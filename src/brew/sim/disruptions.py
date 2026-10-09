"""Disruptions / chaos: scenario schedules, manual triggers, random failures (docs/implementation-spec.md 7.10)."""

from __future__ import annotations

import math
from typing import TYPE_CHECKING

import numpy as np

from brew.config.schemas import ScenarioConfig
from brew.domain.enums import DISRUPTION_KINDS, MANUAL_DISRUPTION_KINDS
from brew.domain.timeutil import DAY_S, parse_hhmm

from .engine import P_DECIDE, P_DISRUPT, P_TELEMETRY
from .state import Disruption

if TYPE_CHECKING:
    from .world import World


COST_EVERY_S = 300.0  # chaos.cost cadence while a disruption is active (sim s)
COST_FINAL_AFTER_S = 1800.0  # final chaos.cost this long after the disruption resolves


def default_target(w: World, kind: str) -> str | None:
    """Sensible target for a manual disruption when the caller gives none (None = no target needed)."""
    if kind == "staff_absent" or kind == "staff_late":
        baristas = [s for s in w.kitchen.staff_list if s.role == "barista"]
        live = [s for s in baristas if s.present and not s.absent]
        pick = live or baristas or w.kitchen.staff_list
        return pick[0].key if pick else None
    if kind == "equipment_down":
        for e in w.equip:
            if e.key == "oven" or e.station == "oven":
                return "oven"
        return w.equip[0].key if w.equip else None
    if kind in ("supplier_delay", "supplier_short"):
        for key, sup in w.ix.supplier.items():
            if any(it.ingredient == "milk" for it in sup.items):
                return key
        return next(iter(w.ix.supplier), None)
    return None


