"""Pydantic models for every event type (data payloads) plus the wire envelope union."""

from __future__ import annotations

from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, create_model


class D(BaseModel):
    """Base for event payloads."""

    model_config = ConfigDict(frozen=True, extra="forbid")


class OrderLine(D):
    sku: str
    qty: int
    mods: list[str] = []
    unit_price: float
    replate: bool = False
    combo: str | None = None


# ---- time / world ---------------------------------------------------------------
class ClockTick(D):
    day: int
    hhmm: str
    weekday: str
    speed: float


class WeatherChanged(D):
    state: str
    temp_c: float
    rain_mm_h: float


class DayStarted(D):
    day: int
    date: str
    weekday: str
    weather: str
    events: list[str] = []


class DayEnded(D):
    day: int
    summary: dict[str, Any]


# ---- customers -------------------------------------------------------------------
class CustomerArrived(D):
    customer_id: str
    party_id: str
    persona: str
    party_size: int
    channel: str
    appearance_seeds: list[int]
    name: str
    laptop: bool = False


class CustomerQueued(D):
    party_id: str
    position: int


class CustomerBalked(D):
    party_id: str
    reason: str


class CustomerOrdering(D):
    party_id: str


class CustomerWaiting(D):
    party_id: str
    order_no: int
    patience_s: float
    patience_deadline_s: float


class CustomerPatience(D):
    party_id: str
    frac: float


class CustomerReneged(D):
    party_id: str
    order_no: int | None = None


class CustomerSeated(D):
    party_id: str
    table_ids: list[str]
    seats: list[int]
    merged: bool


class CustomerEating(D):
    party_id: str


class CustomerLingering(D):
    party_id: str
    laptop: bool


class CustomerPaying(D):
    party_id: str
    method: str


class CustomerLeft(D):
    party_id: str
    happy: bool


# ---- orders ----------------------------------------------------------------------
class OrderPlaced(D):
    order_no: int
    order_id: str
    channel: str
    party_id: str | None = None
    persona: str
    name: str
    items: list[OrderLine]
    note: str | None = None
    note_flags: list[str] = []
    promised_s: float
    priority: int = 0


class OrderAccepted(D):
    order_no: int
    promised_s: float


class OrderRejected(D):
    order_no: int
    reason: str


class OrderProgress(D):
    order_no: int
    state: Literal["queued", "brewing", "almost", "ready"]
    progress: float
    ahead: int


class Batch(D):
    id: str
    order_nos: list[int]


class RailReordered(D):
    order_nos: list[int]
    batches: list[Batch]


class BatchFormed(D):
    batch_id: str
    station: str
    step: str
    order_nos: list[int]
    size: int
    saves_s: float = 0.0  # sim-seconds saved vs running the tasks one by one


class BatchStarted(D):
    batch_id: str
    station: str
    step: str
    order_nos: list[int]
    size: int
    saves_s: float = 0.0  # sim-seconds saved vs running the tasks one by one


class OrderReady(D):
    order_no: int
    ready_s: float


class OrderServed(D):
    order_no: int
    by: Literal["player", "runner", "rider"]


class OrderVoided(D):
    order_no: int
    reason: str


class BagShelved(D):
    order_no: int
    channel: str
    slot: int
    eta_s: float
    quality: float


class RiderAssigned(D):
    order_no: int
    channel: str
    eta_s: float


class RiderArrived(D):
    order_no: int
    channel: str
    slot: int | None = None
    waiting: bool


class RiderPickedUp(D):
    order_no: int
    channel: str
    slot: int | None = None
    quality: float
    rider_wait_s: float


class ReceiptLine(D):
    sku: str
    name: str
    qty: int
    mods: list[str]
    unit_price: float
    amount: float
    replate: bool = False


class ReceiptPrinted(D):
    order_no: int
    lines: list[ReceiptLine]
    subtotal: float
    discount: float
    cgst: float
    sgst: float
    round_off: float
    total: float
    payment: str
    qr: str


class PaymentReceived(D):
    order_no: int
    amount: float
    method: str


class ReviewPosted(D):
    review_id: str
    party_id: str | None = None
    order_no: int
    stars: int
    text: str
    causes: dict[str, float]
    channel: str
    persona: str


