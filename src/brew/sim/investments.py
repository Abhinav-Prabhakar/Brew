"""Investments from ``catalog.yaml``: buy with sim cash, delivered after the lead time (backend.md 6.1)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from brew.config.schemas import StaffMember
from brew.domain.timeutil import DAY_S

from .actions import InvalidAction, UnknownTarget
from .engine import P_CLOCK
from .state import EquipState, Table

if TYPE_CHECKING:
    from .world import World


class Investments:
    """Purchases and their effects. Effects kinds: add_table, add_slots, fridge_capacity, add_staff,
    dish_speed, standing_po, demand_mult."""

    def __init__(self, w: World) -> None:
        self.w = w
        self.standing: list[dict[str, Any]] = []

    def buy(self, key: str, by: str = "owner") -> dict[str, Any]:
        """Pay the capex now; the effect lands after ``lead_time_h``. Raises on unknown key / no cash."""
        w = self.w
        item = w.ix.catalog.get(key)
        if item is None:
            raise UnknownTarget(f"catalog item {key!r} not found")
        if item.capex > w.fin.cash + 1e-6:
            raise InvalidAction(f"not enough cash for {key} (needs {item.capex:.0f}, have {w.fin.cash:.0f})")
        if any(c["key"] == key and not c["delivered"] for c in w.invest_log):
            raise InvalidAction(f"{key} is already on order")
        w.fin.cash -= item.capex
        w.fin.post("capex", item.capex)
        at = w.now + item.lead_time_h * 3600.0
        rec = {
            "key": key, "bought_s": w.now, "deliver_s": at, "capex": item.capex, "opex": item.opex_per_day,
            "effect": dict(item.effect), "delivered": False, "by": by,
        }  # fmt: skip
        w.invest_log.append(rec)
        w.engine.schedule(at, "INVEST_DELIVER", len(w.invest_log) - 1, P_CLOCK)
        w.kpi.pulse()
        return {"catalog_key": key, "capex": item.capex, "deliver_s": at}

    def deliver(self, idx: int) -> None:
        w = self.w
        rec = w.invest_log[idx]
        if rec["delivered"]:
            return
        rec["delivered"] = True
        self.apply(rec["effect"])
        w.emit("investment.delivered", catalog_key=rec["key"], effect=rec["effect"])

    def apply(self, eff: dict[str, Any]) -> None:
        """Apply an effect dict to the live world (also used by the advisor's counterfactual forks)."""
        w = self.w
        kind = eff["kind"]
        if kind == "add_table":
            tid = f"T{len(w.tables) + 1}"
            w.tables[tid] = Table(tid, int(eff.get("seats", 2)))
            w.table_order.append(tid)
        elif kind == "add_slots":
            st = w.kitchen.stations[eff["station"]]
            proto = w.equip[st.eq[0]]
            e = EquipState(
                len(w.equip), proto.key, proto.station, int(eff["slots"]), proto.kw_active, proto.kw_idle,
                proto.mtbf_h, proto.mttr_h, proto.maintenance_per_day, proto.capex,
            )  # fmt: skip
            w.equip.append(e)
            st.eq.append(e.idx)
            w.kitchen.request_dispatch()
        elif kind == "fridge_capacity":
            w.fridge_factor *= float(eff["factor"])
        elif kind == "add_staff":
            sm = StaffMember(**eff["staff"])
            s = w.kitchen.add_staff(sm)
            d0 = w.day * DAY_S
            from brew.domain.timeutil import parse_hhmm

            a, b = sm.shift
            s.shift_start_s, s.shift_end_s = d0 + parse_hhmm(a), d0 + parse_hhmm(b)
            s.break_done = True
            if s.shift_end_s > w.now:
                w.engine.schedule(max(w.now, s.shift_start_s), "SHIFT_START", s.key, 0)
                w.engine.schedule(s.shift_end_s, "SHIFT_END", s.key, 0)
        elif kind == "dish_speed":
            w.dish_speed = float(eff["factor"])
        elif kind == "standing_po":
            self.standing.append({"ingredient": eff["ingredient"], "qty": float(eff["qty"])})
        elif kind == "demand_mult":
            w.trend_mult *= float(eff["factor"])
            w.trend_until_day = max(w.trend_until_day, w.day + int(eff.get("days", 7)))
        else:  # pragma: no cover - guarded by catalog validation
            raise InvalidAction(f"unknown effect {kind!r}")

    def day_end(self) -> None:
        """Place the standing purchase orders."""
        w = self.w
        for s in self.standing:
            sup = w.suppliers.supplier_for(s["ingredient"])
            w.suppliers.place(sup, {s["ingredient"]: s["qty"]}, source="standing")
