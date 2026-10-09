"""Demand access for policies C / E: LightGBM forecaster when available, moving-average fallback otherwise."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import numpy as np

from brew.domain.enums import CATEGORIES
from brew.forecast.lgbm import ForecastArrays
from brew.forecast.nowcast import GammaPoissonNowcast

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
        # self-calibration: intraday Gamma-Poisson level + day-over-day bias of the raw forecast
        self.calibrate = True
        self.now = GammaPoissonNowcast(30.0, 30.0)
        self.bias = 1.0
        self._exp_slot: dict[int, float] = {}  # slot -> expected total units (one step ahead, uncalibrated)
        self._day = -1
        self._day_exp = 0.0
        self._seen_slot = -1
        # raw LightGBM forecast is re-predicted at most every ``raw_every`` slots (1 h) and sliced in between:
        # predict() dominates the env step (~2/3) and 10 parallel workers otherwise thrash the CPU cache.
        self.raw_every = 1  # 1 = every tick (policies, arena); the RL training env raises it (EnvConfig.forecast_refresh_slots)
        self._raw: ForecastArrays | None = None
        self._raw_day = -1

    # ------------------------------------------------------------------ refresh
    def refresh(self, view: WorldView, horizon: int = 24) -> ForecastArrays:
        slot = int(view.tod_s // 900)
        stamp = (view.day, slot)
        if self.fa is not None and stamp == self._stamp:
            return self.fa
        self._stamp = stamp
        self._calibrate_update(view, slot)
        start = max(slot, 28)
        if self.oracle is not None:
            fa = self._from_array(self.oracle, start, horizon)
        elif self.forecaster is not None:
            try:
                fa = self._raw_slice(view, start, horizon)
            except Exception:
                fa = self._fallback(view, start, horizon)
        else:
            fa = self._fallback(view, start, horizon)
        if self.calibrate and self.oracle is None:
            self._exp_slot[slot] = float(fa.mean[0].sum()) if len(fa.slots) else 0.0
            lvl = self.level()
            if abs(lvl - 1.0) > 1e-3:
                fa = ForecastArrays(fa.slots, fa.p10 * lvl, fa.p50 * lvl, fa.p90 * lvl, fa.mean * lvl)
        self.fa = fa
        return fa

    def level(self) -> float:
        """Calibration multiplier: day-over-day bias x intraday Gamma-Poisson level (clipped)."""
        return float(np.clip(self.bias * self.now.level, 0.45, 1.5))

    def _calibrate_update(self, view: WorldView, slot: int) -> None:
        """Feed the realised demand of the slot(s) that just finished into the nowcast."""
        if view.day != self._day:
            self._day = view.day
            self.now.reset()
            self._exp_slot = {}
            self._seen_slot = 27
        cur = view.demand_log().cur
        if cur is None:
            return
        for s in range(self._seen_slot + 1, slot):
            exp = self._exp_slot.get(s)
            if exp is not None and 32 <= s < 88:
                self.now.update(float(cur.counts[s].sum()), exp)
        self._seen_slot = max(self._seen_slot, slot - 1)

    def end_day(self, view: WorldView) -> None:
        """Update the day-over-day bias from today's realised vs one-step-ahead expected total."""
        cur = view.demand_log().cur
        if cur is None or not self._exp_slot:
            return
        exp = sum(v for s, v in self._exp_slot.items() if 32 <= s < 88)
        act = float(cur.counts[32:88].sum())
        if exp > 50:
            ratio = float(np.clip(act / exp, 0.5, 1.5))
            # `exp` is the raw (uncalibrated) forecast, so the bias is a direct estimate of act/raw
            self.bias = 0.5 * self.bias + 0.5 * ratio if self.bias != 1.0 or self.now.a != self.now.a0 else ratio

    def _raw_slice(self, view: WorldView, start: int, horizon: int) -> ForecastArrays:
        """Raw forecast for ``start..start+horizon``, re-predicted at most hourly and sliced in between."""
        raw = self._raw
        if raw is not None and self._raw_day == view.day and len(raw.slots) and raw.slots[0] <= start:
            k = int(start - raw.slots[0])
            end_needed = min(start + horizon, CLOSE_SLOT)
            if k < self.raw_every and (len(raw.slots) and raw.slots[-1] + 1 >= end_needed):
                n = end_needed - start
                return ForecastArrays(raw.slots[k : k + n], raw.p10[k : k + n], raw.p50[k : k + n], raw.p90[k : k + n], raw.mean[k : k + n])
        assert self.forecaster is not None
        fa = self.forecaster.predict_arrays(view.demand_log(), start, horizon + self.raw_every)
        if len(fa.slots) == 0 or fa.slots[0] != start:
            fa = self._shift(fa, start, horizon + self.raw_every)
        self._raw, self._raw_day = fa, view.day
        n = max(0, min(start + horizon, CLOSE_SLOT) - start)
        return ForecastArrays(fa.slots[:n], fa.p10[:n], fa.p50[:n], fa.p90[:n], fa.mean[:n])

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
