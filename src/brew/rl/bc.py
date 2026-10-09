"""Behaviour cloning from Policy C (docs/implementation-spec.md 13.5).

1. Roll out the real Policy C (CP-SAT, custom Replate, pricing ladder, newsvendor) for N days in the same
   worlds the env builds, recording ``(observation, action vector, mask, reward)`` at every manager tick.
   The action vector is what C's decisions imply in the RL action space (``actions.encode_teacher``).
2. Train the MaskablePPO policy's action heads (cross-entropy over the masked per-dimension distributions)
   plus its value head (regression on discounted returns) and save the initial weights together with the
   observation / return normalisation statistics (``VecNormalize`` priors).
"""

from __future__ import annotations

import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from brew.config.loader import load_scenario
from brew.parallel import pool_context
from brew.policies.C_solver import PolicyC
from brew.sim.world import World

from . import torch_setup  # noqa: F401  (must precede any torch use)
from .actions import NVEC, encode_teacher, sanitize
from .env import OBS_CLIP, OBS_DIM, randomise_scenario
from .masks import compute_masks
from .reward import RewardConfig, RewardTracker


class TeacherC(PolicyC):
    """Policy C that records its decisions as RL-space labels (a drop-in policy for a World)."""

    def __init__(self, models_dir: str | Path | None = None, reward: RewardConfig | None = None) -> None:
        super().__init__(models_dir=models_dir)
        self.rewcfg = reward or RewardConfig()
        self.tracker: RewardTracker | None = None
        self.obs: list[np.ndarray] = []
        self.act_vec: list[np.ndarray] = []
        self.masks: list[np.ndarray] = []
        self.rew: list[float] = []

    def on_manager_tick(self, obs: Any, view: Any) -> Any:
        w = view._w
        act = super().on_manager_tick(obs, view)
        if self.tracker is None:
            self.tracker = RewardTracker(w, self.rewcfg)
            self.tracker.rebase()
        else:
            self.rew.append(self.tracker.step()[0])  # reward earned by the previous tick's action
        self.obs.append(np.clip(np.nan_to_num(obs.vec), -OBS_CLIP, OBS_CLIP).astype(np.float32))
        mask = compute_masks(w)
        label = encode_teacher(self.teach_kappa, self.teach_premake, self.teach_steps, w.batch_window_s)
        self.act_vec.append(sanitize(label, mask))  # the shield applies to the teacher too
        self.masks.append(mask)
        return act

    def finish(self) -> None:
        """Credit the last action with the remaining reward (+ terminal term)."""
        assert self.tracker is not None
        self.rew.append(self.tracker.step(terminal=True)[0])


def collect_episode(spec: dict[str, Any]) -> dict[str, Any]:
    """Worker: one Policy C episode of ``days`` days -> arrays (top-level so it can run in a process pool)."""
    seed = int(spec["seed"])
    rng = np.random.default_rng(seed * 2654435761 % (2**32))
    scn = load_scenario(spec.get("scenario", "weekday_normal"))
    start = None
    if spec.get("dr"):
        scn = randomise_scenario(scn, rng, None)
    pol = TeacherC(spec.get("models_dir"), RewardConfig(**spec.get("reward", {})))
    w = World(scenario=scn, policy=pol, seed=seed, days=int(spec["days"]), start_date=start)
    t0 = time.perf_counter()
    w.run(int(spec["days"]))
    pol.finish()
    n = len(pol.obs)
    assert len(pol.rew) == n, (len(pol.rew), n)
    return {
        "obs": np.stack(pol.obs), "act": np.stack(pol.act_vec), "mask": np.stack(pol.masks),
        "rew": np.asarray(pol.rew, np.float32), "wall_s": time.perf_counter() - t0,
        "profit": [float(k["net_profit"]) for k in w.daily_kpis], "seed": seed,
    }  # fmt: skip