class Disruptions:
    """Tracks active disruptions and exposes the derived effect flags used by other subsystems."""

    def __init__(self, w: World) -> None:
        self.w = w
        self.items: dict[str, Disruption] = {}
        self.seq = 0
        self.power_cut = False
        self.platform_outage = False
        self.rider_eta_mult = 1.0
        self.supplier_delay_h: dict[str, float] = {}
        self.supplier_fill_mult: dict[str, float] = {}
        self.demand: list[tuple[str | None, float]] = []
        self.cost_mult = 1.0
        self.storm = False  # a manual rain_storm is active (weather forced to rain)
        self.log: list[dict] = []

    # --------------------------------------------------------------- triggering
    def trigger(
        self,
        kind: str,
        target: str | None = None,
        severity: float = 1.0,
        start_s: float | None = None,
        end_s: float | None = None,
        duration_min: float | None = None,
        source: str = "manual",
    ) -> Disruption:
        """Schedule (or immediately start) a disruption. Raises ``ValueError`` on unknown kind/target."""
        w = self.w
        if kind not in DISRUPTION_KINDS and kind not in MANUAL_DISRUPTION_KINDS:
            raise ValueError(f"unknown disruption kind {kind!r}")
        self._check_target(kind, target)
        start = w.now if start_s is None else max(w.now, start_s)
        if end_s is None:
            end_s = start + (duration_min if duration_min is not None else 60.0) * 60.0
        self.seq += 1
        d = Disruption(f"dis-{self.seq:04d}", kind, target, float(severity), start, end_s, source)
        self.items[d.id] = d
        w.engine.schedule(start, "DIS_START", d.id, P_DISRUPT)
        return d

    def _check_target(self, kind: str, target: str | None) -> None:
        w = self.w
        if target is None:
            return
        if kind in ("staff_absent", "staff_late") and target not in w.kitchen.staff:
            raise ValueError(f"unknown staff {target!r}")
        if kind == "equipment_down" and not self._equip_matches(target):
            raise ValueError(f"unknown equipment {target!r}")
        if kind in ("supplier_delay", "supplier_short") and target not in w.ix.supplier:
            raise ValueError(f"unknown supplier {target!r}")

    def _equip_matches(self, target: str) -> list[int]:
        return [e.idx for e in self.w.equip if e.key == target or e.station == target]

    def on_start(self, did: str) -> None:
        w = self.w
        d = self.items.get(did)
        if d is None or d.resolved:
            return
        d.active = True
        w.engine.schedule(d.end_s, "DIS_END", did, P_DISRUPT)
        k = d.kind
        if k in ("staff_absent", "staff_late"):
            tgt = d.target or next(iter(w.kitchen.staff))
            d.target = tgt
            w.kitchen.set_absent(tgt, True, "late" if k == "staff_late" else "absent")
        elif k == "equipment_down":
            tgt = d.target or w.equip[0].key
            d.target = tgt
            self._equip_set(self._equip_matches(tgt), False, d.end_s)
        elif k == "power_cut":
            self._equip_set([e.idx for e in w.equip if e.kw_active >= 1.0], False, d.end_s)
        self.recompute()
        if k == "rain_storm":
            w.force_weather("rain" if d.severity >= 0.5 else "drizzle")
        w.emit(
            "chaos.triggered", disruption_id=d.id, kind=k, target=d.target, severity=d.severity,
            until_s=round(d.end_s, 1), source=d.source,
        )  # fmt: skip
        self.log.append(
            {
                "id": d.id,
                "kind": k,
                "target": d.target,
                "severity": d.severity,
                "start_s": w.now,
                "end_s": d.end_s,
                "source": d.source,
            }
        )
        w.kitchen.request_dispatch()
        if d.source == "manual":  # re-plan right away (after this disruption's effects), not at the next 15-min tick
            w.engine.schedule(w.now, "REPLAN", did, P_DECIDE)
        if d.meta.get("cost_track"):  # cost-of-chaos shadow: first reading 5 sim-min in
            w.engine.schedule(w.now + COST_EVERY_S, "CHAOS_COST", (did, "active"), P_TELEMETRY)

    def on_end(self, did: str) -> None:
        w = self.w
        d = self.items.get(did)
        if d is None or d.resolved:
            return
        d.active = False
        d.resolved = True
        k = d.kind
        if k in ("staff_absent", "staff_late") and d.target:
            w.kitchen.set_absent(d.target, False)
        elif k == "equipment_down" and d.target:
            self._equip_set(self._equip_matches(d.target), True, 0.0)
        elif k == "power_cut":
            self._equip_set([e.idx for e in w.equip if e.kw_active >= 1.0], True, 0.0)
        self.recompute()
        if k == "rain_storm" and not self.storm:
            w.force_weather(None)
        w.emit("chaos.resolved", disruption_id=d.id, kind=k, target=d.target)
        w.kitchen.request_dispatch()
        if d.meta.get("cost_track"):
            w.engine.schedule(w.now, "CHAOS_COST", (did, "resolved"), P_TELEMETRY)
            w.engine.schedule(w.now + COST_FINAL_AFTER_S, "CHAOS_COST", (did, "final"), P_TELEMETRY)

    def on_cost(self, payload: tuple[str, str]) -> None:
        """Emit ``chaos.cost`` (CRN counterfactual) at a sim-time instant; reschedule while the disruption is active."""
        did, phase = payload
        w = self.w
        d = self.items.get(did)
        probe = w.cost_probe
        if d is None or probe is None:
            return
        cf = probe(did, w.now, phase == "final")
        if cf is None:
            return
        actual = w.kpi.profit_today()
        cost = round(cf - actual, 2)
        d.meta["cost_inr"] = cost
        d.meta["cost_phase"] = phase
        w.emit(
            "chaos.cost", disruption_id=did, kind=d.kind, cost_inr=cost, profit_actual=actual,
            profit_counterfactual=cf, phase=phase,
        )  # fmt: skip
        if phase == "active" and d.active:
            w.engine.schedule(w.now + COST_EVERY_S, "CHAOS_COST", (did, "active"), P_TELEMETRY)

    def _equip_set(self, idxs: list[int], up: bool, until: float) -> None:
        w = self.w
        for i in idxs:
            e = w.equip[i]
            if e.up == up:
                continue
            e.up = up
            e.down_until = until
            if up:
                w.emit("equipment.up", equipment=e.key, station=e.station)
            else:
                w.emit("equipment.down", equipment=e.key, station=e.station, until_s=round(until, 1))

    def recompute(self) -> None:
        """Rebuild derived flags from the set of active disruptions."""
        self.power_cut = False
        self.platform_outage = False
        self.rider_eta_mult = 1.0
        self.supplier_delay_h = {}
        self.supplier_fill_mult = {}
        self.demand = []
        self.cost_mult = 1.0
        self.storm = False
        for d in self.items.values():
            if not d.active:
                continue
            k = d.kind
            if k == "power_cut":
                self.power_cut = True
            elif k == "platform_outage":
                self.platform_outage = True
            elif k == "rider_shortage":
                self.rider_eta_mult *= 1.0 + d.severity
            elif k == "supplier_delay":
                key = d.target or "*"
                self.supplier_delay_h[key] = self.supplier_delay_h.get(key, 0.0) + 12.0 * d.severity
            elif k == "supplier_short":
                key = d.target or "*"
                self.supplier_fill_mult[key] = min(
                    self.supplier_fill_mult.get(key, 1.0), max(0.2, 1.0 - 0.5 * d.severity)
                )
            elif k == "demand_spike":
                self.demand.append((d.target, 1.0 + d.severity))
            elif k == "price_shock":
                self.cost_mult *= 1.0 + 0.3 * d.severity
            elif k == "rain_storm":
                self.storm = True
        self.w.inv.cost_mult = self.cost_mult

    # ----------------------------------------------------------------- queries
    def demand_mult(self, persona: str, channel: str) -> float:
        m = 1.0
        for tgt, v in self.demand:
            if tgt is None or tgt == persona or tgt == channel:
                m *= v
        return m

    def supplier_delay(self, supplier: str) -> float:
        return self.supplier_delay_h.get(supplier, 0.0) + self.supplier_delay_h.get("*", 0.0)

    def supplier_fill(self, supplier: str) -> float:
        return min(self.supplier_fill_mult.get(supplier, 1.0), self.supplier_fill_mult.get("*", 1.0))

    def active_list(self) -> list[Disruption]:
        return [d for d in self.items.values() if d.active]

    # ------------------------------------------------------------- day set-up
    def day_setup(self, day: int, scn: ScenarioConfig) -> None:
        """Schedule scenario disruptions, MTBF failures and random chaos for ``day``."""
        w = self.w
        d0 = day * DAY_S
        for spec in scn.disruptions:
            if spec.day not in (day, -1):  # -1 = every day
                continue
            self.trigger(
                spec.kind,
                spec.target,
                spec.severity,
                d0 + parse_hhmm(spec.start),
                d0 + parse_hhmm(spec.end),
                source="scenario",
            )
        rng = w.rng.failures
        open_s = d0 + w.cfg.cafe.open_s
        close_s = d0 + w.cfg.cafe.close_s
        for e in w.equip:
            u1, u2 = rng.random(2)
            ttf_h = -math.log(1.0 - u1) * e.mtbf_h
            t = d0 + 7 * 3600 + ttf_h * 3600.0
            if t < close_s:
                mttr = e.mttr_h * (0.5 + u2)
                self.trigger("equipment_down", e.key, 1.0, t, t + mttr * 3600.0, source="failure")
        rate = float(scn.random_chaos.get("rate_per_day", 0.0))
        if rate > 0:
            kinds = list(scn.random_chaos.get("kinds", DISRUPTION_KINDS))
            n = int(rng.poisson(rate))
            for _ in range(n):
                kind = kinds[int(rng.integers(0, len(kinds)))]
                start = open_s + float(rng.random()) * (close_s - open_s - 3600)
                dur = (60 + float(rng.random()) * 120) * 60
                sev = 0.5 + float(rng.random()) * 0.5
                tgt = self._random_target(kind, rng)
                self.trigger(kind, tgt, sev, start, start + dur, source="scenario")

    def _random_target(self, kind: str, rng: np.random.Generator) -> str | None:
        w = self.w
        if kind in ("staff_absent", "staff_late"):
            keys = [k for k, s in w.kitchen.staff.items() if s.role in ("barista", "cook", "cashier")]
            return keys[int(rng.integers(0, len(keys)))]
        if kind == "equipment_down":
            keys = sorted({e.key for e in w.equip if e.slots > 0})
            return keys[int(rng.integers(0, len(keys)))]
        if kind in ("supplier_delay", "supplier_short"):
            keys = sorted(w.ix.supplier)
            return keys[int(rng.integers(0, len(keys)))]
        if kind == "demand_spike":
            keys = sorted(w.cfg.personas)
            return keys[int(rng.integers(0, len(keys)))]
        return None
