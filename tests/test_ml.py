"""ML components: forecaster, nowcast, elasticity, text models, registry, stats, demand log."""

from __future__ import annotations

import numpy as np
import polars as pl
import pytest

from brew.analysis.stats import compare, cvar, paired_bootstrap_ci, wilcoxon_p
from brew.forecast import features as F
from brew.forecast.backtest import backtest
from brew.forecast.baselines import bias, coverage, pinball, wape
from brew.forecast.lgbm import Forecaster
from brew.forecast.nowcast import GammaPoissonNowcast
from brew.models.elasticity import ElasticityModel, true_beta
from brew.models.registry import ModelRegistry
from brew.models.text_notes import NoteParser, load_note_rows
from brew.models.text_reviews import ReviewCauseTagger, load_review_rows, train_test_split_rows
from brew.sim.demandlog import OPEN_SLOTS, DayRec, DemandLog

SKUS = ["cappuccino", "chai", "croissant", "sandwich"]
CATS = ["coffee", "notcoffee", "bakes", "plates"]


def synth_log(days: int = 28, seed: int = 0, weekly: bool = True) -> DemandLog:
    """Seasonal demand: slot shape x SKU level x weekday effect, Poisson noise."""
    rng = np.random.default_rng(seed)
    log = DemandLog(SKUS, keep=10**6)
    slots = np.array(list(OPEN_SLOTS))
    shape = np.exp(-(((slots - 50) / 9.0) ** 2)) + 0.4 * np.exp(-(((slots - 76) / 6.0) ** 2)) + 0.05
    level = np.array([1.6, 1.2, 0.7, 0.4])
    wd_mult = np.array([1.0, 0.9, 0.95, 0.9, 1.1, 1.5, 1.3]) if weekly else np.ones(7)
    for d in range(days):
        wd = d % 7
        rec = DayRec(d, wd, (False, False, False, False), len(SKUS))
        lam = shape[:, None, None] * level[None, :, None] * wd_mult[wd] * np.array([1.0, 0.35])[None, None, :]
        rec.counts[slots] = rng.poisson(lam).astype(np.float32)
        rec.seen[:] = True
        log.days.append(rec)
    return log


# ------------------------------------------------------------------ forecaster
def test_forecaster_quantiles_monotone_and_beats_naive_on_seasonal_data():
    log = synth_log(28)
    res = backtest([log], SKUS, CATS, folds=2, test_days=3, n_estimators=60, out_dir=None)
    assert res["wape_p50"] < res["wape_seasonal_naive"]
    assert res["wape_mean"] < res["wape_seasonal_naive"] * 1.05
    assert 0.5 < res["coverage_p10_p90"] <= 1.0
    fc = Forecaster.fit([log], SKUS, CATS, n_estimators=40)
    fa = fc.predict_arrays(log, 40, 8)
    assert fa.p10.shape == (8, len(SKUS), 2)
    assert np.all(fa.p10 <= fa.p50 + 1e-9) and np.all(fa.p50 <= fa.p90 + 1e-9) and np.all(fa.p10 >= 0)
    assert fa.mean.sum() > 0


def test_forecaster_save_load_roundtrip_and_frame(tmp_path):
    log = synth_log(21)
    fc = Forecaster.fit([log], SKUS, CATS, n_estimators=20)
    fc.save(tmp_path / "fc")
    fc2 = Forecaster.load(tmp_path / "fc")
    a = fc.predict_arrays(log, 44, 4)
    b = fc2.predict_arrays(log, 44, 4)
    assert np.allclose(a.p50, b.p50) and np.allclose(a.mean, b.mean)
    df = fc.to_frame(a)
    assert set(df.columns) == {"sku", "channel_group", "slot", "p10", "p50", "p90", "mean"} and len(df) == 4 * len(SKUS) * 2


def test_forecaster_handles_a_young_world_via_profile():
    log = synth_log(21)
    fc = Forecaster.fit([log], SKUS, CATS, n_estimators=30)
    young = DemandLog(SKUS)
    young.new_day(0, 2, {})
    fa = fc.predict_arrays(young, 48, 4)
    ref = fc.predict_arrays(log, 48, 4)
    assert fa.mean.sum() > 0.4 * ref.mean.sum() and fa.mean.sum() < 2.5 * ref.mean.sum()


