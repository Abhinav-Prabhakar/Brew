"""Simple moving-average demand estimator (stand-in until the M2 LightGBM forecaster).

Demand is tracked per (category, channel group) per 15-min slot and per SKU per day, as an EMA over
days seeded by a prior derived from the arrival configuration and MNL shares at base prices.
"""

from __future__ import annotations

import math
from typing import TYPE_CHECKING

import numpy as np

from brew.domain.enums import CATEGORIES, CHANNEL_GROUPS, channel_group

from .arrivals import SLOTS, slot_rates

if TYPE_CHECKING:
    from .world import World

ALPHA = 0.3


class MaForecast:
    """EMA of demand with Poisson-style P10/P50/P90 bands."""

    def __init__(self, w: World) -> None:
        self.w = w
        cfg = w.cfg
        self.ema: dict[tuple[str, str], np.ndarray] = {
            (c, g): np.zeros(SLOTS) for c in CATEGORIES for g in CHANNEL_GROUPS
        }
        self.sku_daily: dict[str, float] = dict.fromkeys(w.choice.skus, 0.0)
        self.today: dict[tuple[str, str], np.ndarray] = {k: np.zeros(SLOTS) for k in self.ema}
        self.today_sku: dict[str, float] = dict.fromkeys(self.sku_daily, 0.0)
        self.days_seen = 0
        for daytype in ("weekday", "weekend"):
            pass
        self._seed_prior(daytype="weekday")
        self.ema_wk = {k: v.copy() for k, v in self.ema.items()}
        self.sku_daily_wk = dict(self.sku_daily)
        self._seed_prior(daytype="weekend")
        self.ema_we = {k: v.copy() for k, v in self.ema.items()}
        self.sku_daily_we = dict(self.sku_daily)
        self.ema = {k: v.copy() for k, v in self.ema_wk.items()}
        self.sku_daily = dict(self.sku_daily_wk)
        self.cfg = cfg

    def _seed_prior(self, daytype: str) -> None:
        w = self.w
        cfg = w.cfg
        ch = w.choice
        for k in self.ema:
            self.ema[k] = np.zeros(SLOTS)
        for s in self.sku_daily:
            self.sku_daily[s] = 0.0
        cats = [m.cat for m in cfg.menu]
        for pkey, per in cfg.personas.items():
            rates = slot_rates(per, daytype)
            ps = per.party_size
            mean_size = sum(s * p for s, p in ps.items())
            mean_food = sum(((s + 1) // 2) * p for s, p in ps.items()) * float(
                per.basket.get("food_prob", 0.4)
            )
            bi = per.basket.get("bulk_items")
            if bi:
                n_items = (bi[0] + bi[1]) / 2.0
                mean_size, mean_food = n_items * 0.6, n_items * 0.4
            _, pd = ch.probs(pkey, "drink", with_outside=False)
            _, pf = ch.probs(pkey, "food", with_outside=False)
            for chn, share in per.channels.items():
                g = channel_group(chn)
                for j, sku in enumerate(ch.skus):
                    cat = cats[j]
                    per_party = mean_size * pd[j] + mean_food * pf[j]
                    if per_party <= 0:
                        continue
                    self.ema[(cat, g)] += rates * share * per_party
                    self.sku_daily[sku] += float(rates.sum()) * share * per_party

    def switch_daytype(self, weekend: bool) -> None:
        """Select weekday/weekend profile for today's expectations."""
        src_ema, src_sku = (self.ema_we, self.sku_daily_we) if weekend else (self.ema_wk, self.sku_daily_wk)
        self.ema = {k: v.copy() for k, v in src_ema.items()}
        self.sku_daily = dict(src_sku)

    def observe(self, cat: str, channel: str, slot: int, qty: float, sku: str) -> None:
        self.today[(cat, channel_group(channel))][slot] += qty
        self.today_sku[sku] += qty

    def end_day(self, weekend: bool) -> None:
        """EMA update at day end (and reset the day accumulators)."""
        store, store_sku = (self.ema_we, self.sku_daily_we) if weekend else (self.ema_wk, self.sku_daily_wk)
        for k, arr in self.today.items():
            store[k] = (1 - ALPHA) * store[k] + ALPHA * arr
            arr[:] = 0.0
        for s, v in self.today_sku.items():
            store_sku[s] = (1 - ALPHA) * store_sku[s] + ALPHA * v
            self.today_sku[s] = 0.0
        self.days_seen += 1

    # ------------------------------------------------------------------ queries
    def p50(self, cat: str, group: str, slot: int) -> float:
        return float(self.ema[(cat, group)][slot % SLOTS])

    def band(self, cat: str, group: str, slot: int) -> tuple[float, float, float]:
        """(P10, P50, P90) using a normal approx to Poisson with overdispersion."""
        m = self.p50(cat, group, slot)
        sd = math.sqrt(max(m, 0.05) * 1.5)
        return max(0.0, m - 1.2816 * sd), m, m + 1.2816 * sd

    def sku_usage_per_day(self, sku: str) -> float:
        return self.sku_daily.get(sku, 0.0)

    def key_usage_per_day(self, key: str) -> float:
        """Expected daily consumption of an ingredient/prep key from SKU demand x base BOM."""
        w = self.w
        use = 0.0
        for sku in w.inv.key_skus.get(key, ()):
            q = dict(w.inv.sku_keys[sku]).get(key, 0.0)
            use += self.sku_daily.get(sku, 0.0) * q
        # prep items feed from their components (not from sku demand directly)
        for p in w.cfg.prep_items:
            for c in p.components:
                if c.ingredient == key:
                    use += self.key_usage_per_day(p.key) * c.qty / p.batch_size
        return use
