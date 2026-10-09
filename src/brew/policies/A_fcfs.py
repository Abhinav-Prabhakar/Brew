"""Policy A - naive: accept everything, FCFS dispatch, no pre-prep except when out, fixed weekly PO."""

from __future__ import annotations

import math
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

# prep items A makes only when they run out (long waits follow, by design)
MANDATORY_PREP = {"chai_base": 160.0, "coldbrew_concentrate": 120.0}
ORDER_DAYS = (0, 3)
WEEKLY_COVER_DAYS = 3.5


class PolicyA:
    """Naive FCFS baseline."""

    code = "A"
    default_preset = "fcfs"
    default_batch_window_s = 0.0

    def __init__(self) -> None:
        self.last_decision: dict[str, Explanation] = {}

    def reset(self, view: WorldView, seed: int) -> None:
        self.last_decision = {}

    def on_manager_tick(self, obs: Observation, view: WorldView) -> ManagerAction:
        """Only reacts when a mandatory prep item is out (no forecast, no pricing)."""
        act = ManagerAction()
        for key, min_qty in MANDATORY_PREP.items():
            if view.usable(key) < min_qty and view.prep_inflight(key) <= 0:
                act.prep_now[key] = 1.0  # one batch
        if act.prep_now:
            act.reason = "Out of " + ", ".join(act.prep_now)
        return act

    def accept(self, order: OrderView, view: WorldView) -> AcceptDecision:
        return AcceptDecision("accept")

    def dispatch(self, ready: list[Task], view: WorldView) -> list[TaskChoice]:
        """FCFS: oldest order first (manual strategy presets are honoured when set)."""
        preset = view.strategies.presets[view.preset]
        boost = view.channel_boost
        now = view.now
        scored = [(priority(t, now, preset, boost), t.id, t) for t in ready]
        scored.sort(key=lambda x: (-x[0], x[1]))
        return [TaskChoice([t]) for _p, _i, t in scored]

    def on_day_end(self, view: WorldView) -> DayEndAction:
        """Fixed order twice a week, sized to ~3.5 days of expected use, regardless of stock."""
        act = DayEndAction(donate=False)
        if view.day % 7 not in ORDER_DAYS:
            return act
        cfg = view.config
        by_sup: dict[str, list[POLine]] = {}
        for ing in cfg.ingredients:
            qty = view.usage_per_day(ing.key) * WEEKLY_COVER_DAYS * 1.2
            if qty <= 0:
                continue
            sup = view.supplier_for(ing.key)
            by_sup.setdefault(sup, []).append(POLine(ing.key, math.ceil(qty)))
        for sup, lines in sorted(by_sup.items()):
            act.pos.append(PurchaseOrder(sup, lines))
        return act

    def explain(self, decision_id: str) -> Explanation | None:
        return self.last_decision.get(decision_id)
