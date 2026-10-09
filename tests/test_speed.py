"""Fast-forward: per-world rate, re-anchoring, detaching a wall-clock world, the world.speed event, the state block."""

from __future__ import annotations

import asyncio

import httpx
import pytest
from fastapi.testclient import TestClient

from brew.api.app import create_app
from brew.events.schema import EVENT_MODELS
from brew.settings import Settings

pytestmark = pytest.mark.integration
API = "/api/v1"


@pytest.fixture
def api_client():
    app = create_app(Settings(db_enabled=False))
    with TestClient(app) as c:
        c.app_ = app  # type: ignore[attr-defined]
        yield c


def mk(c, **kw) -> str:
    r = c.post(f"{API}/worlds", json={"policy": "A", "seed": 3, **kw})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def speed(c, wid, rate):
    return c.post(f"{API}/worlds/{wid}/control", json={"action": "speed", "rate": rate})


def test_rates_and_validation(api_client):
    c = api_client
    wid = mk(c)
    j = c.get(f"{API}/worlds/{wid}").json()
    assert j["rate"] == 1.0 and j["detached"] is False
    for rate in (5, 20, 60, 1):
        r = speed(c, wid, rate)
        assert r.status_code == 200 and r.json()["rate"] == rate and r.json()["detached"] is False  # open worlds never detach
    for bad in (0, 2, 100, -1):
        r = speed(c, wid, bad)
        assert r.status_code == 422 and r.json()["error"]["code"] == "bad_request", r.text
    assert c.post(f"{API}/worlds/{wid}/control", json={"action": "speed"}).status_code == 422
    assert c.post(f"{API}/worlds/{wid}/control", json={"action": "speed", "rate": "fast"}).status_code == 422


def test_speed_event_and_state_block(api_client):
    c = api_client
    wid = mk(c)
    mw = c.app_.state.manager.worlds[wid]
    speed(c, wid, 20)
    evs = [e for e in mw.ring.since(0) if e.type == "world.speed"]
    assert len(evs) == 1 and evs[0].data == {"rate": 20.0, "detached": False}
    EVENT_MODELS["world.speed"].model_validate(evs[0].data)
    speed(c, wid, 20)  # unchanged: no second event
    assert len([e for e in mw.ring.since(0) if e.type == "world.speed"]) == 1
    w = c.get(f"{API}/worlds/{wid}/state").json()["world"]
    assert w["rate"] == 20.0 and w["detached"] is False
    assert w["rate"] == mw.world.speed


def test_wall_world_detaches_and_stays_detached(api_client):
    c = api_client
    wid = mk(c, clock="wall")
    mw = c.app_.state.manager.worlds[wid]
    assert mw.clock == "wall" and not mw.detached
    speed(c, wid, 1)  # rate 1 on a wall world: nothing changes
    assert mw.clock == "wall" and not mw.detached
    t0 = mw.world.now
    j = speed(c, wid, 5).json()
    assert j["detached"] is True and j["clock_mode"] == "open" and mw.world.now == t0  # time never jumps
    ev = [e for e in mw.ring.since(0) if e.type == "world.speed"][-1]
    assert ev.data == {"rate": 5.0, "detached": True}
    j = speed(c, wid, 1).json()  # back to 1x: still detached
    assert j["detached"] is True and j["clock_mode"] == "open" and j["rate"] == 1.0
    assert c.get(f"{API}/worlds/{wid}/state").json()["world"]["detached"] is True


async def test_pacer_uses_per_world_rate_and_reanchors():
    app = create_app(Settings(db_enabled=False, pacer_tick_s=0.01))
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            wid = (await c.post(f"{API}/worlds", json={"policy": "A", "seed": 3})).json()["id"]
            mw = app.state.manager.worlds[wid]
            await c.post(f"{API}/worlds/{wid}/control", json={"action": "play"})
            await asyncio.sleep(0.3)
            t_slow = mw.world.now
            await c.post(f"{API}/worlds/{wid}/control", json={"action": "speed", "rate": 60})
            await asyncio.sleep(0.05)
            t1 = mw.world.now
            assert t1 - t_slow < 5, "re-anchoring must not jump the clock"
            await asyncio.sleep(0.5)
            gained = mw.world.now - t1
            assert 15 < gained < 45, gained  # ~0.5 s * 60 sim-s/s
            await c.post(f"{API}/worlds/{wid}/control", json={"action": "pause"})
