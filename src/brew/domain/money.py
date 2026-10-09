"""Money helpers. All amounts are INR floats rounded to 2 dp at boundaries."""

from __future__ import annotations


def round2(x: float) -> float:
    """Round rupees to 2 decimals (half away from zero, avoiding float dust)."""
    return round(x + (1e-9 if x >= 0 else -1e-9), 2)


def to_grid(price: float, grid: float = 5.0) -> float:
    """Snap a price in rupees to the nearest ``grid`` rupees."""
    return round(price / grid) * grid


def round_rupee(x: float) -> float:
    """Round to the nearest whole rupee (half up) - used for receipt round-off."""
    return float(int(x + 0.5)) if x >= 0 else -float(int(-x + 0.5))
