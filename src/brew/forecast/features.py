"""Forecast feature construction (technical.md 12.1) shared by training, backtests and live inference.

One row = ``(day, open slot, sku, channel group)``.  Features: categorical ``sku, cat, fg, weather``;
numeric slot/dow/weather/temperature/rain, calendar flags, ``price_ratio``, ``featured``, ``hidden``,
lags (``lag_1d``, ``lag_7d``, ``roll_7d`` same slot), ``ratio_so_far`` (intraday nowcast level),
horizon ``h`` (slots between forecast origin and target) and ``rating``.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from brew.sim.demandlog import OPEN_SLOTS, DayRec, DemandLog

CATS = ("coffee", "notcoffee", "bakes", "plates")
FEATURES = [
    "sku", "cat", "fg", "slot", "dow", "is_weekend", "weather", "temp_c", "rain_mm_h", "holiday", "cricket",
    "exam", "payday", "price_ratio", "featured", "hidden", "lag_1d", "lag_7d", "roll_7d", "ratio_so_far", "h",
    "rating",
]  # fmt: skip
CAT_FEATURES = ["sku", "cat", "fg", "weather"]
CAT_IDX = [FEATURES.index(c) for c in CAT_FEATURES]
OPEN = np.array(list(OPEN_SLOTS))
MAX_H = 24


@dataclass
class FeatureSet:
    """Feature matrix with row identifiers."""

    X: np.ndarray  # (n, len(FEATURES)) float32
    y: np.ndarray  # (n,) observed counts (zeros for inference)
    day: np.ndarray
    slot: np.ndarray
    sku_i: np.ndarray
    fg: np.ndarray
    lag7: np.ndarray  # raw lag columns (NaN when missing) for baselines
    lag1: np.ndarray
    roll7: np.ndarray
    hidden: np.ndarray | None = None  # 1 where the item was 86'd (demand censored)


def _prior_arrays(
    recs: list[DayRec], p: int, profile: np.ndarray | None
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(lag1, lag7, roll7) arrays of shape (96, J, 2) for ``recs[p]``; profile fills gaps."""
    r = recs[p]
    by_day = {x.day: x for x in recs[:p]}
    shape = r.counts.shape

    def fallback(day_back: int) -> np.ndarray:
        if profile is None:
            return np.full(shape, np.nan, dtype=np.float32)
        return profile[(r.weekday - day_back) % 7]

    d1 = by_day.get(r.day - 1)
    d7 = by_day.get(r.day - 7)
    lag1 = d1.counts if d1 is not None else fallback(1)
    lag7 = d7.counts if d7 is not None else fallback(7)
    prev = [by_day[d].counts for d in range(r.day - 7, r.day) if d in by_day]
    if len(prev) >= 3:
        roll7 = np.mean(prev, axis=0).astype(np.float32)
    elif profile is not None:
        roll7 = profile.mean(axis=0).astype(np.float32)
    else:
        roll7 = np.full(shape, np.nan, dtype=np.float32)
    return lag1.astype(np.float32), lag7.astype(np.float32), roll7.astype(np.float32)


def day_profile(recs: list[DayRec], n_sku: int) -> tuple[np.ndarray, np.ndarray]:
    """``(profile, n)``: mean counts per ``(weekday, slot, sku, fg)`` over a history (the prior used when a
    world is new) and the number of days behind each weekday."""
    out = np.zeros((7, 96, n_sku, 2), dtype=np.float32)
    n = np.zeros(7)
    for r in recs:
        out[r.weekday] += r.counts
        n[r.weekday] += 1
    gmean = np.mean([r.counts for r in recs], axis=0) if recs else out[0]
    for d in range(7):
        out[d] = out[d] / n[d] if n[d] > 0 else gmean
    return out, n


