"""Row schemas for LLM-generated synthetic datasets (docs/implementation-spec.md 15.2)."""

from __future__ import annotations

import string
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from brew.config.loader import default_cafe
from brew.domain.enums import CAUSES

CAUSE_KEYS = tuple(CAUSES)
INTENTS = ("allergy", "modifier", "rush", "gift_message", "packaging", "cutlery", "spice_level", "other")
CHANNELS = ("dine_in", "takeaway", "zomato", "swiggy")
DECISION_TYPES = (
    "price_change",
    "feature_item",
    "hide_item",
    "prep_start",
    "strategy_switch",
    "throttle",
    "accept_order",
    "reject_order",
    "batch_hold",
    "reorder",
)
EXPLANATION_SLOTS = (
    "sku", "item", "category", "old", "new", "delta", "pct", "load", "load_pct", "forecast_delta",
    "temp", "stock", "stock_days", "channel", "queue", "hour", "reason", "qty", "prep_item", "supplier",
    "strategy", "rain", "p90", "wait_min", "orders", "level", "ingredient",
)  # fmt: skip
EXPL_FACTORS = (
    "load", "forecast_delta", "temp", "stock", "queue", "hour", "channel", "rain", "p90", "wait_min", "orders",
    "strategy", "reason", "price_index", "shelf_life",
)  # fmt: skip
KNOWN_ROUTES = (
    "GET /cafe", "GET /worlds/{id}", "GET /worlds/{id}/state", "GET /worlds/{id}/menu", "GET /worlds/{id}/orders",
    "GET /worlds/{id}/rail", "GET /worlds/{id}/board", "GET /worlds/{id}/customers", "GET /worlds/{id}/tables",
    "GET /worlds/{id}/inventory", "GET /worlds/{id}/inventory/{key}/lots", "GET /worlds/{id}/fridge",
    "GET /worlds/{id}/shelf", "GET /worlds/{id}/staff", "GET /worlds/{id}/equipment", "GET /worlds/{id}/kpis",
    "GET /worlds/{id}/impact", "GET /worlds/{id}/forecast", "GET /worlds/{id}/decisions", "GET /decisions/{id}/explain",
    "GET /worlds/{id}/bottlenecks", "GET /worlds/{id}/advisor", "POST /worlds/{id}/invest", "GET /worlds/{id}/reviews",
    "GET /worlds/{id}/receipts/{order_no}", "POST /worlds/{id}/control", "POST /worlds/{id}/policy",
    "POST /worlds/{id}/fork", "POST /worlds/{id}/chaos", "POST /worlds/{id}/actions", "POST /arena",
    "GET /arena/{id}", "GET /models", "GET /health", "GET /worlds", "POST /worlds",
)  # fmt: skip
KINDS = (
    "public_holiday",
    "festival",
    "cricket_match",
    "exam_season",
    "payday",
    "marathon",
    "long_weekend",
    "concert",
    "other",
)


def _cafe_sets() -> tuple[set[str], set[str], set[str], set[str]]:
    cfg = default_cafe()
    return (
        {m.sku for m in cfg.menu},
        set(cfg.personas),
        {m.id for m in cfg.modifiers},
        {i.key for i in cfg.ingredients},
    )


class _Row(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=3, max_length=40)


class ReviewRow(_Row):
    persona: str
    channel: Literal["dine_in", "takeaway", "zomato", "swiggy"]
    stars: int = Field(ge=1, le=5)
    causes: dict[str, float]
    skus_mentioned: list[str] = []
    text: str = Field(min_length=8, max_length=280)
    language: Literal["en", "hinglish"]

    @model_validator(mode="after")
    def _check(self) -> ReviewRow:
        skus, personas, _m, _i = _cafe_sets()
        if self.persona not in personas:
            raise ValueError(f"unknown persona {self.persona!r}")
        for k, v in self.causes.items():
            if k not in CAUSE_KEYS:
                raise ValueError(f"unknown cause {k!r}")
            if not 0 <= v <= 1:
                raise ValueError(f"cause weight {k}={v} outside 0..1")
        if sum(self.causes.values()) > 1.5 + 1e-9:
            raise ValueError("cause weights sum > 1.5")
        for s in self.skus_mentioned:
            if s not in skus:
                raise ValueError(f"unknown sku {s!r}")
        return self


class NoteRow(_Row):
    text: str = Field(min_length=3, max_length=120)
    intents: list[str] = Field(min_length=1)
    modifiers: list[str] = []
    allergy: str | None = None
    urgency: float = Field(ge=0, le=1)
    gift_name: str | None = None

    @model_validator(mode="after")
    def _check(self) -> NoteRow:
        _s, _p, mods, _i = _cafe_sets()
        for i in self.intents:
            if i not in INTENTS:
                raise ValueError(f"unknown intent {i!r}")
        for m in self.modifiers:
            if m not in mods:
                raise ValueError(f"unknown modifier {m!r}")
        return self


