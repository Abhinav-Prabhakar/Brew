"""Backend gaps for the frontend integration (serve design, saves_s, station.load, staff.status, chaos, ...)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from brew.api.app import create_app
from brew.settings import Settings

pytestmark = pytest.mark.integration
API = "/api/v1"


@pytest.fixture
def c():
    app = create_app(Settings(db_enabled=False))
    with TestClient(app) as cl:
        cl.app_ = app  # type: ignore[attr-defined]
        yield cl


def mk(c, **kw) -> str:
    r = c.post(f"{API}/worlds", json={"policy": "A", "seed": 3, **kw})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def step(c, wid, s):
    r = c.post(f"{API}/worlds/{wid}/control", json={"action": "step", "step_s": s})
    assert r.status_code == 200, r.text
    return r.json()


def mgr_world(c, wid):
    return c.app_.state.manager.worlds[wid]


def test_design_served(c):
    r = c.get("/")
    assert r.status_code == 200 and "brew" in r.text.lower()
    assert c.get("/lobby.js").status_code == 200
    assert c.get(f"{API}/health").json()["status"] == "ok"
    assert c.get(f"{API}/nope").status_code == 404


def test_design_can_be_disabled():
    app = create_app(Settings(db_enabled=False, serve_design=False))
    with TestClient(app) as cl:
        assert cl.get("/").status_code == 404
