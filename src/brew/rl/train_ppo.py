"""MaskablePPO training for the manager: curriculum over episode length, VecNormalize, evaluation, checkpoints.

* ``build_venv`` builds the training VecEnv (``DummyVecEnv`` in-process or ``SubprocVecEnv`` workers) wrapped by
  ``VecMonitor`` and ``VecNormalize`` (statistics saved with every checkpoint).
* ``Evaluator`` runs deterministic evaluation episodes on held-out seeds (in parallel when workers are available).
* ``train_ppo`` runs the curriculum (1 day -> 7 days -> 28 days with shaping annealing), writes
  ``eval/ppo_eval_<step>.json``, keeps the best evaluated weights (the step-0 evaluation is the BC init), saves
  resumable checkpoints and updates ``progress.json``.
"""

from __future__ import annotations

import json
import time
from functools import partial
from pathlib import Path
from typing import Any

import numpy as np

from . import torch_setup
from .env import BrewManagerEnv, EnvConfig, make_env
from .progress import RunMonitor
from .reward import RewardConfig

CKPT_PREFIX = "ppo_"


# ------------------------------------------------------------------------------ envs
def _env_cfgs(base: EnvConfig, n: int) -> list[EnvConfig]:
    return [base.replace(seed=base.seed + 100_003 * i) for i in range(n)]


def make_venv(base: EnvConfig, n_envs: int, kind: str = "dummy") -> Any:
    """A raw VecEnv of ``n_envs`` manager envs with distinct seed streams."""
    from stable_baselines3.common.vec_env import DummyVecEnv, SubprocVecEnv

    fns = [partial(make_env, c) for c in _env_cfgs(base, n_envs)]
    if kind == "subproc" and n_envs > 1:
        return SubprocVecEnv(fns, start_method=torch_setup.vec_start_method())  # type: ignore[arg-type]
    return DummyVecEnv(fns)  # type: ignore[arg-type]


def build_venv(
    base: EnvConfig, n_envs: int, kind: str, gamma: float, prior: dict[str, Any] | None = None,
    carry: Any = None,
) -> Any:  # fmt: skip
    """Training VecEnv: Monitor -> VecNormalize.  ``prior`` (BC statistics) or ``carry`` (previous VecNormalize)
    initialise the running statistics."""
    from stable_baselines3.common.vec_env import VecMonitor, VecNormalize

    v = VecNormalize(VecMonitor(make_venv(base, n_envs, kind)), norm_obs=True, norm_reward=True, clip_obs=10.0, clip_reward=10.0, gamma=gamma)
    obs_rms: Any = v.obs_rms
    if carry is not None:
        v.obs_rms, v.ret_rms = carry.obs_rms, carry.ret_rms
    elif prior is not None:
        obs_rms.mean = np.asarray(prior["obs_mean"], dtype=np.float64)
        obs_rms.var = np.asarray(prior["obs_var"], dtype=np.float64)
        obs_rms.count = float(prior.get("count", 100))
        v.ret_rms.var = np.asarray(float(prior["ret_scale"]) ** 2, dtype=np.float64)
        v.ret_rms.count = float(prior.get("count", 100))
    return v


class GlobalLR:
    """Learning rate decaying linearly over the *whole* run (not per curriculum stage). Picklable."""

    def __init__(self, start: float, end: float) -> None:
        self.start, self.end, self.progress = start, end, 0.0

    def __call__(self, _remaining: float) -> float:
        return float(self.start + (self.end - self.start) * min(1.0, max(0.0, self.progress)))


