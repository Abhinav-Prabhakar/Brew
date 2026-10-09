"""Gamma-Poisson intraday nowcast of the demand level multiplier (docs/implementation-spec.md 12.1)."""

from __future__ import annotations


class GammaPoissonNowcast:
    """Level multiplier ``m`` with prior ``Gamma(a, b)`` (mean ``a / b`` = 1).

    Observing ``obs`` arrivals where the forecast expected ``exp`` updates ``a += obs``, ``b += exp``;
    the posterior mean is ``a / b`` and the posterior sd ``sqrt(a) / b``.
    """

    def __init__(self, a: float = 20.0, b: float = 20.0) -> None:
        self.a0, self.b0 = a, b
        self.a, self.b = a, b

    def reset(self) -> None:
        self.a, self.b = self.a0, self.b0

    def update(self, observed: float, expected: float) -> None:
        """Add one interval of realised vs forecast counts."""
        self.a += max(0.0, observed)
        self.b += max(0.0, expected)

    @property
    def level(self) -> float:
        """Posterior mean multiplier."""
        return self.a / self.b

    @property
    def sd(self) -> float:
        return self.a**0.5 / self.b

    def quantile(self, q: float) -> float:
        """Posterior quantile of the multiplier."""
        from scipy.stats import gamma

        return float(gamma.ppf(q, self.a, scale=1.0 / self.b))
