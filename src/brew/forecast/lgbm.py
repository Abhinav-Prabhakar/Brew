"""Global LightGBM quantile demand forecaster (+ Poisson mean model) - technical.md 12.1."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import lightgbm as lgb
import numpy as np

from brew.sim.demandlog import FG, DemandLog

from . import features as F

QUANTILES = (0.1, 0.5, 0.9)
NAMES = ("p10", "p50", "p90")


@dataclass
class ForecastArrays:
    """Per-slot forecasts for the next ``H`` slots: arrays of shape ``(H, n_sku, 2)``."""

    slots: np.ndarray
    p10: np.ndarray
    p50: np.ndarray
    p90: np.ndarray
    mean: np.ndarray

    def total_mean(self) -> np.ndarray:
        """Expected units per sku over the whole horizon, shape ``(n_sku,)`` (both channel groups)."""
        return self.mean.sum(axis=(0, 2))


def default_params(n_estimators: int, seed: int = 0) -> dict[str, Any]:
    return {
        "num_leaves": 31, "learning_rate": 0.05, "min_data_in_leaf": 20, "feature_fraction": 0.9,
        "bagging_fraction": 0.9, "bagging_freq": 1, "verbose": -1, "seed": seed, "num_threads": 4,
        "n_estimators": n_estimators,
    }  # fmt: skip


class Forecaster:
    """Four boosters: quantile 0.1 / 0.5 / 0.9 and a Poisson mean used for planning."""

    def __init__(
        self,
        skus: list[str],
        cats: list[str],
        models: dict[str, lgb.Booster],
        profile: np.ndarray,
        meta: dict[str, Any] | None = None,
    ) -> None:
        self.skus = list(skus)
        self.cats = list(cats)
        self.cat_of = [F.CATS.index(c) for c in cats]
        self.models = models
        self.profile = profile
        self.meta = meta or {}

    # --------------------------------------------------------------- training
    @classmethod
    def fit(
        cls,
        logs: list[DemandLog],
        skus: list[str],
        cats: list[str],
        *,
        n_estimators: int = 120,
        seed: int = 0,
        min_history: int = 7,
        num_threads: int = 4,
        val_frac: float = 0.1,
    ) -> Forecaster:
        """Train on one or more demand logs (each a separate world history)."""
        cat_of = [F.CATS.index(c) for c in cats]
        all_days = [r for lg in logs for r in lg.all_days(include_current=False)]
        profile, profile_n = F.day_profile(all_days, len(skus))
        xs, ys, vals = [], [], []
        for li, lg in enumerate(logs):
            recs = lg.all_days(include_current=False)
            # every day is a training day: young-world days use a leave-one-out profile for their lags,
            # exactly what inference uses for a new world; censored (86'd) item-slots are dropped
            fs = F.build(
                recs, len(skus), cat_of, targets=list(range(len(recs))), min_history=min_history, seed=seed + li,
                profile=profile, profile_n=profile_n, loo=True,
            )  # fmt: skip
            if len(fs.y) == 0:
                continue
            keep = (fs.hidden == 0) if fs.hidden is not None else np.ones(len(fs.y), dtype=bool)
            xs.append(fs.X[keep])
            ys.append(fs.y[keep])
            cut = np.quantile(fs.day[keep], 1.0 - val_frac)
            vals.append(fs.day[keep] > cut)
        X = np.concatenate(xs)
        y = np.concatenate(ys)
        is_val = np.concatenate(vals)
        models: dict[str, lgb.Booster] = {}
        base = default_params(n_estimators, seed)
        base["num_threads"] = num_threads
        for name, alpha in zip(NAMES, QUANTILES, strict=True):
            models[name] = cls._train_one({**base, "objective": "quantile", "alpha": alpha}, X, y, is_val)
        models["mean"] = cls._train_one({**base, "objective": "poisson"}, X, y, is_val)
        meta = {
            "n_rows": int(len(y)), "n_estimators": n_estimators, "features": F.FEATURES, "seed": seed,
            "n_days": len(all_days),
        }  # fmt: skip
        return cls(skus, cats, models, profile, meta)

    @staticmethod
    def _train_one(params: dict[str, Any], X: np.ndarray, y: np.ndarray, is_val: np.ndarray) -> lgb.Booster:
        p = dict(params)
        n_est = p.pop("n_estimators")
        tr = lgb.Dataset(
            X[~is_val], y[~is_val], categorical_feature=F.CAT_IDX, feature_name=F.FEATURES, free_raw_data=False
        )
        callbacks = []
        valid_sets = []
        if is_val.any() and (~is_val).sum() > 50:
            va = lgb.Dataset(X[is_val], y[is_val], reference=tr)
            valid_sets = [va]
            callbacks = [lgb.early_stopping(30, verbose=False)]
        return lgb.train(p, tr, num_boost_round=n_est, valid_sets=valid_sets, callbacks=callbacks)

    # -------------------------------------------------------------- inference
    def predict_rows(self, X: np.ndarray) -> dict[str, np.ndarray]:
        """Raw predictions for feature rows; quantiles are sorted to be monotone and non-negative."""
        if len(X) == 0:
            z = np.zeros(0)
            return {"p10": z, "p50": z, "p90": z, "mean": z}
        raw = np.stack([self.models[n].predict(X, num_threads=1) for n in NAMES], axis=1)
        raw = np.maximum(raw, 0.0)
        raw.sort(axis=1)
        mean = np.maximum(self.models["mean"].predict(X, num_threads=1), 0.0)
        return {"p10": raw[:, 0], "p50": raw[:, 1], "p90": raw[:, 2], "mean": mean}

    def predict_arrays(
        self, log: DemandLog, now_slot: int, horizon_slots: int = 16, ratio_override: float | None = None
    ) -> ForecastArrays:
        """Forecast the next ``horizon_slots`` slots (from ``now_slot``, clipped to opening hours)."""
        X, slots = F.build_future(
            log, now_slot, horizon_slots, self.cat_of, self.profile, ratio_override=ratio_override
        )
        J = len(self.skus)
        H = len(slots)
        out = self.predict_rows(X)
        shape = (H, J, 2)
        return ForecastArrays(
            slots, out["p10"].reshape(shape), out["p50"].reshape(shape), out["p90"].reshape(shape),
            out["mean"].reshape(shape),
        )  # fmt: skip

    def predict(self, view: Any, horizon_slots: int = 16) -> Any:
        """``DataFrame[sku, channel_group, slot, p10, p50, p90, mean]`` for a world view."""
        import polars as pl

        log = view.demand_log()
        now_slot = int(view.tod_s // 900)
        fa = self.predict_arrays(log, now_slot, horizon_slots)
        return self.to_frame(fa)

    def to_frame(self, fa: ForecastArrays) -> Any:
        import polars as pl

        H = len(fa.slots)
        J = len(self.skus)
        slot = np.repeat(fa.slots, J * 2)
        sku = np.tile(np.repeat(np.array(self.skus), 2), H)
        fg = np.tile(np.array(FG), H * J)
        return pl.DataFrame(
            {
                "sku": sku, "channel_group": fg, "slot": slot, "p10": fa.p10.reshape(-1),
                "p50": fa.p50.reshape(-1), "p90": fa.p90.reshape(-1), "mean": fa.mean.reshape(-1),
            }
        )  # fmt: skip

    # ------------------------------------------------------------- persistence
    def save(self, path: str | Path) -> Path:
        d = Path(path)
        d.mkdir(parents=True, exist_ok=True)
        for name, b in self.models.items():
            b.save_model(str(d / f"{name}.txt"))
        np.savez_compressed(d / "profile.npz", profile=self.profile)
        (d / "forecaster.json").write_text(
            json.dumps({"skus": self.skus, "cats": self.cats, "meta": self.meta}, indent=2)
        )
        return d

    @classmethod
    def load(cls, path: str | Path) -> Forecaster:
        d = Path(path)
        info = json.loads((d / "forecaster.json").read_text())
        models = {n: lgb.Booster(model_file=str(d / f"{n}.txt")) for n in (*NAMES, "mean")}
        profile = np.load(d / "profile.npz")["profile"]
        return cls(info["skus"], info["cats"], models, profile, info.get("meta", {}))