# ---- menu / inventory -------------------------------------------------------------
class PriceChanged(D):
    sku: str
    old: float
    new: float
    base: float
    dir: Literal["up", "down"]
    reason_text: str
    by: str


class MenuFeatured(D):
    sku: str
    on: bool = True
    reason: str = ""


class MenuHidden(D):
    sku: str
    reason: str


class MenuRestored(D):
    sku: str
    reason: str = ""


class ReplateListing(D):
    """``replate.listed`` / ``replate.marked_down``: a lot goes on (or deeper into) the Replate menu."""

    listing_id: str
    sku: str
    lot_id: str
    units: float
    made_at_s: float
    use_by_s: float
    discount_pct: float
    price: float


class ReplateSold(D):
    listing_id: str
    order_no: int
    units: int
    price: float


class ReplateRetired(D):
    listing_id: str
    units: float
    outcome: Literal["donated", "wasted", "sold_out"]


class ReplateMode(D):
    mode: str
    previous: str
    by: str


class StockChanged(D):
    key: str
    qty: float
    low: bool


class LotOpened(D):
    key: str
    lot_id: str
    expires_s: float


class LotExpired(D):
    key: str
    lot_id: str
    qty: float


class LotDonated(D):
    key: str
    lot_id: str
    qty: float


class PoLine(D):
    ingredient: str
    qty: float
    packs: int | None = None


class PoCreated(D):
    po_id: str
    supplier: str
    lines: list[PoLine]
    eta_s: float


class PoReceived(D):
    po_id: str
    supplier: str
    lines: list[PoLine]
    short: bool = False


class TaskStarted(D):
    task_id: int
    station: str
    step: str
    staff_id: str
    order_no: int | None = None
    est_s: float


class TaskFinished(D):
    task_id: int
    station: str
    step: str
    staff_id: str
    order_no: int | None = None
    actual_s: float
    remake: bool = False


class PrepStarted(D):
    prep_key: str
    qty: float


class PrepReady(D):
    prep_key: str
    qty: float


class PrepExpired(D):
    prep_key: str
    qty: float


class StaffEvent(D):
    staff_id: str
    detail: str = ""


class EquipmentDown(D):
    equipment: str
    station: str
    until_s: float


class EquipmentUp(D):
    equipment: str
    station: str


class StationRow(D):
    station: str
    util: float  # busy share over the last 15 sim-min, 0..1
    queue: int  # tasks waiting for the station
    in_use: int  # equipment slots in use (staff working there when slots == 0)
    slots: int
    status: Literal["up", "down"]
    down_until_s: float | None = None


class StationLoad(D):
    stations: list[StationRow]


class StaffRow(D):
    staff_id: str
    fatigue: float
    station: str | None = None
    task: str | None = None
    state: Literal["working", "idle", "break", "off", "absent"]
    break_due_s: float | None = None
    break_end_s: float | None = None


class StaffStatus(D):
    staff: list[StaffRow]


# ---- management -------------------------------------------------------------------
class KpiTick(D):
    cash: float
    revenue_today: float
    profit_today: float
    rating: float
    rating_n: int
    load_pct: float
    open_orders: int
    walkouts_today: int


class DecisionMade(D):
    decision_id: str
    type: str
    summary: str
    policy: str
    top_factors: list[dict[str, Any]] = []
    clipped: list[str] = []


class BottleneckChanged(D):
    resource: str
    rho: float
    shadow_price: float = 0.0


class ChaosTriggered(D):
    disruption_id: str
    kind: str
    target: str | None = None
    severity: float
    until_s: float
    source: str


class ChaosResolved(D):
    disruption_id: str
    kind: str
    target: str | None = None


class StrategyChanged(D):
    strategy: str
    previous: str


class PolicyChanged(D):
    policy: str
    previous: str


class ThrottleChanged(D):
    channel: str
    level: str


class InvestmentDelivered(D):
    catalog_key: str
    effect: dict[str, Any]


class ActionApplied(D):
    kind: str
    payload: dict[str, Any] = {}
    ok: bool = True
    detail: str = ""


