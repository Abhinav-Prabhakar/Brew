"""Training pipeline stages (backend.md 9): history, forecast, elasticity, prep_time, rider_eta, text,
replate (sell-through) and eval.  Each stage reads/writes under ``<runs>/`` and registers its champion
artifact in the model registry.  M3 stages (bc, ppo, adversarial, export) live elsewhere.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from brew.config.loader import default_cafe
from brew.models.registry import ModelRegistry

from .config import TrainConfig

M2_STAGES = ("history", "forecast", "elasticity", "prep_time", "rider_eta", "text", "replate", "eval")


def _history_dir(cfg: TrainConfig) -> Path:
    return cfg.run_dir() / "history"


def _manifest(cfg: TrainConfig) -> list[dict[str, Any]]:
    f = _history_dir(cfg) / "manifest.json"
    if not f.exists():
        raise FileNotFoundError(f"no history at {f}; run `brew-train history` first")
    return list(json.loads(f.read_text()))


def _write_metrics(cfg: TrainConfig, stage: str, metrics: dict[str, Any]) -> None:
    d = cfg.run_dir()
    d.mkdir(parents=True, exist_ok=True)
    (d / f"metrics_{stage}.json").write_text(json.dumps(metrics, indent=2, default=str))


def _register(
    cfg: TrainConfig, kind: str, name: str, artifact: Path, metrics: dict[str, Any], params: dict[str, Any],
    lineage: dict[str, Any] | None = None,
) -> dict[str, Any]:  # fmt: skip
    reg = ModelRegistry(cfg.models_path())
    entry = reg.register(
        kind, name, cfg.name, artifact_dir=artifact, metrics=metrics, params=params,
        lineage=lineage or {"history": [m["name"] for m in _manifest(cfg)], "config": cfg.name},
    )  # fmt: skip
    return entry


def _skus_cats() -> tuple[list[str], list[str]]:
    cafe = default_cafe()
    return [m.sku for m in cafe.menu], [m.cat for m in cafe.menu]


# ----------------------------------------------------------------------------- stages
def stage_history(cfg: TrainConfig) -> dict[str, Any]:
    """Generate synthetic POS history (policy A/B + price/pre-make/ladder exploration + CRN price experiment)."""
    from .history import generate_history

    rows = generate_history(cfg.history, cfg.run_dir())
    return {"runs": [{k: r[k] for k in ("name", "policy", "seed", "days", "wall_s")} for r in rows]}


def stage_forecast(cfg: TrainConfig) -> dict[str, Any]:
    """LightGBM quantile forecaster + seasonal-naive baseline, rolling-origin backtest."""
    from brew.forecast.backtest import backtest
    from brew.forecast.lgbm import Forecaster

    from .history import load_history_logs

    skus, cats = _skus_cats()
    logs = load_history_logs(cfg.run_dir(), skus)
    fc = cfg.forecast
    out = cfg.run_dir() / "forecast"
    bt = backtest(
        logs, skus, cats, folds=fc.folds, test_days=fc.test_days, n_estimators=fc.n_estimators,
        min_history=fc.min_history, out_dir=out,
    )  # fmt: skip
    model = Forecaster.fit(logs, skus, cats, n_estimators=fc.n_estimators, min_history=fc.min_history)
    art = model.save(out / "model")
    entry = _register(cfg, "forecast", "lgbm", art, bt, fc.model_dump())
    return {"backtest": bt, "version": entry["version"]}


def stage_elasticity(cfg: TrainConfig) -> dict[str, Any]:
    """Penalised Poisson GLM on the CRN price experiment (falls back to the exploration history)."""
    import polars as pl

    from brew.models.elasticity import ElasticityModel, true_beta

    cafe = default_cafe()
    cats = {m.sku: m.cat for m in cafe.menu}
    exp = _history_dir(cfg) / "price_exp" / "demand_dense.parquet"
    if exp.exists():
        df = pl.read_parquet(exp)
    else:
        frames = []
        for i, r in enumerate(_manifest(cfg)):
            frames.append(
                pl.read_parquet(Path(r["path"]) / "demand_dense.parquet").with_columns(
                    (pl.col("day") + 1000 * (i + 1)).alias("day_id")
                )
            )
        df = pl.concat(frames)
    ec = cfg.elasticity
    m = ElasticityModel.fit(df, cats, alpha=ec.alpha, shrink_k=ec.shrink_k)
    tb = true_beta(cafe)
    assert m.result is not None
    errs = sorted(abs(m.result.beta[s] - tb[s]) for s in m.result.beta)
    metrics = {
        "signs_ok": m.signs_ok(), "median_abs_err": errs[len(errs) // 2], "max_abs_err": errs[-1],
        "beta": m.result.beta, "true_beta": tb, "category_beta": m.result.category_beta, "loss": m.result.loss,
    }  # fmt: skip
    art = m.save(cfg.run_dir() / "elasticity")
    _register(cfg, "elasticity", "poisson_glm", art, {k: v for k, v in metrics.items() if k not in ("beta", "true_beta")}, ec.model_dump())
    return metrics


def _telemetry(cfg: TrainConfig, name: str) -> Any:
    import polars as pl

    frames = []
    for r in _manifest(cfg):
        f = Path(r["path"]) / f"{name}.parquet"
        if f.exists():
            frames.append(pl.read_parquet(f))
    return pl.concat(frames) if frames else None


def stage_prep_time(cfg: TrainConfig) -> dict[str, Any]:
    from brew.models.prep_time import PrepTimeModel

    tasks = _telemetry(cfg, "tasks")
    qc = cfg.prep_time
    model, metrics = PrepTimeModel.fit(tasks, qc.n_estimators)
    art = model.save(cfg.run_dir() / "prep_time")
    _register(cfg, "prep_time", "lgbm_quantile", art, metrics, qc.model_dump())
    return metrics


def stage_rider_eta(cfg: TrainConfig) -> dict[str, Any]:
    from brew.models.rider_eta import RiderEtaModel

    d = _telemetry(cfg, "deliveries")
    qc = cfg.rider_eta
    model, metrics = RiderEtaModel.fit(d, qc.n_estimators)
    art = model.save(cfg.run_dir() / "rider_eta")
    _register(cfg, "rider_eta", "lgbm_quantile", art, metrics, qc.model_dump())
    return metrics


def stage_text(cfg: TrainConfig) -> dict[str, Any]:
    """Review-cause tagger and ticket-note parser on the (clean) synthetic data, with a held-out split."""
    from brew.models.text_notes import NoteParser, load_note_rows
    from brew.models.text_reviews import ReviewCauseTagger, load_review_rows, train_test_split_rows

    tc = cfg.text
    out: dict[str, Any] = {}
    rows = load_review_rows(tc.source)
    tr, te = train_test_split_rows(rows, tc.test_size, tc.seed)
    tagger = ReviewCauseTagger().fit(tr)
    ev = tagger.evaluate(te)
    final = ReviewCauseTagger().fit(rows)
    art = final.save(cfg.run_dir() / "text_reviews")
    ev["rows"] = len(rows)
    _register(cfg, "text", "review_tagger", art, ev, {"source": tc.source})
    out["review_tagger"] = ev
    rows = load_note_rows(tc.source)
    tr, te = train_test_split_rows(rows, tc.test_size, tc.seed)
    parser = NoteParser().fit(tr)
    ev = parser.evaluate(te)
    final_p = NoteParser().fit(rows)
    art = final_p.save(cfg.run_dir() / "text_notes")
    ev["rows"] = len(rows)
    _register(cfg, "text", "note_parser", art, ev, {"source": tc.source})
    out["note_parser"] = ev
    return out


def stage_replate(cfg: TrainConfig) -> dict[str, Any]:
    """Replate sell-through model from listing telemetry."""
    from brew.models.replate_model import SellThroughModel

    obs = _telemetry(cfg, "replate_obs")
    skus, _ = _skus_cats()
    qc = cfg.replate_model
    if obs is None:
        import polars as pl

        obs = pl.DataFrame()
    model, metrics = SellThroughModel.fit(obs, skus, qc.n_estimators) if len(obs) else (SellThroughModel.fit(obs, skus)[0], {"trained": False, "rows": 0})
    art = model.save(cfg.run_dir() / "replate_sellthrough")
    _register(cfg, "replate", "sellthrough", art, metrics, qc.model_dump())
    return metrics


def stage_eval(cfg: TrainConfig) -> dict[str, Any]:
    """Arena: policies x seeds x days with paired CIs vs A, plus the Replate on/off comparison."""
    from brew.analysis.arena import run_arena, run_replate_ab

    ec = cfg.eval
    res = run_arena(ec.policies, ec.seeds, ec.days, ec.scenario, workers=ec.workers, models_dir=cfg.models_path())
    out: dict[str, Any] = {"arena": res.summary()}
    if ec.replate_ab and "C" in ec.policies:
        out["replate_ab"] = run_replate_ab("C", ec.seeds, ec.days, ec.scenario, models_dir=cfg.models_path())
    d = cfg.run_dir() / "eval"
    d.mkdir(parents=True, exist_ok=True)
    (d / "eval.json").write_text(json.dumps(out, indent=2, default=str))
    return out


STAGE_FUNCS: dict[str, Callable[[TrainConfig], dict[str, Any]]] = {
    "history": stage_history,
    "forecast": stage_forecast,
    "elasticity": stage_elasticity,
    "prep_time": stage_prep_time,
    "rider_eta": stage_rider_eta,
    "text": stage_text,
    "replate": stage_replate,
    "eval": stage_eval,
}


def run_stage(stage: str, cfg: TrainConfig) -> dict[str, Any]:
    """Run one stage; records wall time in the stage metrics file."""
    if stage not in STAGE_FUNCS:
        raise ValueError(f"unknown stage {stage!r}; M2 stages: {', '.join(M2_STAGES)}")
    t0 = time.perf_counter()
    res = STAGE_FUNCS[stage](cfg)
    res = {**res, "_wall_s": round(time.perf_counter() - t0, 2)}
    _write_metrics(cfg, stage, res)
    return res


def run_all(cfg: TrainConfig, stages: tuple[str, ...] = M2_STAGES, log: Callable[[str], None] | None = None) -> dict[str, Any]:
    """Run the M2 stages in order (M3 stages are skipped here)."""
    out: dict[str, Any] = {}
    for s in stages:
        if log:
            log(f"stage {s} ...")
        out[s] = run_stage(s, cfg)
        if log:
            log(f"stage {s} done in {out[s]['_wall_s']}s")
    return out
