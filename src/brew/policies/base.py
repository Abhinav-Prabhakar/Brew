"""Policy protocol and shared decision dataclasses (technical.md 8.1)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Protocol

if TYPE_CHECKING:
    from brew.sim.observation import Observation
    from brew.sim.state import Task
    from brew.sim.views import OrderView, WorldView

    TaskView = Task


@dataclass(slots=True)
class POLine:
    ingredient: str
    qty: float  # base units


@dataclass(slots=True)
class PurchaseOrder:
    supplier: str
    lines: list[POLine]
    arrive_tod_s: float | None = None  # force arrival at a time of day (standing bakery deliveries)


@dataclass(slots=True)
class ManagerAction:
    """Manager-level decision - the same representation the RL agent outputs (M3).

    All price changes pass the charter shield in :meth:`World.apply_manager_action`.
    """

    price_steps: dict[str, float] = field(default_factory=dict)  # category -> fraction (-0.10..+0.10)
    sku_prices: dict[str, float] = field(default_factory=dict)  # absolute INR price per sku
    promotion: bool = False  # sku_prices are a promotion (decrease-only, not step-limited)
    restore: bool = False  # sku_prices restore a previous price (exempt from cooldown)
    kappa: dict[str, float] = field(default_factory=dict)  # prep class -> quantile (0 = off)
    strategy: str | None = None  # dispatch preset name
    throttles: dict[str, str] = field(default_factory=dict)  # aggregator -> open|plus5|plus10|pause
    batch_window_s: float | None = None
    featured: str | None = None  # sku to feature; "" clears
    hide: dict[str, bool] = field(default_factory=dict)  # sku -> hide?
    prep_now: dict[str, float] = field(default_factory=dict)  # prep key -> qty (base uom)
    premake: dict[str, int] = field(default_factory=dict)  # replate-eligible sku -> units to make ahead
    replate_mode: str | None = None  # off|gentle|standard|aggressive|custom (ignored under owner override)
    replate_discounts: dict[str, float] = field(default_factory=dict)  # lot_id -> discount % (monotone)
    pos: list[PurchaseOrder] = field(default_factory=list)  # intra-day purchase orders (urgent top-ups)
    replate_caps: dict[str, float] = field(default_factory=dict)  # lot_id -> units offered on the rescue menu
    reason: str = ""
    factors: list[dict[str, Any]] = field(default_factory=list)

    def is_noop(self) -> bool:
        return not (
            self.price_steps or self.sku_prices or self.kappa or self.strategy or self.throttles
            or self.batch_window_s is not None or self.featured is not None or self.hide or self.prep_now
            or self.premake or self.replate_mode is not None or self.replate_discounts or self.pos
        )  # fmt: skip


@dataclass(slots=True)
class AcceptDecision:
    """Answer to an aggregator order: accept (with extra promise seconds), reject, or delay."""

    kind: str = "accept"  # accept | reject | delay
    extra_promise_s: float = 0.0
    reason: str = ""


@dataclass(slots=True)
class DayEndAction:
    pos: list[PurchaseOrder] = field(default_factory=list)
    donate: bool = True
    notes: str = ""


@dataclass(slots=True)
class TaskChoice:
    """One dispatch choice: a single task, or a batch of compatible tasks started together."""

    tasks: list[Task]
    hold_until: float = 0.0  # >now means "wait for more compatible tasks"


@dataclass(slots=True)
class Explanation:
    decision_id: str
    summary: str
    factors: list[dict[str, Any]] = field(default_factory=list)


class Policy(Protocol):
    """Every policy (A..E) implements this protocol; arena, live and training share it."""

    code: str

    def reset(self, view: WorldView, seed: int) -> None: ...

    def on_manager_tick(self, obs: Observation, view: WorldView) -> ManagerAction: ...

    def accept(self, order: OrderView, view: WorldView) -> AcceptDecision: ...

    def dispatch(self, ready: list[Task], view: WorldView) -> list[TaskChoice]: ...

    def on_day_end(self, view: WorldView) -> DayEndAction: ...

    def explain(self, decision_id: str) -> Explanation | None: ...
