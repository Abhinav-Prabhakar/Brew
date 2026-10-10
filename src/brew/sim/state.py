"""Mutable simulation state records (slots dataclasses; picklable for fork)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# task states
T_WAIT, T_READY, T_RUN, T_DONE, T_CANCEL = 0, 1, 2, 3, 4


@dataclass(slots=True, eq=False)
class Task:
    """One staffed unit of work. Policies see tasks read-only (TaskView)."""

    id: int
    kind: str  # step | register | prep | clean | wash | bag
    name: str
    station: str
    order_no: int
    duration_mean: float
    duration_sd: float
    attention: float
    uses_slot: bool = False
    batchable: bool = False
    max_batch: int = 1
    batch_factor: float = 0.0
    deps_left: int = 0
    children: list[Task] = field(default_factory=list)
    state: int = T_WAIT
    ready_s: float = 0.0
    start_s: float = 0.0
    end_s: float = 0.0
    staff: str = ""
    batch_id: int = 0
    extra_s: float = 0.0
    sku: str = ""
    unit: Unit | None = None
    ref: Any = None
    channel: str = ""
    persona: str = ""
    due_s: float = 0.0
    placed_s: float = 0.0
    bumped: bool = False
    wait_reason: str = ""
    est_s: float = 0.0
    remake: bool = False
    batch_n: int = 1
    slot_eq: int = -1


@dataclass(slots=True, eq=False)
class Unit:
    """One physical item (a line of qty 2 = two units)."""

    sku: str
    mods: tuple[str, ...]
    line: int
    order_no: int
    tasks: list[Task] = field(default_factory=list)
    tasks_left: int = 0
    ready_s: float = 0.0
    quality: float = 1.0
    ing_quality: float = 1.0
    remakes: int = 0
    cost: float = 0.0
    packaging_cost: float = 0.0
    done: bool = False
    started: bool = False
    ware: str = ""
    premade: bool = False  # served from make-ahead stock (kitchen steps skipped)
    rp_price: float = 0.0  # replate listing price when the unit was ordered off the replate menu
    lot_id: str = ""  # tracked (replate-able) lot the unit was drawn from


@dataclass(slots=True, eq=False)
class Order:
    order_no: int
    id: str
    channel: str
    persona: str
    name: str
    party_id: str | None
    lines: list[dict[str, Any]]
    units: list[Unit]
    note: str | None
    note_flags: list[str]
    placed_s: float
    promised_s: float
    priority: int = 0
    bumped: bool = False
    state: str = "queued"  # queued|brewing|almost|ready|served|voided|pending
    progress_key: int = -1
    tasks_total: int = 0
    tasks_done: int = 0
    tasks_started: bool = False
    ready_s: float = 0.0
    served_s: float = 0.0
    served_by: str = ""
    subtotal: float = 0.0
    discount: float = 0.0
    total: float = 0.0
    ref_total: float = 0.0
    paid: bool = False
    pay_method: str = ""
    receipt: dict[str, Any] | None = None
    quality: float = 1.0
    bag_task: Task | None = None
    accepted: bool = True
    rider: dict[str, Any] | None = None
    shelf_slot: int = -1
    cogs: float = 0.0
    pack_cost: float = 0.0
    remakes: int = 0
    reviewed: bool = False
    ti: int = 0  # telemetry index
    errors: int = 0
    accept_handle: int | None = None
    cook_at_s: float = 0.0  # delivery, just-in-time: kitchen work is held until this sim time (0 = not held)
    no_table: bool = False
    is_refill: bool = False
    delivered_s: float = 0.0
    items_n: int = 0
    unhappy: bool = False


@dataclass(slots=True, eq=False)
class Party:
    id: str
    cust_id: str
    idx: int
    persona: str
    size: int
    channel: str
    name: str
    arrive_s: float
    seeds: list[int]
    laptop: bool
    state: str = "arriving"
    patience_total: float = 0.0
    patience_left: float = 0.0
    patience_rate: float = 0.0
    patience_mark: float = 0.0
    patience_handle: int | None = None
    thresholds: int = 0
    order_nos: list[int] = field(default_factory=list)
    table_ids: list[str] = field(default_factory=list)
    unhappy: bool = False
    dwell_s: float = 0.0
    refills_left: int = 0
    refill_u: list[float] = field(default_factory=list)
    reg_idx: int = -1
    paid_orders: int = 0
    seated_s: float = 0.0
    queue_wait_s: float = 0.0
    queued_s: float = 0.0
    wait_start_s: float = 0.0
    seat_handle: int | None = None
    left: bool = False
    want_table: bool = False
    ordered_s: float = 0.0
    reg_task: Task | None = None
    eat_end_s: float = 0.0


@dataclass(slots=True, eq=False)
class StaffState:
    key: str
    name: str
    role: str
    wage: float
    skills: dict[str, float]
    speed: float
    error_rate: float
    fatigue_rate: float
    recovery_rate: float
    shift_start_s: float = 0.0
    shift_end_s: float = 0.0
    break_min: float = 30.0
    break_at_s: float = 0.0
    break_end_s: float = 0.0
    present: bool = False
    on_break: bool = False
    absent: bool = False
    break_pending: bool = False
    break_done: bool = False
    attention_used: float = 0.0
    active: list[Task] = field(default_factory=list)
    fatigue: float = 0.0
    fatigue_mark: float = 0.0
    clock_in_s: float = 0.0
    worked_s: float = 0.0
    busy_s: float = 0.0
    overload_s: float = 0.0
    exp_days: float = 30.0
    task_name: str = ""
    station: str = ""
    shift_end_pending: bool = False
    tasks_done: int = 0


@dataclass(slots=True, eq=False)
class EquipState:
    idx: int
    key: str
    station: str
    slots: int
    kw_active: float
    kw_idle: float
    mtbf_h: float
    mttr_h: float
    maintenance_per_day: float
    capex: float
    up: bool = True
    slots_used: int = 0
    active_s: float = 0.0
    down_until: float = 0.0
    condition: float = 1.0
    down_s: float = 0.0
    last_change_s: float = 0.0


@dataclass(slots=True, eq=False)
class StationState:
    key: str
    max_staff: int
    eq: list[int] = field(default_factory=list)  # indices into world.equip
    staff_active: dict[str, int] = field(default_factory=dict)
    busy_s: float = 0.0
    queue_wait_s: float = 0.0
    tasks_done: int = 0
    ready_count: int = 0
    util_ewma: float = 0.0
    active_att: float = 0.0


@dataclass(slots=True, eq=False)
class Table:
    id: str
    seats: int
    state: str = "free"  # free | occupied | dirty | cleaning
    occ: list[str | None] = field(default_factory=list)
    merged: str | None = None
    dirty_ware: dict[str, int] = field(default_factory=dict)
    party_ids: list[str] = field(default_factory=list)
    turns: int = 0
    occupied_s: float = 0.0
    since_s: float = 0.0


@dataclass(slots=True, eq=False)
class MenuState:
    sku: str
    price: float
    base: float
    ref_price: float
    featured: bool = False
    hidden: str | None = None  # reason text when hidden
    hidden_kind: str = ""  # "stock" | "owner" | "strategy"
    last_change_s: float = -1e9
    chip_dir: str = ""
    chip_text: str = ""
    drivers: list[dict[str, Any]] = field(default_factory=list)  # why the price moved (short labelled factors)
    decision_id: str | None = None
    promo: bool = False
    pre_promo_price: float = 0.0
    price_sum: float = 0.0
    price_n: float = 0.0
    sold_today: int = 0


@dataclass(slots=True, eq=False)
class Lot:
    lot_id: str
    key: str
    qty0: float
    qty: float
    unit_cost: float
    received_s: float
    expires_s: float
    opened_s: float | None = None
    quality: float = 1.0


@dataclass(slots=True, eq=False)
class Regular:
    idx: int
    name: str
    seed: int
    sat_ema: float = 0.7
    bad_streak: int = 0
    churned: bool = False
    visits: int = 0


@dataclass(slots=True, eq=False)
class Disruption:
    id: str
    kind: str
    target: str | None
    severity: float
    start_s: float
    end_s: float
    source: str
    active: bool = False
    resolved: bool = False
    start_h: int | None = None
    end_h: int | None = None
    meta: dict[str, Any] = field(default_factory=dict)
