"""Pydantic schemas for the YAML seed data (technical.md section 5). All frozen."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

CATS = ("coffee", "notcoffee", "bakes", "plates")
CHANNELS = ("dine_in", "takeaway", "zomato", "swiggy")


class _M(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class Params(_M):
    balk_a: float = 0.6
    balk_b: float = 1.2
    queue_patience_rate: float = 0.6
    renege_prob: float = 0.55
    review_noise: float = 0.35
    choice_gamma_featured: float = 0.35
    choice_lambda_loss: float = 1.0
    choice_delta_weather: float = 0.4
    outside_target: float = 0.05
    note_prob: float = 0.12
    refill_period_s: float = 2700
    refill_prob: float = 0.35
    lambda_max_factor: float = 2.0
    day_noise_sigma: float = 0.1
    ref_price_ema_days: float = 7
    pause_rank_decay: float = 0.97
    pause_rank_recovery: float = 0.01
    fatigue_speed_k: float = 0.25
    error_load_k: float = 2.0


class Reputation(_M):
    rating: float
    n: float


class CafeProfile(_M):
    key: str
    name: str
    area: str
    city: str
    tz: str = "Asia/Kolkata"
    currency: str = "INR"
    start_date: str = "2026-10-03"
    open: str = "08:00"
    close: str = "22:00"
    gst_rate: float = 0.05
    cgst_rate: float = 0.025
    sgst_rate: float = 0.025
    cash_start: float = 18450
    order_no_start: int = 141
    rent_per_day: float = 6000
    energy_rate_per_kwh: float = 9.0
    co2e_kg_per_kwh: float = 0.7
    auto_serve_delay_s: float = 20
    cleaning_s: float = 90
    register_s: tuple[float, float] = (32, 8)
    payment_s: float = 40
    seat_walk_s: float = 15
    seat_wait_max_s: float = 180
    shelf_slots: int = 6
    acceptance_timeout_s: float = 90
    manager_tick_s: float = 900
    bag_s: float = 25
    depreciation_life_days: float = 1500
    initial_reputation: dict[str, Reputation]
    reputation_prior: dict[str, float]
    regulars_pool: int = 40
    dish_pool: dict[str, int]
    dishwasher: dict[str, float]
    params: Params = Params()

    @property
    def open_s(self) -> int:
        h, m = self.open.split(":")
        return int(h) * 3600 + int(m) * 60

    @property
    def close_s(self) -> int:
        h, m = self.close.split(":")
        return int(h) * 3600 + int(m) * 60


class ReplateItem(_M):
    """Per-SKU Replate (rescue menu) block in ``menu.yaml``."""

    eligible: bool = False
    stock_key: str | None = None  # inventory finished-goods key backing the SKU (bakes); None = make-ahead plate
    premake_hold_s: float = 0  # safe hold of a pre-made unit (seconds); stock-backed SKUs use the lot shelf life
    min_quality: float = 0.6
    donate: bool = False  # sealed bakery: retire as donation instead of waste


class MenuItem(_M):
    sku: str
    name: str
    cat: Literal["coffee", "notcoffee", "bakes", "plates"]
    base_price: float
    min_price: float
    max_price: float
    staple: bool = False
    station: str
    deliverable: bool = True
    hold_time_s: float = 300
    quality_half_life_s: float = 600
    temp: Literal["hot", "cold", "ambient"] = "hot"
    allergens: tuple[str, ...] = ()
    veg: bool = True
    vegan: bool = False
    co2e_g: float = 0
    popularity_prior: float = 1.0
    tags: tuple[str, ...] = ()
    desc: str = ""
    replate: ReplateItem = ReplateItem()

    @model_validator(mode="after")
    def _bounds(self) -> MenuItem:
        if not (self.min_price <= self.base_price <= self.max_price):
            raise ValueError(f"{self.sku}: base price outside [min,max]")
        return self


class RecipeDelta(_M):
    replace: dict[str, str] | None = None
    add: dict[str, Any] | None = None
    remove: str | None = None
    scale: dict[str, Any] | None = None


class Modifier(_M):
    id: str
    label: str
    long: str
    price_delta: float = 0
    applies_to_tags: tuple[str, ...] = ()
    applies_to: tuple[str, ...] = ()
    negation: bool = False
    allergy: bool = False
    recipe_delta: tuple[RecipeDelta, ...] = ()
    extra_prep_s: float = 0
    overlay_icon: str = ""
    pick_prob: dict[str, float] = {}


class Step(_M):
    name: str
    station: str
    duration: tuple[float, float]
    attention: float = Field(1.0, gt=0, le=1)
    batchable: bool = False
    max_batch: int = 1
    batch_factor: float = 0.0
    uses_slot: bool = False
    depends_on: tuple[str, ...] | None = None


class Component(_M):
    ingredient: str
    qty: float
    returnable: bool = False
    when: Literal["always", "dine_in", "carry"] = "always"


class Recipe(_M):
    pack: str | None = None
    components: tuple[Component, ...]
    steps: tuple[Step, ...]


class RecipeBook(_M):
    packaging: dict[str, tuple[Component, ...]]
    recipes: dict[str, Recipe]


class Ingredient(_M):
    key: str
    name: str
    category: str
    base_uom: Literal["g", "ml", "pc"]
    zone: Literal["ambient", "chilled", "frozen"] = "ambient"
    shelf_life_sealed_h: float
    shelf_life_opened_h: float
    perishability: Literal["A", "B", "C", "D"] = "C"
    co2e_kg_per_kg: float = 1.0
    is_packaging: bool = False
    finished_good: bool = False
    par: float
    reorder_point: float
    safety_stock: float
    unit_cost: float
    initial_qty: float
    unit_weight_g: float = 1.0


class PrepStep(_M):
    name: str
    station: str
    duration: tuple[float, float]
    attention: float = Field(1.0, gt=0, le=1)
    uses_slot: bool = False


class PrepItem(_M):
    key: str
    name: str
    base_uom: Literal["g", "ml", "pc"]
    zone: Literal["ambient", "chilled", "frozen"] = "chilled"
    batch_size: float
    lead_time_min: float
    hold_time_min: float
    quality_half_life_min: float
    kappa_class: str = ""
    co2e_kg_per_kg: float = 1.0
    par: float
    reorder_point: float
    initial_qty: float
    unit_weight_g: float = 1.0
    finished_good: bool = False
    components: tuple[Component, ...]
    steps: tuple[PrepStep, ...]


class SupplierItem(_M):
    ingredient: str
    pack_size: float
    pack_uom: str
    price: float
    moq_packs: int = 1


class Supplier(_M):
    key: str
    name: str
    items: tuple[SupplierItem, ...]
    lead_time_h: tuple[float, float]
    on_time_rate: float = 0.95
    fill_rate: float = 0.98
    delivery_days: tuple[int, ...] = (0, 1, 2, 3, 4, 5, 6)
    cutoff: str = "16:00"
    is_local: bool = True
    distance_km: float = 10
    standing_times: tuple[str, ...] = ()


class StaffMember(_M):
    key: str
    name: str
    role: str
    wage_per_h: float
    skills: dict[str, float]
    speed: float = 1.0
    error_rate: float = 0.02
    fatigue_rate: float = 0.012
    recovery_rate: float = 0.03
    shift: tuple[str, str]
    break_min: float = 30
    break_at: str = "13:00"


class EquipmentType(_M):
    key: str
    station: str
    slots: int
    warmup_s: float = 0
    kw_active: float = 0
    kw_idle: float = 0
    mtbf_h: float = 1000
    mttr_h: float = 2
    capex: float = 0
    maintenance_per_day: float = 0
    footprint_m2: float = 0


class Station(_M):
    key: str
    max_staff: int
    equipment: tuple[str, ...]
    canonical: bool = True


class Table(_M):
    id: str
    seats: int = 2


class TablesConfig(_M):
    tables: tuple[Table, ...]
    combinable: tuple[tuple[str, str], ...] = ()
    cleaning_s: float = 90


class Channel(_M):
    key: str
    name: str
    kind: Literal["offline", "aggregator"]
    commission: float = 0
    packaging_cost: float = 0
    gateway_fee: float = 0
    acceptance_timeout_s: float = 0
    throttle: bool = False
    label: str = ""
    share: float = 1.0
    enabled: bool = True


class Persona(_M):
    key: str = ""
    name: str
    icon: str
    arrivals_scale: float = 1.0
    weekend_scale: float = 1.0
    arrivals: dict[str, dict[str, float]]
    party_size: dict[int, float]
    channels: dict[str, float]
    price_beta: float
    patience_s: tuple[float, float]
    dwell_min: tuple[float, float]
    laptop_prob: float = 0.0
    basket: dict[str, Any]
    balk_q0: float = 5
    affinity: dict[str, float] = {}
    review_prob: float = 0.05
    negativity_bias: float = 1.0


class CatalogItem(_M):
    key: str
    name: str
    capex: float
    opex_per_day: float = 0
    lead_time_h: float = 24
    effect: dict[str, Any]


class CalendarEvent(_M):
    id: str
    date: str
    end_date: str
    name: str
    kind: str = "other"
    start_time: str | None = None
    end_time: str | None = None
    multipliers: dict[str, dict[str, float]] = {}
    source_note: str = ""


class Ladder(_M):
    """Markdown ladder: ``(frac_left_threshold, discount_pct)`` rungs plus a final time-based rung."""

    rungs: tuple[tuple[float, float], ...]
    last_s: float = 2700
    last_pct: float = 70


class ReplateConfig(_M):
    """Replate (rescue menu) parameters, ``configs/cafe/replate.yaml``."""

    modes: tuple[str, ...] = ("off", "gentle", "standard", "aggressive")
    ladders: dict[str, Ladder] = {}
    floor_cost_factor: float = 0.5
    round_to: float = 5.0
    phi: float = 1.2  # utility penalty per unit of lost quality
    noise_tau: float = 0.35  # scale of the extra CRN Gumbel draw on the replate alternative
    affinity: dict[str, float] = {}
    min_ladder_gap_pct: float = 1.0
    max_premake_job: int = 8
    prep_backed: dict[str, str] = {}  # prepped intermediate / perishable key -> dish SKU listed from it
    backed_frac: float = 0.5  # a prep-backed lot becomes listable once its remaining hold fraction is <= this
    backed_raw_s: float = 10800.0  # ... a raw perishable once it has less than this many seconds left
    surplus_only: bool = True  # ladder modes list only units beyond the full-price demand expected before use-by
    surplus_z: float = 0.5  # safety margin (in sqrt-units) added to that expected demand
    choice_alt: bool = True  # listings are extra alternatives in the customer's choice set (backend.md 3.11)
    addon_enabled: bool = True  # counter impulse add-on: after choosing, a customer may add one listed rescue unit
    addon_beta: float = 2.4  # impulse sensitivity to the discount depth d = -ln(listing price / reference price)
    addon_kappa: float = 2.75  # utility of "no add-on" (higher = fewer add-ons)


class Combo(_M):
    """A two-item meal combo priced off its components' live prices (backend.md 3.12)."""

    id: str
    name: str
    skus: tuple[str, ...]
    discount_pct: float = Field(gt=0, lt=50)
    tagline: str = ""