# -------------------------------------------------------------------------- evaluation
class Evaluator:
    """Deterministic evaluation on held-out seeds ``base_seed .. base_seed + n_seeds - 1``."""

    def __init__(self, env_cfg: EnvConfig, n_seeds: int, base_seed: int, workers: int = 1) -> None:
        self.n_seeds = n_seeds
        self.base_seed = base_seed
        self.n = max(1, min(workers, n_seeds))
        self.cfg = env_cfg.replace(chaos="none", domain_randomisation=False, adversary_dir=None)
        self.venv = make_venv(self.cfg, self.n, "subproc" if self.n > 1 else "dummy")

    def close(self) -> None:
        self.venv.close()

    def run(self, model: Any, normalise: Any) -> dict[str, Any]:
        """``normalise(obs) -> obs`` applies the training VecNormalize statistics."""
        rewards: list[float] = []
        kpis: list[dict[str, float]] = []
        for start in range(0, self.n_seeds, self.n):
            m = min(self.n, self.n_seeds - start)
            self.venv.seed(self.base_seed + start)
            obs = self.venv.reset()
            done = np.zeros(self.n, dtype=bool)
            ep_r = np.zeros(self.n)
            fin: list[dict[str, float] | None] = [None] * self.n
            while not done[:m].all():
                masks = np.stack(self.venv.env_method("action_masks"))
                act, _ = model.predict(normalise(obs), action_masks=masks, deterministic=True)
                obs, r, d, infos = self.venv.step(act)
                for i in range(m):
                    if done[i]:
                        continue
                    ep_r[i] += r[i]
                    if d[i]:
                        done[i] = True
                        fin[i] = infos[i].get("kpis")
            for i in range(m):
                rewards.append(float(ep_r[i]))
                kpis.append(fin[i] or {})
        profit = [k.get("mean_profit_per_day", 0.0) for k in kpis]
        return {
            "mean_reward": float(np.mean(rewards)), "std_reward": float(np.std(rewards)),
            "mean_profit": float(np.mean(profit)), "rewards": rewards, "profits": profit,
            "mean_walkouts": float(np.mean([k.get("walkouts", 0.0) for k in kpis])),
            "mean_waste_kg": float(np.mean([k.get("waste_kg", 0.0) for k in kpis])),
            "mean_sla_breach": float(np.mean([k.get("sla_breach_rate", 0.0) for k in kpis])),
            "n_seeds": self.n_seeds,
        }  # fmt: skip


# ---------------------------------------------------------------------------- callbacks
def _callback_cls() -> Any:
    from stable_baselines3.common.callbacks import BaseCallback

    class PPOCallback(BaseCallback):  # type: ignore[misc]
        """Progress, evaluation, best-model tracking and checkpoints."""

        def __init__(self, trainer: PPOTrainer) -> None:
            super().__init__()
            self.t = trainer
            self._ep_rewards: list[float] = []
            self._t_log = time.time()

        def _on_training_start(self) -> None:
            for step, r, p in self.t.pending_tb:
                self.logger.record("eval/mean_reward", r)
                self.logger.record("eval/mean_profit", p)
                self.logger.dump(step)
            self.t.pending_tb.clear()

        def _on_rollout_start(self) -> None:
            self.t.lr.progress = self.num_timesteps / max(1, self.t.total_steps)

        def _on_step(self) -> bool:
            for info in self.locals.get("infos", []):
                ep = info.get("episode")
                if ep is not None:
                    self._ep_rewards.append(float(ep["r"]))
            if self.num_timesteps % 256 < self.training_env.num_envs:
                self.t.monitor.update(step=self.num_timesteps)
            return True

        def _on_rollout_end(self) -> None:
            t = self.t
            t.monitor.update(step=self.num_timesteps)
            if t.frozen:  # critic warm-up after BC: the first updates train V only
                if t.warm_left <= 0:
                    t.set_actor_frozen(False)
                    t.monitor.log(f"  critic warm-up done at step {self.num_timesteps}: policy unfrozen")
                else:
                    t.warm_left -= 1
            if self._ep_rewards:
                self.logger.record("rollout/ep_rew_raw_mean", float(np.mean(self._ep_rewards[-20:])))
            if time.time() - self._t_log > 30:
                self._t_log = time.time()
                last = float(np.mean(self._ep_rewards[-20:])) if self._ep_rewards else float("nan")
                t.monitor.log(
                    f"  ppo step {self.num_timesteps}/{t.total_steps} "
                    f"({t.monitor.state['steps_per_s']} steps/s, eta {t.monitor.state['eta_s']} s) "
                    f"recent train ep reward {last:.2f}"
                )
            if self.num_timesteps >= t.next_eval:
                t.evaluate(self.model, self.num_timesteps)
            if self.num_timesteps >= t.next_ckpt:
                t.checkpoint(self.model, self.num_timesteps)

        def _on_training_end(self) -> None:
            pass

    return PPOCallback


