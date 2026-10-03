from __future__ import annotations

import json

import polars as pl

from brew.events.bus import ParquetSink
from brew.sim.telemetry import DEMAND_COLS, ORDER_COLS, TASK_COLS, write_run
from brew.sim.world import World


def test_parquet_files_and_columns(tmp_path):
    sink = ParquetSink(tmp_path / "events.parquet")
    w = World(policy="B", seed=4, sink=sink, telemetry=True)
    w.run()
    sink.close()
    counts = write_run(w, tmp_path)
    for name in ("events", "orders", "tasks", "demand_15m", "deliveries", "decisions", "kpis"):
        assert (tmp_path / f"{name}.parquet").exists(), name
    assert pl.read_parquet(tmp_path / "orders.parquet").columns == ORDER_COLS
    assert pl.read_parquet(tmp_path / "tasks.parquet").columns == TASK_COLS
    assert pl.read_parquet(tmp_path / "demand_15m.parquet").columns == DEMAND_COLS
    ev = pl.read_parquet(tmp_path / "events.parquet")
    assert ev.columns == ["seq", "sim_s", "type", "data"] and len(ev) == w.seq == sink.count
    json.loads(ev["data"][0])
    meta = json.loads((tmp_path / "_meta.json").read_text())
    assert meta["schema_version"] == 1 and meta["policy"] == "B"
    assert counts["orders"] > 300


def test_demand_15m_aggregates_equal_orders(tmp_path):
    w = World(policy="A", seed=4, telemetry=True)
    w.run()
    write_run(w, tmp_path)
    demand = pl.read_parquet(tmp_path / "demand_15m.parquet")
    assert int(demand["qty"].sum()) == w.daily_kpis[0]["items_sold"]
    by_ch = demand.group_by("channel").agg(pl.col("qty").sum())
    assert by_ch.height >= 3
    assert demand["slot"].min() >= 28 and demand["slot"].max() <= 90


def test_orders_rows_have_waits_and_quality(tmp_path):
    w = World(policy="A", seed=4, telemetry=True)
    w.run()
    write_run(w, tmp_path)
    o = pl.read_parquet(tmp_path / "orders.parquet")
    assert (o["wait_s"] >= 0).all() and o["quality"].max() <= 1.0 and (o["cogs"] > 0).any()
    d = pl.read_parquet(tmp_path / "deliveries.parquet")
    assert len(d) > 20 and (d["eta_actual_s"] > 0).all()