def test_metrics_helpers():
    y = np.array([1.0, 2.0, 3.0, 0.0])
    assert wape(y, y) == 0 and wape(y, np.zeros(4)) == 1.0
    assert bias(y, y + 1) == pytest.approx(4 / 6)
    assert pinball(y, y, 0.5) == 0
    assert coverage(y, y - 1, y + 1) == 1.0
    assert wape(np.zeros(3), np.ones(3)) == 0.0


def test_gamma_poisson_nowcast():
    n = GammaPoissonNowcast(20, 20)
    assert n.level == 1.0
    n.update(observed=60, expected=40)  # busier than forecast
    assert n.level == pytest.approx(80 / 60) and n.level > 1.0
    assert n.quantile(0.1) < n.level < n.quantile(0.9)
    n.reset()
    assert n.level == 1.0


def test_demandlog_dense_frame_roundtrip():
    log = synth_log(9)
    cats = dict(zip(SKUS, CATS, strict=True))
    df = log.dense_frame(cats, include_current=False)
    assert len(df) == 9 * len(OPEN_SLOTS) * len(SKUS) * 2
    log2 = DemandLog.from_frame(df, SKUS)
    assert len(log2.days) == 9
    assert float(sum(r.counts.sum() for r in log.days)) == pytest.approx(float(sum(r.counts.sum() for r in log2.days)))
    fs = F.build(log2.days, len(SKUS), [F.CATS.index(c) for c in CATS], min_history=7)
    assert fs.X.shape[1] == len(F.FEATURES) and len(fs.y) == 2 * len(OPEN_SLOTS) * len(SKUS) * 2


