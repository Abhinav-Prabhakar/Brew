"""Adversary for RARL (docs/implementation-spec.md 13.5).

The adversary is an RL agent that injects disruptions against the (frozen) protagonist manager.  At every
manager tick it picks ``(kind, target, start slot)`` -- ``kind`` has one extra 'none' value so that it can
stay idle -- with a **budget of 3 hits per day** and plausibility masks (a target only where the kind takes
one, the start slot in the future).  Its reward is ``-protagonist profit`` (scaled 1/1000).

``DisruptionScheduler`` holds the action space, budget and masks and turns an action into a scheduled
disruption.  ``AdversaryEnv`` is the training env (protagonist = any ``obs, mask -> action`` callable).
``FrozenAdversary`` wraps a trained MaskablePPO adversary for use inside the protagonist env (mixed
chaos: 50 % random disruptions / 30 % adversary / 20 % calm).
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING, Any

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from brew.domain.enums import DISRUPTION_KINDS

if TYPE_CHECKING:
    from brew.sim.world import World

BUDGET_PER_DAY = 3
N_KINDS = len(DISRUPTION_KINDS) + 1  # 0 = none
N_TARGETS = 4
N_SLOTS = 56  # 08:00 .. 22:00 in 15-minute slots
ADV_NVEC = [N_KINDS, N_TARGETS, N_SLOTS]
ADV_LOGITS = int(sum(ADV_NVEC))
SEVERITY = 0.8
DURATION_MIN = 90.0
SLOT0 = 32  # slot index of 08:00
TARGETED = ("staff_absent", "staff_late", "equipment_down", "supplier_delay", "supplier_short", "demand_spike")


class DisruptionScheduler:
    """Budget + plausibility masks + injection of adversary-chosen disruptions into a world."""

    def __init__(self) -> None:
        self.day = -1
        self.used = 0
        self.log: list[dict[str, Any]] = []

    def budget_left(self, w: World) -> int:
        if w.day != self.day:
            self.day = w.day
            self.used = 0
        return BUDGET_PER_DAY - self.used

    @staticmethod
    def candidates(w: World, kind: str) -> list[str | None]:
        """Up to 4 plausible targets for ``kind`` (``[None]`` for untargeted kinds)."""
        if kind in ("staff_absent", "staff_late"):
            keys = sorted(k for k, s in w.kitchen.staff.items() if s.role in ("barista", "cook", "cashier"))
        elif kind == "equipment_down":
            keys = sorted({e.key for e in w.equip if e.slots > 0})
        elif kind in ("supplier_delay", "supplier_short"):
            keys = sorted(w.ix.supplier)
        elif kind == "demand_spike":
            keys = sorted(w.cfg.personas)
        else:
            return [None]
        return list(keys[:N_TARGETS])  # type: ignore[arg-type]

    def mask(self, w: World) -> np.ndarray:
        """Flat mask over ``[kind(11), target(4), slot(56)]`` (never all-false per block)."""
        m = np.ones(ADV_LOGITS, dtype=bool)
        left = self.budget_left(w)
        slot_now = int(w.now % 86400 // 900)
        if left <= 0:
            m[1:N_KINDS] = False  # only 'none'
        # a start slot must be after the current tick (and inside opening hours)
        o = N_KINDS + N_TARGETS
        for s in range(N_SLOTS):
            if SLOT0 + s <= slot_now:
                m[o + s] = False
        if not m[o : o + N_SLOTS].any():
            m[o + N_SLOTS - 1] = True  # the last slot stays valid; ``apply`` clamps to the future anyway
        # kinds with a time already past closing are pointless
        # targets: valid index range depends on the kind, but the kind is chosen jointly -> allow idx < max cands
        mt = N_KINDS
        m[mt : mt + N_TARGETS] = True
        return m

    def apply(self, w: World, action: np.ndarray, source: str = "adversary") -> bool:
        """Schedule the chosen disruption.  Returns True when something was injected."""
        k, t, s = int(action[0]), int(action[1]), int(action[2])
        if k == 0 or self.budget_left(w) <= 0:
            return False
        kind = DISRUPTION_KINDS[k - 1]
        cands = self.candidates(w, kind)
        target = cands[t % len(cands)]
        start = (w.day * 86400) + (SLOT0 + s) * 900.0
        start = max(start, w.now + 1.0)
        try:
            w.dis.trigger(kind, target, SEVERITY, start_s=start, duration_min=DURATION_MIN, source=source)
        except ValueError:
            return False
        self.used += 1
        self.log.append({"day": w.day, "kind": kind, "target": target, "start_s": start})
        return True


def random_action(rng: np.random.Generator, mask: np.ndarray) -> np.ndarray:
    """A uniformly random valid adversary action (used for the 'random disruptions' share of the mix)."""
    out = np.zeros(3, dtype=np.int64)
    o = 0
    for d, n in enumerate(ADV_NVEC):
        ok = np.flatnonzero(mask[o : o + n])
        out[d] = int(rng.choice(ok)) if len(ok) else 0
        o += n
    return out


class FrozenAdversary:
    """A saved MaskablePPO adversary used (deterministically) inside protagonist training envs."""

    def __init__(self, path: str | Path) -> None:
        from sb3_contrib import MaskablePPO

        p = Path(path)
        self.model = MaskablePPO.load(str(p / "adversary.zip"), device="cpu")
        self.vn: dict[str, Any] = {}
        stats = p / "adv_vecnormalize.npz"
        if stats.exists():
            z = np.load(stats)
            self.vn = {k: z[k] for k in z.files}

    def normalise(self, x: np.ndarray) -> np.ndarray:
        if not self.vn:
            return x
        return np.clip((x - self.vn["mean"]) / np.sqrt(self.vn["var"] + 1e-8), -10.0, 10.0).astype(np.float32)

    def __call__(self, adv_obs: np.ndarray, mask: np.ndarray) -> np.ndarray:
        a, _ = self.model.predict(self.normalise(adv_obs[None]), action_masks=mask[None], deterministic=False)
        return np.asarray(a[0], dtype=np.int64)


def adversary_obs(proto_obs: np.ndarray, sched: DisruptionScheduler, w: World) -> np.ndarray:
    """Protagonist observation + [budget left / 3, active disruptions / 3, day fraction]."""
    act = len(w.dis.active_list())
    extra = np.array([sched.budget_left(w) / BUDGET_PER_DAY, min(act, 3) / 3.0, (w.now % 86400) / 86400.0], np.float32)
    return np.concatenate([proto_obs.astype(np.float32), extra])


ADV_OBS_DIM = 183 + 3
Protagonist = Callable[[np.ndarray, np.ndarray], np.ndarray]


def make_adv_env(env_config: Any, files: tuple[str, str]) -> AdversaryEnv:
    """Top-level (picklable) factory so adversary envs can run in ``SubprocVecEnv`` workers."""
    return AdversaryEnv(env_config, protagonist_files=files)


class AdversaryEnv(gym.Env):  # type: ignore[type-arg]
    """Gymnasium env for the adversary.  One step = one manager tick of the protagonist's world.

    ``protagonist(obs, mask) -> action`` is the frozen manager (SB3 model or ONNX); the env's reward is
    ``-d_profit / 1000`` of the protagonist over the tick.
    """

    metadata: dict[str, Any] = {"render_modes": []}

    def __init__(
        self, env_config: Any = None, protagonist: Protagonist | None = None,
        protagonist_files: tuple[str, str] | None = None,
    ) -> None:
        super().__init__()
        from .env import BrewManagerEnv, EnvConfig

        cfg = env_config or EnvConfig()
        cfg = EnvConfig(**{**cfg.__dict__, "chaos": "none"})
        self.inner = BrewManagerEnv(cfg)
        self.protagonist = protagonist
        self.protagonist_files = protagonist_files  # (model.zip, vecnormalize.pkl): loaded lazily in the worker
        self.sched = DisruptionScheduler()
        self.observation_space = spaces.Box(-100.0, 100.0, (ADV_OBS_DIM,), np.float32)
        self.action_space = spaces.MultiDiscrete(ADV_NVEC)
        self._mask = np.ones(ADV_LOGITS, dtype=bool)
        self._obs = np.zeros(ADV_OBS_DIM, np.float32)

    def set_protagonist(self, fn: Protagonist) -> None:
        self.protagonist = fn

    def _observe(self, proto_obs: np.ndarray) -> np.ndarray:
        w = self.inner.world
        assert w is not None
        self._mask = self.sched.mask(w)
        return adversary_obs(proto_obs, self.sched, w)

    def _load_protagonist(self) -> None:
        if self.protagonist is None and self.protagonist_files is not None:
            from .train_ppo import load_policy

            model, norm = load_policy(self.protagonist_files[0], self.protagonist_files[1], device="cpu")

            def fn(obs: np.ndarray, mask: np.ndarray) -> np.ndarray:
                a, _ = model.predict(norm(obs[None]), action_masks=mask[None], deterministic=True)
                return np.asarray(a[0], dtype=np.int64)

            self.protagonist = fn

    def reset(self, *, seed: int | None = None, options: dict[str, Any] | None = None) -> tuple[np.ndarray, dict[str, Any]]:
        super().reset(seed=seed)
        self._load_protagonist()
        self.sched = DisruptionScheduler()
        proto_obs, _info = self.inner.reset(seed=seed, options=options)
        self._obs = self._observe(proto_obs)
        return self._obs, {}

    def action_masks(self) -> np.ndarray:
        return self._mask

    def step(self, action: Any) -> tuple[np.ndarray, float, bool, bool, dict[str, Any]]:
        w = self.inner.world
        assert w is not None
        a = np.asarray(action, dtype=np.int64).reshape(-1)
        injected = False
        if a[0] < N_KINDS and self._mask[a[0]]:
            injected = self.sched.apply(w, a)
        proto_obs = self.inner.last_obs_vec()
        pa = (
            self.protagonist(proto_obs, self.inner.action_masks())
            if self.protagonist is not None
            else self.inner.action_space.sample()
        )
        obs, _r, term, trunc, info = self.inner.step(pa)
        reward = -float(info["reward_parts"]["d_profit"])
        self._obs = self._observe(obs)
        info = {"injected": injected, "budget_left": self.sched.budget_left(w), **info}
        return self._obs, reward, term, trunc, info
