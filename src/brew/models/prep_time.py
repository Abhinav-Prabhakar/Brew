"""Prep-time model: LightGBM quantiles of task duration from task telemetry (docs/implementation-spec.md 12.6)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from .gbm import FeatureSpace, QuantileGBM

NUMERIC = ["batch_size", "load", "fatigue", "hour"]
TARGET = "duration_s"


def prepare(df: Any) -> Any:
    """Add the ``hour`` feature and drop zero-length service rows."""
    import polars as pl

    return df.with_columns(((pl.col("sim_s") % 86400) // 3600).cast(pl.Float64).alias("hour")).filter(
        pl.col(TARGET) > 0
    )


class PrepTimeModel:
    """P10 / P50 / P90 of a task's duration given step, station, staff, batch size, load and fatigue."""

    def __init__(self, model: QuantileGBM, table: dict[str, Any] | None = None) -> None:
        self.model = model
        self.table = table or {}

    @classmethod
    def fit(cls, tasks: Any, n_estimators: int = 80, seed: int = 0) -> tuple[PrepTimeModel, dict[str, Any]]:
        """Train on a task frame; returns the model and held-out-style metrics."""
        df = prepare(tasks)
        space = FeatureSpace(
            NUMERIC,
            {
                "step": sorted(set(df["step"].to_list())),
                "station": sorted(set(df["station"].to_list())),
                "staff": sorted(set(df["staff"].to_list())),
            },
        )
        # time-ordered 80/20 split for honest metrics, then refit on everything
        df = df.sort("sim_s")
        cut = int(len(df) * 0.8)
        tr, te = df[:cut], df[cut:]
        probe = QuantileGBM(space).fit(tr, TARGET, n_estimators, seed)
        metrics = cls._metrics(probe, te)
        model = QuantileGBM(space).fit(df, TARGET, n_estimators, seed)
        pm = cls(model)
        pm.table = pm._nominal_table(df)
        return pm, metrics

    @staticmethod
    def _metrics(m: QuantileGBM, te: Any) -> dict[str, Any]:
        q = m.predict(te)
        y = te[TARGET].to_numpy()
        base = te.group_by("step").agg(__import__("polars").col(TARGET).median().alias("med"))
        med = dict(zip(base["step"].to_list(), base["med"].to_list(), strict=True))
        naive = np.array([med.get(s, y.mean()) for s in te["step"].to_list()])
        mae = float(np.abs(y - q[:, 1]).mean())
        return {
            "p50_mae_s": mae, "p50_mae_pct": mae / float(y.mean()), "naive_mae_s": float(np.abs(y - naive).mean()),
            "coverage_p10_p90": float(np.mean((y >= q[:, 0]) & (y <= q[:, 2]))), "rows_test": len(y),
        }  # fmt: skip

    def _nominal_table(self, df: Any) -> dict[str, Any]:
        """(station, step) -> (p50, p90) at the typical staffing / load - fast lookup for planners."""
        import polars as pl

        g = df.group_by(["station", "step"]).agg(
            pl.col("batch_size").median(), pl.col("load").median(), pl.col("fatigue").median(), pl.col("hour").median(),
            pl.col("staff").mode().first(),
        )  # fmt: skip
        out: dict[str, Any] = {}
        for r in g.iter_rows(named=True):
            q = self.model.predict_row(
                step=r["step"], station=r["station"], staff=r["staff"], batch_size=r["batch_size"], load=r["load"],
                fatigue=r["fatigue"], hour=r["hour"],
            )  # fmt: skip
            out[f"{r['station']}.{r['step']}"] = [float(q[1]), float(q[2])]
        return out

    def step_seconds(self, station: str, step: str, default: float) -> tuple[float, float]:
        """(P50, P90) seconds of a step at nominal conditions."""
        v = self.table.get(f"{station}.{step}")
        return (v[0], v[1]) if v else (default, default * 1.5)

    def save(self, path: str | Path) -> Path:
        import json

        d = self.model.save(path)
        (d / "table.json").write_text(json.dumps(self.table))
        return d

    @classmethod
    def load(cls, path: str | Path) -> PrepTimeModel:
        import json

        d = Path(path)
        t = json.loads((d / "table.json").read_text()) if (d / "table.json").exists() else {}
        return cls(QuantileGBM.load(d), t)
