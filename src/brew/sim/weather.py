"""Hourly Markov weather and temperature curve (technical.md 7.1)."""

from __future__ import annotations

import math

import numpy as np

from brew.domain.enums import WEATHER_STATES

TEMP_DELTA = {"sunny": 1.0, "partly": 0.0, "cloudy": -1.0, "drizzle": -3.0, "rain": -5.0}
RAIN_MM_H = {"sunny": 0.0, "partly": 0.0, "cloudy": 0.0, "drizzle": 0.8, "rain": 6.0}
HOURS = range(7, 23)


def temperature(hour: float, state: str, offset: float = 0.0) -> float:
    """Air temperature (deg C) at ``hour`` (0-24 float): ``26 + 6 sin(pi (h-8)/12) + delta``."""
    return round(26.0 + 6.0 * math.sin(math.pi * (hour - 8.0) / 12.0) + TEMP_DELTA[state] + offset, 1)


def matrix(profile: dict[str, dict[str, float]]) -> np.ndarray:
    """Row-stochastic matrix in WEATHER_STATES order."""
    m = np.array([[profile[a].get(b, 0.0) for b in WEATHER_STATES] for a in WEATHER_STATES], dtype=float)
    return m / m.sum(axis=1, keepdims=True)


def plan_day(
    prev: str,
    profile: dict[str, dict[str, float]],
    draws: np.ndarray,
    forced: tuple[dict, ...] = (),
) -> dict[int, str]:
    """Sample the state for each hour 7..22 from uniform ``draws`` (16 values).

    ``forced`` windows ``{from_h, to_h, state}`` override the chain (which then continues from the
    forced state). Draw count is fixed so the stream is consumed identically for every policy.
    """
    m = matrix(profile)
    cum = np.cumsum(m, axis=1)
    state = prev
    out: dict[int, str] = {}
    for i, h in enumerate(HOURS):
        row = cum[WEATHER_STATES.index(state)]
        j = int(np.searchsorted(row, draws[i], side="right"))
        state = WEATHER_STATES[min(j, len(WEATHER_STATES) - 1)]
        for f in forced:
            if f["from_h"] <= h < f["to_h"]:
                state = f["state"]
        out[h] = state
    return out
