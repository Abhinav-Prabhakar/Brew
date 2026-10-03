from __future__ import annotations

import pytest
from sqlalchemy import func, select, text

from brew.db import models as m
from brew.db.repo import create_world_row, seed_reference_data
from brew.db.session import async_session_factory, make_async_engine, make_sync_engine, sync_session_factory
from brew.db.writer import DbWriterSink
from brew.sim.world import World

pytestmark = pytest.mark.integration


def test_alembic_upgrade_on_empty_db(tmp_path, monkeypatch):
    from alembic import command
    from alembic.config import Config

    url = f"sqlite:///{tmp_path}/mig.db"
    monkeypatch.setenv("BREW_DATABASE_URL", url)
    from brew.settings import get_settings

    get_settings.cache_clear()
    try:
        cfg = Config("alembic.ini")
        cfg.set_main_option("sqlalchemy.url", url)
        command.upgrade(cfg, "head")
        eng = make_sync_engine(url)
        with eng.connect() as c:
            tables = {r[0] for r in c.execute(text("select name from sqlite_master where type='table'"))}
        for t in ("cafe", "scenario", "world", "channel", "menu_item", "price_history", "menu_intervention", "order",
                  "order_item", "review", "policy", "policy_decision", "disruption", "daily_kpi", "investment",
                  "model_registry", "evaluation", "counterfactual", "training_run", "sim_event"):  # fmt: skip
            assert t in tables, t
    finally:
        get_settings.cache_clear()


def test_seed_reference_data_idempotent(tmp_path):
    url = f"sqlite:///{tmp_path}/seed.db"
    first = seed_reference_data(url)
    assert first["menu_item"] == 23 and first["scenario"] == 8 and first["policy"] == 5
    second = seed_reference_data(url)
    assert sum(second.values()) == 0


async def test_writer_persists_orders_reviews_decisions(tmp_path):
    url = f"sqlite:///{tmp_path}/w.db"
    seed_reference_data(url)
    eng = make_sync_engine(url)
    w = World(policy="B", seed=5)
    with sync_session_factory(eng)() as s:
        create_world_row(s, w.world_id, "demo", "weekday_normal", "B", 5, w.start_date)
    aeng = make_async_engine(url)
    sink = DbWriterSink(async_session_factory(aeng), w.world_id, store_events=True, batch=500)
    w.sink = sink
    w.run()
    n = await sink.flush()
    assert n == w.seq
    with sync_session_factory(eng)() as s:
        orders = s.scalar(select(func.count()).select_from(m.Order).where(m.Order.world_id == w.world_id))
        served = s.scalar(
            select(func.count())
            .select_from(m.Order)
            .where(m.Order.world_id == w.world_id, m.Order.status == "served")
        )
        items = s.scalar(select(func.count()).select_from(m.OrderItem))
        reviews = s.scalar(select(func.count()).select_from(m.Review))
        decisions = s.scalar(select(func.count()).select_from(m.PolicyDecision))
        prices = s.scalar(select(func.count()).select_from(m.PriceHistory))
        kpis = s.scalar(select(func.count()).select_from(m.DailyKpi))
        events = s.scalar(select(func.count()).select_from(m.SimEvent))
        total = s.scalar(select(func.sum(m.Order.total)).where(m.Order.world_id == w.world_id))
    assert orders >= w.daily_kpis[0]["orders"] > 250
    assert served > 200 and items >= orders
    assert reviews == len(w.reviews.log) and decisions == len(w.decisions) and kpis == 1
    assert prices > 0 and events == w.seq
    assert total and total > 50_000
    await aeng.dispose()


async def test_writer_background_loop_flushes(tmp_path):
    import asyncio

    url = f"sqlite:///{tmp_path}/loop.db"
    seed_reference_data(url)
    eng = make_sync_engine(url)
    w = World(policy="A", seed=2)
    with sync_session_factory(eng)() as s:
        create_world_row(s, w.world_id, "live", "weekday_normal", "A", 2, w.start_date)
    aeng = make_async_engine(url)
    sink = DbWriterSink(async_session_factory(aeng), w.world_id, interval=0.05)
    w.sink = sink
    sink.start()
    w.run_until(11 * 3600)
    for _ in range(100):
        if not sink.buf:
            break
        await asyncio.sleep(0.05)
    await sink.close()
    with sync_session_factory(eng)() as s:
        assert s.scalar(select(func.count()).select_from(m.Order)) > 20
    await aeng.dispose()
