"""Live pacing: advance a world in step with the wall clock in a worker thread (technical.md 10.3).

There are no playback speeds: the café runs live at ``settings.live_rate`` sim-seconds per wall-second (1.0 = real
time). ``clock="wall"`` worlds stay locked to the real local time; ``clock="open"`` worlds run on from where they
are and skip the closed night instantly.
"""

from __future__ import annotations

import asyncio
import contextlib
import time

from .world_manager import ManagedWorld


async def pace(mw: ManagedWorld) -> None:
    """Every ``pacer_tick_s`` advance the sim to ``anchor_sim + (wall - anchor_wall) * live_rate``.

    Processing runs in a worker thread with a CPU budget (``pacer_cpu_budget_s``); if it cannot keep up the world
    lags and ``lagging`` is reported. Wall-clock worlds catch up afterwards; "open" worlds re-anchor instead.
    """
    s = mw.settings
    rate = float(s.live_rate)
    wall0, sim0 = time.time(), mw.world.now
    try:
        while mw.running:
            await asyncio.sleep(s.pacer_tick_s)
            w = mw.world
            if mw.clock == "wall":
                target = mw.wall_sim_now()
            else:
                target = sim0 + (time.time() - wall0) * rate
                nxt = w.next_event_time()
                if w.at_night() and nxt is not None:
                    target = nxt  # nothing happens between close-out and the next day: jump
                    wall0, sim0 = time.time(), nxt
            done = await asyncio.to_thread(mw.advance, target, s.pacer_cpu_budget_s)
            mw.lagging = not done
            if not done and mw.clock != "wall":
                wall0, sim0 = time.time(), mw.world.now  # don't try to catch up with wall time
    except asyncio.CancelledError:
        raise
    finally:
        mw.pacer = None


def start_pacer(mw: ManagedWorld) -> None:
    mw.running = True
    if mw.pacer is None or mw.pacer.done():
        mw.pacer = asyncio.get_running_loop().create_task(pace(mw))


async def stop_pacer(mw: ManagedWorld) -> None:
    mw.running = False
    if mw.pacer is not None:
        mw.pacer.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await mw.pacer
        mw.pacer = None