@dataclass
class BCData:
    """Concatenated teacher rollouts."""

    obs: np.ndarray
    act: np.ndarray
    mask: np.ndarray
    ret: np.ndarray  # discounted returns-to-go (unscaled)
    ep_starts: list[int]
    stats: dict[str, Any]


def discounted_returns(rew: np.ndarray, gamma: float) -> np.ndarray:
    out = np.zeros_like(rew, dtype=np.float64)
    g = 0.0
    for i in range(len(rew) - 1, -1, -1):
        g = rew[i] + gamma * g
        out[i] = g
    return out


def collect_teacher(
    days: int, episode_days: int, seed0: int, gamma: float, models_dir: str | Path | None = None,
    workers: int = 1, scenarios: tuple[str, ...] = ("weekday_normal",), dr: bool = False,
    reward: RewardConfig | None = None, log: Any = None,
) -> BCData:  # fmt: skip
    """Roll out Policy C for ``days`` days in episodes of ``episode_days``."""
    n_ep = max(1, int(np.ceil(days / episode_days)))
    specs = [
        {"seed": seed0 + i, "days": episode_days, "scenario": scenarios[i % len(scenarios)], "dr": dr,
         "models_dir": str(models_dir) if models_dir else None, "reward": (reward or RewardConfig()).__dict__}
        for i in range(n_ep)
    ]  # fmt: skip
    if workers > 1 and n_ep > 1:
        with ProcessPoolExecutor(max_workers=workers, mp_context=pool_context()) as ex:
            res = []
            for i, r in enumerate(ex.map(collect_episode, specs)):
                res.append(r)
                if log:
                    log(f"  BC teacher episode {i + 1}/{n_ep} done ({r['wall_s']:.0f}s)")
    else:
        res = []
        for i, sp in enumerate(specs):
            res.append(collect_episode(sp))
            if log:
                log(f"  BC teacher episode {i + 1}/{n_ep} done ({res[-1]['wall_s']:.0f}s)")
    obs = np.concatenate([r["obs"] for r in res])
    act = np.concatenate([r["act"] for r in res])
    mask = np.concatenate([r["mask"] for r in res])
    ret = np.concatenate([discounted_returns(r["rew"], gamma) for r in res]).astype(np.float32)
    starts, o = [], 0
    for r in res:
        starts.append(o)
        o += len(r["obs"])
    prof = [p for r in res for p in r["profit"]]
    stats = {
        "episodes": n_ep, "samples": len(obs), "teacher_profit_per_day": float(np.mean(prof)),
        "wall_s": float(sum(r["wall_s"] for r in res)),
        "label_hist": {i: np.bincount(act[:, i], minlength=n).tolist() for i, n in enumerate(NVEC)},
    }  # fmt: skip
    return BCData(obs, act, mask, ret, starts, stats)


class SpecEnv(gym.Env):  # type: ignore[type-arg]
    """Space-only env used to construct a policy without building a world."""

    def __init__(self) -> None:
        super().__init__()
        self.observation_space = spaces.Box(-OBS_CLIP, OBS_CLIP, (OBS_DIM,), np.float32)
        self.action_space = spaces.MultiDiscrete(NVEC)

    def reset(self, *, seed: int | None = None, options: dict[str, Any] | None = None) -> tuple[np.ndarray, dict[str, Any]]:
        super().reset(seed=seed)
        return np.zeros(OBS_DIM, np.float32), {}

    def step(self, action: Any) -> tuple[np.ndarray, float, bool, bool, dict[str, Any]]:
        return np.zeros(OBS_DIM, np.float32), 0.0, True, False, {}

    def action_masks(self) -> np.ndarray:
        return np.ones(int(sum(NVEC)), dtype=bool)


