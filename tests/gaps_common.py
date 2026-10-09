"""Helpers shared by the frontend-gap API tests."""

from __future__ import annotations

API = "/api/v1"


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


def events(c, wid, types):
    return [e for e in mgr_world(c, wid).ring.since(0) if e.type in types]
