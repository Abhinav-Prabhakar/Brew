"""Newsvendor quantities for prep, make-ahead and purchasing (technical.md 12.3).

``q* = F^-1(c_u / (c_u + c_o))``.  Demand over a horizon is modelled as a negative binomial with mean
``mu`` and variance ``phi * mu`` (``phi >= 1`` captures the day-level shocks the Poisson model ignores);
``quantile_from_bands`` interpolates a forecaster's P10/P50/P90 with a fitted log-normal instead.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from scipy.stats import nbinom, norm, poisson

Z10 = float(norm.ppf(0.9))


def critical_ratio(c_under: float, c_over: float) -> float:
    """``c_u / (c_u + c_o)`` in (0, 1); degenerate costs return 0.5."""
    tot = c_under + c_over
    if tot <= 0:
        return 0.5
    return float(min(0.999, max(0.001, c_under / tot)))


def demand_quantile(mean: float, q: float, dispersion: float = 1.8) -> float:
    """``q``-quantile (units, >= 0) of a count with the given mean and variance ``dispersion * mean``."""
    if mean <= 1e-9:
        return 0.0
    if dispersion <= 1.0 + 1e-9:
        return float(poisson.ppf(q, mean))
    n = mean / (dispersion - 1.0)
    p = n / (n + mean)
    return float(nbinom.ppf(q, n, p))


def newsvendor_qty(mean: float, c_under: float, c_over: float, dispersion: float = 1.8) -> float:
    """Optimal stocking level for demand with ``mean`` and the given underage / overage costs (INR / unit)."""
    return demand_quantile(mean, critical_ratio(c_under, c_over), dispersion)


def fit_lognormal(p10: float, p50: float, p90: float) -> tuple[float, float]:
    """``(mu, sigma)`` of a log-normal through the P50 and the P10-P90 spread (zeros are lifted by 0.05)."""
    p10, p50, p90 = max(p10, 0.05), max(p50, 0.05), max(p90, 0.05)
    mu = math.log(p50)
    sigma = max(1e-3, (math.log(p90) - math.log(p10)) / (2 * Z10))
    return mu, sigma


def quantile_from_bands(p10: float, p50: float, p90: float, q: float) -> float:
    """Quantile ``q`` of the log-normal fitted to the forecast bands."""
    mu, sigma = fit_lognormal(p10, p50, p90)
    return float(math.exp(mu + sigma * norm.ppf(q)))


def expected_overage(mean: float, stock: float, dispersion: float = 1.8, hi: int = 200) -> tuple[float, float]:
    """``(E[min(D, stock)], E[(stock - D)+])`` for the NB demand model (expected sales, expected leftover)."""
    if mean <= 1e-9:
        return 0.0, stock
    if dispersion <= 1.0 + 1e-9:
        pm = poisson.pmf(np.arange(0, hi), mean)
    else:
        n = mean / (dispersion - 1.0)
        pm = nbinom.pmf(np.arange(0, hi), n, n / (n + mean))
    d = np.arange(0, hi)
    sales = float(np.sum(np.minimum(d, stock) * pm) + stock * max(0.0, 1.0 - pm.sum()))
    return sales, float(max(0.0, stock - sales))


@dataclass(slots=True)
class PrepClassCosts:
    """Underage / overage costs of a prep class (INR per unit)."""

    c_under: float
    c_over: float


def replate_adjusted_overage(
    unit_cost: float, recovery_price: float, p_sell: float, co2e_shadow: float = 0.0
) -> float:
    """Expected loss of a leftover unit once replate recovers part of it (technical.md 7.11).

    ``c_o' = unit_cost - E[replate revenue] + CO2e shadow``; ``E[revenue] = p_sell * recovery_price``.
    """
    return max(0.0, unit_cost - p_sell * recovery_price) + co2e_shadow


def perishable_order_up_to(
    use_per_day: float,
    cover_days: float,
    shelf_days: float,
    z: float = 1.28,
    cv: float = 0.35,
    cap_frac_of_shelf: float = 0.8,
) -> float:
    """Order-up-to level for a perishable: demand over ``cover_days`` plus ``z`` safety sigmas, capped so
    the stock can be used within ``cap_frac_of_shelf`` of its shelf life."""
    mu = use_per_day * cover_days
    sigma = cv * mu / max(1.0, math.sqrt(max(1.0, cover_days)))
    target = mu + z * sigma
    cap = use_per_day * shelf_days * cap_frac_of_shelf
    return float(min(target, cap) if cap > 0 else target)
