"""Policy B - heuristic: pause aggregators under load, dine-in first, batch same step within 60 s,
P50 morning prep from a moving average, happy hour in dead hours, (s,S) purchasing."""

from __future__ import annotations

import math
from collections import defaultdict
from typing import TYPE_CHECKING

from brew.policies.base import (
    AcceptDecision,
    DayEndAction,
    Explanation,
    ManagerAction,
    POLine,
    PurchaseOrder,
    TaskChoice,
)
from brew.policies.strategies import priority

if TYPE_CHECKING:
    from brew.sim.observation import Observation
    from brew.sim.state import Task
    from brew.sim.views import OrderView, WorldView

PAUSE_ABOVE = 8
RESUME_BELOW = 4
BATCH_WINDOW_S = 60.0
PREP_CLASSES = ("coldbrew_concentrate", "chai_base", "croissant_baked", "paneer_marinade", "fries_cut")
HAPPY_START_H, HAPPY_END_H = 15.0, 17.0
HAPPY_PCT = 10.0
PREP_CUTOFF_H = 19.0
BAKERY_SPLIT = (("07:30", 0.6), ("13:00", 0.4))


def _hhmm(s: str) -> float:
    h, m = s.split(":")
    return int(h) * 3600 + int(m) * 60


class PolicyB:
    """Heuristic baseline."""

    code = "B"
    default_preset = "dine_first"
    default_batch_window_s = BATCH_WINDOW_S

    def __init__(self) -> None:
        self.happy_on = False
        self.last_decision: dict[str, Explanation] = {}

    def reset(self, view: WorldView, seed: int) -> None:
        self.happy_on = False
        self.last_decision = {}

    # ---------------------------------------------------------------- manager
    def on_manager_tick(self, obs: Observation, view: WorldView) -> ManagerAction:
        act = ManagerAction()
        reasons: list[str] = []
        # 1. intake control
        open_agg = view.open_aggregator_orders()
        for ch in ("zomato", "swiggy"):
            lvl = view.throttle(ch)
            if open_agg > PAUSE_ABOVE and lvl != "pause":
                act.throttles[ch] = "pause"
                reasons.append(f"{open_agg} open delivery orders > {PAUSE_ABOVE}: pausing {ch}")
            elif open_agg < RESUME_BELOW and lvl == "pause":
                act.throttles[ch] = "open"
                reasons.append(f"delivery backlog cleared ({open_agg}): reopening {ch}")
        # 2. prep to P50 of expected demand
        hour = view.hour
        if hour < PREP_CUTOFF_H:
            frac = max(0.25, min(1.0, (22.0 - hour) / 14.0))
            for key in PREP_CLASSES:
                p = view.config_prep(key)
                share = min(
                    frac, p.hold_time_min / 60.0 / 14.0 * 1.3
                )  # short-hold items: cover the hold window only
                need = view.usage_per_day(key) * share
                have = view.usable(key) + view.prep_inflight(key)
                horizon_need = view.usage_per_day(key) * 0.3  # next ~4 h
                if have < max(horizon_need, 0.0) and need > 0:
                    short = need * 1.1 - have
                    act.prep_now[key] = max(p.batch_size, math.ceil(short / p.batch_size) * p.batch_size)
            if act.prep_now:
                reasons.append("prep to P50: " + ", ".join(act.prep_now))
        # 3. happy hour in dead hours
        if HAPPY_START_H <= hour < HAPPY_END_H and not self.happy_on:
            for m in view.config.menu:
                if m.cat in ("coffee", "notcoffee"):
                    act.sku_prices[m.sku] = view.base_price(m.sku) * (1 - HAPPY_PCT / 100.0)
            act.promotion = True
            self.happy_on = True
            reasons.append(f"happy hour: drinks -{HAPPY_PCT:.0f}% in dead hours")
        elif hour >= HAPPY_END_H and self.happy_on:
            for m in view.config.menu:
                if m.cat in ("coffee", "notcoffee"):
                    act.sku_prices[m.sku] = view.base_price(m.sku)
            act.restore = True
            self.happy_on = False
            reasons.append("happy hour over: prices restored")
        act.reason = "; ".join(reasons)
        return act

    def accept(self, order: OrderView, view: WorldView) -> AcceptDecision:
        return AcceptDecision("accept")

    # --------------------------------------------------------------- dispatch
    def dispatch(self, ready: list[Task], view: WorldView) -> list[TaskChoice]:
        """Dine-in first then age; batch same-step tasks; hold a lone batchable task up to 60 s."""
        preset = view.strategies.presets[view.preset]
        boost = view.channel_boost
        now = view.now
        window = view.batch_window_s
        groups: dict[tuple[str, str], list[Task]] = defaultdict(list)
        out: list[tuple[float, int, TaskChoice]] = []
        for t in ready:
            if t.batchable and window > 0:
                groups[(t.station, t.name)].append(t)
            else:
                out.append((priority(t, now, preset, boost), t.id, TaskChoice([t])))
        for members in groups.values():
            members.sort(key=lambda t: (-priority(t, now, preset, boost), t.id))
            mb = members[0].max_batch
            for i in range(0, len(members), mb):
                chunk = members[i : i + mb]
                pr = max(priority(t, now, preset, boost) for t in chunk)
                hold = 0.0
                if len(chunk) == 1:
                    t = chunk[0]
                    slack = (t.due_s - now - t.est_s) if t.due_s else 1e4
                    if now - t.ready_s < window and slack > 120.0 and t.channel != "dine_in":
                        hold = t.ready_s + window
                out.append((pr, chunk[0].id, TaskChoice(chunk, hold)))
        out.sort(key=lambda x: (-x[0], x[1]))
        return [c for _p, _i, c in out]

    # ---------------------------------------------------------------- purchasing
    def on_day_end(self, view: WorldView) -> DayEndAction:
        """(s,S): order up to par whenever position (on hand + on order) <= reorder point."""
        act = DayEndAction(donate=True)
        by_sup: dict[str, list[POLine]] = defaultdict(list)
        for ing in view.config.ingredients:
            pos = view.onhand(ing.key) + view.on_order(ing.key)
            use = view.usage_per_day(ing.key)
            s = max(ing.reorder_point, use * 1.5)
            S = max(ing.par, use * 3.0)
            if pos <= s:
                by_sup[view.supplier_for(ing.key)].append(POLine(ing.key, S - pos))
        for sup, lines in sorted(by_sup.items()):
            if sup == "bakery":
                for tod, share in BAKERY_SPLIT:
                    part = [POLine(ln.ingredient, ln.qty * share) for ln in lines]
                    act.pos.append(PurchaseOrder(sup, part, arrive_tod_s=_hhmm(tod)))
            else:
                act.pos.append(PurchaseOrder(sup, lines))
        return act

    def explain(self, decision_id: str) -> Explanation | None:
        return self.last_decision.get(decision_id)
