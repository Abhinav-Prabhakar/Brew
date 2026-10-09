"""M3 slow tier: the whole pipeline through the CLI on a tiny config (offline, resume, failure), subprocess envs."""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import pytest

from brew.rl import torch_setup  # noqa: F401
from brew.rl.actions import default_vector
from brew.rl.env import EnvConfig

pytestmark = pytest.mark.slow

PPO_TINY = {
    "total_timesteps": 256, "n_envs": 2, "n_steps": 64, "batch_size": 64,
    "curriculum": [{"days": 1, "frac": 1.0, "shaping": 1.0}],
    "eval": {"every": 128, "seeds": 2, "days": 1, "base_seed": 1000, "workers": 1}, "checkpoint_every": 128,
}  # fmt: skip


def _tiny_yaml(tmp_path: Path, **over: object) -> Path:
    import yaml

    cfg: dict[str, object] = {
        "name": "tiny", "runs_dir": str(tmp_path / "m2"), "models_dir": str(tmp_path / "models"),
        "history": {
            "runs": [{"policy": "B", "seed": 11, "days": 12}, {"policy": "B", "seed": 12, "days": 10}],
            "price_experiment": {"groups": 4, "variants": 3, "seed": 70},
        },
        "forecast": {"n_estimators": 30, "folds": 2, "test_days": 1, "min_history": 7},
        "prep_time": {"n_estimators": 20}, "rider_eta": {"n_estimators": 20}, "replate_model": {"n_estimators": 20},
        "eval": {"policies": ["A", "C"], "seeds": [1], "days": 1, "replate_ab": False},
        "bc": {"days": 1, "episode_days": 1, "epochs": 25, "workers": 1},
        "ppo": PPO_TINY,
        "adversarial": {"total_timesteps": 128, "iterations": 2, "protagonist_steps": 128, "n_envs": 2, "n_steps": 64, "batch_size": 64},
        "export": {"surrogate_days": 1, "surrogate_seeds": 1},
        "final_eval": {"policies": ["A", "C", "D"], "seeds": [1], "days": 1, "workers": 1},
    }  # fmt: skip
    cfg.update(over)
    p = tmp_path / "tiny.yaml"
    p.write_text(yaml.safe_dump(cfg))
    return p


def test_cli_contract_end_to_end_offline_resume_and_failure(tmp_path, monkeypatch):
    import socket

    from typer.testing import CliRunner

    from brew.cli import train_app

    def no_network(*a: object, **k: object) -> None:
        raise AssertionError("network access attempted")

    monkeypatch.setattr(socket.socket, "connect", no_network)
    cfgp = _tiny_yaml(tmp_path)
    run = tmp_path / "run"
    r = CliRunner().invoke(train_app, ["all", "--config", str(cfgp), "--run-dir", str(run)])
    assert r.exit_code == 0, r.output
    assert "\r" not in r.output and "all 13 stages done" in r.output
    for f in ("config.yaml", "progress.json", "metrics.json", "train.log"):
        assert (run / f).exists(), f
    prog = json.loads((run / "progress.json").read_text())
    for k in ("stage", "stage_index", "n_stages", "step", "total_steps", "steps_per_s", "eta_s", "last_eval", "updated"):
        assert k in prog, k
    assert prog["n_stages"] == 13 and set(prog["last_eval"]) >= {"mean_reward", "mean_profit"}
    m = json.loads((run / "metrics.json").read_text())
    assert list(m["stages"]) == [
        "history", "forecast", "elasticity", "prep_time", "rider_eta", "text", "replate", "eval", "bc", "ppo",
        "adversarial", "export", "arena",
    ]  # fmt: skip
    assert m["stages"]["bc"]["loss_last"] < m["stages"]["bc"]["loss_first"]
    assert m["stages"]["export"]["parity"]["max_abs_diff"] < 1e-4 and m["stages"]["export"]["parity"]["ok"]
    assert "D" in m["stages"]["arena"]["days_1"]["policies"] and m["summary"]["lines"]
    assert list((run / "eval").glob("*.json")) and any((run / "tb").rglob("events.out.tfevents*"))
    assert list((run / "checkpoints").glob("*.zip"))
    for f in ("policy.onnx", "obs_norm.json", "meta.json", "surrogate.joblib"):
        assert (run / "champion" / f).exists(), f
    ver = m["stages"]["export"]["version"]
    assert (tmp_path / "models" / "rl_policy" / "D" / ver / "policy.onnx").exists()
    reg = json.loads((tmp_path / "models" / "registry.json").read_text())
    assert any(e["kind"] == "rl_policy" and e["champion"] for e in reg)
    # --resume skips every completed stage
    r2 = CliRunner().invoke(train_app, ["all", "--config", str(cfgp), "--run-dir", str(run), "--resume"])
    assert r2.exit_code == 0 and r2.output.count("already complete, skipping") == 13
    # PPO resumes from its last checkpoint: raise the budget, drop only the ppo marker
    cfg2 = _tiny_yaml(tmp_path, ppo={**PPO_TINY, "total_timesteps": 384})
    (run / "markers" / "ppo.done").unlink()
    r3 = CliRunner().invoke(train_app, ["ppo", "--config", str(cfg2), "--run-dir", str(run), "--resume"])
    assert r3.exit_code == 0, r3.output
    assert "resuming PPO from" in r3.output
    assert json.loads((run / "markers" / "ppo.done").read_text())["total_steps"] == 384
    # a failing stage exits non-zero with the traceback in the log
    bad = CliRunner().invoke(train_app, ["export", "--config", str(cfgp), "--run-dir", str(tmp_path / "empty")])
    assert bad.exit_code != 0
    assert "FAILED" in (tmp_path / "empty" / "train.log").read_text()


def test_subprocess_envs_and_progress_heartbeat(tmp_path):
    from brew.rl.progress import RunMonitor
    from brew.rl.train_ppo import build_venv

    v = build_venv(EnvConfig(days=1), 2, "subproc", 0.99)
    try:
        obs = v.reset()
        assert obs.shape == (2, 183)
        _o, r, _d, _i = v.step(np.stack([default_vector()] * 2))
        assert np.isfinite(r).all()
    finally:
        v.close()
    mon = RunMonitor(tmp_path, 1, heartbeat_s=0.2)
    t0 = json.loads((tmp_path / "progress.json").read_text())["updated"]
    time.sleep(0.7)
    assert json.loads((tmp_path / "progress.json").read_text())["updated"] != t0  # heartbeat rewrites the file
    mon.finish()
