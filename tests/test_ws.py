from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from brew.api.app import create_app
from brew.settings import Settings

pytestmark = pytest.mark.integration
API = "/api/v1"


def client(**kw) -> TestClient:
    return TestClient(create_app(Settings(db_enabled=False, ws_frame_interval_s=0.02, **kw)))


def mk(c) -> str:
    r = c.post(f"{API}/worlds", json={"policy": "A", "seed": 3})
    return r.json()["id"]


def step(c, wid, s):
    assert c.post(f"{API}/worlds/{wid}/control", json={"action": "step", "step_s": s}).status_code == 200


def drain(ws, until_seq: int, limit: int = 400):
    """Collect frames until an event with seq >= until_seq arrives."""
    frames, events = [], []
    for _ in range(limit):
        msg = ws.receive_json()
        if "frame" in msg:
            frames.append(msg)
            events += msg["events"]
            if events and events[-1]["seq"] >= until_seq:
                return frames, events
    raise AssertionError("did not receive expected events")


def test_hello_then_replay_from_since_seq():
    with client() as c:
        wid = mk(c)
        step(c, wid, 3600)
        mw = c.app.state.manager.worlds[wid]
        last = mw.world.seq
        with c.websocket_connect(f"{API}/ws/worlds/{wid}?since_seq=0") as ws:
            hello = ws.receive_json()["hello"]
            assert hello["last_seq"] == last and hello["world"]["id"] == wid
            frames, events = drain(ws, last)
            seqs = [e["seq"] for e in events]
            assert seqs == list(range(1, last + 1))
            assert events[0]["t"].endswith("+05:30") and {"seq", "sim_s", "t", "type", "data"} == set(
                events[0]
            )
        # resume from the middle
        mid = last // 2
        with c.websocket_connect(f"{API}/ws/worlds/{wid}?since_seq={mid}") as ws:
            ws.receive_json()
            _, events = drain(ws, last)
            assert events[0]["seq"] == mid + 1


def test_live_frames_are_batched():
    with client() as c:
        wid = mk(c)
        step(c, wid, 3600)
        mw = c.app.state.manager.worlds[wid]
        with c.websocket_connect(f"{API}/ws/worlds/{wid}") as ws:  # no since_seq: live only
            ws.receive_json()
            before = mw.world.seq
            step(c, wid, 1800)
            after = mw.world.seq
            frames, events = drain(ws, after)
            assert events[0]["seq"] == before + 1
            assert sum(len(f["events"]) for f in frames) == after - before
            assert max(len(f["events"]) for f in frames) > 20  # many events per frame, not one per frame
            assert [f["frame"] for f in frames] == list(range(1, len(frames) + 1))


def test_resync_when_beyond_ring_buffer():
    with client(ws_ring_size=50) as c:
        wid = mk(c)
        step(c, wid, 2 * 3600)
        with c.websocket_connect(f"{API}/ws/worlds/{wid}?since_seq=1") as ws:
            assert "hello" in ws.receive_json()
            msg = ws.receive_json()
            assert msg.get("resync") is True
            # after resync the client fetches /state and resumes from last_seq
            st = c.get(f"{API}/worlds/{wid}/state").json()
            assert st["last_seq"] == msg["last_seq"]
        with c.websocket_connect(f"{API}/ws/worlds/{wid}?since_seq={st['last_seq']}") as ws:
            ws.receive_json()
            step(c, wid, 70)
            _, events = drain(ws, st["last_seq"] + 1)
            assert events[0]["seq"] == st["last_seq"] + 1


def test_multiple_subscribers_get_same_events():
    with client() as c:
        wid = mk(c)
        mw = c.app.state.manager.worlds[wid]
        with (
            c.websocket_connect(f"{API}/ws/worlds/{wid}") as a,
            c.websocket_connect(f"{API}/ws/worlds/{wid}") as b,
        ):
            a.receive_json()
            b.receive_json()
            step(c, wid, 1200)
            target = mw.world.seq
            _, ea = drain(a, target)
            _, eb = drain(b, target)
            assert [e["seq"] for e in ea] == [e["seq"] for e in eb]


def test_subscribe_filter_and_ping_pong():
    with client() as c:
        wid = mk(c)
        with c.websocket_connect(f"{API}/ws/worlds/{wid}") as ws:
            ws.receive_json()
            ws.send_json({"op": "ping"})
            assert "pong" in ws.receive_json()
            ws.send_json({"op": "subscribe", "types": ["clock.tick"]})
            msg = ws.receive_json()
            while "subscribed" not in msg:
                msg = ws.receive_json()
            assert msg["subscribed"] == ["clock.tick"]
            step(c, wid, 900)
            _, events = drain(ws, 1)
            assert events and {e["type"] for e in events} == {"clock.tick"}


def test_heartbeat_when_idle():
    with TestClient(
        create_app(Settings(db_enabled=False, ws_frame_interval_s=0.02, ws_heartbeat_s=0.1))
    ) as c:
        wid = mk(c)
        with c.websocket_connect(f"{API}/ws/worlds/{wid}") as ws:
            ws.receive_json()
            msg = ws.receive_json()
            assert "hb" in msg and "last_seq" in msg["hb"]


def test_unknown_world_closes():
    with client() as c:
        with pytest.raises(WebSocketDisconnect) as ei:
            with c.websocket_connect(f"{API}/ws/worlds/nope"):
                pass
        assert ei.value.code == 4404
