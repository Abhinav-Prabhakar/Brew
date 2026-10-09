"""Replate sell-through model (technical.md 7.11): expected units sold per 5-minute tick of a listing.

A LightGBM Poisson regressor on listing telemetry (``replate_obs.parquet``): features ``frac_left,
discount_pct, price_ratio, hour, weather, footfall, n_competing, remaining, sku``.  ``p_any = 1 - exp(-rate)``
is the probability that at least one unit sells in the tick (the "classifier" view of the same model).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import lightgbm as lgb
import numpy as np

from .gbm import FeatureSpace, train_booster

NUMERIC = ["frac_left", "discount_pct", "price_ratio", "hour", "footfall", "n_competing", "remaining"]
TARGET = "sold_next"
WEATHER = ["sunny", "partly", "cloudy", "drizzle", "rain"]


class SellThroughModel:
    """Units per 5 min as a function of discount depth, time left, hour and competition."""

    def __init__(self, booster: lgb.Booster | None, space: FeatureSpace, prior: float = 0.05) -> None:
        self.booster = booster
        self.space = space
        self.prior = prior  # fallback rate (units / 5 min) when untrained

    @classmethod
    def fit(cls, obs: Any, skus: list[str], n_estimators: int = 60, seed: int = 0) -> tuple[SellThroughModel, dict[str, Any]]:
        space = FeatureSpace(NUMERIC, {"sku": skus, "weather": WEATHER})
        if len(obs) < 100:
            return cls(None, space), {"rows": len(obs), "trained": False}
        df = obs.sort("sim_s")
        cut = int(len(df) * 0.8)
        tr, te = df[:cut], df[cut:]
        X, y = space.matrix(tr), tr[TARGET].to_numpy().astype(float)
        params = {"objective": "poisson", "min_data_in_leaf": 10, "num_leaves": 15}
        probe = train_booster(X, y, space.cat_idx, space.names, params, n_estimators, seed=seed)
        mu = np.maximum(probe.predict(space.matrix(te), num_threads=1), 1e-6)
        yt = te[TARGET].to_numpy().astype(float)
        base = max(float(y.mean()), 1e-6)
        dev = lambda yy, m: float(2 * np.mean(np.where(yy > 0, yy * np.log(yy / m), 0.0) - (yy - m)))  # noqa: E731
        metrics = {
            "rows": len(df), "trained": True, "poisson_deviance": dev(yt, mu), "baseline_deviance": dev(yt, np.full_like(yt, base)),
            "mean_rate": float(y.mean()),
        }  # fmt: skip
        metrics["deviance_improvement_pct"] = 100.0 * (1.0 - metrics["poisson_deviance"] / max(1e-9, metrics["baseline_deviance"]))
        full = train_booster(
            space.matrix(df), df[TARGET].to_numpy().astype(float), space.cat_idx, space.names, params, n_estimators, seed=seed
        )
        return cls(full, space, prior=float(y.mean())), metrics

    def rate(
        self, sku: str, frac_left: float, discount_pct: float, price_ratio: float, hour: float, weather: str,
        footfall: float, n_competing: int, remaining: float,
    ) -> float:  # fmt: skip
        """Expected units sold in the next 5 minutes."""
        if self.booster is None:
            return self.prior * (1.0 + discount_pct / 50.0)
        x = self.space.row(
            sku=sku, weather=weather, frac_left=frac_left, discount_pct=discount_pct, price_ratio=price_ratio, hour=hour,
            footfall=footfall, n_competing=n_competing, remaining=remaining,
        )  # fmt: skip
        return float(max(self.booster.predict(x, num_threads=1)[0], 1e-6))

    def p_any(self, **kw: Any) -> float:
        return float(1.0 - np.exp(-self.rate(**kw)))

    def save(self, path: str | Path) -> Path:
        d = Path(path)
        d.mkdir(parents=True, exist_ok=True)
        if self.booster is not None:
            self.booster.save_model(str(d / "model.txt"))
        (d / "space.json").write_text(json.dumps({"space": self.space.to_json(), "prior": self.prior}))
        return d

    @classmethod
    def load(cls, path: str | Path) -> SellThroughModel:
        d = Path(path)
        j = json.loads((d / "space.json").read_text())
        booster = lgb.Booster(model_file=str(d / "model.txt")) if (d / "model.txt").exists() else None
        return cls(booster, FeatureSpace.from_json(j["space"]), j["prior"])
