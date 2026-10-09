"""station.load / staff.status events, /stations and /staff read models, snapshot keys."""

from __future__ import annotations

import pytest
from gaps_common import API, events, mk, step

pytestmark = pytest.mark.integration


def test_station_load_and_staff_status_events(gap_client):
    c = gap_client
    wid = mk(c, seed=5)
    step(c, wid, 3 * 3600)  # 07:00 -> 10:00 (café opens 08:00)
    sl = events(c, wid, {"station.load"})
    assert sl, "no station.load"
    assert sl[0].sim_s == pytest.approx(8 * 3600)  # once at open
    assert all(b.sim_s - a.sim_s == pytest.approx(60.0) for a, b in zip(sl, sl[1:], strict=False))
    rows = sl[-1].data["stations"]
    keys = {r["station"] for r in rows}
    assert {"espresso", "oven", "grinder", "dishpit", "register", "pass", "prep"} <= keys
    for r in rows:
        assert 0.0 <= r["util"] <= 1.0 and r["status"] in ("up", "down") and r["queue"] >= 0
        assert set(r) == {"station", "util", "queue", "in_use", "slots", "status", "down_until_s"}
    assert any(r["util"] > 0 for r in rows)
    ss = events(c, wid, {"staff.status"})
    assert ss and ss[0].sim_s < sl[0].sim_s  # staff arrive before opening
    st = ss[-1].data["staff"]
    assert {r["state"] for r in st} <= {"working", "idle", "break", "off", "absent"}
    assert all("fatigue" in r and "break_due_s" in r and "break_end_s" in r for r in st)


def test_stations_readmodel_and_snapshot(gap_client):
    c = gap_client
    wid = mk(c, seed=5)
    step(c, wid, 3 * 3600)
    r = c.get(f"{API}/worlds/{wid}/stations").json()
    assert r["items"] and "sim_s" in r
    snap = c.get(f"{API}/worlds/{wid}/state").json()
    assert [x["station"] for x in snap["stations"]] == [x["station"] for x in r["items"]]


def test_staff_readmodel_break_fields(gap_client):
    c = gap_client
    wid = mk(c, seed=5)
    step(c, wid, 4 * 3600)  # 11:00
    rows = {x["id"]: x for x in c.get(f"{API}/worlds/{wid}/staff").json()["items"]}
    assert rows["barista_a"]["break_rule"].startswith("30 min break from 11:00")
    for _ in range(60):  # run until barista_a goes on break
        if rows["barista_a"]["state"] == "break":
            break
        step(c, wid, 60)
        rows = {x["id"]: x for x in c.get(f"{API}/worlds/{wid}/staff").json()["items"]}
    a = rows["barista_a"]
    assert a["state"] == "break" and a["break_end_s"] is not None and a["break_due_s"] is None
    b = rows["barista_b"]
    assert b["break_due_s"] == pytest.approx(16 * 3600) and b["break_end_s"] is None
    snap = c.get(f"{API}/worlds/{wid}/state").json()
    assert {x["id"]: x["state"] for x in snap["staff"]}["barista_a"] == "break"


def test_station_down_reflected(gap_client):
    c = gap_client
    wid = mk(c, seed=5)
    step(c, wid, 3 * 3600)
    r = c.post(f"{API}/worlds/{wid}/chaos", json={"kind": "equipment_down", "target": "oven", "duration_min": 30})
    assert r.status_code == 201
    step(c, wid, 120)
    oven = next(x for x in c.get(f"{API}/worlds/{wid}/stations").json()["items"] if x["station"] == "oven")
    assert oven["status"] == "down" and oven["down_until_s"] > 0