def _cum_ratio_inputs(r: DayRec, roll7: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    obs = np.cumsum(r.counts.sum(axis=(1, 2)))
    base = np.cumsum(np.nan_to_num(roll7).sum(axis=(1, 2)))
    return obs, base


def ratio_at(obs_cum: np.ndarray, base_cum: np.ndarray, origin: np.ndarray) -> np.ndarray:
    """Intraday level multiplier at the origin slot (shrunk toward 1, clipped)."""
    o = np.clip(origin, 0, len(obs_cum) - 1)
    a, b = 20.0, 20.0  # Gamma(20, 20) prior on the level
    return np.clip((a + obs_cum[o]) / (b + base_cum[o]), 0.4, 2.5)


def build(
    log_days: list[DayRec],
    n_sku: int,
    cat_of: list[int],
    *,
    targets: list[int] | None = None,
    min_history: int = 7,
    profile: np.ndarray | None = None,
    seed: int = 0,
    profile_n: np.ndarray | None = None,
    loo: bool = False,
) -> FeatureSet:
    """Training/backtest rows for the days at positions ``targets`` (default: all with enough history).

    With ``loo`` the days that lack ``min_history`` days of real lags use a leave-one-out profile (the
    day itself removed) so that training sees the same "young world" lag features inference will use.
    """
    recs = log_days
    rng = np.random.default_rng(seed)
    pos = targets if targets is not None else [p for p in range(len(recs)) if p >= min_history]
    parts: list[np.ndarray] = []
    meta: list[tuple[np.ndarray, ...]] = []
    S = len(OPEN)
    J = n_sku
    sku_g = np.tile(np.repeat(np.arange(J), 2), S)
    fg_g = np.tile(np.array([0, 1]), S * J)
    slot_g = np.repeat(OPEN, J * 2)
    n = len(slot_g)
    cat_arr = np.array(cat_of)
    for p in pos:
        r = recs[p]
        prof_p = profile
        if loo and profile is not None and profile_n is not None and p < min_history and profile_n[r.weekday] > 1:
            prof_p = profile.copy()
            nwd = profile_n[r.weekday]
            prof_p[r.weekday] = (profile[r.weekday] * nwd - r.counts) / (nwd - 1.0)
        lag1, lag7, roll7 = _prior_arrays(recs, p, prof_p)
        obs_cum, base_cum = _cum_ratio_inputs(r, roll7)
        h = rng.integers(1, 17, size=n)
        origin = np.maximum(slot_g - h, 31)
        ratio = ratio_at(obs_cum, base_cum, origin)
        r.fill_forward()
        X = np.empty((n, len(FEATURES)), dtype=np.float32)
        X[:, 0] = sku_g
        X[:, 1] = cat_arr[sku_g]
        X[:, 2] = fg_g
        X[:, 3] = slot_g
        X[:, 4] = r.weekday
        X[:, 5] = 1.0 if r.weekday >= 5 else 0.0
        X[:, 6] = r.wx[slot_g]
        X[:, 7] = r.temp[slot_g]
        X[:, 8] = r.rain[slot_g]
        X[:, 9:13] = np.array(r.flags, dtype=np.float32)
        X[:, 13] = r.price_ratio[slot_g, sku_g]
        X[:, 14] = r.featured[slot_g, sku_g]
        X[:, 15] = r.hidden[slot_g, sku_g]
        X[:, 16] = lag1[slot_g, sku_g, fg_g]
        X[:, 17] = lag7[slot_g, sku_g, fg_g]
        X[:, 18] = roll7[slot_g, sku_g, fg_g]
        X[:, 19] = ratio
        X[:, 20] = h
        X[:, 21] = r.rating[slot_g]
        parts.append(X)
        meta.append(
            (
                r.counts[slot_g, sku_g, fg_g], np.full(n, r.day), slot_g, sku_g, fg_g,
                lag7[slot_g, sku_g, fg_g], lag1[slot_g, sku_g, fg_g], roll7[slot_g, sku_g, fg_g],
                r.hidden[slot_g, sku_g],
            )
        )  # fmt: skip
    if not parts:
        z = np.zeros((0, len(FEATURES)), dtype=np.float32)
        e = np.zeros(0)
        return FeatureSet(z, e, e, e, e, e, e, e, e, e)
    X = np.concatenate(parts)
    cols = [np.concatenate([m[i] for m in meta]) for i in range(9)]
    return FeatureSet(X, cols[0], cols[1], cols[2], cols[3], cols[4], cols[5], cols[6], cols[7], cols[8])


def build_future(
    log: DemandLog,
    now_slot: int,
    horizon: int,
    cat_of: list[int],
    profile: np.ndarray | None,
    *,
    ratio_override: float | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Inference rows for slots ``now_slot .. now_slot + horizon - 1`` of the current day.

    Returns ``(X, slots)`` with X rows ordered ``(slot, sku, fg)``.  Context features (price, weather,
    rating...) persist from the latest snapshot; lags come from the log (profile fills a young history).
    """
    recs = log.all_days()
    p = len(recs) - 1
    r = recs[p]
    J = log.n
    lag1, lag7, roll7 = _prior_arrays(recs, p, profile)
    slots = np.arange(now_slot, min(now_slot + horizon, 88))
    slots = slots[slots >= 32]
    if len(slots) == 0:
        return np.zeros((0, len(FEATURES)), dtype=np.float32), slots
    S = len(slots)
    sku_g = np.tile(np.repeat(np.arange(J), 2), S)
    fg_g = np.tile(np.array([0, 1]), S * J)
    slot_g = np.repeat(slots, J * 2)
    n = len(slot_g)
    obs_cum, base_cum = _cum_ratio_inputs(r, roll7)
    origin = max(now_slot - 1, 31)
    if ratio_override is None:
        ratio = float(ratio_at(obs_cum, base_cum, np.array([origin]))[0])
    else:
        ratio = ratio_override
    ctx = max(0, min(now_slot, 95))
    cat_arr = np.array(cat_of)
    X = np.empty((n, len(FEATURES)), dtype=np.float32)
    X[:, 0] = sku_g
    X[:, 1] = cat_arr[sku_g]
    X[:, 2] = fg_g
    X[:, 3] = slot_g
    X[:, 4] = r.weekday
    X[:, 5] = 1.0 if r.weekday >= 5 else 0.0
    X[:, 6] = r.wx[ctx]
    X[:, 7] = r.temp[ctx]
    X[:, 8] = r.rain[ctx]
    X[:, 9:13] = np.array(r.flags, dtype=np.float32)
    X[:, 13] = r.price_ratio[ctx, sku_g]
    X[:, 14] = r.featured[ctx, sku_g]
    X[:, 15] = 0.0  # availability is a supply issue, forecast unconstrained demand
    X[:, 16] = lag1[slot_g, sku_g, fg_g]
    X[:, 17] = lag7[slot_g, sku_g, fg_g]
    X[:, 18] = roll7[slot_g, sku_g, fg_g]
    X[:, 19] = ratio
    X[:, 20] = slot_g - now_slot + 1
    X[:, 21] = r.rating[ctx]
    return X, slots
