"""Adversarial training: RARL alternation of adversary and protagonist (technical.md 13.5).

Iteration ``i`` (``k`` iterations): (1) train the adversary (MaskablePPO over ``[kind, target, slot]``, reward
``-protagonist profit``) against the *frozen* protagonist; (2) fine-tune the protagonist with PPO in envs whose
disruptions come 50 % from random chaos, 30 % from the frozen adversary and 20 % from calm days.  The adversary
is saved as ``adversary/adversary.zip`` + ``adv_vecnormalize.npz``.
"""

from __future__ import annotations

import json
import pickle
from functools import partial
from pathlib import Path
from typing import Any

import numpy as np

from brew.train.config import resolve_n_envs

from . import torch_setup
from .adversary import ADV_NVEC
from .env import EnvConfig
from .progress import RunMonitor
from .train_ppo import PPOTrainer


def prior_from_pkl(path: Path | str) -> dict[str, Any]:
    """VecNormalize statistics of a saved run as a ``build_venv`` prior."""
    with open(path, "rb") as f:
        vn: Any = pickle.load(f)
    return {
        "obs_mean": np.asarray(vn.obs_rms.mean).tolist(), "obs_var": np.asarray(vn.obs_rms.var).tolist(),
        "ret_scale": float(np.sqrt(float(vn.ret_rms.var) + 1e-8)), "count": float(vn.obs_rms.count),
    }  # fmt: skip


