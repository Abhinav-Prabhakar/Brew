"""Arena statistics: paired bootstrap CIs, Wilcoxon signed-rank, CVaR (technical.md 14.3)."""

from __future__ import annotations

import math
from typing import Any

import numpy as np


def paired_bootstrap_ci(
    diffs: np.ndarray | list[float], n_boot: int = 10_000, alpha: float = 0.05, seed: int = 0
) -> tuple[float, float, float]:
    """``(mean, lo, hi)`` of the mean of paired differences with a percentile bootstrap (fixed RNG)."""
    d = np.asarray(diffs, dtype=float)
    if d.size == 0:
        return 0.0, 0.0, 0.0
    if d.size == 1:
        return float(d[0]), float(d[0]), float(d[0])
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, d.size, size=(n_boot, d.size))
    means = d[idx].mean(axis=1)
    return float(d.mean()), float(np.quantile(means, alpha / 2)), float(np.quantile(means, 1 - alpha / 2))


def wilcoxon_p(diffs: np.ndarray | list[float]) -> float:
    """Two-sided Wilcoxon signed-rank p-value of the paired differences (NaN if undefined)."""
    from scipy.stats import wilcoxon

    d = np.asarray(diffs, dtype=float)
    d = d[np.abs(d) > 1e-12]
    if d.size < 1:
        return float("nan")
    try:
        return float(wilcoxon(d, alternative="two-sided").pvalue)
    except ValueError:
        return float("nan")


def cvar(values: np.ndarray | list[float], q: float = 0.10) -> float:
    """Mean of the worst ``q`` share of ``values`` (lower tail), e.g. CVaR(10%) of daily profit."""
    v = np.sort(np.asarray(values, dtype=float))
    if v.size == 0:
        return 0.0
    k = max(1, math.ceil(q * v.size))
    return float(v[:k].mean())


def compare(base: np.ndarray, other: np.ndarray, seed: int = 0) -> dict[str, Any]:
    """Paired comparison ``other - base``: mean difference, 95% bootstrap CI, Wilcoxon p, win rate."""
    d = np.asarray(other, dtype=float) - np.asarray(base, dtype=float)
    mean, lo, hi = paired_bootstrap_ci(d, seed=seed)
    return {
        "mean_diff": mean, "ci95": [lo, hi], "wilcoxon_p": wilcoxon_p(d), "win_rate": float(np.mean(d > 0)) if d.size else 0.0,
        "n": int(d.size),
    }  # fmt: skip
