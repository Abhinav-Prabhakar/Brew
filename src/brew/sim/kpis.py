"""KPI counters: rolling kpi.tick payload and daily summaries (docs/implementation-spec.md 7.11)."""

from __future__ import annotations

from collections import defaultdict
from typing import TYPE_CHECKING, Any

from brew.domain.money import round2

from .state import Order

if TYPE_CHECKING:
    from .world import World


class Kpis:
    """Accumulates per-day statistics; ``daily()`` produces the summary dict."""

    def __init__(self, w: World) -> None:
        self.w = w
        self.history: list[dict[str, Any]] = []
        self.energy_kwh_today = 0.0
        # cumulative (never reset) counters read by the RL reward tracker (rl/reward.py)
        self.cum_late_min: dict[str, float] = defaultdict(
            float
        )  # persona -> minutes served/delivered past promise
        self.cum_walkouts: dict[str, int] = defaultdict(int)  # persona -> balks + reneges
        self.cum_overload_s = 0.0  # staff-seconds above 95 % attention
        self.cum_price_changes = 0
        self.stock_reported: dict[str, float] = {}  # raw stock last streamed per key (report_stock)
        self.cum_waste_kg = 0.0
        self.cum_waste_inr = 0.0
        self.reset()

    def reset(self) -> None:
        self.orders_by_channel: dict[str, int] = defaultdict(int)
        self.items_sold = 0
        self.waits: dict[str, list[float]] = defaultdict(list)
        self.sla_breach = 0
        self.served = 0
        self.balks = 0
        self.reneges = 0
        self.rejected = 0
        self.voided = 0
        self.arrived_agg = 0
        self.price_changes = 0
        self.co2e_g = 0.0
        self.waste_kg = 0.0
        self.waste_inr = 0.0
        self.donated_kg = 0.0
        self.delivered = 0
        self.delivery_late = 0
        self.rider_wait_s = 0.0

    def on_order_placed(self, o: Order) -> None:
        self.orders_by_channel[o.channel] += 1
        self.items_sold += o.items_n
        w = self.w
        for ln in o.lines:
            self.co2e_g += w.ix.menu[ln["sku"]].co2e_g * ln["qty"]

    def on_order_served(self, o: Order) -> None:
        self.served += 1
        self.waits[o.channel].append(o.served_s - o.placed_s)
        if o.served_s > o.promised_s:
            self.sla_breach += 1
            if o.channel not in ("zomato", "swiggy"):  # aggregator orders are judged at delivery
                self.cum_late_min[o.persona] += (o.served_s - o.promised_s) / 60.0

    def on_void(self, o: Order, reason: str) -> None:
        self.voided += 1

    def on_reject(self, o: Order, reason: str) -> None:
        self.rejected += 1

    def on_delivered(self, o: Order) -> None:
        self.delivered += 1
        if o.delivered_s > o.promised_s:
            self.delivery_late += 1
            self.cum_late_min[o.persona] += (o.delivered_s - o.promised_s) / 60.0
        self.rider_wait_s += (o.rider or {}).get("wait_s", 0.0)

    # ------------------------------------------------------------------- views
    def revenue_today(self) -> float:
        return self.w.fin.ledger.revenue(self.w.day)

    def profit_today(self) -> float:
        """Running profit; accrued labour/energy/rent are not yet booked mid-day, so estimate them."""
        w = self.w
        base = w.fin.ledger.profit(w.day)
        cfg = w.cfg.cafe
        frac = min(1.0, max(0.0, (w.now - (w.day * 86400 + 7 * 3600)) / (15.5 * 3600)))
        lab = w.kitchen.labour_accrued
        for s in w.kitchen.staff_list:
            if s.present:
                lab += s.wage * (w.now - s.clock_in_s) / 3600.0
        return round2(base - lab - cfg.rent_per_day * frac)

    def profit_live(self) -> float:
        """The HUD's running profit (``kpi.tick``). Labour, rent, energy, maintenance and depreciation are only booked
        at close-out, so mid-day they are estimated pro rata; once the day is closed the ledger is the truth.
        (``profit_today`` above is the RL observation / reward signal and stays as trained.)"""
        w = self.w
        base = w.fin.ledger.profit(w.day)
        day = w.fin.ledger.day[w.day]
        if day["rent"] > 0:  # close_day already booked every cost: the ledger is the truth
            return base
        cfg = w.cfg.cafe
        frac = min(1.0, max(0.0, (w.now - (w.day * 86400 + 7 * 3600)) / (15.5 * 3600)))
        lab = w.kitchen.labour_accrued
        for s in w.kitchen.staff_list:
            if s.present:
                lab += s.wage * (w.now - s.clock_in_s) / 3600.0
        open_h = (cfg.close_s - cfg.open_s) / 3600.0
        elapsed_h = min(open_h, max(0.0, (w.now - w.day * 86400 - cfg.open_s) / 3600.0))
        kwh = 0.0
        maint = 0.0
        dep = 0.0
        for e in w.equip:
            active_h = e.active_s / 3600.0
            kwh += e.kw_active * active_h + e.kw_idle * max(0.0, elapsed_h - active_h)
            maint += e.maintenance_per_day * frac
            dep += e.capex / cfg.depreciation_life_days * frac
        extra = sum(c["opex"] for c in w.invest_log if c["delivered"]) * frac
        energy = kwh * cfg.energy_rate_per_kwh
        return round2(base - lab - cfg.rent_per_day * frac - energy - maint - dep - extra)

    def pulse(self) -> None:
        """Stream a ``kpi.tick`` right after money moved (payment, refund, PO received, purchase): the HUD's cash /
        revenue / profit follow the ledger instead of waiting for the 5-min scheduled tick. Building the payload is
        lazy (nothing is computed when no sink is attached, so training / arena runs pay nothing)."""
        self.w.emit_lazy("kpi.tick", self.tick_payload)

    def report_stock(self) -> None:
        """Stream ``stock.changed`` for raw ingredients / prep items whose on-hand moved since the last report (once a
        sim-minute): the sim only streamed finished goods, so every other shelf stayed frozen between REST polls."""
        w = self.w
        inv = w.inv
        rep = self.stock_reported
        if not rep:  # first call: the opening stock is what the snapshot / REST already show
            for k, q in inv.onhand.items():
                rep[k] = round(q, 2)
            return
        for k, q in inv.onhand.items():
            if (
                k in inv.finished or k in inv.virtual
            ):  # these stream on every change already (recheck_availability)
                continue
            r = round(q, 2)
            if rep.get(k) == r:
                continue
            rep[k] = r
            ing = w.ix.ingredient.get(k)
            reorder = (
                ing.reorder_point
                if ing is not None
                else (w.ix.prep[k].reorder_point if k in w.ix.prep else 0.0)
            )
            low = q < reorder
            w.low_flag[k] = low
            w.emit("stock.changed", key=k, qty=r, low=low)

    def tick_payload(self) -> dict[str, Any]:
        w = self.w
        return {
            "cash": round2(w.fin.cash),
            "revenue_today": round2(self.revenue_today()),
            "profit_today": self.profit_live(),
            "rating": round(w.reviews.rep.overall(), 2),
            "rating_n": w.reviews.rep.count(),
            "load_pct": round(w.kitchen.load_pct(), 1),
            "open_orders": len(w.orders.open),
            "walkouts_today": w.customers.walkouts_today,
        }

    def daily(self, day: int) -> dict[str, Any]:
        w = self.w
        led = w.fin.ledger.day[day]
        total_orders = sum(self.orders_by_channel.values())
        labour_h = sum(s.worked_s for s in w.kitchen.staff_list) / 3600.0
        revenue = w.fin.ledger.revenue(day)
        profit = w.fin.ledger.profit(day)
        avg_wait = {ch: round(sum(v) / len(v), 1) for ch, v in self.waits.items() if v}
        p95 = {ch: round(w.orders.p95(v), 1) for ch, v in self.waits.items() if v}
        overload_min = sum(s.overload_s for s in w.kitchen.staff_list) / 60.0
        co2e = self.co2e_g / 1000.0 + self.energy_kwh_today * w.cfg.cafe.co2e_kg_per_kwh + self.waste_kg * 2.0
        batch_rate = w.kitchen.batched_tasks_today / max(1, w.kitchen.tasks_started_today)
        stars = w.reviews.stars_today
        return {
            "day": day,
            "date": w.date_str(day),
            "revenue": round2(revenue),
            "net_profit": round2(profit),
            "orders": total_orders,
            "orders_by_channel": dict(self.orders_by_channel),
            "items_sold": self.items_sold,
            "avg_wait_s": avg_wait,
            "p95_wait_s": p95,
            "sla_breach_rate": round(self.sla_breach / max(1, self.served), 4),
            "balks": self.balks,
            "reneges": self.reneges,
            "walkouts": w.customers.walkouts_today,
            "rejected": self.rejected,
            "voided": self.voided,
            "rating": round(w.reviews.rep.overall(), 3),
            "reviews": len(stars),
            "reviews_neg": w.reviews.neg_today,
            "table_turns": w.customers.table_turns_today,
            "labour_hours": round(labour_h, 2),
            "revenue_per_labour_hour": round2(revenue / labour_h) if labour_h else 0.0,
            "food_cost_pct": round((led["cogs"] / revenue * 100.0) if revenue else 0.0, 2),
            "waste_kg": round(self.waste_kg, 3),
            "waste_inr": round2(self.waste_inr),
            "donated_kg": round(self.donated_kg, 3),
            "energy_kwh": round(self.energy_kwh_today, 2),
            "co2e_kg": round(co2e, 2),
            "overload_min": round(overload_min, 1),
            "price_changes": self.price_changes,
            "batch_rate": round(batch_rate, 4),
            "delivered": self.delivered,
            "rider_wait_s": round(self.rider_wait_s, 1),
            "cash": round2(w.fin.cash),
            **w.replate.kpis(),
            **w.combos.kpis(),
            "ledger": {k: round2(v) for k, v in led.items()},
        }