class CombosConfig(_M):
    """Meal combos, ``configs/cafe/combos.yaml``."""

    enabled: bool = True
    round_to: float = 5.0
    upsell_base: float = 0.08  # P(add the missing half) at 0 % saving
    upsell_per_pct: float = 0.012  # + per % saving
    upsell_max: float = 0.32  # cap before the persona factor
    persona_factor: dict[str, float] = {}
    combos: tuple[Combo, ...] = ()


class CafeConfig(_M):
    cafe: CafeProfile
    menu: tuple[MenuItem, ...]
    modifiers: tuple[Modifier, ...]
    incompatible: tuple[tuple[str, str], ...]
    recipes: RecipeBook
    ingredients: tuple[Ingredient, ...]
    prep_items: tuple[PrepItem, ...]
    suppliers: tuple[Supplier, ...]
    staff: tuple[StaffMember, ...]
    equipment: tuple[EquipmentType, ...]
    stations: tuple[Station, ...]
    tables: TablesConfig
    channels: tuple[Channel, ...]
    personas: dict[str, Persona]
    catalog: tuple[CatalogItem, ...]
    calendar_fallback: tuple[CalendarEvent, ...]
    replate: ReplateConfig = ReplateConfig()
    combos: CombosConfig = CombosConfig()

    # --- convenience lookups (computed lazily, cached outside the frozen model) ---
    def index(self) -> ConfigIndex:
        return ConfigIndex.of(self)


