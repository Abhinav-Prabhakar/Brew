"""Rider-ETA model: LightGBM quantiles of rider arrival time from delivery telemetry (technical.md 12.6)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

from .gbm import FeatureSpace, QuantileGBM

NUMERIC = ["eta_pred_s", "rain", "hour"]
TARGET = "eta_actual_s"


class RiderEtaModel:
    """P10 / P50 / P90 seconds from rider dispatch to arrival."""

    def __init__(self, model: QuantileGBM) -> None:
        self.model = model

    @classmethod
    def fit(cls, deliveries: Any, n_estimators: int = 80, seed: int = 0) -> tuple[RiderEtaModel, dict[str, Any]]:
        df = deliveries.filter(deliveries[TARGET] > 0).sort("sim_s")
        space = FeatureSpace(NUMERIC, {"platform": sorted(set(df["platform"].to_list()))})
        cut = int(len(df) * 0.8)
        tr, te = df[:cut], df[cut:]
        probe = QuantileGBM(space).fit(tr, TARGET, n_estimators, seed)
        q = probe.predict(te)
        y = te[TARGET].to_numpy()
        pred = te["eta_pred_s"].to_numpy()
        metrics = {
            "p50_mae_s": float(np.abs(y - q[:, 1]).mean()),
            "platform_pred_mae_s": float(np.abs(y - pred).mean()),
            "coverage_p10_p90": float(np.mean((y >= q[:, 0]) & (y <= q[:, 2]))),
            "p90_coverage": float(np.mean(y <= q[:, 2])),
            "rows_test": len(y),
        }
        return cls(QuantileGBM(space).fit(df, TARGET, n_estimators, seed)), metrics

    def predict(self, platform: str, eta_pred_s: float, rain: float, hour: float) -> tuple[float, float, float]:
        q = self.model.predict_row(platform=platform, eta_pred_s=eta_pred_s, rain=rain, hour=hour)
        return float(q[0]), float(q[1]), float(q[2])

    def save(self, path: str | Path) -> Path:
        d = self.model.save(path)
        (d / "kind.json").write_text(json.dumps({"kind": "rider_eta"}))
        return d

    @classmethod
    def load(cls, path: str | Path) -> RiderEtaModel:
        return cls(QuantileGBM.load(path))