class PPOTrainer:
    """Owns the model, the curriculum position, evaluation records and checkpoints of one PPO run."""

    def __init__(
        self, cfg: Any, env_base: EnvConfig, run_dir: Path, monitor: RunMonitor, device: str = "auto",
        prior: dict[str, Any] | None = None, init_model: Path | None = None, n_envs: int = 4,
        eval_dir: Path | None = None, ckpt_dir: Path | None = None, tag: str = "ppo",
    ) -> None:  # fmt: skip
        self.cfg = cfg
        self.env_base = env_base
        self.run_dir = Path(run_dir)
        self.monitor = monitor
        self.device = torch_setup.pick_device(device)
        self.prior = prior
        self.init_model = init_model
        self.n_envs = n_envs
        self.tag = tag
        self.eval_dir = eval_dir or self.run_dir / "eval"
        self.ckpt_dir = ckpt_dir or self.run_dir / "checkpoints"
        self.eval_dir.mkdir(parents=True, exist_ok=True)
        self.ckpt_dir.mkdir(parents=True, exist_ok=True)
        self.total_steps = int(cfg.total_timesteps)
        self.lr = GlobalLR(cfg.lr_start, cfg.lr_end)
        self.evals: list[dict[str, Any]] = []
        self.best: dict[str, Any] | None = None
        self.next_eval = 0
        self.next_ckpt = int(cfg.checkpoint_every)
        self.pending_tb: list[tuple[int, float, float]] = []
        self.frozen = False
        self.warm_left = 0
        self.model: Any = None
        self.venv: Any = None
        self.evaluator: Evaluator | None = None
        bounds, acc = [], 0.0
        for st in cfg.curriculum:
            acc += float(st.frac)
            bounds.append(round(self.total_steps * min(1.0, acc / sum(float(s.frac) for s in cfg.curriculum))))
        bounds[-1] = self.total_steps
        self.bounds = bounds

    # ----------------------------------------------------------------- evaluation
    def evaluate(self, model: Any, step: int) -> dict[str, Any]:
        assert self.evaluator is not None and self.venv is not None
        t0 = time.time()
        res = self.evaluator.run(model, self.venv.normalize_obs)
        res.update(step=int(step), wall_s=round(time.time() - t0, 1), stage_days=self.stage_days)
        self.evals.append(res)
        (self.eval_dir / f"{self.tag}_eval_{step:09d}.json").write_text(json.dumps(res, indent=2))
        lg = getattr(model, "_logger", None)
        if lg is not None:
            lg.record("eval/mean_reward", res["mean_reward"])
            lg.record("eval/mean_profit", res["mean_profit"])
            lg.dump(step)
        else:  # before the first learn() the logger does not exist yet: flushed in _on_training_start
            self.pending_tb.append((step, res["mean_reward"], res["mean_profit"]))
        self.monitor.set_eval(res["mean_reward"], res["mean_profit"], step=int(step))
        self.monitor.log(
            f"  eval @ {step}: mean reward {res['mean_reward']:.3f} mean profit/day {res['mean_profit']:.0f} "
            f"(walkouts {res['mean_walkouts']:.1f}, waste {res['mean_waste_kg']:.1f} kg, {res['wall_s']}s)"
        )
        if self.best is None or res["mean_reward"] > self.best["mean_reward"]:
            self.best = {"step": int(step), "mean_reward": res["mean_reward"], "mean_profit": res["mean_profit"]}
            bdir = self.run_dir / self.tag
            bdir.mkdir(parents=True, exist_ok=True)
            model.save(str(bdir / "best_model.zip"))
            self.venv.save(str(bdir / "best_vecnormalize.pkl"))
            (bdir / "best.json").write_text(json.dumps(self.best))
        every = int(self.cfg.eval.every)
        self.next_eval = (step // every + 1) * every if every > 0 else 1 << 62
        return res

    # ---------------------------------------------------------------- checkpoints
    def checkpoint(self, model: Any, step: int) -> None:
        p = self.ckpt_dir / f"{CKPT_PREFIX}{self.tag}_{step:09d}"
        model.save(str(p) + ".zip")
        self.venv.save(str(p) + ".vecnorm.pkl")
        state = {
            "step": int(step), "stage": self.stage_idx, "best": self.best, "evals": [
                {k: v for k, v in e.items() if k not in ("rewards", "profits")} for e in self.evals
            ], "next_eval": self.next_eval,
        }  # fmt: skip
        (Path(str(p) + ".state.json")).write_text(json.dumps(state))
        olds = sorted(self.ckpt_dir.glob(f"{CKPT_PREFIX}{self.tag}_*.zip"))
        for old in olds[:-2]:
            for suf in (".zip", ".vecnorm.pkl", ".state.json"):
                Path(str(old)[: -len(".zip")] + suf).unlink(missing_ok=True)
        every = int(self.cfg.checkpoint_every)
        self.next_ckpt = (step // every + 1) * every
        self.monitor.log(f"  checkpoint saved at step {step}")

    def latest_checkpoint(self) -> Path | None:
        zips = sorted(self.ckpt_dir.glob(f"{CKPT_PREFIX}{self.tag}_*.zip"))
        return zips[-1] if zips else None

    # ------------------------------------------------------------------ training
    def set_actor_frozen(self, flag: bool) -> None:
        pol = self.model.policy
        for p in [*pol.mlp_extractor.policy_net.parameters(), *pol.action_net.parameters()]:
            p.requires_grad_(not flag)
        self.frozen = flag

    def _env_for_stage(self, idx: int) -> EnvConfig:
        st = self.cfg.curriculum[idx]
        rw = RewardConfig(**{**self.env_base.reward.__dict__, "shaping_scale": float(st.shaping)})
        return self.env_base.replace(days=int(st.days), reward=rw)

    def run(self, resume: bool = False) -> dict[str, Any]:
        from sb3_contrib import MaskablePPO
        from stable_baselines3.common.vec_env import VecNormalize

        cfg = self.cfg
        mon = self.monitor
        PPOCallback = _callback_cls()
        ck = self.latest_checkpoint() if resume else None
        carry: Any = None
        start = 0
        stage0 = 0
        self.stage_idx = 0
        self.stage_days = int(cfg.curriculum[0].days)
        if ck is not None:  # ---- resume
            state = json.loads(Path(str(ck)[: -len(".zip")] + ".state.json").read_text())
            start, stage0 = int(state["step"]), int(state["stage"])
            self.best, self.next_eval = state.get("best"), int(state.get("next_eval", start))
            self.evals = state.get("evals", [])
            self.next_ckpt = (start // int(cfg.checkpoint_every) + 1) * int(cfg.checkpoint_every)
            mon.log(f"resuming PPO from {ck.name} (step {start}, curriculum stage {stage0})")
        for si in range(stage0, len(cfg.curriculum)):
            if self.bounds[si] <= start and si < len(cfg.curriculum) - 1:
                continue
            self.stage_idx = si
            st = cfg.curriculum[si]
            self.stage_days = int(st.days)
            envc = self._env_for_stage(si)
            venv = build_venv(envc, self.n_envs, cfg.vec, cfg.gamma, prior=self.prior if self.model is None and ck is None else None, carry=carry)
            if self.model is None and ck is not None:
                venv = VecNormalize.load(str(ck)[: -len(".zip")] + ".vecnorm.pkl", venv.venv)
                venv.training = True
                venv.norm_reward = True
            self.venv = venv
            if self.model is None:
                if ck is not None:
                    self.model = MaskablePPO.load(
                        str(ck), env=venv, device=self.device,
                        custom_objects={"learning_rate": self.lr, "lr_schedule": self.lr},
                        tensorboard_log=str(self.run_dir / "tb"),
                    )
                else:
                    self.model = self._fresh(venv)
            else:
                self.model.set_env(venv)
                self.model._last_obs = None
            # evaluator (rebuilt per stage so episode length follows the eval config, not the curriculum)
            if self.evaluator is None:
                ecfg = self.env_base.replace(days=int(cfg.eval.days), scenarios=(cfg.eval.scenario,))
                self.evaluator = Evaluator(
                    ecfg, int(cfg.eval.seeds), int(cfg.eval.base_seed), _resolve_workers(cfg.eval.workers)
                )
            self.lr.progress = (self.model.num_timesteps / max(1, self.total_steps))
            mon.update(
                step=self.model.num_timesteps, total_steps=self.total_steps,
                substage=f"{self.tag} curriculum {si + 1}/{len(cfg.curriculum)} ({st.days}d episodes)",
            )
            mon.log(
                f"PPO curriculum stage {si + 1}/{len(cfg.curriculum)}: {st.days}-day episodes, shaping {st.shaping}, "
                f"steps {self.model.num_timesteps} -> {self.bounds[si]}, {self.n_envs} envs ({cfg.vec}), device {self.device}"
            )
            if ck is None and si == 0 and not self.evals:
                self.evaluate(self.model, 0)  # step 0 = the BC initialisation
                if self.init_model is not None and int(getattr(cfg, "critic_warmup_updates", 0)) > 0:
                    self.warm_left = int(cfg.critic_warmup_updates)
                    self.set_actor_frozen(True)
                    mon.log(f"critic warm-up: policy frozen for the first {self.warm_left} update(s)")
            remaining = self.bounds[si] - self.model.num_timesteps
            if remaining > 0:
                self.model.learn(
                    total_timesteps=remaining, callback=PPOCallback(self), reset_num_timesteps=False,
                    progress_bar=False, tb_log_name=self.tag,
                )
            self.checkpoint(self.model, self.model.num_timesteps)
            carry = venv
            start = self.bounds[si]
        # final evaluation of the last weights
        if not self.evals or self.evals[-1]["step"] != self.model.num_timesteps:
            self.evaluate(self.model, self.model.num_timesteps)
        out = self.finish()
        return out

    def _fresh(self, venv: Any) -> Any:
        from sb3_contrib import MaskablePPO

        cfg = self.cfg
        model = MaskablePPO(
            "MlpPolicy", venv, learning_rate=self.lr, n_steps=int(cfg.n_steps), batch_size=int(cfg.batch_size),
            n_epochs=int(cfg.n_epochs), gamma=float(cfg.gamma), gae_lambda=float(cfg.gae_lambda),
            clip_range=float(cfg.clip_range), ent_coef=float(cfg.ent_coef), vf_coef=float(cfg.vf_coef),
            max_grad_norm=float(cfg.max_grad_norm), target_kl=cfg.target_kl, policy_kwargs={"net_arch": list(cfg.net_arch)}, device=self.device,
            seed=int(cfg.seed), tensorboard_log=str(self.run_dir / "tb"), verbose=0,
        )  # fmt: skip
        if self.init_model is not None:  # BC weights
            bc = MaskablePPO.load(str(self.init_model), device=self.device)
            model.policy.load_state_dict(bc.policy.state_dict())
            self.monitor.log(f"initialised policy weights from {self.init_model.parent.name}/{self.init_model.name}")
        return model

    def finish(self) -> dict[str, Any]:
        first, last = self.evals[0], self.evals[-1]
        bdir = self.run_dir / self.tag
        bdir.mkdir(parents=True, exist_ok=True)
        self.model.save(str(bdir / "final_model.zip"))
        self.venv.save(str(bdir / "final_vecnormalize.pkl"))
        out = {
            "first_eval": {k: first[k] for k in ("step", "mean_reward", "mean_profit")},
            "last_eval": {k: last[k] for k in ("step", "mean_reward", "mean_profit")},
            "best": self.best, "n_evals": len(self.evals), "total_steps": int(self.model.num_timesteps),
            "improved": bool(last["mean_reward"] > first["mean_reward"]),
            "best_improved": bool(self.best and self.best["mean_reward"] > first["mean_reward"]),
            "evals": [{k: v for k, v in e.items() if k not in ("rewards", "profits")} for e in self.evals],
            "device": self.device, "n_envs": self.n_envs,
        }  # fmt: skip
        if self.evaluator is not None:
            self.evaluator.close()
        self.venv.close()
        return out


def _resolve_workers(w: int | str) -> int:
    from brew.train.config import resolve_n_envs

    return resolve_n_envs(w) if isinstance(w, str) else max(1, int(w))


def load_policy(model_zip: Path | str, vecnorm_pkl: Path | str, device: str = "cpu") -> tuple[Any, Any]:
    """Load ``(MaskablePPO, normalise_fn)`` from saved files without building a world."""
    import pickle

    from sb3_contrib import MaskablePPO

    from .bc import SpecEnv

    model = MaskablePPO.load(str(model_zip), device=device)
    with open(vecnorm_pkl, "rb") as f:
        vn = pickle.load(f)
    mean, var = np.asarray(vn.obs_rms.mean), np.asarray(vn.obs_rms.var)
    clip, eps = float(vn.clip_obs), float(vn.epsilon)

    def norm(o: np.ndarray) -> np.ndarray:
        return np.clip((o - mean) / np.sqrt(var + eps), -clip, clip).astype(np.float32)

    del SpecEnv
    return model, norm


def rollout_policy(model: Any, norm: Any, env: BrewManagerEnv, seed: int, options: dict[str, Any] | None = None) -> dict[str, Any]:
    """One deterministic episode; returns reward / kpis."""
    obs, _ = env.reset(seed=seed, options=options)
    total, done = 0.0, False
    info: dict[str, Any] = {}
    while not done:
        a, _ = model.predict(norm(obs[None]), action_masks=env.action_masks()[None], deterministic=True)
        obs, r, term, trunc, info = env.step(a[0])
        total += r
        done = term or trunc
    return {"reward": total, **info.get("kpis", {})}
