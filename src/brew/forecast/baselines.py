"""Baseline demand forecasts and shared metrics (docs/implementation-spec.md 12.1)."""

from __future__ import annotations

import numpy as np

from .features import FeatureSet


def seasonal_naive(fs: FeatureSet) -> np.ndarray:
    """Same slot last week; falls back to yesterday, then to the 7-day mean."""
    out = fs.lag7.copy()
    miss = np.isnan(out)
    out[miss] = fs.lag1[miss]
    miss = np.isnan(out)
    out[miss] = fs.roll7[miss]
    return np.nan_to_num(out)


def moving_average(fs: FeatureSet) -> np.ndarray:
    """Mean of the same slot over the previous 7 days."""
    return np.nan_to_num(fs.roll7)


def wape(y: np.ndarray, yhat: np.ndarray) -> float:
    """Weighted absolute percentage error ``sum|y - yhat| / sum y`` (0 if there is no demand)."""
    d = float(np.abs(y).sum())
    return float(np.abs(y - yhat).sum() / d) if d > 0 else 0.0


def pinball(y: np.ndarray, q: np.ndarray, alpha: float) -> float:
    """Mean pinball (quantile) loss."""
    e = y - q
    return float(np.mean(np.maximum(alpha * e, (alpha - 1.0) * e)))


def bias(y: np.ndarray, yhat: np.ndarray) -> float:
    """``sum(yhat - y) / sum y``."""
    d = float(np.abs(y).sum())
    return float((yhat - y).sum() / d) if d > 0 else 0.0


def coverage(y: np.ndarray, lo: np.ndarray, hi: np.ndarray) -> float:
    """Share of observations inside ``[lo, hi]``."""
    return float(np.mean((y >= lo) & (y <= hi))) if len(y) else 0.0
