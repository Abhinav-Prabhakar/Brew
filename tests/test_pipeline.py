"""Performance budgets (fast guards) and the training pipeline / acceptance runs (slow)."""

from __future__ import annotations

import json
import time

import pytest
from typer.testing import CliRunner

from brew.cli import eval_app, train_app
from brew.sim.world import World
from brew.train.config import TrainConfig, load_train_config
from brew.train.pipeline import M2_STAGES, run_all, run_stage


# ------------------------------------------------------------------ perf guards
def test_policy_c_day_within_budget():
    w = World(policy="C", seed=7, days=1, telemetry=True)
    t0 = time.perf_counter()
    w.run(1)
    # a regression guard, not a target: ~9.3 s on an M3 (CP-SAT + hourly LightGBM re-forecast dominate)
    assert time.perf_counter() - t0 < 12.0


def test_policy_a_b_days_and_fork_within_budget():
    for pol in ("A", "B"):
        w = World(policy=pol, seed=7, days=1, telemetry=True)
        t0 = time.perf_counter()
        w.run(1)
        assert time.perf_counter() - t0 < 2.0, pol
    w2 = World(policy="C", seed=7)
    w2.run_until(14 * 3600)
    t1 = time.perf_counter()
    w2.fork()
    assert time.perf_counter() - t1 < 0.05


# ------------------------------------------------------------------- configs
def test_smoke_and_full_configs_load():
    s = load_train_config("configs/train/smoke.yaml")
    f = load_train_config("configs/train/full.yaml")
    assert s.name == "smoke" and f.name == "full"
    assert s.eval.policies == ["A", "B", "C"] and f.history.runs[0].days == 180
    assert s.forecast.n_estimators < f.forecast.n_estimators and s.eval.replate_ab


def test_train_cli_unknown_stage_fails_and_m3_stages_are_listed():
    r = CliRunner().invoke(train_app, ["nope", "--config", "configs/train/smoke.yaml"])
    assert r.exit_code != 0
    r = CliRunner().invoke(train_app, ["ppo", "--config", "configs/train/smoke.yaml", "--dry-run"])
    assert r.exit_code == 0 and "ppo" in r.output


def test_eval_cli_runs_a_tiny_arena(tmp_path):
    out = tmp_path / "r.json"
    r = CliRunner().invoke(eval_app, ["--policies", "A,B", "--seeds", "1", "--days", "1", "--out", str(out)])
    assert r.exit_code == 0, r.output
    j = json.loads(out.read_text())
    assert set(j["arena"]["policies"]) == {"A", "B"}


# --------------------------------------------------------------------- slow
def tiny_cfg(tmp_path) -> TrainConfig:
    return TrainConfig(
        name="tiny", runs_dir=str(tmp_path / "runs"), models_dir=str(tmp_path / "models"),
        history={"runs": [{"policy": "B", "seed": 11, "days": 12}, {"policy": "B", "seed": 12, "days": 10}],
                 "price_experiment": {"groups": 4, "variants": 3, "seed": 70}},
        forecast={"n_estimators": 30, "folds": 2, "test_days": 1, "min_history": 7},
        prep_time={"n_estimators": 20}, rider_eta={"n_estimators": 20}, replate_model={"n_estimators": 20},
        eval={"policies": ["A", "C"], "seeds": [1], "days": 1, "replate_ab": True},
    )  # fmt: skip


@pytest.mark.slow
def test_pipeline_end_to_end_tiny(tmp_path):
    cfg = tiny_cfg(tmp_path)
    res = run_all(cfg, M2_STAGES)
    assert set(res) == set(M2_STAGES)
    assert res["forecast"]["backtest"]["wape_p50"] > 0
    assert res["text"]["review_tagger"]["macro_f1"] > 0.6 and res["text"]["note_parser"]["macro_f1"] > 0.6
    assert res["eval"]["arena"]["policies"]["C"]["mean_profit"] > 0
    assert "waste_reduction_pct" in res["eval"]["replate_ab"]
    kinds = {r["kind"] for r in json.loads((tmp_path / "models" / "registry.json").read_text()) if r["champion"]}
    assert {"forecast", "elasticity", "prep_time", "rider_eta", "text", "replate"} <= kinds
    # a policy C world can use the freshly trained champions
    from brew.policies.C_solver import PolicyC

    p = PolicyC(models_dir=tmp_path / "models")
    w = World(policy=p, seed=2, days=1)
    w.run(1)
    assert set(p.bundle.loaded()) >= {"forecaster", "elasticity", "prep_time"}


@pytest.mark.slow
def test_acceptance_c_beats_a_and_b_on_three_smoke_seeds():
    from brew.analysis.arena import run_arena

    res = run_arena(["A", "B", "C"], [1, 2, 3], 5, "weekday_normal")
    s = res.summary()["policies"]
    assert s["C"]["mean_profit"] > s["B"]["mean_profit"] > 0 and s["C"]["mean_profit"] > s["A"]["mean_profit"]


@pytest.mark.slow
def test_stage_history_and_forecast_beat_naive_wape(tmp_path):
    cfg = tiny_cfg(tmp_path)
    run_stage("history", cfg)
    out = run_stage("forecast", cfg)
    bt = out["backtest"]
    assert bt["wape_p50"] < bt["wape_seasonal_naive"]
