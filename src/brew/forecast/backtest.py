"""Rolling-origin backtest of the LightGBM forecaster vs seasonal-naive / moving-average baselines."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

from brew.sim.demandlog import DayRec, DemandLog

from . import features as F
from .baselines import bias, coverage, moving_average, pinball, seasonal_naive, wape
from .lgbm import Forecaster


def _truncate(log: DemandLog, upto: int) -> DemandLog:
    out = DemandLog(log.skus, keep=10**6)
    out.days = log.days[:upto]
    return out


def backtest(
    logs: list[DemandLog],
    skus: list[str],
    cats: list[str],
    *,
    folds: int = 3,
    test_days: int = 2,
    n_estimators: int = 120,
    seed: int = 0,
    min_history: int = 7,
    out_dir: str | Path | None = None,
) -> dict[str, Any]:
    """Rolling-origin evaluation on the last ``folds * test_days`` days of the first log.

    Every fold trains on all other logs plus the first log up to the fold cut. Metrics are computed on
    all open-slot rows of the test days; ``wape_p50`` compares the P50 forecast with the baselines.
    """
    primary = logs[0]
    recs: list[DayRec] = primary.all_days(include_current=False)
    n = len(recs)
    cat_of = [F.CATS.index(c) for c in cats]
    first_cut = n - folds * test_days
    if first_cut < min_history + 2:
        raise ValueError(f"history of {n} days is too short for {folds} folds of {test_days} days")
    ys, p50s, naive, ma, p10s, p90s, means, keys = ([] for _ in range(8))
    for k in range(folds):
        cut = first_cut + k * test_days
        train_logs = [_truncate(primary, cut), *logs[1:]]
        fc = Forecaster.fit(
            train_logs, skus, cats, n_estimators=n_estimators, seed=seed, min_history=min_history
        )
        targets = list(range(cut, cut + test_days))
        fs = F.build(recs, len(skus), cat_of, targets=targets, profile=fc.profile, seed=seed + 100 + k)
        pred = fc.predict_rows(fs.X)
        ys.append(fs.y)
        keys.append(
            ((fs.day * 100 + fs.slot // 4) * 64 + fs.sku_i) * 2 + fs.fg  # (day, hour, sku, group) cell id
        )
        p50s.append(pred["p50"])
        p10s.append(pred["p10"])
        p90s.append(pred["p90"])
        means.append(pred["mean"])
        naive.append(seasonal_naive(fs))
        ma.append(moving_average(fs))
    y = np.concatenate(ys)
    p10, p50, p90 = np.concatenate(p10s), np.concatenate(p50s), np.concatenate(p90s)
    mean = np.concatenate(means)
    sn, mv = np.concatenate(naive), np.concatenate(ma)
    res: dict[str, Any] = {
        "folds": folds, "test_days": test_days, "rows": int(len(y)), "demand_units": float(y.sum()),
        "wape_p50": wape(y, p50), "wape_mean": wape(y, mean), "wape_seasonal_naive": wape(y, sn),
        "wape_moving_average": wape(y, mv),
        "pinball_p10": pinball(y, p10, 0.1), "pinball_p50": pinball(y, p50, 0.5), "pinball_p90": pinball(y, p90, 0.9),
        "coverage_p10_p90": coverage(y, p10, p90), "bias_p50": bias(y, p50), "bias_mean": bias(y, mean),
    }  # fmt: skip
    res["improvement_vs_naive_pct"] = 100.0 * (1.0 - res["wape_p50"] / max(1e-9, res["wape_seasonal_naive"]))
    # hourly roll-up (what planning actually consumes): sum the 4 slots of each hour per sku/group
    cell = np.concatenate(keys)
    _u, inv = np.unique(cell, return_inverse=True)
    hy = np.bincount(inv, weights=y)
    res["wape_hourly_mean_model"] = wape(hy, np.bincount(inv, weights=mean))
    res["wape_hourly_seasonal_naive"] = wape(hy, np.bincount(inv, weights=sn))
    res["wape_hourly_moving_average"] = wape(hy, np.bincount(inv, weights=mv))
    if out_dir is not None:
        d = Path(out_dir)
        d.mkdir(parents=True, exist_ok=True)
        (d / "metrics.json").write_text(json.dumps(res, indent=2))
    return res