class ConfigIndex:
    """Dict lookups over a CafeConfig. Cached per config object id."""

    _cache: dict[int, ConfigIndex] = {}

    def __init__(self, cfg: CafeConfig) -> None:
        self.cfg = cfg
        self.menu = {m.sku: m for m in cfg.menu}
        self.skus = [m.sku for m in cfg.menu]
        self.mod = {m.id: m for m in cfg.modifiers}
        self.ingredient = {i.key: i for i in cfg.ingredients}
        self.prep = {p.key: p for p in cfg.prep_items}
        self.supplier = {s.key: s for s in cfg.suppliers}
        self.staff = {s.key: s for s in cfg.staff}
        self.equipment = {e.key: e for e in cfg.equipment}
        self.station = {s.key: s for s in cfg.stations}
        self.channel = {c.key: c for c in cfg.channels}
        self.table = {t.id: t for t in cfg.tables.tables}
        self.catalog = {c.key: c for c in cfg.catalog}
        self.incompatible = {frozenset(p) for p in cfg.incompatible}

    @classmethod
    def of(cls, cfg: CafeConfig) -> ConfigIndex:
        k = id(cfg)
        ix = cls._cache.get(k)
        if ix is None or ix.cfg is not cfg:
            ix = cls(cfg)
            cls._cache[k] = ix
        return ix


