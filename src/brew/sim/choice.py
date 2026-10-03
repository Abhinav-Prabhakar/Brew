"""Multinomial-logit menu choice with loss aversion (technical.md 7.4)."""

from __future__ import annotations

import math

import numpy as np

from brew.config.schemas import CafeConfig, Params

NEG = -1e9
DRINK_CATS = ("coffee", "notcoffee")


def weather_fit(
    cfg: CafeConfig, temp_c: float, state: str, hot_bonus: float, cold_bonus: float
) -> np.ndarray:
    """Per-SKU weather utility: cold drinks in heat (+0.4), hot drinks in rain/cool weather (+0.3)."""
    fit = np.zeros(len(cfg.menu))
    hot_day = temp_c >= 31.0
    cool = state in ("rain", "drizzle") or temp_c < 22.0
    for j, m in enumerate(cfg.menu):
        if m.cat not in DRINK_CATS:
            continue
        if hot_day and m.temp == "cold":
            fit[j] += hot_bonus
        if cool and m.temp == "hot":
            fit[j] += cold_bonus
    return fit


class ChoiceModel:
    """Utility model; the live context (prices, visibility...) is set by the world."""

    def __init__(self, cfg: CafeConfig) -> None:
        self.cfg = cfg
        p: Params = cfg.cafe.params
        self.params = p
        self.skus = [m.sku for m in cfg.menu]
        self.J = len(self.skus)
        self.is_drink = np.array([m.cat in DRINK_CATS for m in cfg.menu])
        self.is_food = ~self.is_drink
        self.log_pop = np.log(np.array([m.popularity_prior for m in cfg.menu]))
        cats = [m.cat for m in cfg.menu]
        self.aff: dict[str, np.ndarray] = {}
        self.beta: dict[str, float] = {}
        for key, per in cfg.personas.items():
            a = np.zeros(self.J)
            for j, sku in enumerate(self.skus):
                v = per.affinity.get(cats[j], 1.0) * per.affinity.get(sku, 1.0)
                a[j] = math.log(v)
            self.aff[key] = a
            self.beta[key] = per.price_beta
        self.base_u = {k: self.log_pop + self.aff[k] for k in self.aff}
        self.kappa = {k: self._calibrate(k) for k in self.aff}
        # live context
        self.lnr = np.zeros(self.J)
        self.featured = np.zeros(self.J)
        self.visible = np.ones(self.J, dtype=bool)
        self.wfit = np.zeros(self.J)
        self.cal = np.zeros(self.J)
        self._cache: dict[tuple[str, str], np.ndarray] = {}

    def _calibrate(self, persona: str) -> float:
        """kappa so that P(outside) = outside_target on a neutral drink slot at base prices."""
        s = float(np.exp(self.base_u[persona][self.is_drink]).sum())
        t = self.params.outside_target
        return math.log(t / (1 - t) * s)

    def set_context(
        self,
        lnr: np.ndarray,
        featured: np.ndarray,
        visible: np.ndarray,
        wfit: np.ndarray,
        cal: np.ndarray,
    ) -> None:
        """Install live context: ln(price/ref), featured flags, visible mask, weather & calendar terms."""
        self.lnr, self.featured, self.visible, self.wfit, self.cal = lnr, featured, visible, wfit, cal
        self._cache.clear()

    def utilities(self, persona: str, kind: str) -> np.ndarray:
        """Utility vector over SKUs (``-1e9`` where not selectable) for ``kind`` in {drink, food}."""
        ck = (persona, kind)
        hit = self._cache.get(ck)
        if hit is not None:
            return hit
        p = self.params
        u = (
            self.base_u[persona]
            + self.beta[persona] * self.lnr
            - p.choice_lambda_loss * np.maximum(0.0, self.lnr)
            + p.choice_gamma_featured * self.featured
            + self.wfit
            + self.cal
        )
        mask = self.visible & (self.is_drink if kind == "drink" else self.is_food)
        u = np.where(mask, u, NEG)
        self._cache[ck] = u
        return u

    def probs(self, persona: str, kind: str = "drink", with_outside: bool = True) -> tuple[float, np.ndarray]:
        """``(p_outside, p_sku[J])`` summing to 1 (outside only counted if ``with_outside``)."""
        u = self.utilities(persona, kind)
        m = u.max()
        e = np.exp(u - m)
        e[u <= NEG / 2] = 0.0
        z = float(e.sum())
        if with_outside:
            e0 = math.exp(self.kappa[persona] - m)
            z += e0
            return e0 / z, e / z
        if z == 0:
            return 1.0, e
        return 0.0, e / z

    def choose(self, persona: str, kind: str, gumbel_row: np.ndarray, with_outside: bool) -> int:
        """Gumbel-max draw using the customer's pre-drawn noise. Returns SKU index or -1 (outside/none)."""
        u = self.utilities(persona, kind) + gumbel_row[1:]
        j = int(np.argmax(u))
        if u[j] <= NEG / 2:
            return -1
        if with_outside and self.kappa[persona] + gumbel_row[0] > u[j]:
            return -1
        return j
