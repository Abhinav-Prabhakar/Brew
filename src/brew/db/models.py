"""SQLAlchemy 2.0 models (technical.md 10.6). Portable types only: String ids, JSON, Numeric, Float."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Index, Integer, Numeric, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    type_annotation_map = {dict[str, Any]: JSON, list[Any]: JSON}


def _id() -> Mapped[str]:
    return mapped_column(String(36), primary_key=True)


class Cafe(Base):
    __tablename__ = "cafe"
    id: Mapped[str] = _id()
    key: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(80))
    area: Mapped[str] = mapped_column(String(80))
    city: Mapped[str] = mapped_column(String(80))
    tz: Mapped[str] = mapped_column(String(40))
    currency: Mapped[str] = mapped_column(String(3))
    config: Mapped[dict[str, Any]] = mapped_column(JSON)


class Scenario(Base):
    __tablename__ = "scenario"
    id: Mapped[str] = _id()
    key: Mapped[str] = mapped_column(String(60), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    config: Mapped[dict[str, Any]] = mapped_column(JSON)


class Policy(Base):
    __tablename__ = "policy"
    id: Mapped[str] = _id()
    code: Mapped[str] = mapped_column(String(4), unique=True)
    name: Mapped[str] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(20), default="available")
    config: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class Channel(Base):
    __tablename__ = "channel"
    id: Mapped[str] = _id()
    cafe_id: Mapped[str] = mapped_column(ForeignKey("cafe.id"))
    key: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(60))
    kind: Mapped[str] = mapped_column(String(20))
    commission: Mapped[float] = mapped_column(Numeric(6, 4))


class MenuItem(Base):
    __tablename__ = "menu_item"
    id: Mapped[str] = _id()
    cafe_id: Mapped[str] = mapped_column(ForeignKey("cafe.id"))
    sku: Mapped[str] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(80))
    cat: Mapped[str] = mapped_column(String(20))
    base_price: Mapped[float] = mapped_column(Numeric(12, 2))
    min_price: Mapped[float] = mapped_column(Numeric(12, 2))
    max_price: Mapped[float] = mapped_column(Numeric(12, 2))
    staple: Mapped[bool] = mapped_column(default=False)
    attrs: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    __table_args__ = (Index("ix_menu_item_sku", "cafe_id", "sku", unique=True),)


class World(Base):
    __tablename__ = "world"
    id: Mapped[str] = _id()
    cafe_id: Mapped[str | None] = mapped_column(ForeignKey("cafe.id"), nullable=True)
    kind: Mapped[str] = mapped_column(String(20))  # live | demo | counterfactual | arena | train
    scenario: Mapped[str] = mapped_column(String(60))
    policy: Mapped[str] = mapped_column(String(4))
    seed: Mapped[int] = mapped_column(Integer)
    parent_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    start_date: Mapped[str] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(20), default="paused")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    params: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class Order(Base):
    __tablename__ = "order"
    id: Mapped[str] = _id()
    world_id: Mapped[str] = mapped_column(ForeignKey("world.id"), index=True)
    order_no: Mapped[int] = mapped_column(Integer)
    channel: Mapped[str] = mapped_column(String(20))
    persona: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(40))
    party_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="placed")
    note: Mapped[str | None] = mapped_column(String(200), nullable=True)
    placed_s: Mapped[float] = mapped_column(Float)
    promised_s: Mapped[float] = mapped_column(Float)
    ready_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    served_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    total: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    payment: Mapped[str | None] = mapped_column(String(20), nullable=True)
    reject_reason: Mapped[str | None] = mapped_column(String(40), nullable=True)
    __table_args__ = (Index("ix_order_world_no", "world_id", "order_no", unique=True),)


class OrderItem(Base):
    __tablename__ = "order_item"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    world_id: Mapped[str] = mapped_column(String(36), index=True)
    order_id: Mapped[str] = mapped_column(ForeignKey("order.id"), index=True)
    sku: Mapped[str] = mapped_column(String(40))
    qty: Mapped[int] = mapped_column(Integer)
    mods: Mapped[list[Any]] = mapped_column(JSON, default=list)
    unit_price: Mapped[float] = mapped_column(Numeric(12, 2))


class Review(Base):
    __tablename__ = "review"
    id: Mapped[str] = _id()
    world_id: Mapped[str] = mapped_column(ForeignKey("world.id"), index=True)
    order_no: Mapped[int] = mapped_column(Integer)
    party_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    stars: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    causes: Mapped[dict[str, Any]] = mapped_column(JSON)
    channel: Mapped[str] = mapped_column(String(20))
    persona: Mapped[str] = mapped_column(String(20))
    sim_s: Mapped[float] = mapped_column(Float)


class PriceHistory(Base):
    __tablename__ = "price_history"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    world_id: Mapped[str] = mapped_column(ForeignKey("world.id"), index=True)
    sku: Mapped[str] = mapped_column(String(40))
    old: Mapped[float] = mapped_column(Numeric(12, 2))
    new: Mapped[float] = mapped_column(Numeric(12, 2))
    base: Mapped[float] = mapped_column(Numeric(12, 2))
    by: Mapped[str] = mapped_column(String(20))
    reason: Mapped[str] = mapped_column(String(200), default="")
    sim_s: Mapped[float] = mapped_column(Float)


class MenuIntervention(Base):
    __tablename__ = "menu_intervention"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    world_id: Mapped[str] = mapped_column(ForeignKey("world.id"), index=True)
    sku: Mapped[str] = mapped_column(String(40))
    kind: Mapped[str] = mapped_column(String(20))  # featured | unfeatured | hidden | restored
    reason: Mapped[str] = mapped_column(String(200), default="")
    sim_s: Mapped[float] = mapped_column(Float)


class PolicyDecision(Base):
    __tablename__ = "policy_decision"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    world_id: Mapped[str] = mapped_column(ForeignKey("world.id"), index=True)
    policy: Mapped[str] = mapped_column(String(20))
    type: Mapped[str] = mapped_column(String(30))
    summary: Mapped[str] = mapped_column(Text)
    top_factors: Mapped[list[Any]] = mapped_column(JSON, default=list)
    sim_s: Mapped[float] = mapped_column(Float)


class Disruption(Base):
    __tablename__ = "disruption"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    world_id: Mapped[str] = mapped_column(ForeignKey("world.id"), index=True)
    kind: Mapped[str] = mapped_column(String(30))
    target: Mapped[str | None] = mapped_column(String(40), nullable=True)
    severity: Mapped[float] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(20))
    start_s: Mapped[float] = mapped_column(Float)
    end_s: Mapped[float] = mapped_column(Float)
    resolved: Mapped[bool] = mapped_column(default=False)


class DailyKpi(Base):
    __tablename__ = "daily_kpi"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    world_id: Mapped[str] = mapped_column(ForeignKey("world.id"), index=True)
    day: Mapped[int] = mapped_column(Integer)
    revenue: Mapped[float] = mapped_column(Numeric(12, 2))
    net_profit: Mapped[float] = mapped_column(Numeric(12, 2))
    orders: Mapped[int] = mapped_column(Integer)
    rating: Mapped[float] = mapped_column(Float)
    summary: Mapped[dict[str, Any]] = mapped_column(JSON)
    __table_args__ = (Index("ix_daily_kpi_world_day", "world_id", "day", unique=True),)


class Investment(Base):
    __tablename__ = "investment"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    world_id: Mapped[str] = mapped_column(ForeignKey("world.id"), index=True)
    catalog_key: Mapped[str] = mapped_column(String(40))
    effect: Mapped[dict[str, Any]] = mapped_column(JSON)
    sim_s: Mapped[float] = mapped_column(Float)


class ModelRegistry(Base):
    __tablename__ = "model_registry"
    id: Mapped[str] = _id()
    kind: Mapped[str] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(80))
    version: Mapped[str] = mapped_column(String(40))
    path: Mapped[str] = mapped_column(String(300))
    metrics: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    params: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    git_sha: Mapped[str] = mapped_column(String(40), default="")
    champion: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Evaluation(Base):
    __tablename__ = "evaluation"
    id: Mapped[str] = _id()
    scenario: Mapped[str] = mapped_column(String(60))
    policies: Mapped[list[Any]] = mapped_column(JSON)
    seeds: Mapped[list[Any]] = mapped_column(JSON)
    days: Mapped[int] = mapped_column(Integer)
    results: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Counterfactual(Base):
    __tablename__ = "counterfactual"
    id: Mapped[str] = _id()
    world_id: Mapped[str] = mapped_column(ForeignKey("world.id"), index=True)
    catalog_key: Mapped[str] = mapped_column(String(40))
    seeds: Mapped[int] = mapped_column(Integer)
    days: Mapped[int] = mapped_column(Integer)
    result: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class TrainingRun(Base):
    __tablename__ = "training_run"
    id: Mapped[str] = _id()
    stage: Mapped[str] = mapped_column(String(40))
    config: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    metrics: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    git_sha: Mapped[str] = mapped_column(String(40), default="")
    status: Mapped[str] = mapped_column(String(20), default="queued")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class SimEvent(Base):
    __tablename__ = "sim_event"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    world_id: Mapped[str] = mapped_column(String(36))
    seq: Mapped[int] = mapped_column(Integer)
    sim_s: Mapped[float] = mapped_column(Float)
    type: Mapped[str] = mapped_column(String(40))
    data: Mapped[dict[str, Any]] = mapped_column(JSON)
    __table_args__ = (Index("ix_sim_event_world_seq", "world_id", "seq"),)
