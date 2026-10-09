"""The full training pipeline (backend.md 9): M2 stages -> bc -> ppo -> adversarial -> export -> arena.

``brew-train all --config <yaml> --run-dir <dir> [--resume] [--dry-run]`` lands here.  Everything is offline.
Run directory layout::

    config.yaml      resolved config                 progress.json   heartbeat (stage, step, eta, last_eval)
    metrics.json     per-stage + final metrics       train.log       the same lines that go to stdout
    markers/*.json   completed stages (--resume)     checkpoints/    PPO checkpoints (+ VecNormalize stats)
    bc/ ppo/ rarl*/ adversary/                       tb/             TensorBoard
    eval/*.json      evaluations                     champion/       policy.onnx, obs_norm.json, meta.json, ...
    m2/              history + M2 model artifacts
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import time
import traceback
from collections.abc import Callable
from pathlib import Path
from typing import Any

import yaml

from brew.models.registry import ModelRegistry, git_sha
from brew.train.config import TrainConfig, resolve_n_envs
from brew.train.pipeline import M2_STAGES, run_stage

from .progress import RunMonitor

M3_STAGES = ("bc", "ppo", "adversarial", "export", "arena")
ALL_STAGES = (*M2_STAGES, *M3_STAGES)
HELD_OUT_SEEDS = 1000


class Tee:
    """stdout + file."""

    def __init__(self, path: Path, stream: Any) -> None:
        self.f = open(path, "a", buffering=1)  # noqa: SIM115 - closed with the process
        self.s = stream

    def write(self, x: str) -> int:
        self.s.write(x)
        self.f.write(x)
        return len(x)

    def flush(self) -> None:
        self.s.flush()
        self.f.flush()


# ------------------------------------------------------------------------------ helpers
def _json(x: Any) -> Any:
    return json.loads(json.dumps(x, default=lambda o: o.tolist() if hasattr(o, "tolist") else str(o)))


def env_base(cfg: TrainConfig, seed_offset: int = 0) -> Any:
    from .env import EnvConfig

    p = cfg.ppo
    return EnvConfig(
        scenarios=tuple(p.scenarios), days=int(p.curriculum[0].days), domain_randomisation=bool(p.domain_randomisation),
        chaos=str(p.chaos), seed=int(p.seed) * 1000 + seed_offset, models_dir=str(cfg.models_path()),
    )  # fmt: skip


def resolve_config(cfg: TrainConfig, run_dir: Path | None, workers: int | None, device: str | None, models_dir: str | None) -> TrainConfig:
    """Apply CLI overrides (``--workers``, ``--device``, ``--models-dir``, ``--run-dir``) to a config."""
    d = cfg.model_dump()
    if workers:
        d["ppo"]["n_envs"] = workers
        d["ppo"]["vec"] = "subproc" if workers > 1 else "dummy"
        d["ppo"]["eval"]["workers"] = min(workers, 10)
    if device:
        d["device"] = device
    if models_dir:
        d["models_dir"] = models_dir
    if run_dir is not None:
        d["runs_dir"] = str(Path(run_dir).resolve() / "m2")
    return TrainConfig(**d)


# ------------------------------------------------------------------------------ dry run
def plan(cfg: TrainConfig, bench: bool = True) -> dict[str, Any]:
    """Validate the config and describe every stage (steps, envs, estimated wall time)."""
    from brew.config.loader import list_scenarios

    issues: list[str] = []
    known = set(list_scenarios())
    for s in [cfg.history.scenario, *[r.scenario or cfg.history.scenario for r in cfg.history.runs], *cfg.ppo.scenarios, cfg.ppo.eval.scenario, cfg.adversarial.scenario, cfg.final_eval.scenario, cfg.eval.scenario, *cfg.bc.scenarios]:
        if s not in known:
            issues.append(f"unknown scenario {s!r}")
    p = cfg.ppo
    n_envs = resolve_n_envs(p.n_envs)
    batch_total = int(p.n_steps) * n_envs
    warnings: list[str] = []
    if batch_total % int(p.batch_size) != 0:
        warnings.append(
            f"batch_size {p.batch_size} does not divide the rollout n_steps*n_envs = {batch_total}: the last "
            "mini-batch per epoch is truncated (SB3 warns; harmless)"
        )
    fr = sum(float(s.frac) for s in p.curriculum)
    bounds, acc = [], 0.0
    for st in p.curriculum:
        acc += float(st.frac)
        bounds.append(round(p.total_timesteps * acc / fr))
    if abs(fr - 1.0) > 1e-6:
        issues.append(f"curriculum fractions sum to {fr}, not 1.0 (they are normalised)")
    ms_step = None
    if bench:
        ms_step = _bench_env_ms()
    sps_env = 1000.0 / ms_step if ms_step else None
    par = max(1, min(n_envs, os.cpu_count() or 1)) if p.vec == "subproc" else 1
    ppo_s = (p.total_timesteps / (sps_env * par)) if sps_env else None
    desktop_h = round(p.total_timesteps / (sps_env * 14) / 3600, 2) if sps_env else None  # 14 workers (16-core desktop)
    n_eval = p.total_timesteps // max(1, p.eval.every) + 1
    ticks = 57
    eval_steps = p.eval.seeds * p.eval.days * ticks
    eval_s = (n_eval * eval_steps / (sps_env * max(1, min(int(_workers(p.eval.workers)), p.eval.seeds)))) if sps_env else None
    bc_samples = cfg.bc.days * ticks
    hist_days = sum(r.days for r in cfg.history.runs)
    try:
        import torch

        cuda = bool(torch.cuda.is_available())
    except Exception:
        cuda = False
    stages: list[dict[str, Any]] = [
        {"stage": "history", "what": "synthetic POS history", "sim_days": hist_days, "runs": len(cfg.history.runs)},
        {"stage": "forecast", "what": "LightGBM quantile forecaster + backtest"},
        {"stage": "elasticity", "what": "Poisson GLM on the CRN price experiment"},
        {"stage": "prep_time", "what": "prep-time quantile GBM"},
        {"stage": "rider_eta", "what": "rider ETA quantile GBM"},
        {"stage": "text", "what": "review tagger + note parser"},
        {"stage": "replate", "what": "Replate sell-through model"},
        {"stage": "eval", "what": "M2 arena", "policies": cfg.eval.policies, "seeds": len(cfg.eval.seeds), "days": cfg.eval.days},
        {"stage": "bc", "what": "behaviour cloning of Policy C", "teacher_days": cfg.bc.days, "samples": bc_samples, "epochs": cfg.bc.epochs},
        {
            "stage": "ppo", "what": "MaskablePPO curriculum", "total_timesteps": p.total_timesteps, "n_envs": n_envs, "vec": p.vec,
            "n_steps": p.n_steps, "batch_size": p.batch_size, "rollout_size": batch_total,
            "curriculum": [{"days": s.days, "frac": s.frac, "shaping": s.shaping, "until_step": b} for s, b in zip(p.curriculum, bounds, strict=True)],
            "eval": {"every": p.eval.every, "seeds": p.eval.seeds, "days": p.eval.days, "n_evals": n_eval},
            "checkpoint_every": p.checkpoint_every, "est_wall_h": round(ppo_s / 3600, 2) if ppo_s else None,
            "est_eval_wall_h": round(eval_s / 3600, 2) if eval_s else None,
        },  # fmt: skip
        {"stage": "adversarial", "what": "RARL alternation", "adversary_steps": cfg.adversarial.total_timesteps, "iterations": cfg.adversarial.iterations, "protagonist_steps_per_iter": cfg.adversarial.protagonist_steps},
        {"stage": "export", "what": "pick champion, ONNX export, parity, surrogate tree, registry", "parity_obs": cfg.export.parity_obs},
        {"stage": "arena", "what": "final arena", "policies": cfg.final_eval.policies, "seeds": cfg.final_eval.seeds, "days": cfg.final_eval.days},
    ]
    total_h = None
    if ppo_s is not None and eval_s is not None:
        total_h = round((ppo_s + eval_s) / 3600, 2)
    return {
        "config": cfg.name, "stages": stages, "n_stages": len(stages), "issues": issues, "warnings": warnings,
        "est_ppo_h_14_workers": desktop_h, "device": cfg.device, "cuda_available": cuda,
        "env_ms_per_step": round(ms_step, 1) if ms_step else None, "est_ppo_plus_eval_h": total_h,
        "cpu_count": os.cpu_count(), "valid": not issues,
    }  # fmt: skip


def _workers(w: int | str) -> int:
    return resolve_n_envs(w) if isinstance(w, str) else int(w)


def _bench_env_ms(n: int = 30) -> float:
    """Average ms per env step on this machine (policy C-lite executor, default action)."""
    from .actions import default_vector
    from .env import BrewManagerEnv, EnvConfig

    env = BrewManagerEnv(EnvConfig(days=1))
    env.reset(seed=3)
    a = default_vector()
    t = time.perf_counter()
    for _ in range(n):
        _o, _r, term, _tr, _i = env.step(a)
        if term:
            env.reset(seed=4)
    return (time.perf_counter() - t) * 1000.0 / n


def print_plan(pl: dict[str, Any], out: Callable[[str], None]) -> None:
    out(f"training plan '{pl['config']}': {pl['n_stages']} stages, device={pl['device']} (cuda available: {pl['cuda_available']}), cpus={pl['cpu_count']}")
    for i, s in enumerate(pl["stages"], 1):
        extra = {k: v for k, v in s.items() if k not in ("stage", "what")}
        out(f"  {i:2d}. {s['stage']:<12s} {s['what']}  {json.dumps(extra, default=str) if extra else ''}")
    if pl["env_ms_per_step"]:
        out(f"measured env step: {pl['env_ms_per_step']} ms (this machine); est. PPO + evaluation wall time ~{pl['est_ppo_plus_eval_h']} h")
    if pl.get("est_ppo_h_14_workers"):
        out(f"on a 16-core desktop (14 workers): PPO ~{pl['est_ppo_h_14_workers']} h of simulation (the GPU only speeds up the learner)")
    for i in pl["issues"]:
        out(f"  ISSUE: {i}")
    for i in pl.get("warnings", []):
        out(f"  warning: {i}")
    out("plan is valid" if pl["valid"] else "plan has issues")


# ------------------------------------------------------------------------------ stages
class Ctx:
    """Everything the stage functions share."""

    def __init__(self, cfg: TrainConfig, run_dir: Path, mon: RunMonitor, resume: bool) -> None:
        self.cfg, self.run_dir, self.mon, self.resume = cfg, run_dir, mon, resume
        from . import torch_setup

        self.device = torch_setup.pick_device(cfg.device)

    def bc_prior(self) -> dict[str, Any] | None:
        f = self.run_dir / "bc" / "prior.json"
        return json.loads(f.read_text()) if f.exists() else None

    @property
    def bc_zip(self) -> Path | None:
        p = self.run_dir / "bc" / "bc_model.zip"
        return p if p.exists() else None


def stage_bc(ctx: Ctx) -> dict[str, Any]:
    from . import torch_setup  # noqa: F401
    from .bc import collect_teacher, new_model, train_bc
    from .reward import RewardConfig

    cfg, mon = ctx.cfg, ctx.mon
    b = cfg.bc
    mon.log(f"BC: rolling out Policy C for {b.days} day(s) in episodes of {b.episode_days} ({resolve_n_envs(b.workers)} worker(s))")
    data = collect_teacher(
        b.days, b.episode_days, b.seed, b.gamma, cfg.models_path(), resolve_n_envs(b.workers), tuple(b.scenarios),
        bool(b.domain_randomisation), RewardConfig(), mon.log,
    )  # fmt: skip
    mon.log(f"BC: {data.stats['samples']} samples, teacher profit/day {data.stats['teacher_profit_per_day']:.0f}")
    model = new_model(tuple(cfg.ppo.net_arch), ctx.device, seed=int(b.seed))
    met = train_bc(model, data, epochs=b.epochs, batch_size=b.batch_size, lr=b.lr, log=mon.log, seed=int(b.seed))
    d = ctx.run_dir / "bc"
    d.mkdir(parents=True, exist_ok=True)
    model.save(str(d / "bc_model.zip"))
    prior = {"obs_mean": met["obs_mean"], "obs_var": met["obs_var"], "ret_scale": met["ret_scale"], "count": len(data.obs)}
    (d / "prior.json").write_text(json.dumps(prior))
    try:
        from torch.utils.tensorboard import SummaryWriter

        w = SummaryWriter(str(ctx.run_dir / "tb" / "bc"))
        for h in met["history"]:
            w.add_scalar("bc/policy_loss", h["policy_loss"], h["epoch"])
            w.add_scalar("bc/value_loss", h["value_loss"], h["epoch"])
            w.add_scalar("bc/accuracy", h["accuracy"], h["epoch"])
        w.close()
    except Exception as e:  # pragma: no cover - TensorBoard is optional for the run
        mon.log(f"  (tensorboard BC scalars skipped: {e})")
    out = {k: v for k, v in met.items() if k not in ("obs_mean", "obs_var", "history")}
    out["teacher"] = data.stats
    (ctx.run_dir / "eval").mkdir(exist_ok=True)
    (ctx.run_dir / "eval" / "bc.json").write_text(json.dumps(_json({**out, "history": met["history"]}), indent=2))
    mon.log(f"BC done: policy loss {met['loss_first']:.3f} -> {met['loss_last']:.3f}, accuracy {met['accuracy']:.3f}")
    return _json(out)


def stage_ppo(ctx: Ctx) -> dict[str, Any]:
    from .train_ppo import PPOTrainer

    cfg, mon = ctx.cfg, ctx.mon
    n_envs = resolve_n_envs(cfg.ppo.n_envs)
    tr = PPOTrainer(
        cfg.ppo, env_base(cfg), ctx.run_dir, mon, ctx.device, prior=ctx.bc_prior(), init_model=ctx.bc_zip, n_envs=n_envs
    )  # fmt: skip
    out = tr.run(resume=ctx.resume)
    mon.log(
        f"PPO done: eval reward {out['first_eval']['mean_reward']:.3f} (step 0) -> {out['last_eval']['mean_reward']:.3f} "
        f"(step {out['last_eval']['step']}), best {out['best']['mean_reward']:.3f} @ {out['best']['step']}; improved={out['improved']}"
    )
    return _json(out)


def stage_adversarial(ctx: Ctx) -> dict[str, Any]:
    from .rarl import run_rarl

    cfg = ctx.cfg
    pz, pv = ctx.run_dir / "ppo" / "best_model.zip", ctx.run_dir / "ppo" / "best_vecnormalize.pkl"
    out = run_rarl(cfg.adversarial, cfg.ppo, env_base(cfg), ctx.run_dir, ctx.mon, ctx.device, pz, pv, n_envs=resolve_n_envs(cfg.adversarial.n_envs))
    return _json(out)


def _candidate_paths(run_dir: Path) -> dict[str, tuple[Path, Path]]:
    c: dict[str, tuple[Path, Path]] = {}
    for tag, dn, m, v in (
        ("ppo_best", "ppo", "best_model.zip", "best_vecnormalize.pkl"),
        ("ppo_final", "ppo", "final_model.zip", "final_vecnormalize.pkl"),
    ):
        if (run_dir / dn / m).exists():
            c[tag] = (run_dir / dn / m, run_dir / dn / v)
    rarl = sorted(run_dir.glob("rarl*/final_model.zip"))
    if rarl:
        d = rarl[-1].parent
        c[d.name + "_final"] = (d / "final_model.zip", d / "final_vecnormalize.pkl")
    bc = run_dir / "bc" / "bc_model.zip"
    return c if c else ({"bc": (bc, bc)} if bc.exists() else {})


def _eval_candidate(ctx: Ctx, model_zip: Path, vn: Path, scenario: str) -> dict[str, Any]:
    from .env import EnvConfig
    from .train_ppo import Evaluator, load_policy

    cfg = ctx.cfg
    e = cfg.ppo.eval
    model, norm = load_policy(model_zip, vn, device="cpu")
    ec = EnvConfig(scenarios=(scenario,), days=int(e.days), models_dir=str(cfg.models_path()))
    ev = Evaluator(ec, int(e.seeds), int(e.base_seed), min(_workers(e.workers), int(e.seeds)))
    try:
        return ev.run(model, norm)
    finally:
        ev.close()


def stage_export(ctx: Ctx) -> dict[str, Any]:
    import numpy as np

    from .actions import DIM_NAMES
    from .export_onnx import parity_observations, write_champion
    from .surrogate import Surrogate
    from .train_ppo import load_policy

    cfg, mon, run_dir = ctx.cfg, ctx.mon, ctx.run_dir
    cands = _candidate_paths(run_dir)
    if not cands:
        raise RuntimeError("no trained policy found (run bc / ppo first)")
    scores: dict[str, dict[str, Any]] = {}
    for tag, (mz, vn) in cands.items():
        calm = _eval_candidate(ctx, mz, vn, cfg.ppo.eval.scenario)
        chaos = _eval_candidate(ctx, mz, vn, "chaos_adversary")
        scores[tag] = {
            "calm_reward": calm["mean_reward"], "calm_profit": calm["mean_profit"],
            "chaos_reward": chaos["mean_reward"], "chaos_profit": chaos["mean_profit"],
            "score": 0.5 * (calm["mean_reward"] + chaos["mean_reward"]),
        }  # fmt: skip
        mon.log(f"  candidate {tag}: calm reward {calm['mean_reward']:.2f} (profit {calm['mean_profit']:.0f}), chaos reward {chaos['mean_reward']:.2f} (profit {chaos['mean_profit']:.0f})")
    best = max(scores, key=lambda k: scores[k]["score"])
    mz, vn = cands[best]
    mon.log(f"champion candidate: {best}")
    model, norm = load_policy(mz, vn, device="cpu")
    # surrogate data: rollouts of the champion + the BC teacher states
    obs_rows, act_rows = _policy_rollouts(ctx, model, norm)
    real = np.stack(obs_rows) if obs_rows else None
    version = cfg.export.version or f"{cfg.name}-{git_sha()}"
    champ = run_dir / "champion"
    meta = {
        "version": version, "config": cfg.name, "candidate": best, "scores": scores, "source": str(mz.name),
        "trained_steps": int(model.num_timesteps), "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }  # fmt: skip
    par = write_champion(model, vn, champ, meta, parity_observations(int(cfg.export.parity_obs), 0, real), float(cfg.export.parity_tol))
    mon.log(f"ONNX parity: max |logit diff| = {par['max_abs_diff']:.2e} (tol {par['tol']}) -> {'OK' if par['ok'] else 'FAIL'}; argmax agreement {par['argmax_agreement']:.3f}")
    if not par["ok"]:
        raise RuntimeError(f"ONNX parity failed: {par}")
    sur_info: dict[str, Any] = {}
    if len(obs_rows) >= 20:
        sur = Surrogate.fit(np.stack(obs_rows), np.stack(act_rows), depth=int(cfg.export.surrogate_depth))
        sur.save(champ / "surrogate.joblib")
        sur_info = {"samples": len(obs_rows), "mean_fidelity": float(np.mean(sur.fidelity)), "fidelity": dict(zip(DIM_NAMES, sur.fidelity, strict=True))}
        mon.log(f"surrogate tree (depth {cfg.export.surrogate_depth}): mean fidelity {sur_info['mean_fidelity']:.3f} on {len(obs_rows)} decisions")
    full_meta = json.loads((champ / "meta.json").read_text())
    full_meta["surrogate"] = sur_info
    (champ / "meta.json").write_text(json.dumps(full_meta, indent=2, default=str))
    # register: models/rl_policy/D/<version>/
    reg = ModelRegistry(cfg.models_path())
    metrics = {**scores[best], "parity_max_abs_diff": par["max_abs_diff"], "surrogate_fidelity": sur_info.get("mean_fidelity")}
    entry = reg.register(
        "rl_policy", "D", version, artifact_dir=champ, metrics=metrics,
        params={"net_arch": list(cfg.ppo.net_arch), "total_timesteps": cfg.ppo.total_timesteps, "algo": "MaskablePPO"},
        lineage={"config": cfg.name, "candidate": best, "run_dir": str(run_dir)},
    )  # fmt: skip
    mon.log(f"registered champion models/rl_policy/D/{version}")
    return _json({"champion": best, "version": version, "scores": scores, "parity": par, "surrogate": sur_info, "registry_path": entry["path"]})


def _policy_rollouts(ctx: Ctx, model: Any, norm: Any) -> tuple[list[Any], list[Any]]:
    """Observations and deterministic actions of the champion on a few days (surrogate-tree training data)."""
    from .env import BrewManagerEnv, EnvConfig

    cfg = ctx.cfg
    ex = cfg.export
    obs_rows: list[Any] = []
    act_rows: list[Any] = []
    for i in range(int(ex.surrogate_seeds)):
        env = BrewManagerEnv(EnvConfig(scenarios=(cfg.ppo.eval.scenario,), days=int(ex.surrogate_days), models_dir=str(cfg.models_path()), domain_randomisation=bool(i % 2)))
        o, _ = env.reset(seed=HELD_OUT_SEEDS + 500 + i)
        done = False
        while not done:
            a, _ = model.predict(norm(o[None]), action_masks=env.action_masks()[None], deterministic=True)
            obs_rows.append(o.copy())
            act_rows.append(a[0].copy())
            o, _r, term, trunc, _info = env.step(a[0])
            done = term or trunc
    return obs_rows, act_rows


def stage_arena(ctx: Ctx) -> dict[str, Any]:
    from brew.analysis.arena import run_arena

    cfg, mon = ctx.cfg, ctx.mon
    fe = cfg.final_eval
    days_list = fe.days if isinstance(fe.days, list) else [fe.days]
    out: dict[str, Any] = {}
    for days in days_list:
        t = time.time()
        res = run_arena(fe.policies, fe.seeds, int(days), fe.scenario, workers=int(fe.workers), models_dir=cfg.models_path())
        summ = res.summary()
        out[f"days_{days}"] = summ
        row = " | ".join(f"{p}: {v['mean_profit']:.0f}" for p, v in summ["policies"].items())
        mon.log(f"arena {fe.scenario} seeds={fe.seeds} days={days} ({time.time() - t:.0f}s) mean profit/day: {row}")
        if "D" in summ["policies"] and "A" in summ["policies"]:
            d, a = summ["policies"]["D"]["profit_by_seed"], summ["policies"]["A"]["profit_by_seed"]
            out[f"days_{days}"]["d_ge_a_mean"] = bool(sum(d) >= sum(a))
            out[f"days_{days}"]["d_ge_a_seeds"] = [bool(x >= y) for x, y in zip(d, a, strict=True)]
    (ctx.run_dir / "eval").mkdir(exist_ok=True)
    (ctx.run_dir / "eval" / "arena.json").write_text(json.dumps(_json(out), indent=2))
    return _json(out)


M3_FUNCS: dict[str, Callable[[Ctx], dict[str, Any]]] = {
    "bc": stage_bc, "ppo": stage_ppo, "adversarial": stage_adversarial, "export": stage_export, "arena": stage_arena,
}  # fmt: skip


# ------------------------------------------------------------------------------ driver
def run_pipeline(
    cfg: TrainConfig, run_dir: Path, stages: tuple[str, ...] = ALL_STAGES, resume: bool = False,
) -> dict[str, Any]:  # fmt: skip
    """Run ``stages`` in order inside ``run_dir`` (see the module docstring).  Raises on failure."""
    run_dir = Path(run_dir).resolve()
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "markers").mkdir(exist_ok=True)
    (run_dir / "eval").mkdir(exist_ok=True)
    (run_dir / "tb").mkdir(exist_ok=True)
    (run_dir / "checkpoints").mkdir(exist_ok=True)
    (run_dir / "config.yaml").write_text(yaml.safe_dump(json.loads(cfg.model_dump_json()), sort_keys=False))
    tee = Tee(run_dir / "train.log", sys.stdout)
    mon = RunMonitor(run_dir, len(stages), stream=tee)  # type: ignore[arg-type]
    mon.log(f"brew-train: config '{cfg.name}', run dir {run_dir}, resume={resume}, stages={len(stages)}")
    metrics_path = run_dir / "metrics.json"
    allm: dict[str, Any] = {"config": cfg.name, "git_sha": git_sha(), "stages": {}, "started": time.strftime("%Y-%m-%dT%H:%M:%S")}
    if resume and metrics_path.exists():
        try:
            allm["stages"] = json.loads(metrics_path.read_text()).get("stages", {})
        except Exception:
            pass
    if not resume:
        shutil.rmtree(run_dir / "markers", ignore_errors=True)
        (run_dir / "markers").mkdir(exist_ok=True)
        allm["stages"] = {}
    ctx = Ctx(cfg, run_dir, mon, resume)
    t_all = time.time()
    try:
        for i, st in enumerate(stages):
            marker = run_dir / "markers" / f"{st}.done"
            mon.begin_stage(st, i)
            if resume and marker.exists():
                mon.log(f"[{i + 1}/{len(stages)}] stage {st}: already complete, skipping")
                allm["stages"].setdefault(st, json.loads(marker.read_text()))
                continue
            mon.log(f"[{i + 1}/{len(stages)}] stage {st} ...")
            t0 = time.time()
            if st in M3_FUNCS:
                res = M3_FUNCS[st](ctx)
            else:
                res = run_stage(st, cfg)
            res = {**res, "_wall_s": round(time.time() - t0, 1)}
            allm["stages"][st] = _json(res)
            marker.write_text(json.dumps(_json(res), default=str))
            metrics_path.write_text(json.dumps(_json(allm), indent=2, default=str))
            mon.log(f"[{i + 1}/{len(stages)}] stage {st} done in {res['_wall_s']}s")
        allm["wall_s"] = round(time.time() - t_all, 1)
        allm["summary"] = summarize(allm)
        metrics_path.write_text(json.dumps(_json(allm), indent=2, default=str))
        mon.finish("done")
        mon.log("=" * 60)
        for line in allm["summary"]["lines"]:
            mon.log(line)
        mon.log(f"all {len(stages)} stages done in {allm['wall_s']}s; artifacts in {run_dir}")
        return allm
    except BaseException:
        mon.log("FAILED:\n" + traceback.format_exc())
        mon.finish("failed")
        raise


def summarize(allm: dict[str, Any]) -> dict[str, Any]:
    """Final human-readable summary + acceptance flags."""
    st = allm["stages"]
    lines: list[str] = []
    acc: dict[str, Any] = {}
    if "bc" in st:
        lines.append(f"BC: policy loss {st['bc']['loss_first']:.3f} -> {st['bc']['loss_last']:.3f} (accuracy {st['bc']['accuracy']:.3f})")
        acc["bc_loss_reduced"] = st["bc"]["loss_last"] < st["bc"]["loss_first"]
    for name in ("ppo", "adversarial"):
        if st.get(name, {}).get("skipped"):
            lines.append(f"{name}: skipped ({st[name].get('reason', 'manual')})")
    if "ppo" in st and not st["ppo"].get("skipped"):
        p = st["ppo"]
        lines.append(f"PPO: eval reward {p['first_eval']['mean_reward']:.3f} -> {p['last_eval']['mean_reward']:.3f} (best {p['best']['mean_reward']:.3f}); {p['total_steps']} steps")
        acc["ppo_improved"] = p["improved"]
    if "adversarial" in st and not st["adversarial"].get("skipped"):
        h = st["adversarial"]["history"][-1]["adversary"]
        lines.append(f"RARL: {st['adversarial']['iterations']} iterations; adversary reward {h['mean_reward_first']} -> {h['mean_reward_last']}")
    if "export" in st:
        e = st["export"]
        lines.append(f"export: champion {e['champion']} v{e['version']}; ONNX parity {e['parity']['max_abs_diff']:.2e}")
        acc["onnx_parity_ok"] = e["parity"]["ok"]
    if "arena" in st:
        for k, v in st["arena"].items():
            if not k.startswith("days_"):
                continue
            row = ", ".join(f"{p} {s['mean_profit']:.0f}" for p, s in v["policies"].items())
            lines.append(f"arena {k}: {row}" + (f" (D >= A: {v.get('d_ge_a_mean')})" if "d_ge_a_mean" in v else ""))
            if "d_ge_a_mean" in v:
                acc[f"d_ge_a_{k}"] = v["d_ge_a_mean"]
    return {"lines": lines, "acceptance": acc}