class CalendarRow(_Row):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    end_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    name: str = Field(min_length=3, max_length=100)
    kind: Literal[
        "public_holiday",
        "festival",
        "cricket_match",
        "exam_season",
        "payday",
        "marathon",
        "long_weekend",
        "concert",
        "other",
    ]
    start_time: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    end_time: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    multipliers: dict[str, dict[str, float]] = {}
    source_note: str = ""

    @model_validator(mode="after")
    def _check(self) -> CalendarRow:
        if not ("2025-01-01" <= self.date <= "2027-12-31"):
            raise ValueError("date outside 2025-01-01..2027-12-31")
        if self.end_date < self.date:
            raise ValueError("end_date before date")
        cfg = default_cafe()
        valid = {
            "persona": set(cfg.personas),
            "channel": {c.key for c in cfg.channels},
            "category": {"coffee", "notcoffee", "bakes", "plates"},
        }
        for dim, d in self.multipliers.items():
            if dim not in valid:
                raise ValueError(f"unknown multiplier dimension {dim!r}")
            for k, v in d.items():
                if k not in valid[dim]:
                    raise ValueError(f"unknown {dim} key {k!r}")
                if not 0.3 <= v <= 3.0:
                    raise ValueError(f"multiplier {dim}.{k}={v} outside 0.3..3.0")
        return self


class ExplanationRow(_Row):
    decision_type: Literal[
        "price_change", "feature_item", "hide_item", "prep_start", "strategy_switch",
        "throttle", "accept_order", "reject_order", "batch_hold", "reorder",
    ]  # fmt: skip
    direction: Literal["up", "down", "none"] | None = None
    factors: list[str] = Field(min_length=1)
    template: str = Field(min_length=10, max_length=300)
    tone: Literal["warm", "crisp"]

    @field_validator("template")
    @classmethod
    def _slots(cls, v: str) -> str:
        n = 0
        for _lit, name, _spec, _conv in string.Formatter().parse(v):
            if name is not None:
                n += 1
                if name not in EXPLANATION_SLOTS:
                    raise ValueError(f"slot {{{name}}} not in allowed list")
        if n < 2:
            raise ValueError("template must use at least two {slots}")
        return v

    @field_validator("factors")
    @classmethod
    def _factors(cls, v: list[str]) -> list[str]:
        for f in v:
            if f not in EXPL_FACTORS:
                raise ValueError(f"factor {f!r} not allowed")
        return v


class NameRow(_Row):
    name: str = Field(min_length=2, max_length=24)
    short: str = Field(pattern=r"^[A-Z]{1,5}$")
    region: str | None = None
    gender: Literal["f", "m", "n", "unspecified"] | None = None


class AskRow(_Row):
    question: str = Field(min_length=8, max_length=300)
    intent: str
    endpoints: list[str] = Field(min_length=1)
    params: dict = {}
    answer_sketch: str = Field(min_length=10)

    @field_validator("endpoints")
    @classmethod
    def _eps(cls, v: list[str]) -> list[str]:
        for e in v:
            if e not in KNOWN_ROUTES:
                raise ValueError(f"endpoint {e!r} is not an API route (see the endpoint table)")
        return v


class SupplierRow(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str | None = None
    ingredient: str
    supplier_name: str
    pack_size: float = Field(gt=0)
    pack_uom: str
    price_inr: float = Field(gt=0)
    lead_time_h_mean: float = Field(gt=0)
    lead_time_h_sd: float = Field(ge=0)
    min_order_packs: int = Field(ge=1)
    is_local: bool
    distance_km: float = Field(ge=0)
    notes: str = ""

    @field_validator("ingredient")
    @classmethod
    def _ing(cls, v: str) -> str:
        if v not in _cafe_sets()[3]:
            raise ValueError(f"unknown ingredient {v!r}")
        return v


SCHEMAS: dict[str, type[BaseModel]] = {
    "reviews": ReviewRow,
    "order_notes": NoteRow,
    "calendar_bengaluru": CalendarRow,
    "explanations": ExplanationRow,
    "customer_names": NameRow,
    "ask_brew_eval": AskRow,
    "supplier_catalog": SupplierRow,
}
MIN_ROWS = {
    "reviews": 3000,
    "order_notes": 1500,
    "calendar_bengaluru": 150,
    "explanations": 400,
    "customer_names": 600,
    "ask_brew_eval": 300,
    "supplier_catalog": 50,
}
