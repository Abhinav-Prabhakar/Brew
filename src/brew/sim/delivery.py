"""Aggregator delivery: acceptance, throttles, promises, riders, pickup shelf, platform score
(docs/implementation-spec.md 7.7)."""

from __future__ import annotations

import math
from typing import TYPE_CHECKING

from brew.domain.timeutil import tod_s
from brew.policies.base import AcceptDecision

from .engine import P_DONE, P_TIMEOUT
from .state import Order

if TYPE_CHECKING:
    from .world import World

THROTTLE_EXTRA = {"open": 0.0, "plus5": 300.0, "plus10": 600.0, "pause": 0.0}
ETA_MEAN_S = 540.0
RETRY_S = 15.0


class Delivery:
    """Intake for zomato/swiggy orders and the rider/shelf pipeline."""

    def __init__(self, w: World) -> None:
        self.w = w
        n = w.cfg.cafe.shelf_slots
        self.shelf: list[int | None] = [None] * n
        self.slots_total = n
        self.waiting_for_slot: list[int] = []
        self.throttle = {"zomato": "open", "swiggy": "open"}
        self.rank = {"zomato": 1.0, "swiggy": 1.0}
        self.paused_hours_today = {"zomato": 0, "swiggy": 0}
        self.handles: dict[int, list[int]] = {}
        self.rider_wait_total = 0.0
        self.deliveries_today = 0
        self.rider_rows: list[dict] = []

    # ---------------------------------------------------------------- intake
    def rider_eta_pred(self, now: float) -> float:
        """Platform's predicted rider ETA (s): 9 min x rain 1.3 x peak 1.2 x shortage."""
        w = self.w
        m = ETA_MEAN_S
        if w.weather_state in ("rain", "drizzle"):
            m *= 1.3
        h = tod_s(now) / 3600.0
        if 12 <= h < 14 or 19 <= h < 22:
            m *= 1.2
        return m * w.dis.rider_eta_mult

    def open_aggregator_orders(self) -> int:
        return sum(1 for o in self.w.orders.open.values() if o.channel in ("zomato", "swiggy"))

    def new_order(self, o: Order) -> None:
        """An aggregator order has arrived; start the acceptance window."""
        w = self.w
        lvl = self.throttle[o.channel]
        o.promised_s = w.orders.estimate_promise(o, THROTTLE_EXTRA.get(lvl, 0.0))
        w.orders.announce_placed(o)
        if lvl == "pause":
            self.reject(o, "paused")
            return
        self.decide(o)

    def decide(self, o: Order) -> None:
        w = self.w
        view = w.order_view(o)
        d: AcceptDecision = w.policy.accept(view, w.view())
        timeout = w.ix.channel[o.channel].acceptance_timeout_s or w.cfg.cafe.acceptance_timeout_s
        if d.kind == "reject":
            self.reject(o, d.reason or "rejected")
        elif d.kind == "delay":
            if w.now - o.placed_s >= timeout - 1e-9:
                self.reject(o, "timeout")
            else:
                nxt = min(w.now + RETRY_S, o.placed_s + timeout)
                o.accept_handle = w.engine.schedule(nxt, "ACCEPT_RETRY", o.order_no, P_TIMEOUT)
        else:
            self.accept(o, d.extra_promise_s)

    def on_accept_retry(self, order_no: int) -> None:
        o = self.w.orders.orders.get(order_no)
        if o is not None and o.state == "pending":
            self.decide(o)

    def accept(self, o: Order, extra: float = 0.0) -> None:
        w = self.w
        extra += THROTTLE_EXTRA[self.throttle[o.channel]]
        if not w.orders.commit(o, extra, announce=False):
            self.reject(o, "sold_out", announce=True)
            return
        w.fin.collect(o, 0.0)  # prepaid via platform
        self.schedule_rider(o)

    def reject(self, o: Order, reason: str, announce: bool = True) -> None:
        w = self.w
        o.state = "rejected"
        w.engine.cancel(o.accept_handle)
        w.emit("order.rejected", order_no=o.order_no, reason=reason)
        w.kpi.on_reject(o, reason)
        self.rank[o.channel] = max(0.5, self.rank[o.channel] - 0.002)
        w.orders.orders.pop(o.order_no, None)

    # ----------------------------------------------------------------- riders
    def schedule_rider(self, o: Order) -> None:
        w = self.w
        pred = self.rider_eta_pred(w.now)
        mu_s = math.sqrt(math.log(1 + 0.33**2))
        actual = pred * math.exp(w.rng.riders.normal(-mu_s * mu_s / 2, mu_s))
        dispatch_t = max(w.now, o.promised_s - pred)
        arrive_t = dispatch_t + actual
        o.rider = {
            "dispatch_s": dispatch_t,
            "arrive_s": arrive_t,
            "waiting_since": None,
            "wait_s": 0.0,
            "pred_s": pred,
        }
        h1 = w.engine.schedule(dispatch_t, "RIDER_DISPATCH", o.order_no, P_DONE)
        h2 = w.engine.schedule(arrive_t, "RIDER_ARRIVE", o.order_no, P_DONE)
        self.handles[o.order_no] = [h1, h2]

    def on_rider_dispatch(self, order_no: int) -> None:
        o = self.w.orders.orders.get(order_no)
        if o is None or o.state == "voided" or o.rider is None:
            return
        self.w.emit(
            "rider.assigned", order_no=order_no, channel=o.channel, eta_s=round(o.rider["arrive_s"], 1)
        )

    def on_rider_arrive(self, order_no: int) -> None:
        w = self.w
        o = w.orders.orders.get(order_no)
        if o is None or o.state == "voided" or o.rider is None:
            return
        waiting = o.shelf_slot < 0
        w.emit(
            "rider.arrived",
            order_no=order_no,
            channel=o.channel,
            slot=o.shelf_slot if o.shelf_slot >= 0 else None,
            waiting=waiting,
        )
        if waiting:
            o.rider["waiting_since"] = w.now
        else:
            self.pickup(o)

    # ------------------------------------------------------------------ shelf
    def free_slot(self) -> int:
        for i, v in enumerate(self.shelf):
            if v is None:
                return i
        return -1

    def shelve(self, o: Order, by: str) -> bool:
        """Kitchen hands the bag to the pickup shelf; ticket is torn off the rail."""
        w = self.w
        slot = self.free_slot()
        if slot < 0:
            if o.order_no not in self.waiting_for_slot:
                self.waiting_for_slot.append(o.order_no)
            return True
        o.served_s = w.now
        o.served_by = by
        o.quality = w.orders.handoff_quality(o, w.now)
        o.state = "served"
        w.orders.open.pop(o.order_no, None)
        w.orders.ready_now.discard(o.order_no)
        self.shelf[slot] = o.order_no
        o.shelf_slot = slot
        eta = o.rider["arrive_s"] if o.rider else w.now
        w.emit("order.served", order_no=o.order_no, by=by)
        w.emit(
            "bag.shelved",
            order_no=o.order_no,
            channel=o.channel,
            slot=slot,
            eta_s=round(eta, 1),
            quality=round(o.quality, 3),
        )
        w.kpi.on_order_served(o)
        if w.tele is not None:
            w.tele.order_served(w, o)
        w.orders.update_rail()
        w.orders._archive(o)
        if o.rider and o.rider["waiting_since"] is not None:
            self.pickup(o)
        return True

    def pickup(self, o: Order) -> None:
        w = self.w
        slot = o.shelf_slot
        rider = o.rider or {}
        wait = 0.0
        if rider.get("waiting_since") is not None:
            wait = w.now - rider["waiting_since"]
        rider["wait_s"] = wait
        self.rider_wait_total += wait
        if slot >= 0:
            self.shelf[slot] = None
            o.shelf_slot = -1
        # quality decays on the shelf and in transit (insulated bag: half the decay rate)
        travel = 0.7 * rider.get("pred_s", ETA_MEAN_S)
        o.quality = w.orders.handoff_quality(o, w.now, extra_decay_s=0.5 * travel)
        w.emit(
            "rider.picked_up",
            order_no=o.order_no,
            channel=o.channel,
            slot=slot if slot >= 0 else None,
            quality=round(o.quality, 3),
            rider_wait_s=round(wait, 1),
        )
        w.engine.schedule(w.now + travel, "DELIVERED", o.order_no, P_DONE)
        if self.waiting_for_slot:
            nxt = self.waiting_for_slot.pop(0)
            no = w.orders.orders.get(nxt)
            if no is not None and no.state == "ready":
                self.shelve(no, "runner")

    def on_delivered(self, order_no: int) -> None:
        w = self.w
        o = w.orders.orders.get(order_no)
        if o is None or o.state == "voided":
            return
        o.delivered_s = w.now
        late = max(0.0, o.delivered_s - o.promised_s)
        rw = (o.rider or {}).get("wait_s", 0.0)
        target = 1.0 - min(0.3, late / 3600.0 + rw / 3600.0)
        self.rank[o.channel] = min(
            1.05, max(0.5, self.rank[o.channel] + 0.05 * (target - self.rank[o.channel]))
        )
        self.deliveries_today += 1
        w.kpi.on_delivered(o)
        if w.tele is not None:
            w.tele.delivery(w, o)
        w.reviews.rate_order(o, None, ambience=0.7)

    def on_void(self, o: Order) -> None:
        for h in self.handles.pop(o.order_no, []):
            self.w.engine.cancel(h)
        if o.shelf_slot >= 0:
            self.shelf[o.shelf_slot] = None
            o.shelf_slot = -1
        if o.order_no in self.waiting_for_slot:
            self.waiting_for_slot.remove(o.order_no)

    # ------------------------------------------------------------- throttling
    def set_throttle(self, ch: str, level: str) -> bool:
        if ch not in self.throttle or level not in THROTTLE_EXTRA:
            return False
        if self.throttle[ch] == level:
            return False
        self.throttle[ch] = level
        self.w.emit("throttle.changed", channel=ch, level=level)
        return True

    def hourly(self) -> None:
        """Platform ranking: x0.97 per pause hour, recovering 1%/h otherwise."""
        pr = self.w.cfg.cafe.params
        for ch, lvl in self.throttle.items():
            if lvl == "pause":
                self.rank[ch] = max(0.5, self.rank[ch] * pr.pause_rank_decay)
                self.paused_hours_today[ch] += 1
            else:
                self.rank[ch] = min(1.05, self.rank[ch] + pr.pause_rank_recovery)

    def shelf_view(self) -> list[dict]:
        w = self.w
        out = []
        for i, no in enumerate(self.shelf):
            if no is None:
                continue
            o = w.orders.orders.get(no)
            if o is None:
                continue
            q = w.orders.handoff_quality(o, w.now)
            out.append(
                {
                    "slot": i,
                    "order_no": no,
                    "channel": o.channel,
                    "rider_eta_s": (o.rider or {}).get("arrive_s"),
                    "quality": round(q, 3),
                }
            )
        return out