def train_adversary_phase(
    cfg: Any, env_cfg: EnvConfig, proto_files: tuple[str, str], steps: int, out_dir: Path, monitor: RunMonitor,
    device: str, model: Any = None, seed: int = 0,
) -> tuple[Any, dict[str, Any]]:  # fmt: skip
    """Train (or continue) the adversary for ``steps`` env steps against the frozen protagonist (saved files)."""
    from sb3_contrib import MaskablePPO
    from stable_baselines3.common.vec_env import DummyVecEnv, SubprocVecEnv, VecMonitor, VecNormalize

    from .adversary import make_adv_env

    fns: Any = [partial(make_adv_env, env_cfg.replace(seed=env_cfg.seed + 7001 * (i + 1)), proto_files) for i in range(resolve_n_envs(cfg.n_envs))]
    raw: Any = SubprocVecEnv(fns, start_method=torch_setup.vec_start_method()) if cfg.vec == "subproc" and len(fns) > 1 else DummyVecEnv(fns)
    venv = VecNormalize(VecMonitor(raw), gamma=0.99, clip_obs=10.0)
    if model is None:
        model = MaskablePPO(
            "MlpPolicy", venv, n_steps=int(cfg.n_steps), batch_size=int(cfg.batch_size), learning_rate=float(cfg.lr),
            ent_coef=float(cfg.ent_coef), gamma=0.99, policy_kwargs={"net_arch": [128, 128]}, device=device,
            seed=seed, verbose=0, tensorboard_log=str(out_dir.parent / "tb"),
        )  # fmt: skip
    else:
        model.set_env(venv)
    rewards: list[float] = []
    profits: list[float] = []

    from stable_baselines3.common.callbacks import BaseCallback

    class Cb(BaseCallback):  # type: ignore[misc]
        def _on_step(self) -> bool:
            for info in self.locals.get("infos", []):
                if "episode" in info:
                    rewards.append(float(info["episode"]["r"]))
                if "kpis" in info:
                    profits.append(float(info["kpis"]["mean_profit_per_day"]))
            if self.num_timesteps % 256 < self.training_env.num_envs:
                monitor.update(substage_step=int(self.num_timesteps))
            return True

    model.learn(total_timesteps=steps, callback=Cb(), reset_num_timesteps=False, progress_bar=False, tb_log_name="adversary")
    out_dir.mkdir(parents=True, exist_ok=True)
    model.save(str(out_dir / "adversary.zip"))
    rms: Any = venv.obs_rms
    np.savez(out_dir / "adv_vecnormalize.npz", mean=rms.mean, var=rms.var)
    venv.close()
    stats = {
        "steps": int(model.num_timesteps), "episodes": len(rewards),
        "mean_reward_first": float(np.mean(rewards[: max(1, len(rewards) // 3)])) if rewards else None,
        "mean_reward_last": float(np.mean(rewards[-max(1, len(rewards) // 3) :])) if rewards else None,
        "protagonist_profit_under_attack": float(np.mean(profits)) if profits else None,
    }  # fmt: skip
    return model, stats


def run_rarl(
    cfg: Any, ppo_cfg: Any, env_base: EnvConfig, run_dir: Path, monitor: RunMonitor, device: str,
    protagonist_zip: Path, protagonist_vecnorm: Path, n_envs: int = 2, resume_ok: bool = True,
) -> dict[str, Any]:  # fmt: skip
    """Alternate ``cfg.iterations`` adversary / protagonist phases.  Returns metrics + final weights paths."""
    from brew.train.config import CurriculumStage, PPOCfg, RLEvalCfg

    dev = torch_setup.pick_device(device)
    adv_dir = run_dir / "adversary"
    k = max(1, int(cfg.iterations))
    adv_steps = max(int(cfg.n_steps) * resolve_n_envs(cfg.n_envs), int(cfg.total_timesteps) // k)
    cur_zip, cur_vn = protagonist_zip, protagonist_vecnorm
    adv_model: Any = None
    history: list[dict[str, Any]] = []
    scn = (cfg.scenario,)
    base = env_base.replace(days=int(cfg.days), scenarios=scn, domain_randomisation=False)
    for it in range(k):
        monitor.log(f"RARL iteration {it + 1}/{k}: adversary phase ({adv_steps} steps)")
        adv_model, astats = train_adversary_phase(
            cfg, base, (str(cur_zip), str(cur_vn)), adv_steps, adv_dir, monitor, dev, adv_model, seed=int(cfg.seed) + it
        )
        monitor.log(
            f"  adversary: episodes {astats['episodes']}, reward {astats['mean_reward_first']} -> {astats['mean_reward_last']}, "
            f"protagonist profit/day under attack {astats['protagonist_profit_under_attack']}"
        )
        monitor.log(f"RARL iteration {it + 1}/{k}: protagonist phase ({int(cfg.protagonist_steps)} steps vs random/adversary/calm mix)")
        pcfg = PPOCfg(
            **{**ppo_cfg.model_dump(), "total_timesteps": int(cfg.protagonist_steps), "n_envs": n_envs, "vec": cfg.vec,
               "curriculum": [CurriculumStage(days=int(cfg.days), frac=1.0, shaping=float(ppo_cfg.curriculum[-1].shaping))],
               "eval": RLEvalCfg(every=10**9, seeds=2, days=int(cfg.days), scenario=cfg.scenario, base_seed=int(ppo_cfg.eval.base_seed)),
               "checkpoint_every": 10**9}
        )  # fmt: skip
        env_p = base.replace(chaos="mix", chaos_mix=tuple(cfg.chaos_mix), adversary_dir=str(adv_dir))
        tr = PPOTrainer(
            pcfg, env_p, run_dir, monitor, dev, prior=prior_from_pkl(cur_vn), init_model=cur_zip, n_envs=n_envs,
            eval_dir=run_dir / "eval", ckpt_dir=run_dir / "checkpoints", tag=f"rarl{it + 1}",
        )  # fmt: skip
        out = tr.run()
        cur_zip = run_dir / f"rarl{it + 1}" / "final_model.zip"
        cur_vn = run_dir / f"rarl{it + 1}" / "final_vecnormalize.pkl"
        history.append({"iteration": it + 1, "adversary": astats, "protagonist": {k_: out[k_] for k_ in ("first_eval", "last_eval", "total_steps")}})
    metrics = {"iterations": k, "history": history, "final_model": str(cur_zip), "final_vecnorm": str(cur_vn),
               "adversary_dir": str(adv_dir), "adv_nvec": ADV_NVEC}  # fmt: skip
    (run_dir / "adversary" / "metrics.json").write_text(json.dumps(metrics, indent=2, default=str))
    return metrics
