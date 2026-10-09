"""Suppliers and purchase orders: lead times, delivery days, fill rate, on-time rate."""

from __future__ import annotations

import math
from typing import TYPE_CHECKING, Any

from brew.domain.timeutil import DAY_S, day_of, parse_hhmm, tod_s, weekday_of

from .engine import P_DONE

if TYPE_CHECKING:
    from .world import World

MORNING = 6.5 * 3600
EVENING = 20 * 3600


class Suppliers:
    """PO book. Cash is paid on receipt for what was actually delivered."""

    def __init__(self, w: World) -> None:
        self.w = w
        self.pos: dict[str, dict[str, Any]] = {}
        self.seq = 0
        self.item_of: dict[str, tuple[str, Any]] = {}
        for s in w.cfg.suppliers:
            for it in s.items:
                self.item_of.setdefault(it.ingredient, (s.key, it))

    def supplier_for(self, ingredient: str) -> str:
        return self.item_of[ingredient][0]

    def eta(self, supplier: str, now: float, arrive_tod_s: float | None = None) -> float:
        """Arrival time: lead time (+delays) rolled to a delivery day and a 06:30-20:00 window."""
        w = self.w
        s = w.ix.supplier[supplier]
        rng = w.rng.inventory
        mean, sd = s.lead_time_h
        z = float(rng.standard_normal())
        lead_h = max(1.0, mean + sd * z)
        if rng.random() > s.on_time_rate:
            lead_h += 6.0
        lead_h += w.dis.supplier_delay(supplier)
        t = now + lead_h * 3600.0
        if arrive_tod_s is not None:
            d = day_of(t)
            t = d * DAY_S + arrive_tod_s
            if t < now + 3600:
                t += DAY_S
        else:
            tod = tod_s(t)
            if tod < MORNING:
                t = day_of(t) * DAY_S + MORNING
            elif tod > EVENING:
                t = (day_of(t) + 1) * DAY_S + MORNING
        for _ in range(7):
            if weekday_of(day_of(t), w.start_date) in s.delivery_days:
                break
            t = (day_of(t) + 1) * DAY_S + max(MORNING, tod_s(t) if arrive_tod_s is None else arrive_tod_s)
        return t

    def place(
        self,
        supplier: str,
        lines: dict[str, float],
        source: str = "policy",
        arrive_tod_s: float | None = None,
        now: float | None = None,
    ) -> dict[str, Any] | None:
        """Create a PO for ``{ingredient: qty_base_units}`` (rounded up to packs, >= MOQ)."""
        w = self.w
        s = w.ix.supplier[supplier]
        items = {it.ingredient: it for it in s.items}
        out_lines = []
        total = 0.0
        for ing, qty in sorted(lines.items()):
            it = items.get(ing)
            if it is None or qty <= 0:
                continue
            packs = max(it.moq_packs, math.ceil(qty / it.pack_size - 1e-9))
            out_lines.append(
                {"ingredient": ing, "qty": packs * it.pack_size, "packs": packs, "price": it.price}
            )
            total += packs * it.price
        if not out_lines:
            return None
        self.seq += 1
        pid = f"po-{self.seq:05d}"
        t_now = w.now if now is None else now
        eta = self.eta(supplier, t_now, arrive_tod_s)
        po = {
            "id": pid,
            "supplier": supplier,
            "lines": out_lines,
            "eta_s": eta,
            "placed_s": t_now,
            "status": "open",
            "total": total,
            "source": source,
        }
        self.pos[pid] = po
        w.engine.schedule(eta, "PO_ARRIVE", pid, P_DONE)
        w.emit(
            "po.created", po_id=pid, supplier=supplier,
            lines=[{"ingredient": ln["ingredient"], "qty": ln["qty"], "packs": ln["packs"]} for ln in out_lines],
            eta_s=round(eta, 1),
        )  # fmt: skip
        return po

    def on_arrive(self, pid: str) -> None:
        w = self.w
        po = self.pos.get(pid)
        if po is None or po["status"] != "open":
            return
        fill = w.ix.supplier[po["supplier"]].fill_rate * w.dis.supplier_fill(po["supplier"])
        rng = w.rng.inventory
        got_lines = []
        paid = 0.0
        short = False
        for ln in po["lines"]:
            packs = ln["packs"]
            recv = sum(1 for _ in range(packs) if rng.random() < fill)
            if recv < packs:
                short = True
            if recv <= 0:
                continue
            it = self.item_of[ln["ingredient"]][1]
            unit_cost = it.price / it.pack_size * w.inv.cost_mult
            qty = recv * it.pack_size
            w.inv.add_lot(ln["ingredient"], qty, w.now, unit_cost=unit_cost)
            paid += recv * it.price * w.inv.cost_mult
            got_lines.append({"ingredient": ln["ingredient"], "qty": qty, "packs": recv})
        po["status"] = "received"
        po["received_s"] = w.now
        po["paid"] = paid
        w.fin.cash -= paid
        w.emit("po.received", po_id=pid, supplier=po["supplier"], lines=got_lines, short=short)
        w.recheck_availability(w.inv.stock_dirty)
        w.kpi.pulse()  # the truck was paid for: cash moves on the HUD now
        w.kitchen.request_dispatch()

    def open_for(self, ingredient: str) -> float:
        """Quantity on order (open POs) for ``ingredient``."""
        return sum(
            ln["qty"]
            for po in self.pos.values()
            if po["status"] == "open"
            for ln in po["lines"]
            if ln["ingredient"] == ingredient
        )

    def parse_cutoff(self, supplier: str) -> int:
        return parse_hhmm(self.w.ix.supplier[supplier].cutoff)
