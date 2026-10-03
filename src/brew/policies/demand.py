"""Demand access for policies C / E: LightGBM forecaster when available, moving-average fallback otherwise."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import numpy as np

from brew.domain.enums import CATEGORIES
from brew.forecast.lgbm import ForecastArrays

if TYPE_CHECKING:
    from brew.sim.views import WorldView

CLOSE_SLOT = 88  # first slot after closing (22:00)
GROUPS = ("offline", "delivery")


class DemandService:
    """Per-tick demand arrays ``(H, n_sku, 2)`` over the coming slots plus window helpers.

    Slot 0 of the arrays is the *current* slot.  ``dispersion`` is the variance / mean ratio used to turn
    mean forecasts into count quantiles (day-level shocks make demand over-dispersed relative to Poisson).
    """

    def __init__(self, skus: list[str], cats: list[str], forecaster: Any = None, dispersion: float = 1.8) -> None:
        self.skus = skus
        self.cats = cats
        self.idx = {s: i for i, s in enumerate(skus)}
        self.forecaster = forecaster
        self.dispersion = dispersion
        self.fa: ForecastArrays | None = None
        self._stamp: tuple[int, int] = (-1, -1)
        self.oracle: np.ndarray | None = None  # (96, n_sku, 2) true expected units (policy E)

    # ------------------------------------------------------------------ refresh
    def refresh(self, view: WorldView, horizon: int = 24) -> ForecastArrays:
        slot = int(view.tod_s // 900)
        stamp = (view.day, slot)
        if self.fa is not None and stamp == self._stamp:
            return self.fa
        self._stamp = stamp
        start = max(slot, 28)
        if self.oracle is not None:
            fa = self._from_array(self.oracle, start, horizon)
        elif self.forecaster is not None:
            try:
                fa = self.forecaster.predict_arrays(view.demand_log(), start, horizon)
                if len(fa.slots) == 0 or fa.slots[0] != start:
                    fa = self._shift(fa, start, horizon)
            except Exception:
                fa = self._fallback(view, start, horizon)
        else:
            fa = self._fallback(view, start, horizon)
        self.fa = fa
        return fa

    def _shift(self, fa: ForecastArrays, start: int, horizon: int) -> ForecastArrays:
        """Pad the forecast with zero slots when the forecaster starts later than ``start``."""
        J = len(self.skus)
        slots = np.arange(start, min(start + horizon, CLOSE_SLOT))
        mean = np.zeros((len(slots), J, 2))
        for k, s in enumerate(fa.slots):
            if s in slots:
                mean[s - start] = fa.mean[k]
        z = np.zeros_like(mean)
        return ForecastArrays(slots, z, mean.copy(), z, mean)

    def _from_array(self, arr: np.ndarray, start: int, horizon: int) -> ForecastArrays:
        slots = np.arange(start, min(start + horizon, CLOSE_SLOT))
        mean = arr[slots].astype(float) if len(slots) else np.zeros((0, len(self.skus), 2))
        return ForecastArrays(slots, mean * 0.5, mean.copy(), mean * 1.6, mean)

    def _fallback(self, view: WorldView, start: int, horizon: int) -> ForecastArrays:
        """Moving-average forecast: daily SKU volume x category slot shape (offline / delivery split)."""
        J = len(self.skus)
        slots = np.arange(start, min(start + horizon, CLOSE_SLOT))
        mean = np.zeros((len(slots), J, 2))
        shape: dict[tuple[str, int], np.ndarray] = {}
        for c in CATEGORIES:
            for g, grp in enumerate(("offline", "zomato", "swiggy")):
                v = np.array([view.expected_demand(c, grp, s)[1] for s in range(96)])
                shape[(c, g)] = v
        for j, sku in enumerate(self.skus):
            daily = view.sku_usage_per_day(sku)
            c = self.cats[j]
            off = shape[(c, 0)]
            dlv = shape[(c, 1)] + shape[(c, 2)]
            tot = off.sum() + dlv.sum()
            if tot <= 0 or daily <= 0:
                continue
            for k, s in enumerate(slots):
                mean[k, j, 0] = daily * off[s] / tot
                mean[k, j, 1] = daily * dlv[s] / tot
        z = np.zeros_like(mean)
        return ForecastArrays(slots, z, mean.copy(), z, mean)

    # ----------------------------------------------------------------- queries
    def units(self, sku: str, n_slots: int, fa: ForecastArrays | None = None) -> float:
        """Expected units of ``sku`` over the next ``n_slots`` slots (both channel groups)."""
        fa = fa or self.fa
        if fa is None or len(fa.slots) == 0:
            return 0.0
        n = max(0, min(int(n_slots), len(fa.slots)))
        return float(fa.mean[:n, self.idx[sku], :].sum())

    def units_until(self, sku: str, until_s: float, now_s: float, fa: ForecastArrays | None = None) -> float:
        """Expected units until ``until_s`` (partial slots pro-rated); beyond the forecast the last hours repeat."""
        fa = fa or self.fa
        if fa is None or len(fa.slots) == 0 or until_s <= now_s:
            return 0.0
        slot_s = 900.0
        first = int(fa.slots[0])
        tod_now = now_s % 86400
        total = 0.0
        j = self.idx[sku]
        for k, s in enumerate(fa.slots):
            t0 = max(tod_now, s * slot_s)
            t1 = min(until_s % 86400 if until_s - now_s < 86400 else 86400, (s + 1) * slot_s)
            if t1 <= t0:
                continue
            total += float(fa.mean[k, j, :].sum()) * (t1 - t0) / slot_s
        del first
        return total

    def group_units(self, sku: str, n_slots: int) -> tuple[float, float]:
        fa = self.fa
        if fa is None:
            return 0.0, 0.0
        n = max(0, min(int(n_slots), len(fa.slots)))
        j = self.idx[sku]
        return float(fa.mean[:n, j, 0].sum()), float(fa.mean[:n, j, 1].sum())

    def remaining_day_units(self, sku: str) -> float:
        fa = self.fa
        return float(fa.mean[:, self.idx[sku], :].sum()) if fa is not None and len(fa.slots) else 0.0

    def next_day_units(self, view: WorldView) -> np.ndarray:
        """Expected units per SKU for tomorrow (profile of tomorrow's weekday x recent level)."""
        J = len(self.skus)
        fc = self.forecaster
        if fc is None:
            return np.array([view.sku_usage_per_day(s) for s in self.skus])
        wd = (view.weekday_of_day(view.day) + 1) % 7
        prof = fc.profile[wd][32:88].sum(axis=(0, 2)).astype(float)
        log = view.demand_log()
        days = log.all_days()
        level = 1.0
        if days:
            recent = [r.counts[32:88].sum() for r in days[-5:]]
            ref = [fc.profile[r.weekday][32:88].sum() for r in days[-5:]]
            if sum(ref) > 0:
                level = float(np.clip(sum(recent) / sum(ref), 0.7, 1.4))
        out = prof * level
        return out if len(out) == J else np.zeros(J)

    def key_usage(self, view: WorldView, sku_units: dict[str, float], carry: float = 0.5) -> dict[str, float]:
        """Ingredient / prep / packaging usage implied by SKU units (BOM with the carry / dine-in mix)."""
        use: dict[str, float] = {}
        cfg = view.config
        prep = {p.key: p for p in cfg.prep_items}
        for sku, u in sku_units.items():
            if u <= 0:
                continue
            for share, flag in ((carry, True), (1.0 - carry, False)):
                for key, q, _pack in view.bom(sku, flag):
                    use[key] = use.get(key, 0.0) + u * q * share
        # prep items are built from components: add their component usage proportionally
        for key, p in prep.items():
            n = use.get(key, 0.0)
            if n <= 0:
                continue
            for c in p.components:
                use[c.ingredient] = use.get(c.ingredient, 0.0) + n * c.qty / p.batch_size
        return use