# ----------------------------------------------------------------- elasticity
def test_elasticity_recovers_known_beta_on_generated_data():
    rng = np.random.default_rng(3)
    true = {"cappuccino": -1.4, "chai": -0.6, "croissant": -2.0, "sandwich": -1.0}
    rows = []
    for g in range(120):
        for hour in range(8, 22):
            for sku, beta in true.items():
                for fg in ("offline", "delivery"):
                    pr = float(rng.choice([0.9, 0.95, 1.0, 1.05, 1.1]))
                    lam = 4.0 * np.exp(beta * np.log(pr)) * (1.0 if fg == "offline" else 0.4) * (1.2 if hour in (12, 13) else 1.0)
                    for k in range(4):
                        rows.append((g, 0, hour * 4 + k, sku, fg, float(rng.poisson(lam / 4)), pr))
    df = pl.DataFrame(rows, schema=["day_id", "weekday", "slot", "sku", "channel_group", "qty", "price_ratio"], orient="row").with_columns(
        pl.lit(0).alias("hidden"), pl.lit(1).alias("wx"), pl.lit(26.0).alias("temp_c"), pl.lit(0).alias("holiday"),
        pl.lit(0).alias("cricket"), pl.lit(0).alias("exam"), pl.lit(0).alias("payday"), pl.col("day_id").alias("day"),
        pl.lit(0).alias("variant"),
    )  # fmt: skip
    cats = dict(zip(SKUS, CATS, strict=True))
    m = ElasticityModel.fit(df, cats, shrink_k=0.0)
    r = m.result
    assert r is not None and m.signs_ok()
    errs = sorted(abs(r.raw_beta[s_] - b) for s_, b in true.items())
    assert errs[len(errs) // 2] < 0.3 and errs[-1] < 0.6, errs
    for sku in true:
        assert r.beta[sku] < 0
    assert m.factor("croissant", 1.1) < m.factor("chai", 1.1) < 1.0
    assert r.se["cappuccino"] > 0


def test_elasticity_roundtrip_and_true_beta(tmp_path, cafe_cfg):
    tb = true_beta(cafe_cfg)
    assert len(tb) == 23 and all(-3.0 < v < -0.4 for v in tb.values())
    from brew.models.elasticity import ElasticityResult

    m = ElasticityModel(ElasticityResult({"a": -1.2}, {"a": 0.1}, {"a": 10}, {"a": -1.3}, {"coffee": -1.2}, {"coffee": -1.0}, {"a": -1.3}))
    m.save(tmp_path)
    m2 = ElasticityModel.load(tmp_path)
    assert m2.beta("a") == -1.2 and m2.result.loss == {"coffee": -1.0} and m2.beta("zzz", -0.9) == -0.9


# ----------------------------------------------------------------- text models
def test_text_models_train_on_fixtures_and_score_in_sample():
    rows = load_review_rows("fixtures")
    tagger = ReviewCauseTagger().fit(rows)
    assert tagger.evaluate(rows)["macro_f1"] > 0.6
    assert set(tagger.tag(rows[0]["text"])) <= set(__import__("brew.domain.enums", fromlist=["CAUSES"]).CAUSES)
    notes = load_note_rows("fixtures")
    parser = NoteParser().fit(notes)
    assert parser.evaluate(notes)["macro_f1"] > 0.6


def test_text_models_held_out_f1_on_clean_synthetic_data():
    rows = load_review_rows("clean")
    if len(rows) < 500:
        pytest.skip("clean synthetic reviews not present")
    tr, te = train_test_split_rows(rows, 0.25, 0)
    assert ReviewCauseTagger().fit(tr).evaluate(te)["macro_f1"] > 0.6
    nr = load_note_rows("clean")
    tr, te = train_test_split_rows(nr, 0.25, 0)
    ev = NoteParser().fit(tr).evaluate(te)
    assert ev["macro_f1"] > 0.6 and ev["macro_f1_modifiers"] > 0.6


def test_note_parser_rules_and_roundtrip(tmp_path):
    rows = load_note_rows("clean") if len(load_note_rows("clean")) > 500 else load_note_rows("fixtures")
    p = NoteParser().fit(rows)
    r = p.parse("nut allergy please, no onion, for Riya's birthday - quick!")
    assert "nonuts" in r.modifiers and "noonion" in r.modifiers and r.allergy == "nuts" and "allergy" in r.intents
    p.save(tmp_path)
    assert NoteParser.load(tmp_path).parse("oat milk please").modifiers == p.parse("oat milk please").modifiers
    t = ReviewCauseTagger().fit(load_review_rows("fixtures"))
    t.save(tmp_path / "t")
    assert ReviewCauseTagger.load(tmp_path / "t").trained == t.trained


# ------------------------------------------------------------------- registry
def test_registry_register_champion_and_listing(tmp_path):
    art = tmp_path / "art"
    art.mkdir()
    (art / "model.txt").write_text("x")
    reg = ModelRegistry(tmp_path / "models")
    reg.register("forecast", "lgbm", "v1", artifact_dir=art, metrics={"wape": 0.5, "nan": float("nan")}, params={"k": 1})
    reg.register("forecast", "lgbm", "v2", artifact_dir=art, metrics={"wape": 0.4})
    rows = reg.list("forecast")
    assert [r["version"] for r in rows] == ["v1", "v2"] and [r["champion"] for r in rows] == [False, True]
    assert rows[0]["metrics"]["nan"] is None
    p = reg.champion("forecast", "lgbm")
    assert p is not None and (p / "model.txt").exists() and p.name == "v2"
    assert reg.champion("elasticity") is None and reg.models_loaded() == 1


def test_registry_sync_db(tmp_path):
    reg = ModelRegistry(tmp_path / "m")
    reg.register("x", "y", "v", metrics={"a": 1})
    assert reg.sync_db(f"sqlite:///{tmp_path}/r.db") == 1
    assert reg.sync_db(f"sqlite:///{tmp_path}/r.db") == 0


# ---------------------------------------------------------------------- stats
def test_paired_bootstrap_ci_covers_the_true_shift_and_is_reproducible():
    rng = np.random.default_rng(1)
    base = rng.normal(100, 10, 40)
    other = base + 8 + rng.normal(0, 3, 40)
    m, lo, hi = paired_bootstrap_ci(other - base, n_boot=4000, seed=7)
    assert lo < 8 < hi and lo > 0
    assert paired_bootstrap_ci(other - base, n_boot=4000, seed=7) == (m, lo, hi)
    c = compare(base, other)
    assert c["wilcoxon_p"] < 0.001 and c["win_rate"] > 0.95 and c["n"] == 40


def test_wilcoxon_and_cvar():
    assert np.isnan(wilcoxon_p([0.0, 0.0]))
    assert wilcoxon_p([1, 2, 3, 4, 5, 6, 7, 8]) < 0.01
    assert cvar([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.2) == 1.5
    assert cvar([], 0.1) == 0.0
