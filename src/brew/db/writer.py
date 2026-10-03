"""Async batched event writer: an EventSink that persists domain rows from the event stream."""

from __future__ import annotations

import asyncio
from collections import deque
from typing import Any

from sqlalchemy import insert, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from brew.events.bus import EventRecord

from . import models as m

ORDER_STATUS = {
    "order.accepted": "accepted",
    "order.rejected": "rejected",
    "order.ready": "ready",
    "order.served": "served",
    "order.voided": "voided",
}


class DbWriterSink:
    """Buffers events (thread-safe ``emit``) and bulk-inserts every ``interval`` s / ``batch`` events.

    ``flush()`` can also be awaited directly (tests). Persisted: orders + items, reviews, price history,
    menu interventions, decisions, disruptions, daily KPIs, investments and (optionally) raw sim_events.
    """

    def __init__(
        self,
        sessions: async_sessionmaker[AsyncSession],
        world_id: str,
        store_events: bool = False,
        batch: int = 500,
        interval: float = 1.0,
    ) -> None:
        self.sessions = sessions
        self.world_id = world_id
        self.store_events = store_events
        self.batch = batch
        self.interval = interval
        self.buf: deque[EventRecord] = deque()
        self._task: asyncio.Task[None] | None = None
        self.rows_written = 0
        self._lock: asyncio.Lock | None = None
        self._running = False

    # ---- sink protocol (called from the simulator thread)
    def emit(self, ev: EventRecord) -> None:
        self.buf.append(ev)

    # ---- lifecycle
    def start(self) -> None:
        """Start the periodic flush loop on the running event loop."""
        if self._task is None:
            self._running = True
            self._task = asyncio.get_running_loop().create_task(self._loop())

    async def _loop(self) -> None:
        while self._running:
            await asyncio.sleep(self.interval)
            if self.buf:
                await self.flush()

    async def close(self) -> None:
        self._running = False
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None
        await self.flush()

    # ---- translation + bulk insert
    async def flush(self) -> int:
        """Persist everything buffered so far. Returns the number of events consumed."""
        if self._lock is None:
            self._lock = asyncio.Lock()
        async with self._lock:
            evs: list[EventRecord] = []
            while self.buf and len(evs) < 50_000:
                evs.append(self.buf.popleft())
            if not evs:
                return 0
            wid = self.world_id
            new_orders: dict[int, dict[str, Any]] = {}
            items: list[dict[str, Any]] = []
            updates: dict[int, dict[str, Any]] = {}
            reviews: list[dict[str, Any]] = []
            prices: list[dict[str, Any]] = []
            interventions: list[dict[str, Any]] = []
            decisions: list[dict[str, Any]] = []
            disruptions: list[dict[str, Any]] = []
            resolved: list[str] = []
            kpis: list[dict[str, Any]] = []
            invests: list[dict[str, Any]] = []
            raw: list[dict[str, Any]] = []
            for e in evs:
                t, d = e.type, e.data
                if self.store_events:
                    raw.append({"world_id": wid, "seq": e.seq, "sim_s": e.sim_s, "type": t, "data": d})
                if t == "order.placed":
                    new_orders[d["order_no"]] = {
                        "id": d["order_id"], "world_id": wid, "order_no": d["order_no"], "channel": d["channel"],
                        "persona": d["persona"], "name": d["name"], "party_id": d.get("party_id"),
                        "status": "placed", "note": d.get("note"), "placed_s": e.sim_s,
                        "promised_s": d["promised_s"],
                    }  # fmt: skip
                    for ln in d["items"]:
                        items.append(
                            {
                                "world_id": wid,
                                "order_id": d["order_id"],
                                "sku": ln["sku"],
                                "qty": ln["qty"],
                                "mods": ln["mods"],
                                "unit_price": ln["unit_price"],
                            }
                        )
                elif t in ORDER_STATUS:
                    u = updates.setdefault(d["order_no"], {})
                    u["status"] = ORDER_STATUS[t]
                    if t == "order.ready":
                        u["ready_s"] = e.sim_s
                    elif t == "order.served":
                        u["served_s"] = e.sim_s
                    elif t == "order.rejected":
                        u["reject_reason"] = d["reason"]
                    elif t == "order.accepted":
                        u["promised_s"] = d["promised_s"]
                elif t == "payment.received":
                    u = updates.setdefault(d["order_no"], {})
                    u["total"] = d["amount"]
                    u["payment"] = d["method"]
                elif t == "review.posted":
                    reviews.append(
                        {
                            "id": d["review_id"],
                            "world_id": wid,
                            "order_no": d["order_no"],
                            "party_id": d.get("party_id"),
                            "stars": d["stars"],
                            "text": d["text"],
                            "causes": d["causes"],
                            "channel": d["channel"],
                            "persona": d["persona"],
                            "sim_s": e.sim_s,
                        }
                    )
                elif t == "price.changed":
                    prices.append(
                        {
                            "world_id": wid,
                            "sku": d["sku"],
                            "old": d["old"],
                            "new": d["new"],
                            "base": d["base"],
                            "by": d["by"],
                            "reason": d["reason_text"],
                            "sim_s": e.sim_s,
                        }
                    )
                elif t in ("menu.featured", "menu.hidden", "menu.restored"):
                    kind = {"menu.hidden": "hidden", "menu.restored": "restored"}.get(
                        t, "featured" if d.get("on", True) else "unfeatured"
                    )
                    interventions.append(
                        {
                            "world_id": wid,
                            "sku": d["sku"],
                            "kind": kind,
                            "reason": d.get("reason", ""),
                            "sim_s": e.sim_s,
                        }
                    )
                elif t == "decision.made":
                    decisions.append(
                        {
                            "id": f"{wid}:{d['decision_id']}",
                            "world_id": wid,
                            "policy": d["policy"],
                            "type": d["type"],
                            "summary": d["summary"],
                            "top_factors": d["top_factors"],
                            "sim_s": e.sim_s,
                        }
                    )
                elif t == "chaos.triggered":
                    disruptions.append(
                        {
                            "id": f"{wid}:{d['disruption_id']}",
                            "world_id": wid,
                            "kind": d["kind"],
                            "target": d.get("target"),
                            "severity": d["severity"],
                            "source": d["source"],
                            "start_s": e.sim_s,
                            "end_s": d["until_s"],
                            "resolved": False,
                        }
                    )
                elif t == "chaos.resolved":
                    resolved.append(f"{wid}:{d['disruption_id']}")
                elif t == "day.ended":
                    s = d["summary"]
                    kpis.append(
                        {
                            "world_id": wid,
                            "day": d["day"],
                            "revenue": s["revenue"],
                            "net_profit": s["net_profit"],
                            "orders": s["orders"],
                            "rating": s["rating"],
                            "summary": s,
                        }
                    )
                elif t == "investment.delivered":
                    invests.append(
                        {
                            "world_id": wid,
                            "catalog_key": d["catalog_key"],
                            "effect": d["effect"],
                            "sim_s": e.sim_s,
                        }
                    )
            async with self.sessions() as s:
                if new_orders:
                    await s.execute(insert(m.Order), list(new_orders.values()))
                if items:
                    await s.execute(insert(m.OrderItem), items)
                for no, vals in updates.items():
                    await s.execute(
                        update(m.Order).where(m.Order.world_id == wid, m.Order.order_no == no).values(**vals)
                    )
                for model, rows in (
                    (m.Review, reviews), (m.PriceHistory, prices), (m.MenuIntervention, interventions),
                    (m.PolicyDecision, decisions), (m.Disruption, disruptions), (m.DailyKpi, kpis),
                    (m.Investment, invests), (m.SimEvent, raw),
                ):  # fmt: skip
                    if rows:
                        await s.execute(insert(model), rows)
                for did in resolved:
                    await s.execute(update(m.Disruption).where(m.Disruption.id == did).values(resolved=True))
                await s.commit()
            self.rows_written += (
                len(new_orders) + len(items) + len(reviews) + len(prices) + len(decisions) + len(kpis)
            )
            return len(evs)