EVENT_MODELS: dict[str, type[D]] = {
    "clock.tick": ClockTick,
    "weather.changed": WeatherChanged,
    "day.started": DayStarted,
    "day.ended": DayEnded,
    "customer.arrived": CustomerArrived,
    "customer.queued": CustomerQueued,
    "customer.balked": CustomerBalked,
    "customer.ordering": CustomerOrdering,
    "customer.waiting": CustomerWaiting,
    "customer.patience": CustomerPatience,
    "customer.reneged": CustomerReneged,
    "customer.seated": CustomerSeated,
    "customer.eating": CustomerEating,
    "customer.lingering": CustomerLingering,
    "customer.paying": CustomerPaying,
    "customer.left": CustomerLeft,
    "order.placed": OrderPlaced,
    "order.accepted": OrderAccepted,
    "order.rejected": OrderRejected,
    "order.progress": OrderProgress,
    "rail.reordered": RailReordered,
    "batch.formed": BatchFormed,
    "batch.started": BatchStarted,
    "order.ready": OrderReady,
    "order.served": OrderServed,
    "order.voided": OrderVoided,
    "bag.shelved": BagShelved,
    "rider.assigned": RiderAssigned,
    "rider.arrived": RiderArrived,
    "rider.picked_up": RiderPickedUp,
    "receipt.printed": ReceiptPrinted,
    "payment.received": PaymentReceived,
    "review.posted": ReviewPosted,
    "price.changed": PriceChanged,
    "menu.featured": MenuFeatured,
    "menu.hidden": MenuHidden,
    "menu.restored": MenuRestored,
    "replate.listed": ReplateListing,
    "replate.marked_down": ReplateListing,
    "replate.sold": ReplateSold,
    "replate.retired": ReplateRetired,
    "replate.mode": ReplateMode,
    "stock.changed": StockChanged,
    "lot.opened": LotOpened,
    "lot.expired": LotExpired,
    "lot.donated": LotDonated,
    "po.created": PoCreated,
    "po.received": PoReceived,
    "task.started": TaskStarted,
    "task.finished": TaskFinished,
    "prep.started": PrepStarted,
    "prep.ready": PrepReady,
    "prep.expired": PrepExpired,
    "staff.clocked_in": StaffEvent,
    "staff.clocked_out": StaffEvent,
    "staff.break_started": StaffEvent,
    "staff.break_ended": StaffEvent,
    "staff.absent": StaffEvent,
    "staff.late": StaffEvent,
    "equipment.down": EquipmentDown,
    "equipment.up": EquipmentUp,
    "station.load": StationLoad,
    "staff.status": StaffStatus,
    "kpi.tick": KpiTick,
    "decision.made": DecisionMade,
    "bottleneck.changed": BottleneckChanged,
    "chaos.triggered": ChaosTriggered,
    "chaos.resolved": ChaosResolved,
    "strategy.changed": StrategyChanged,
    "policy.changed": PolicyChanged,
    "throttle.changed": ThrottleChanged,
    "investment.delivered": InvestmentDelivered,
    "action.applied": ActionApplied,
}


def _envelope_model(name: str, data_model: type[D]) -> type[BaseModel]:
    cls_name = "Ev_" + name.replace(".", "_")
    return create_model(  # type: ignore[call-overload,no-any-return]
        cls_name,
        __config__=ConfigDict(frozen=True, extra="forbid"),
        seq=(int, ...),
        sim_s=(float, ...),
        t=(str, ...),
        type=(Literal[name], ...),  # type: ignore[valid-type]
        data=(data_model, ...),
    )


ENVELOPES: dict[str, type[BaseModel]] = {k: _envelope_model(k, m) for k, m in EVENT_MODELS.items()}
Event = Annotated[Union[tuple(ENVELOPES.values())], Field(discriminator="type")]  # type: ignore[valid-type]  # noqa: UP007
_event_adapter: TypeAdapter[Any] = TypeAdapter(Event)


def validate_event(rec_type: str, data: dict[str, Any]) -> D:
    """Validate a payload against its schema; raises ``KeyError`` for unknown types."""
    return EVENT_MODELS[rec_type].model_validate(data)


def event_json_schema() -> dict[str, Any]:
    """JSON Schema of the full event union (served at /api/v1/events/schema)."""
    return _event_adapter.json_schema()
