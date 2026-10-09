"""Orders: creation, inventory consumption, progress, ready/serve/void, rail."""

from __future__ import annotations

import math
from collections import deque
from typing import TYPE_CHECKING, Any

from brew.domain.money import round2

from .engine import P_DONE
from .state import Order, Unit

if TYPE_CHECKING:
    from .world import World

STATE_RANK = {"queued": 0, "brewing": 1, "almost": 2, "ready": 3}


class Orders:
    """All orders of the world plus the lifecycle operations on them."""

    def __init__(self, w: World) -> None:
        self.w = w
        self.orders: dict[int, Order] = {}
        self.open: dict[int, Order] = {}  # placed, not yet served/voided (insertion = placement order)
        self.archive: deque[Order] = deque(maxlen=400)
        self.next_no = w.cfg.cafe.order_no_start
        self.rail_sig: tuple = ()
        self.serve_handles: dict[int, int] = {}
        self.pack_short: set[int] = set()
        self.ready_now: set[int] = set()
        self.crit: dict[str, float] = {}

    # ------------------------------------------------------------------ helpers
    def critical_path(self, sku: str) -> float:
        """Mean critical-path seconds of a recipe (no waiting)."""
        v = self.crit.get(sku)
        if v is None:
            steps = self.w.cfg.recipes.recipes[sku].steps
            fin: dict[str, float] = {}
            for i, s in enumerate(steps):
                deps = s.depends_on if s.depends_on is not None else ((steps[i - 1].name,) if i > 0 else ())
                fin[s.name] = s.duration[0] + max((fin[d] for d in deps), default=0.0)
            v = max(fin.values())
            self.crit[sku] = v
        return v

    def estimate_prep_s(self, items: list[tuple[str, tuple[str, ...]]], carry: bool) -> float:
        """Estimated seconds from start to ready for the slowest unit (+bagging)."""
        w = self.w
        best = 0.0
        for sku, mods in items:
            extra = sum(w.ix.mod[m].extra_prep_s for m in mods)
            best = max(best, self.critical_path(sku) + extra)
        return best + (w.cfg.cafe.bag_s if carry else 0.0)

    def queue_delay_s(self) -> float:
        """Rough wait before new work starts: open work / effective staff."""
        k = self.w.kitchen
        n = max(1.0, 0.8 * len(k.present_staff()))
        return k.work_open / n

    def make_order(
        self,
        channel: str,
        persona: str,
        name: str,
        party_id: str | None,
        items: list[tuple[str, tuple[str, ...]]],
        note: str | None,
        note_flags: list[str],
        refill: bool = False,
    ) -> Order:
        """Create (but do not commit) an order with live-price lines and one Unit per item."""
        w = self.w
        no = self.next_no
        self.next_no += 1
        grouped: dict[tuple[str, tuple[str, ...]], int] = {}
        for it in items:
            grouped[it] = grouped.get(it, 0) + 1
        lines = []
        units: list[Unit] = []
        ref_total = 0.0
        for li, ((sku, mods), qty) in enumerate(grouped.items()):
            ms = w.menu[sku]
            delta = w.mod_delta(mods)
            lines.append({"sku": sku, "qty": qty, "mods": list(mods), "unit_price": round2(ms.price + delta)})
            ref_total += (ms.ref_price + delta) * qty
            for _ in range(qty):
                units.append(Unit(sku, mods, li, no))
        o = Order(
            order_no=no, id=w.new_id(), channel=channel, persona=persona, name=name, party_id=party_id,
            lines=lines, units=units, note=note, note_flags=note_flags, placed_s=w.now, promised_s=w.now,
            state="pending",
        )  # fmt: skip
        o.ref_total = ref_total
        o.items_n = len(units)
        o.is_refill = refill
        self.orders[no] = o
        return o

    def estimate_promise(self, o: Order, extra: float = 0.0) -> float:
        carry = o.channel != "dine_in"
        items = [(u.sku, u.mods) for u in o.units]
        base = self.estimate_prep_s(items, carry) + self.queue_delay_s()
        pad = 300.0 if o.channel in ("zomato", "swiggy") else 60.0
        return self.w.now + base + pad + extra

    # ------------------------------------------------------------------- commit
    def consume_unit(self, o: Order, u: Unit, remake: bool = False) -> bool:
        """Consume the unit's BOM (FEFO). Packaging may run short (flagged); food may not."""
        w = self.w
        carry = o.channel != "dine_in"
        bom = w.inv.bom(u.sku, u.mods, carry)
        food = [(k, q) for k, q, pack in bom if not pack]
        if not remake and not w.inv.can_supply(food, w.now):
            return False
        cost = 0.0
        qmin = 1.0
        for k, q, pack in bom:
            got, c, qual = w.inv.consume(k, q, w.now, partial=True)
            if pack and got < q - 1e-9:
                self.pack_short.add(o.order_no)
            w.book_consumption(k, c)
            cost += c
            if not pack and got > 0:
                qmin = min(qmin, qual)
        u.cost += cost
        o.cogs += cost
        u.ing_quality = qmin
        return True

    def commit(self, o: Order, extra_promise: float = 0.0, accept_event: bool = True) -> bool:
        """Consume stock, build tasks and announce. Returns False if nothing could be supplied."""
        w = self.w
        keep: list[Unit] = []
        for u in o.units:
            if self.consume_unit(o, u):
                keep.append(u)
        if not keep:
            self.orders.pop(o.order_no, None)
            return False
        if len(keep) != len(o.units):
            self._rebuild_lines(o, keep)
        o.state = "queued"
        o.promised_s = self.estimate_promise(o, extra_promise)
        self.open[o.order_no] = o
        w.kitchen.build_order_tasks(o)
        for ln in o.lines:
            w.menu[ln["sku"]].sold_today += ln["qty"]
        w.kpi.on_order_placed(o)
        if w.tele is not None:
            w.tele.order_placed(w, o)
        w.recheck_availability(w.inv.stock_dirty)
        self.announce_placed(o)
        if accept_event:
            w.emit("order.accepted", order_no=o.order_no, promised_s=round(o.promised_s, 1))
        self.update_rail()
        return True

    def _rebuild_lines(self, o: Order, keep: list[Unit]) -> None:
        w = self.w
        grouped: dict[tuple[str, tuple[str, ...]], int] = {}
        for u in keep:
            grouped[(u.sku, u.mods)] = grouped.get((u.sku, u.mods), 0) + 1
        lines = []
        ref_total = 0.0
        idx = {}
        for li, ((sku, mods), qty) in enumerate(grouped.items()):
            ms = w.menu[sku]
            delta = w.mod_delta(mods)
            lines.append({"sku": sku, "qty": qty, "mods": list(mods), "unit_price": round2(ms.price + delta)})
            ref_total += (ms.ref_price + delta) * qty
            idx[(sku, mods)] = li
        for u in keep:
            u.line = idx[(u.sku, u.mods)]
        o.units = keep
        o.lines = lines
        o.ref_total = ref_total
        o.items_n = len(keep)

    def announce_placed(self, o: Order) -> None:
        """Emit ``order.placed`` (call after lines are final)."""
        self.w.emit(
            "order.placed",
            order_no=o.order_no,
            order_id=o.id,
            channel=o.channel,
            party_id=o.party_id,
            persona=o.persona,
            name=o.name,
            items=[
                {"sku": ln["sku"], "qty": ln["qty"], "mods": ln["mods"], "unit_price": ln["unit_price"]}
                for ln in o.lines
            ],
            note=o.note,
            note_flags=o.note_flags,
            promised_s=round(o.promised_s, 1),
            priority=1 if o.bumped else 0,
        )

    # ----------------------------------------------------------------- progress
    def progress_of(self, o: Order) -> tuple[str, float]:
        if o.state in ("ready", "served"):
            return "ready", 1.0
        prog = o.tasks_done / o.tasks_total if o.tasks_total else 0.0
        if prog >= 0.75:
            return "almost", prog
        if o.tasks_started:
            return "brewing", prog
        return "queued", prog

    def progress_payload(self, o: Order) -> dict[str, Any]:
        state, prog = self.progress_of(o)
        ahead = 0
        for n, oo in self.open.items():
            if n >= o.order_no:
                break
            if oo.state != "ready":
                ahead += 1
        return {"order_no": o.order_no, "state": state, "progress": round(prog, 2), "ahead": ahead}

    def update_progress(self, o: Order) -> None:
        state, prog = self.progress_of(o)
        key = STATE_RANK[state] * 100 + int(prog * 20)
        if key != o.progress_key:
            o.progress_key = key
            self.w.emit("order.progress", **self.progress_payload(o))

    def on_task_started(self, order_no: int) -> None:
        o = self.orders.get(order_no)
        if o is not None and not o.tasks_started:
            o.tasks_started = True
            if o.state == "queued":
                o.state = "brewing"
            self.update_progress(o)

    def unit_done(self, o: Order) -> None:
        if o.bag_task is None and all(u.done for u in o.units):
            self.mark_ready(o)

    def bag_done(self, o: Order) -> None:
        if all(u.done for u in o.units):
            self.mark_ready(o)

    def mark_ready(self, o: Order) -> None:
        w = self.w
        if o.state in ("ready", "served", "voided"):
            return
        o.state = "ready"
        o.ready_s = w.now
        self.ready_now.add(o.order_no)
        self.update_progress(o)
        w.emit("order.ready", order_no=o.order_no, ready_s=round(w.now, 1))
        h = w.engine.schedule(w.now + w.cfg.cafe.auto_serve_delay_s, "AUTO_SERVE", o.order_no, P_DONE)
        self.serve_handles[o.order_no] = h
        self.update_rail()

    # -------------------------------------------------------------------- serve
    def serve(self, order_no: int, by: str) -> bool:
        """Hand an order over (player/runner). Delivery orders go to the shelf instead."""
        w = self.w
        o = self.orders.get(order_no)
        if o is None or o.state != "ready":
            return False
        w.engine.cancel(self.serve_handles.pop(order_no, None))
        self.ready_now.discard(order_no)
        if o.channel in ("zomato", "swiggy"):
            return w.delivery.shelve(o, by)
        self._finish_serve(o, by)
        return True

    def handoff_quality(self, o: Order, now: float, extra_decay_s: float = 0.0) -> float:
        """Mean unit quality at ``now``: ingredient quality x 2^(-age/half_life), hold-time penalty."""
        w = self.w
        qs = []
        for u in o.units:
            m = w.ix.menu[u.sku]
            age = max(0.0, now - (u.ready_s or now)) + extra_decay_s
            q = u.ing_quality * (2.0 ** (-age / m.quality_half_life_s))
            if age > m.hold_time_s:
                q *= 0.92
            qs.append(max(0.0, min(1.0, q)))
        return sum(qs) / len(qs) if qs else 1.0

    def _finish_serve(self, o: Order, by: str) -> None:
        w = self.w
        o.served_s = w.now
        o.served_by = by
        o.quality = self.handoff_quality(o, w.now)
        o.state = "served"
        self.open.pop(o.order_no, None)
        w.emit("order.served", order_no=o.order_no, by=by)
        w.kpi.on_order_served(o)
        if w.tele is not None:
            w.tele.order_served(w, o)
        w.customers.on_served(o)
        self.update_rail()
        self._archive(o)

    def _archive(self, o: Order) -> None:
        # keep only a bounded recent archive; drop heavy task refs
        for u in o.units:
            u.tasks = []
        o.bag_task = None
        self.archive.append(o)
        if len(self.orders) > 600:
            for n in list(self.orders)[:200]:
                oo = self.orders[n]
                if oo.state in ("served", "voided", "rejected"):
                    del self.orders[n]

    def finish_delivered(self, o: Order) -> None:
        """Called by Delivery when the rider has delivered (order closes)."""
        w = self.w
        o.state = "served"
        self.open.pop(o.order_no, None)
        w.emit("order.served", order_no=o.order_no, by="rider")
        w.kpi.on_order_served(o)
        if w.tele is not None:
            w.tele.order_served(w, o)
        self.update_rail()
        self._archive(o)

    def bump(self, order_no: int, on: bool) -> bool:
        o = self.open.get(order_no)
        if o is None or o.state in ("ready", "served", "voided"):
            return False
        o.bumped = on
        for u in o.units:
            for t in u.tasks:
                t.bumped = on
        if o.bag_task is not None:
            o.bag_task.bumped = on
        o.priority = 1 if on else 0
        self.w.kitchen.request_dispatch()
        self.update_rail()
        return True

    def void(self, o: Order, reason: str) -> None:
        w = self.w
        if o.state in ("served", "voided", "rejected"):
            return
        was_open = o.order_no in self.open
        o.state = "voided"
        self.open.pop(o.order_no, None)
        self.ready_now.discard(o.order_no)
        w.engine.cancel(self.serve_handles.pop(o.order_no, None))
        if was_open:
            w.kitchen.cancel_order_tasks(o)
        w.delivery.on_void(o)
        for u in o.units:
            if u.ware:
                w.return_ware(u.ware, clean=False)
                u.ware = ""
        w.fin.refund(o)
        w.emit("order.voided", order_no=o.order_no, reason=reason)
        w.kpi.on_void(o, reason)
        self.update_rail()
        self._archive(o)

    # --------------------------------------------------------------------- rail
    def rail_state(self) -> tuple[list[int], list[dict[str, Any]]]:
        """Priority-sorted open order numbers and live batch groups."""
        w = self.w
        pend = [o for o in self.open.values() if o.state != "ready"]
        pend.sort(key=lambda o: (not o.bumped, o.promised_s, o.order_no))
        ready = sorted((o for o in self.open.values() if o.state == "ready"), key=lambda o: o.ready_s)
        nos = [o.order_no for o in pend] + [o.order_no for o in ready]
        batches = [
            {"id": f"b{bid}", "order_nos": sorted(ons)}
            for bid, ons in sorted(w.kitchen.live_batches.items())
            if len(ons) >= 2
        ]
        return nos, batches

    def update_rail(self) -> None:
        nos, batches = self.rail_state()
        sig = (tuple(nos), tuple((b["id"], tuple(b["order_nos"])) for b in batches))
        if sig != self.rail_sig:
            self.rail_sig = sig
            self.w.emit("rail.reordered", order_nos=nos, batches=batches)

    def open_by_channel(self) -> dict[str, int]:
        out = {"dine_in": 0, "takeaway": 0, "zomato": 0, "swiggy": 0}
        for o in self.open.values():
            out[o.channel] = out.get(o.channel, 0) + 1
        return out

    def slack_hist(self) -> list[int]:
        """Histogram of open orders by slack: <-5m, -5..0, 0..5m, 5..15m, >15m."""
        h = [0] * 5
        now = self.w.now
        for o in self.open.values():
            if o.state == "ready":
                continue
            s = o.promised_s - now
            i = 0 if s < -300 else 1 if s < 0 else 2 if s < 300 else 3 if s < 900 else 4
            h[i] += 1
        return h

    def avg_wait(self, orders: list[Order]) -> float:
        return sum(o.served_s - o.placed_s for o in orders) / len(orders) if orders else 0.0

    @staticmethod
    def p95(vals: list[float]) -> float:
        if not vals:
            return 0.0
        s = sorted(vals)
        return s[min(len(s) - 1, math.ceil(0.95 * len(s)) - 1)]
