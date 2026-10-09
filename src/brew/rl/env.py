"""``BrewManagerEnv``: the manager as a Gymnasium environment (technical.md 13.1).

One step = one manager tick (900 sim-s).  ``reset`` builds a :class:`World` whose policy is the
:class:`~brew.policies.D_rl.ManagerExecutor` (Policy C's scheduler / newsvendor machinery parametrised by the
action) and runs to the first tick.  ``step(action)`` sanitises the action with the masks (shield), decodes it
into a :class:`ManagerAction`, applies it through the charter shield in ``World.apply_manager_action`` and runs
the simulation to the next tick (all event-level decisions inside are handled by the executor).

Observation: the 183 named floats of ``sim/observation.py``.  Action: ``MultiDiscrete(NVEC)``.  Masks:
``action_masks()`` (flat, 96 wide, never all-false per dimension).  Reward: ``rl/reward.py``.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta
from typing import Any

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from brew.config.loader import default_cafe, load_scenario
from brew.config.schemas import ScenarioConfig
from brew.domain.enums import DISRUPTION_KINDS
from brew.policies.D_rl import ManagerExecutor
from brew.sim.world import World

from .actions import NVEC, sanitize
from .masks import compute_masks
from .reward import RewardConfig, RewardTracker

OBS_DIM = 183
OBS_CLIP = 100.0
TRAIN_SCENARIOS = (
    "weekday_normal", "weekend_brunch", "rainy_delivery_surge", "heatwave", "exam_week", "festival", "chaos_random",
)  # fmt: skip
WEATHER_PROFILES = ("default", "monsoon", "dry")


@dataclass
class EnvConfig:
    """Everything a worker process needs to build an env (picklable)."""

    scenarios: tuple[str, ...] = ("weekday_normal",)
    days: int = 1
    domain_randomisation: bool = False
    chaos: str = "none"  # none | random | mix (random / adversary / calm episodes)
    chaos_mix: tuple[float, float, float] = (0.5, 0.3, 0.2)
    seed: int = 0  # base seed when ``reset`` gets none
    models_dir: str | None = None
    use_models: bool = True
    adversary_dir: str | None = None  # frozen adversary used in 'adversary' episodes
    reward: RewardConfig = field(default_factory=RewardConfig)
    # Re-predict the executor's LightGBM forecast every N manager ticks (sliced in between). 4 = hourly: ~2x faster
    # env steps and far less cache thrash across parallel workers; Policy C/D outside training keep 1 (every tick).
    forecast_refresh_slots: int = 4

    def replace(self, **kw: Any) -> EnvConfig:
        d = dict(self.__dict__)
        d.update(kw)
        return EnvConfig(**d)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def randomise_scenario(base: ScenarioConfig, rng: np.random.Generator, chaos_rate: float | None) -> ScenarioConfig:
    """Domain randomisation: demand level / persona mix, weather profile, temperature, chaos rate."""
    d = base.demand
    cfg = default_cafe()
    personas = sorted(cfg.personas)
    pm = dict(d.persona_mult)
    for p in rng.choice(personas, size=3, replace=False):
        pm[str(p)] = pm.get(str(p), 1.0) * float(rng.uniform(0.8, 1.25))
    demand = d.model_copy(update={"global_mult": d.global_mult * float(rng.uniform(0.85, 1.15)), "persona_mult": pm})
    weather = base.weather.model_copy(
        update={
            "profile": str(rng.choice(WEATHER_PROFILES)) if not base.weather.forced else base.weather.profile,
            "temp_offset": base.weather.temp_offset + float(rng.uniform(-2.0, 3.0)),
        }
    )
    chaos = dict(base.random_chaos)
    if chaos_rate is not None:
        chaos = {"rate_per_day": chaos_rate, "kinds": list(DISRUPTION_KINDS)}
    return base.model_copy(update={"demand": demand, "weather": weather, "random_chaos": chaos})


class BrewManagerEnv(gym.Env):  # type: ignore[type-arg]
    """Manager-level Gymnasium environment for Policy D (see module docstring)."""

    metadata: dict[str, Any] = {"render_modes": []}

    def __init__(self, config: EnvConfig | None = None, **overrides: Any) -> None:
        super().__init__()
        self.cfg = (config or EnvConfig()).replace(**overrides) if overrides else (config or EnvConfig())
        self.observation_space = spaces.Box(-OBS_CLIP, OBS_CLIP, (OBS_DIM,), np.float32)
        self.action_space = spaces.MultiDiscrete(NVEC)
        self.world: World | None = None
        self.executor: ManagerExecutor | None = None
        self.tracker: RewardTracker | None = None
        self._obs_vec = np.zeros(OBS_DIM, np.float32)
        self._mask = np.ones(int(sum(NVEC)), dtype=bool)
        self._episodes = 0
        self._ep_reward = 0.0
        self._steps = 0
        self.shaping_scale = self.cfg.reward.shaping_scale
        self.mode = "calm"
        self._adv_fn: Callable[[np.ndarray, np.ndarray], np.ndarray] | None = None
        self._sched: Any = None
        self._rng = np.random.default_rng(self.cfg.seed)

    # ------------------------------------------------------------------ helpers
    def set_shaping_scale(self, s: float) -> None:
        """Curriculum hook (called through ``VecEnv.env_method``)."""
        self.shaping_scale = float(s)
        if self.tracker is not None:
            self.tracker.cfg.shaping_scale = float(s)

    def set_days(self, days: int) -> None:
        """Curriculum hook: the next episode lasts ``days`` days."""
        self.cfg = self.cfg.replace(days=int(days))

    def last_obs_vec(self) -> np.ndarray:
        return self._obs_vec

    def action_masks(self) -> np.ndarray:
        return self._mask

    def _load_adversary(self) -> None:
        if self._adv_fn is None and self.cfg.adversary_dir:
            from .adversary import FrozenAdversary

            self._adv_fn = FrozenAdversary(self.cfg.adversary_dir)

    def _build_scenario(self, name: str, options: dict[str, Any]) -> tuple[ScenarioConfig, str | None]:
        base = load_scenario(name)
        dr = bool(options.get("domain_randomisation", self.cfg.domain_randomisation))
        chaos_rate: float | None = None
        if self.mode == "random":
            chaos_rate = float(self._rng.uniform(1.0, 3.0))
        elif self.mode in ("calm", "adversary") and self.cfg.chaos != "none":
            chaos_rate = 0.0
        if not dr and chaos_rate is None:
            return base, None
        scn = randomise_scenario(base, self._rng, chaos_rate) if dr else base.model_copy(
            update={"random_chaos": {"rate_per_day": chaos_rate, "kinds": list(DISRUPTION_KINDS)}}
        )
        start = None
        if dr:
            d0 = date.fromisoformat(base.start_date) + timedelta(days=int(self._rng.integers(0, 28)))
            start = d0.isoformat()
        return scn, start

    def _pick_mode(self) -> str:
        c = self.cfg.chaos
        if c == "none":
            return "calm"
        if c == "random":
            return "random"
        if c == "mix":
            p = np.asarray(self.cfg.chaos_mix, dtype=float)
            m = str(self._rng.choice(["random", "adversary", "calm"], p=p / p.sum()))
            if m == "adversary" and not self.cfg.adversary_dir:
                m = "random"
            return m
        return c

    # -------------------------------------------------------------------- reset
    def reset(self, *, seed: int | None = None, options: dict[str, Any] | None = None) -> tuple[np.ndarray, dict[str, Any]]:
        super().reset(seed=seed)
        options = options or {}
        if seed is None:
            seed = self.cfg.seed + 7919 * self._episodes + 1
        self._rng = np.random.default_rng(int(seed) * 2654435761 % (2**32))
        self._episodes += 1
        self.mode = options.get("chaos") or self._pick_mode()
        names = self.cfg.scenarios
        name = str(options.get("scenario") or (names[int(self._rng.integers(0, len(names)))] if len(names) > 1 else names[0]))
        days = int(options.get("days", self.cfg.days))
        scn, start = self._build_scenario(name, options)
        self.executor = ManagerExecutor(models_dir=self.cfg.models_dir, use_models=self.cfg.use_models)
        self.executor.forecast_refresh_slots = int(self.cfg.forecast_refresh_slots)  # applied in reset()
        self.world = World(scenario=scn, policy=self.executor, seed=int(seed), days=days, start_date=start)
        self.tracker = RewardTracker(self.world, self.cfg.reward)
        self.tracker.cfg.shaping_scale = self.shaping_scale
        self._ep_reward = 0.0
        self._steps = 0
        self._sched = None
        if self.mode == "adversary":
            from .adversary import DisruptionScheduler

            self._load_adversary()
            self._sched = DisruptionScheduler()
        self._advance()
        self.tracker.rebase()
        self._refresh_obs()
        return self._obs_vec.copy(), {"scenario": name, "mode": self.mode, "days": days, "seed": int(seed)}

    # --------------------------------------------------------------- simulation
    def _advance(self) -> bool:
        """Run the world to the next manager tick.  False when the episode is over."""
        w, ex = self.world, self.executor
        assert w is not None and ex is not None
        ex.tick_pending = False
        eng, disp = w.engine, w._dispatch
        while not w.done:
            if not eng.step(disp):
                return False
            if ex.tick_pending:
                return True
        return False

    def _refresh_obs(self) -> None:
        w, ex = self.world, self.executor
        assert w is not None and ex is not None
        obs = ex.last_obs if ex.tick_pending and ex.last_obs is not None else w.obs_builder.build()
        v = np.nan_to_num(obs.vec, nan=0.0, posinf=OBS_CLIP, neginf=-OBS_CLIP)
        self._obs_vec = np.clip(v, -OBS_CLIP, OBS_CLIP).astype(np.float32)
        self._mask = compute_masks(w)

    def _adversary_move(self) -> None:
        w = self.world
        assert w is not None
        if self.mode == "adversary" and self._adv_fn is not None and self._sched is not None:
            from .adversary import adversary_obs

            m = self._sched.mask(w)
            self._sched.apply(w, self._adv_fn(adversary_obs(self._obs_vec, self._sched, w), m))

    # --------------------------------------------------------------------- step
    def step(self, action: Any) -> tuple[np.ndarray, float, bool, bool, dict[str, Any]]:
        w, ex, tr = self.world, self.executor, self.tracker
        assert w is not None and ex is not None and tr is not None, "call reset() first"
        vec = sanitize(np.asarray(action).reshape(-1), self._mask)
        self._adversary_move()
        act = ex.act(vec, ex.last_obs, w.view())
        res = w.apply_manager_action(act, by="D")
        ticked = self._advance()
        terminated = w.done or not ticked
        reward, parts = tr.step(terminal=terminated)
        self._steps += 1
        self._ep_reward += reward
        self._refresh_obs()
        info: dict[str, Any] = {
            "reward_parts": parts, "applied": len(res["applied"]), "clipped": list(res["clipped"]),
            "day": w.day, "profit_cum": tr.prev["profit"],
        }  # fmt: skip
        if terminated:
            dk = w.daily_kpis
            info["kpis"] = {
                "days": len(dk),
                "mean_profit_per_day": float(np.mean([k["net_profit"] for k in dk])) if dk else 0.0,
                "walkouts": float(np.mean([k["walkouts"] for k in dk])) if dk else 0.0,
                "waste_kg": float(np.mean([k["waste_kg"] for k in dk])) if dk else 0.0,
                "sla_breach_rate": float(np.mean([k["sla_breach_rate"] for k in dk])) if dk else 0.0,
                "rating": float(dk[-1]["rating"]) if dk else 0.0,
                "episode_reward": self._ep_reward, "steps": self._steps,
            }  # fmt: skip
        return self._obs_vec.copy(), float(reward), bool(terminated), False, info


def make_env(config: EnvConfig) -> BrewManagerEnv:
    """Top-level (picklable) factory for ``SubprocVecEnv``."""
    return BrewManagerEnv(config)
