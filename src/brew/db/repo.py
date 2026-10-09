"""Repository helpers: reference-data seeding and world rows."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from brew.config.loader import default_cafe, default_policies, list_scenarios, load_scenario
from brew.domain.ids import uuid7

from . import models as m
from .session import create_all, make_sync_engine, sync_session_factory


def _uid(seed: int) -> str:
    return uuid7(1_700_000_000_000 + seed, seed * 7919, seed * 104729)


def seed_reference_data(url: str | None = None) -> dict[str, int]:
    """Create tables (if needed) and idempotently insert cafe, channels, menu, scenarios, policies."""
    eng = make_sync_engine(url)
    create_all(eng)
    cfg = default_cafe()
    pol = default_policies()
    counts = {"cafe": 0, "channel": 0, "menu_item": 0, "scenario": 0, "policy": 0}
    with sync_session_factory(eng)() as s:
        cafe = s.scalar(select(m.Cafe).where(m.Cafe.key == cfg.cafe.key))
        if cafe is None:
            cafe = m.Cafe(
                id=_uid(1), key=cfg.cafe.key, name=cfg.cafe.name, area=cfg.cafe.area, city=cfg.cafe.city,
                tz=cfg.cafe.tz, currency=cfg.cafe.currency, config=cfg.cafe.model_dump(mode="json"),
            )  # fmt: skip
            s.add(cafe)
            s.flush()
            counts["cafe"] += 1
        have_ch = set(s.scalars(select(m.Channel.key).where(m.Channel.cafe_id == cafe.id)))
        for i, c in enumerate(cfg.channels):
            if c.key not in have_ch:
                s.add(
                    m.Channel(
                        id=_uid(100 + i),
                        cafe_id=cafe.id,
                        key=c.key,
                        name=c.name,
                        kind=c.kind,
                        commission=c.commission,
                    )
                )
                counts["channel"] += 1
        have_sku = set(s.scalars(select(m.MenuItem.sku).where(m.MenuItem.cafe_id == cafe.id)))
        for i, it in enumerate(cfg.menu):
            if it.sku not in have_sku:
                s.add(
                    m.MenuItem(
                        id=_uid(200 + i), cafe_id=cafe.id, sku=it.sku, name=it.name, cat=it.cat, base_price=it.base_price,
                        min_price=it.min_price, max_price=it.max_price, staple=it.staple,
                        attrs=it.model_dump(mode="json", exclude={"sku", "name", "cat", "base_price", "min_price", "max_price", "staple"}),
                    )
                )  # fmt: skip
                counts["menu_item"] += 1
        have_sc = set(s.scalars(select(m.Scenario.key)))
        for i, k in enumerate(list_scenarios()):
            if k not in have_sc:
                sc = load_scenario(k)
                s.add(
                    m.Scenario(
                        id=_uid(300 + i),
                        key=k,
                        name=sc.name or k,
                        description=sc.description,
                        config=sc.model_dump(mode="json"),
                    )
                )
                counts["scenario"] += 1
        have_pol = set(s.scalars(select(m.Policy.code)))
        for i, (code, p) in enumerate(sorted(pol.params.items())):
            if code not in have_pol:
                s.add(
                    m.Policy(
                        id=_uid(400 + i),
                        code=code,
                        name=p.get("name", code),
                        status=p.get("status", "available"),
                        config=p,
                    )
                )
                counts["policy"] += 1
        s.commit()
    return counts


def create_world_row(
    s: Session, world_id: str, kind: str, scenario: str, policy: str, seed: int, start_date: str,
    parent_id: str | None = None, params: dict[str, Any] | None = None,
) -> m.World:  # fmt: skip
    """Insert the ``world`` row that event rows reference."""
    row = s.get(m.World, world_id)
    if row is None:
        row = m.World(
            id=world_id, kind=kind, scenario=scenario, policy=policy, seed=seed, start_date=start_date,
            parent_id=parent_id, status="paused", created_at=datetime.now(UTC), params=params or {},
        )  # fmt: skip
        s.add(row)
        s.commit()
    return row


def count_rows(s: Session, model: type) -> int:
    return int(s.scalar(select(func.count()).select_from(model)) or 0)
