"""Live pacing: advance a world in step with the wall clock in a worker thread (docs/implementation-spec.md 10.3).

The café runs live at ``mw.rate`` sim-seconds per wall-second (1.0 = real time; the owner can fast-forward to 5, 20
or 60). ``clock="wall"`` worlds stay locked to the real local time until fast-forwarded (then they detach and become
``open``); ``clock="open"`` worlds run on from where they are and skip the closed night instantly.
"""

from __future__ import annotations

import asyncio
import contextlib
import time

from .world_manager import ManagedWorld


async def pace(mw: ManagedWorld) -> None:
    """Every ``pacer_tick_s`` advance the sim to ``sim0 + (wall - wall0) * mw.rate``.

    ``mw.rate`` is per world (1 = real time; 5/20/60 fast-forward). Changing it clears ``mw.pace_anchor`` so the
    next tick re-anchors ``(wall0, sim0)`` at the current sim time and nothing jumps. A ``clock="wall"`` world follows
    the real local time (rate 1) until it is fast-forwarded: then it detaches (``clock="open"``) for good.
    Processing runs in a worker thread with a CPU budget (``pacer_cpu_budget_s``); if it cannot keep up the world
    lags and ``lagging`` is reported. Wall-clock worlds catch up afterwards; "open" worlds re-anchor instead.
    """
    s = mw.settings
    try:
        while mw.running:
            await asyncio.sleep(s.pacer_tick_s)
            w = mw.world
            if mw.clock == "wall":
                target = mw.wall_sim_now()
            else:
                if mw.pace_anchor is None:
                    mw.pace_anchor = (time.time(), w.now)
                wall0, sim0 = mw.pace_anchor
                target = sim0 + (time.time() - wall0) * mw.rate
                nxt = w.next_event_time()
                if w.at_night() and nxt is not None:
                    target = nxt  # nothing happens between close-out and the next day: jump
                    mw.pace_anchor = (time.time(), nxt)
            done = await asyncio.to_thread(mw.advance, target, s.pacer_cpu_budget_s)
            mw.lagging = not done
            if not done and mw.clock != "wall":
                mw.pace_anchor = (time.time(), mw.world.now)  # don't try to catch up with wall time
    except asyncio.CancelledError:
        raise
    finally:
        mw.pacer = None


def start_pacer(mw: ManagedWorld) -> None:
    mw.running = True
    if mw.pacer is None or mw.pacer.done():
        mw.pace_anchor = None  # (re)starting: anchor at the current sim time
    if mw.pacer is None or mw.pacer.done():
        mw.pacer = asyncio.get_running_loop().create_task(pace(mw))


async def stop_pacer(mw: ManagedWorld) -> None:
    mw.running = False
    if mw.pacer is not None:
        mw.pacer.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await mw.pacer
        mw.pacer = None