class WeatherSpec(_M):
    profile: str = "default"
    initial: str = "partly"
    temp_offset: float = 0.0
    forced: tuple[dict[str, Any], ...] = ()


class DemandSpec(_M):
    global_mult: float = 1.0
    persona_mult: dict[str, float] = {}
    channel_mult: dict[str, float] = {}
    category_mult: dict[str, float] = {}
    windows: tuple[dict[str, Any], ...] = ()


class DisruptionSpec(_M):
    kind: str
    target: str | None = None
    start: str = "08:00"
    end: str = "10:00"
    day: int = 0
    severity: float = 1.0


class ScenarioConfig(_M):
    key: str
    name: str = ""
    description: str = ""
    start_date: str
    weather: WeatherSpec = WeatherSpec()
    demand: DemandSpec = DemandSpec()
    disruptions: tuple[DisruptionSpec, ...] = ()
    random_chaos: dict[str, Any] = {}


class Preset(_M):
    w_late: float = 0.0
    w_age: float = 1.0
    w_channel: dict[str, float] = {}
    w_persona: dict[str, float] = {}
    w_batch: float = 0.0
    w_bump: float = 1000.0
    w_short: float = 0.0


class ManualStrategy(_M):
    preset: str | None = None
    hide: tuple[str, ...] = ()
    drink_discount_pct: float = 0
    label: str = ""
    channel_boost: dict[str, float] = {}
    arrival_mult: float = 1.0


class StrategiesConfig(_M):
    presets: dict[str, Preset]
    manual: dict[str, ManualStrategy]


class CharterConfig(_M):
    price_grid: float = 5
    max_step_frac: float = 0.10
    cooldown_s: float = 7200
    staples_no_increase: bool = True
    max_featured: int = 2
    promotion_decrease_only: bool = True


class PoliciesConfig(_M):
    strategies: StrategiesConfig
    charter: CharterConfig
    params: dict[str, dict[str, Any]]
