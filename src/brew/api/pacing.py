"""Live pacing: advance a world against wall-clock x speed in a worker thread (technical.md 10.3)."""

from __future__ import annotations

import asyncio
import contextlib
import time

from .world_manager import ManagedWorld


async def pace(mw: ManagedWorld) -> None:
    """Every ``pacer_tick_s`` of wall time advance the sim by ``dt * base_rate * speed`` seconds.

    Processing runs in a worker thread with a CPU budget (``pacer_cpu_budget_s``); if it cannot keep
    up the world lags gracefully and ``lagging`` is reported. Nights are skipped instantly.
    """
    s = mw.settings
    last = time.perf_counter()
    try:
        while mw.speed > 0:
            await asyncio.sleep(s.pacer_tick_s)
            now = time.perf_counter()
            dt = now - last
            last = now
            w = mw.world
            target = w.now + dt * s.live_base_rate * mw.speed
            nxt = w.next_event_time()
            if w.at_night() and nxt is not None:
                target = nxt  # nothing happens between close-out and the next day: jump
            done = await asyncio.to_thread(mw.advance, target, s.pacer_cpu_budget_s)
            if not done:
                # budget exhausted: don't try to catch up with wall time next tick
                mw.lagging = True
                last = time.perf_counter()
            else:
                mw.lagging = False
    except asyncio.CancelledError:
        raise
    finally:
        mw.pacer = None


def start_pacer(mw: ManagedWorld) -> None:
    if mw.pacer is None or mw.pacer.done():
        mw.pacer = asyncio.get_running_loop().create_task(pace(mw))


async def stop_pacer(mw: ManagedWorld) -> None:
    mw.speed = 0
    if mw.pacer is not None:
        mw.pacer.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await mw.pacer
        mw.pacer = None
