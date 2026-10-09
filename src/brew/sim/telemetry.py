"""Telemetry buffers + Parquet writers (technical.md section 11).

The simulator only appends tuples to :class:`TeleBuf`; :func:`write_run` does the I/O and is called
by the CLI / API outside ``sim`` hot paths.
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import TYPE_CHECKING, Any

from brew.domain.timeutil import DAY_S, tod_s

if TYPE_CHECKING:
    from .state import Order, StaffState, Task
    from .world import World

SCHEMA_VERSION = 1

ORDER_COLS = [
    "order_no", "sku", "channel", "persona", "qty", "price", "base", "mods", "placed_s", "ready_s",
    "handoff_s", "wait_s", "quality", "cogs",
]  # fmt: skip
TASK_COLS = ["sim_s", "step", "station", "staff", "batch_size", "load", "fatigue", "duration_s", "order_no"]
DEMAND_COLS = [
    "day", "slot", "sku", "channel", "qty", "price", "base", "featured", "hidden", "weather", "temp_c",
    "calendar_flags", "rating",
]  # fmt: skip
DELIVERY_COLS = [
    "sim_s",
    "order_no",
    "platform",
    "eta_pred_s",
    "eta_actual_s",
    "rain",
    "hour",
    "rider_wait_s",
    "late_s",
]
DECISION_COLS = ["sim_s", "decision_id", "type", "policy", "summary"]
KPI_COLS = ["day", "revenue", "net_profit", "orders", "rating", "cash"]


def _new_demand() -> list[Any]:
    return [0.0, 0.0, 0.0, 0.0, "", 0.0]


class TeleBuf:
    """In-memory telemetry rows (cheap appends)."""

    def __init__(self) -> None:
        self.orders: list[tuple] = []
        self.tasks: list[tuple] = []
        self.demand: dict[tuple, list[Any]] = defaultdict(_new_demand)
        self.deliveries: list[tuple] = []
        self.decisions: list[tuple] = []
        self.kpis: list[dict[str, Any]] = []

    # ---- hooks called from the simulator
    def order_placed(self, w: World, o: Order) -> None:
        slot = int(tod_s(w.now) // 900)
        for ln in o.lines:
            m = w.menu[ln["sku"]]
            key = (w.day, slot, ln["sku"], o.channel)
            d = self.demand[key]
            d[0] += ln["qty"]
            d[1] = m.price
            d[2] = m.base
            d[3] = 1.0 if m.featured else 0.0
            d[4] = w.weather_state
            d[5] = w.temp_c

    def order_served(self, w: World, o: Order) -> None:
        for ln in o.lines:
            m = w.menu[ln["sku"]]
            self.orders.append(
                (
                    o.order_no,
                    ln["sku"],
                    o.channel,
                    o.persona,
                    ln["qty"],
                    ln["unit_price"],
                    m.base,
                    ",".join(ln["mods"]),
                    o.placed_s,
                    o.ready_s,
                    o.served_s,
                    o.served_s - o.placed_s,
                    round(o.quality, 4),
                    round(o.cogs / max(1, o.items_n) * ln["qty"], 4),
                )  # fmt: skip
            )

    def task(self, w: World, t: Task, staff: StaffState, dur: float) -> None:
        self.tasks.append(
            (
                w.now,
                t.name,
                t.station,
                staff.key,
                t.batch_n,
                round(w.kitchen.load_ewma, 3),
                round(staff.fatigue, 3),
                round(dur, 2),
                t.order_no,
            )
        )

    def delivery(self, w: World, o: Order) -> None:
        r = o.rider or {}
        self.deliveries.append(
            (
                w.now,
                o.order_no,
                o.channel,
                r.get("pred_s", 0.0),
                r.get("arrive_s", 0.0) - r.get("dispatch_s", 0.0),
                w.rain_mm_h,
                int(tod_s(w.now) // 3600),
                r.get("wait_s", 0.0),
                max(0.0, o.delivered_s - o.promised_s),
            )  # fmt: skip
        )

    def decision(self, w: World, did: str, typ: str, policy: str, summary: str) -> None:
        self.decisions.append((w.now, did, typ, policy, summary))


def _table(cols: list[str], rows: list[tuple]):  # type: ignore[no-untyped-def]
    import pyarrow as pa

    if not rows:
        return pa.table({c: pa.array([], pa.string()) for c in cols})
    data = list(zip(*rows, strict=True))
    return pa.table({c: pa.array(list(v)) for c, v in zip(cols, data, strict=True)})


def write_run(w: World, out_dir: str | Path, extra_meta: dict[str, Any] | None = None) -> dict[str, int]:
    """Write orders/tasks/demand_15m/deliveries/decisions/kpis parquet files; returns row counts."""
    import pyarrow.parquet as pq

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    tb = w.tele
    if tb is None:
        return {}
    counts: dict[str, int] = {}

    def put(name: str, cols: list[str], rows: list[tuple]) -> None:
        pq.write_table(_table(cols, rows), out / f"{name}.parquet", compression="zstd")
        counts[name] = len(rows)

    put("orders", ORDER_COLS, tb.orders)
    put("tasks", TASK_COLS, tb.tasks)
    put("deliveries", DELIVERY_COLS, tb.deliveries)
    put("decisions", DECISION_COLS, tb.decisions)
    drows = []
    for (day, slot, sku, ch), (qty, price, base, feat, wst, tmp) in sorted(tb.demand.items()):
        hid = 1 if w.menu[sku].hidden else 0
        drows.append((day, slot, sku, ch, qty, price, base, feat, hid, wst, tmp, "", w.reviews.rep.overall()))
    put("demand_15m", DEMAND_COLS, drows)
    put(
        "kpis",
        KPI_COLS,
        [(k["day"], k["revenue"], k["net_profit"], k["orders"], k["rating"], k["cash"]) for k in tb.kpis],
    )
    meta = {
        "schema_version": SCHEMA_VERSION,
        "world_id": w.world_id,
        "seed": w.seed,
        "policy": w.policy.code,
        "scenario": w.scenario.key,
        "days": len(tb.kpis),
        "rows": counts,
        "start_date": w.start_date,
        "day_seconds": DAY_S,
        **(extra_meta or {}),
    }
    (out / "_meta.json").write_text(json.dumps(meta, indent=2))
    return counts
