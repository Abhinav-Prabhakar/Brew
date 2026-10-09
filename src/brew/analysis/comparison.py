"""Policy comparison from the committed final arena (``docs/training/full-20261005/metrics.json``)."""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from brew.config.loader import repo_root

from .stats import paired_bootstrap_ci

SOURCE = "docs/training/full-20261005/metrics.json"
LABELS = {"A": "A naive", "B": "B heuristic", "C": "C optimiser", "D": "D learned"}


@lru_cache(maxsize=4)
def load_comparison(source: str = SOURCE) -> dict[str, Any]:
    """Final arena (``stages.arena.days_7``) reshaped for the HUD. Loaded once, cached.

    All profit / waste / walkout numbers are **per-day means** (the arena averages each seed's days, then the seeds).
    ``ci95`` is the 95 % percentile-bootstrap CI of the mean of ``profit_by_seed`` (10 000 resamples, RNG seed 0,
    deterministic); the paired CI against A stays in ``vs_A.ci95``.
    """
    raw = json.loads((repo_root() / source).read_text())
    arena = raw["stages"]["arena"]["days_7"]
    pols: dict[str, Any] = {}
    base = arena["policies"]["A"]["mean_profit"]
    for code, row in arena["policies"].items():
        by_seed = row["profit_by_seed"]
        _m, lo, hi = paired_bootstrap_ci(by_seed, seed=0)
        out = {
            "policy": code, "label": LABELS.get(code, code), "mean_profit": row["mean_profit"],
            "profit_by_seed": by_seed, "ci95": [round(lo, 2), round(hi, 2)],
            "mean_waste_kg": row["mean_waste_kg"], "mean_rating": row["mean_rating"],
            "mean_walkouts": row["mean_walkouts"], "mean_revenue": row.get("mean_revenue"),
            "mean_sla_breach": row.get("mean_sla_breach"), "cvar10_daily_profit": row["cvar10_daily_profit"],
            "uplift_pct_vs_A": round(100.0 * (row["mean_profit"] / base - 1.0), 1) if base else None,
            "vs_A": row.get("vs_A"),
        }  # fmt: skip
        pols[code] = out
    a = pols["A"]
    return {
        "scenario": arena["scenario"], "seeds": arena["seeds"], "days": arena["days"], "source": source,
        "unit": "per-day means (INR/day, kg/day, walkouts/day)", "labels": LABELS,
        "order": [k for k in LABELS if k in pols], "policies": pols,
        "baseline": {k: a[k] for k in ("policy", "label", "mean_profit", "mean_waste_kg", "mean_rating", "mean_walkouts", "mean_revenue")},
    }  # fmt: skip
