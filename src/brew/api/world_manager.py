"""WorldManager: owns live worlds, their pacers, ring buffers and DB writers (technical.md 10.2)."""

from __future__ import annotations

import asyncio
import threading
from datetime import UTC, datetime, timedelta
from datetime import date as _date
from typing import Any

from sqlalchemy.ext.asyncio import AsyncEngine

from brew.config.loader import list_scenarios, load_scenario
from brew.db.repo import create_world_row
from brew.db.session import async_session_factory, make_async_engine, make_sync_engine, sync_session_factory
from brew.db.writer import DbWriterSink
from brew.events.bus import EventRecord, FanoutSink, RingBufferSink
from brew.policies.registry import available, make_policy, planned
from brew.settings import Settings
from brew.sim import readmodels as rm
from brew.sim.actions import BadPayload, apply_action
from brew.sim.world import World

SPEEDS = (0, 1, 10, 60)


class NotImplementedYet(Exception):
    """Feature belongs to a later milestone (HTTP 501)."""

    def __init__(self, milestone: str, what: str) -> None:
        super().__init__(f"{what} is available in {milestone}")
        self.milestone = milestone
        self.what = what


class UnknownWorld(Exception):
    """No such world (HTTP 404)."""


class ManagedWorld:
    """A World plus its pacing state, ring buffer, lock and optional DB sink."""

    def __init__(self, world: World, kind: str, settings: Settings, parent_id: str | None = None) -> None:
        self.world = world
        self.kind = kind
        self.settings = settings
        self.parent_id = parent_id
        self.lock = threading.RLock()
        self.ring = RingBufferSink(settings.ws_ring_size)
        self.fan = FanoutSink(self.ring)
        world.sink = self.fan
        self.db_sink: DbWriterSink | None = None
        self.speed = 0
        self.last_speed = 1
        self.status = "paused"
        self.lagging = False
        self.pacer: asyncio.Task[None] | None = None
        self.created_at = datetime.now(UTC)
        self.wall_events = 0

    # ---- control (all under lock)
    def advance(self, target: float, budget_s: float | None = None) -> bool:
        """Advance the world to sim time ``target`` (optionally capped by a CPU budget in seconds)."""
        import time

        with self.lock:
            w = self.world
            stop = None
            if budget_s is not None:
                t_end = time.perf_counter() + budget_s
                stop = lambda: time.perf_counter() > t_end  # noqa: E731
            return w.advance_to(target, stop)

    def step(self, step_s: float) -> dict[str, Any]:
        with self.lock:
            before = self.world.seq
            self.world.advance_to(self.world.now + step_s)
            return {"events": self.world.seq - before}

    def act(self, kind: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Apply a player/owner action immediately (between pacer slices) and process its events."""
        with self.lock:
            res = apply_action(self.world, kind, payload)
            self.world.advance_to(self.world.now)  # run zero-delay consequences at the current sim_s
            return res

    def chaos(self, kind: str, target: str | None, severity: float, duration_min: float) -> dict[str, Any]:
        with self.lock:
            try:
                d = self.world.trigger_chaos(kind, target, severity, duration_min)
            except ValueError as e:
                raise BadPayload(str(e)) from e
            self.world.advance_to(self.world.now)
            return {
                "id": d.id,
                "kind": d.kind,
                "target": d.target,
                "severity": d.severity,
                "start_s": d.start_s,
                "end_s": d.end_s,
                "source": d.source,
                "sim_s": self.world.now,
            }

    def set_policy(self, policy: str | None, strategy: str | None) -> None:
        with self.lock:
            if policy:
                code = policy.upper()
                md = self.settings.resolved_models_dir()
                if code in planned(md):
                    raise NotImplementedYet(planned(md)[code], f"policy {code}")
                if code not in available(md):
                    raise BadPayload(f"unknown policy {policy!r}")
                if code != self.world.policy.code:
                    self.world.set_policy(make_policy(code, models_dir=md) if code == "D" else code)
            if strategy:
                try:
                    self.world.set_strategy(strategy)
                except ValueError as e:
                    raise BadPayload(str(e)) from e
            self.world.advance_to(self.world.now)

    def json(self) -> dict[str, Any]:
        w = self.world
        with self.lock:
            return {
                "id": w.world_id, "kind": self.kind, "scenario": w.scenario.key, "policy": w.policy.code,
                "strategy": w.manual_strategy, "seed": w.seed, "status": self.status, "speed": self.speed,
                "lagging": self.lagging, "parent_id": self.parent_id, "created_at": self.created_at.isoformat(),
                "start_date": w.start_date, "clock": rm.clock(w), "last_seq": w.seq,
            }  # fmt: skip

    def recent(self, since_seq: int) -> list[EventRecord]:
        return self.ring.since(since_seq)


class WorldManager:
    """Registry of live worlds plus shared DB engines."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.worlds: dict[str, ManagedWorld] = {}
        self._seq = 0
        self.async_engine: AsyncEngine | None = None
        self.sync_engine = None
        self._sessions = None
        self._lock = threading.Lock()
        if settings.db_enabled:
            url = settings.resolved_database_url()
            self.sync_engine = make_sync_engine(url)
            from brew.db.session import create_all

            create_all(self.sync_engine)
            self.async_engine = make_async_engine(url)
            self._sessions = async_session_factory(self.async_engine)

    # ---- lifecycle
    def _new_id(self, seed: int) -> str:
        from brew.domain.ids import uuid7

        with self._lock:
            self._seq += 1
            n = self._seq
        import time

        return uuid7(int(time.time() * 1000), n * 2654435761 + seed, n * 40503 + 17)

    def create(self, spec: dict[str, Any]) -> ManagedWorld:
        s = self.settings
        if len(self.worlds) >= s.max_worlds:
            raise BadPayload(f"world limit reached ({s.max_worlds})")
        policy: Any = str(spec.get("policy", "A")).upper()
        md = s.resolved_models_dir()
        if policy in planned(md):
            raise NotImplementedYet(planned(md)[policy], f"policy {policy}")
        if policy not in available(md):
            raise BadPayload(f"unknown policy {policy!r}")
        if policy == "D":  # the learned manager needs the champion of *this* server's model directory
            policy = make_policy("D", models_dir=md)
        scenario = spec.get("scenario", "weekday_normal")
        if scenario not in list_scenarios():
            raise BadPayload(f"unknown scenario {scenario!r}")
        scn = load_scenario(scenario)
        start_date = spec.get("start_date") or scn.start_date
        if spec.get("start_day"):
            y, m, d = (int(x) for x in start_date.split("-"))
            start_date = (_date(y, m, d) + timedelta(days=int(spec["start_day"]))).isoformat()
        wid = self._new_id(int(spec.get("seed", 7)))
        w = World(
            scenario=scn, policy=policy, seed=int(spec.get("seed", 7)), days=10**6, continuous=True,
            start_date=start_date, world_id=wid, cash_start=spec.get("cash_start"), replate=spec.get("replate"),
        )  # fmt: skip
        mw = ManagedWorld(w, spec.get("kind", "live"), s)
        self._attach_db(mw)
        if spec.get("strategy") and spec["strategy"] != "balanced":
            try:
                w.set_strategy(spec["strategy"])
            except ValueError as e:
                raise BadPayload(str(e)) from e
        mw.last_speed = int(spec.get("speed", 1)) or 1
        w.advance_to(w.day_start_t(0))  # hydrate: day started, weather set, staff scheduled
        self.worlds[wid] = mw
        return mw

    def _attach_db(self, mw: ManagedWorld) -> None:
        if self._sessions is None or self.sync_engine is None:
            return
        w = mw.world
        with sync_session_factory(self.sync_engine)() as sess:
            create_world_row(
                sess,
                w.world_id,
                mw.kind,
                w.scenario.key,
                w.policy.code,
                w.seed,
                w.start_date,
                parent_id=mw.parent_id,
            )
        store = mw.kind in ("live", "demo") and self.settings.db_store_events
        sink = DbWriterSink(self._sessions, w.world_id, store_events=store)
        mw.db_sink = sink
        mw.fan.add(sink)
        try:
            asyncio.get_running_loop()
            sink.start()
        except RuntimeError:
            pass  # no loop (sync caller): flush on demand

    def get(self, wid: str) -> ManagedWorld:
        mw = self.worlds.get(wid)
        if mw is None:
            raise UnknownWorld(wid)
        return mw

    def delete(self, wid: str) -> None:
        mw = self.get(wid)
        mw.speed = 0
        mw.status = "deleted"
        if mw.pacer is not None:
            mw.pacer.cancel()
        del self.worlds[wid]

    def fork(self, wid: str, kind: str = "counterfactual", reseed: int | None = None) -> ManagedWorld:
        parent = self.get(wid)
        if len(self.worlds) >= self.settings.max_worlds:
            raise BadPayload("world limit reached")
        with parent.lock:
            child_id = self._new_id(parent.world.seed + 1)
            cw = parent.world.fork(reseed=reseed, world_id=child_id)
        mw = ManagedWorld(cw, kind, self.settings, parent_id=wid)
        self._attach_db(mw)
        self.worlds[child_id] = mw
        return mw

    def list(self) -> list[dict[str, Any]]:
        return [mw.json() for mw in self.worlds.values()]

    async def shutdown(self) -> None:
        for mw in list(self.worlds.values()):
            mw.speed = 0
            if mw.pacer is not None:
                mw.pacer.cancel()
            if mw.db_sink is not None:
                await mw.db_sink.close()
        if self.async_engine is not None:
            await self.async_engine.dispose()
        if self.sync_engine is not None:
            self.sync_engine.dispose()