def new_model(
    net_arch: tuple[int, ...] = (256, 256), device: str = "auto", seed: int = 0, tensorboard_log: str | None = None,
    **ppo_kw: Any,
) -> Any:  # fmt: skip
    """A fresh MaskablePPO (MlpPolicy) over the manager spaces."""
    from sb3_contrib import MaskablePPO
    from stable_baselines3.common.vec_env import DummyVecEnv

    venv = DummyVecEnv([SpecEnv])
    return MaskablePPO(
        "MlpPolicy", venv, policy_kwargs={"net_arch": list(net_arch)}, device=device, seed=seed,
        tensorboard_log=tensorboard_log, verbose=0, **ppo_kw,
    )  # fmt: skip


def train_bc(
    model: Any, data: BCData, *, epochs: int = 60, batch_size: int = 256, lr: float = 1e-3, vf_coef: float = 0.5,
    var_floor: float = 0.05, log: Any = None, seed: int = 0,
) -> dict[str, Any]:  # fmt: skip
    """Fit the policy (and value head) to the teacher.  Returns metrics and the normalisation priors.

    The observation prior is the teacher's mean / variance (variance floored so that features that were
    constant under C -- e.g. disruption flags -- do not blow up later); the return scale is the std of the
    discounted returns, used both to scale the value targets and as ``VecNormalize.ret_rms`` prior.
    """
    import torch

    torch.manual_seed(seed)
    mean = data.obs.mean(axis=0)
    var = np.maximum(data.obs.var(axis=0), var_floor)
    ret_scale = float(np.sqrt(data.ret.var() + 1e-8))
    ret_mean = 0.0  # value targets are scaled, not centred (matches VecNormalize reward scaling)
    x = torch.as_tensor(np.clip((data.obs - mean) / np.sqrt(var + 1e-8), -10.0, 10.0), dtype=torch.float32)
    a = torch.as_tensor(data.act, dtype=torch.long)
    m = torch.as_tensor(data.mask, dtype=torch.bool)
    y = torch.as_tensor((data.ret - ret_mean) / ret_scale, dtype=torch.float32)
    dev = model.device
    x, a, m, y = x.to(dev), a.to(dev), m.to(dev), y.to(dev)
    pol = model.policy
    pol.set_training_mode(True)
    opt = torch.optim.Adam(pol.parameters(), lr=lr)
    n = len(x)
    g = torch.Generator().manual_seed(seed)
    hist: list[dict[str, float]] = []
    for ep in range(epochs):
        perm = torch.randperm(n, generator=g)
        tot_pi = tot_v = 0.0
        correct = 0.0
        nb = 0
        for i in range(0, n, batch_size):
            idx = perm[i : i + batch_size].to(dev)
            values, logp, _ent = pol.evaluate_actions(x[idx], a[idx], action_masks=m[idx])
            loss_pi = -logp.mean()
            loss_v = torch.nn.functional.mse_loss(values.flatten(), y[idx])
            loss = loss_pi + vf_coef * loss_v
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(pol.parameters(), 1.0)
            opt.step()
            tot_pi += float(loss_pi.detach())
            tot_v += float(loss_v.detach())
            nb += 1
        with torch.no_grad():
            dist = pol.get_distribution(x, action_masks=m)
            pred = dist.get_actions(deterministic=True)
            correct = float((pred == a).float().mean())
        hist.append({"epoch": ep, "policy_loss": tot_pi / nb, "value_loss": tot_v / nb, "accuracy": correct})
        if log and (ep % max(1, epochs // 6) == 0 or ep == epochs - 1):
            log(f"  BC epoch {ep + 1}/{epochs}: policy loss {tot_pi / nb:.3f} value loss {tot_v / nb:.3f} acc {correct:.3f}")
    pol.set_training_mode(False)
    return {
        "loss_first": hist[0]["policy_loss"], "loss_last": hist[-1]["policy_loss"],
        "value_loss_first": hist[0]["value_loss"], "value_loss_last": hist[-1]["value_loss"],
        "accuracy": hist[-1]["accuracy"], "epochs": epochs, "samples": n, "ret_scale": ret_scale,
        "obs_mean": mean.tolist(), "obs_var": var.tolist(), "history": hist,
    }  # fmt: skip
