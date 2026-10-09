"""Multinomial-logit menu choice with loss aversion (docs/implementation-spec.md 7.4)."""

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
        # replate alternatives (extra choice-set members, docs/implementation-spec.md 7.11)
        rc = cfg.replate
        self.rho = {k: float(rc.affinity.get(k, 0.0)) for k in cfg.personas}
        self.phi = rc.phi
        self.tau = rc.noise_tau
        self.rp_mask: np.ndarray | None = None
        self.rp_lnr = np.zeros(self.J)
        self.rp_q = np.ones(self.J)
        self.rp_deliv = np.array([m.deliverable for m in cfg.menu])
        self._rp_cache: dict[tuple[str, str], np.ndarray] = {}

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
        rp_mask: np.ndarray | None = None,
        rp_lnr: np.ndarray | None = None,
        rp_q: np.ndarray | None = None,
    ) -> None:
        """Install live context: ln(price/ref), featured flags, visible mask, weather & calendar terms.

        ``rp_*`` describe the replate alternatives (mask of listed SKUs, ln(listing price / ref), quality).
        """
        self.lnr, self.featured, self.visible, self.wfit, self.cal = lnr, featured, visible, wfit, cal
        self.rp_mask = rp_mask if rp_mask is not None and bool(rp_mask.any()) else None
        if self.rp_mask is not None:
            assert rp_lnr is not None and rp_q is not None
            self.rp_lnr, self.rp_q = rp_lnr, rp_q
        self._cache.clear()
        self._rp_cache.clear()

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

    def utilities_rp(self, persona: str, kind: str) -> np.ndarray | None:
        """Utility of the replate alternative per SKU (``-1e9`` where none is listed), or ``None``."""
        if self.rp_mask is None:
            return None
        ck = (persona, kind)
        hit = self._rp_cache.get(ck)
        if hit is not None:
            return hit
        p = self.params
        u = (
            self.base_u[persona]
            + self.beta[persona] * self.rp_lnr
            - p.choice_lambda_loss * np.maximum(0.0, self.rp_lnr)
            + self.wfit
            + self.cal
            + self.rho[persona]
            - self.phi * (1.0 - self.rp_q)
        )
        mask = self.rp_mask & self.visible & (self.is_drink if kind == "drink" else self.is_food)
        u = np.where(mask, u, NEG)
        self._rp_cache[ck] = u
        return u

    def addon_choice(
        self, persona: str, g_row: np.ndarray, g_out: float, rp_allowed: np.ndarray | None = None
    ) -> int:
        """Counter impulse add-on: the listed SKU index the customer adds on top of the basket, or -1.

        Gumbel-max over the listed rescue SKUs plus "nothing" (utility ``addon_kappa``); the utility of a
        listing grows with its discount depth, persona affinity and shelf quality (CRN: pre-drawn noise).
        """
        if self.rp_mask is None:
            return -1
        rc = self.cfg.replate
        d = np.maximum(0.0, -self.rp_lnr)
        u = rc.addon_beta * d + self.aff[persona] + self.rho[persona] - self.phi * (1.0 - self.rp_q)
        mask = self.rp_mask & self.visible
        if rp_allowed is not None:
            mask = mask & rp_allowed
        v = np.where(mask, u + g_row, NEG)
        j = int(np.argmax(v))
        if v[j] <= NEG / 2 or v[j] <= rc.addon_kappa + g_out:
            return -1
        return j

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

    def choose(
        self,
        persona: str,
        kind: str,
        gumbel_row: np.ndarray,
        with_outside: bool,
        gumbel_rp_row: np.ndarray | None = None,
        rp_allowed: np.ndarray | None = None,
    ) -> int:
        """Gumbel-max draw using the customer's pre-drawn noise.

        Returns the SKU index, ``J + j`` when the replate alternative of SKU ``j`` wins, or -1
        (outside option / nothing selectable).  Replate alternatives reuse the parent SKU's Gumbel
        draw plus one extra centred draw from the ``replate`` stream (CRN-safe).
        """
        u = self.utilities(persona, kind) + gumbel_row[1:]
        j = int(np.argmax(u))
        best = float(u[j])
        if best <= NEG / 2:
            j = -1
        if gumbel_rp_row is not None and self.rp_mask is not None and self.cfg.replate.choice_alt:
            ur = self.utilities_rp(persona, kind)
            if ur is not None:
                if rp_allowed is not None:
                    ur = np.where(rp_allowed, ur, NEG)
                v = ur + gumbel_row[1:] + self.tau * (gumbel_rp_row - 0.5772156649)
                jr = int(np.argmax(v))
                if v[jr] > NEG / 2 and (j < 0 or v[jr] > best):
                    j = self.J + jr
                    best = float(v[jr])
        if j < 0:
            return -1
        if with_outside and self.kappa[persona] + gumbel_row[0] > best:
            return -1
        return j
