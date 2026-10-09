"""The new periodic / chaos events stream over the WebSocket and validate against their schemas."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from brew.api.app import create_app
from brew.events.schema import EVENT_MODELS, validate_event
from brew.settings import Settings

pytestmark = pytest.mark.integration
API = "/api/v1"


def test_new_events_stream_over_ws():
    with TestClient(create_app(Settings(db_enabled=False, ws_frame_interval_s=0.02))) as c:
        wid = c.post(f"{API}/worlds", json={"policy": "B", "seed": 3}).json()["id"]
        c.post(f"{API}/worlds/{wid}/control", json={"action": "step", "step_s": 3 * 3600})
        r = c.post(f"{API}/worlds/{wid}/chaos", json={"kind": "equipment_down", "target": "oven", "duration_min": 10})
        assert r.status_code == 201
        c.post(f"{API}/worlds/{wid}/control", json={"action": "step", "step_s": 3600})
        last = c.app.state.manager.worlds[wid].world.seq
        seen: dict[str, list[dict]] = {}
        with c.websocket_connect(f"{API}/ws/worlds/{wid}?since_seq=0") as ws:
            ws.receive_json()
            done = False
            while not done:
                msg = ws.receive_json()
                for e in msg.get("events", []):
                    seen.setdefault(e["type"], []).append(e)
                    done = done or e["seq"] >= last
        for t in ("station.load", "staff.status", "chaos.triggered", "chaos.cost", "chaos.resolved", "batch.started"):
            assert t in EVENT_MODELS and seen.get(t), t
        for t in ("station.load", "staff.status", "chaos.cost", "batch.started"):
            for e in seen[t][:50]:
                validate_event(t, e["data"])
        assert all("saves_s" in e["data"] and e["data"]["saves_s"] > 0 for e in seen["batch.started"])
        phases = [e["data"]["phase"] for e in seen["chaos.cost"]]
        assert phases[-1] == "final" or "resolved" in phases


def test_events_schema_lists_new_types():
    with TestClient(create_app(Settings(db_enabled=False))) as c:
        s = str(c.get(f"{API}/events/schema").json())
        for t in ("station.load", "staff.status", "chaos.cost", "saves_s"):
            assert t in s
