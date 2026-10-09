"""WebSocket event stream with batched frames, since_seq replay, resync and heartbeat."""

from __future__ import annotations

import asyncio
import contextlib
import time
from typing import Any

import orjson
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from brew.events.bus import envelope

router = APIRouter(tags=["stream"])
MAX_FRAME_EVENTS = 500


@router.websocket("/ws/worlds/{wid}")
async def stream(websocket: WebSocket, wid: str, since_seq: int | None = None) -> None:
    """Server -> client: ``{"hello"}``, optional ``{"resync": true}``, then ``{"frame": n, "events": [...]}``.

    Client -> server: ``{"op": "ping"}`` and ``{"op": "subscribe", "types": [...]}`` (event-type filter).
    After a reconnect fetch ``/state`` and pass ``since_seq`` = its ``last_seq`` to resume.
    """
    mgr = websocket.app.state.manager
    mw = mgr.worlds.get(wid)
    s = websocket.app.state.settings
    if mw is None:
        await websocket.close(code=4404)
        return
    await websocket.accept()
    ring = mw.ring
    start = mw.world.start_date
    types: set[str] | None = None
    frame_no = 0

    async def send(obj: dict[str, Any]) -> None:
        await websocket.send_text(orjson.dumps(obj).decode())

    hello = {"world": mw.json(), "last_seq": ring.last_seq, "frame_interval_s": s.ws_frame_interval_s}
    await send({"hello": hello})
    last = ring.last_seq
    if since_seq is not None:
        if ring.covers(since_seq):
            last = since_seq
        else:
            await send({"resync": True, "last_seq": ring.last_seq})
    recv = asyncio.create_task(websocket.receive_json())
    last_sent = time.monotonic()
    try:
        while True:
            done, _ = await asyncio.wait({recv}, timeout=s.ws_frame_interval_s)
            if recv in done:
                try:
                    msg = recv.result()
                except WebSocketDisconnect:
                    break
                except Exception:
                    msg = {}
                op = msg.get("op") if isinstance(msg, dict) else None
                if op == "ping":
                    await send({"pong": {"sim_s": mw.world.now, "last_seq": ring.last_seq}})
                elif op == "subscribe":
                    t = msg.get("types")
                    types = set(t) if t else None
                    await send({"subscribed": sorted(types) if types else "all"})
                recv = asyncio.create_task(websocket.receive_json())
            if not ring.covers(last):
                await send({"resync": True, "last_seq": ring.last_seq})
                last = ring.last_seq
                last_sent = time.monotonic()
                continue
            evs = ring.since(last)
            if evs:
                last = evs[-1].seq
                if types is not None:
                    evs = [e for e in evs if e.type in types]
                for i in range(0, len(evs), MAX_FRAME_EVENTS):
                    frame_no += 1
                    chunk = evs[i : i + MAX_FRAME_EVENTS]
                    await send({"frame": frame_no, "events": [envelope(e, start) for e in chunk]})
                    last_sent = time.monotonic()
            if time.monotonic() - last_sent >= s.ws_heartbeat_s:
                await send({"hb": {"sim_s": mw.world.now, "last_seq": ring.last_seq}})
                last_sent = time.monotonic()
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        recv.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await recv
