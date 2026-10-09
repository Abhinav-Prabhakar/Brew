"""Chaos card: the six UI kinds (targeted + untargeted), rain_storm, chaos.cost (CRN counterfactual)."""

from __future__ import annotations

import pytest
from gaps_common import API, events, mk, step

from brew.events.schema import validate_event

pytestmark = pytest.mark.integration

UI_KINDS = ["staff_absent", "equipment_down", "supplier_delay", "rain_storm", "rider_shortage", "power_cut"]


def test_chaos_kinds_endpoint(gap_client):
    items = gap_client.get(f"{API}/chaos/kinds").json()["items"]
    assert [i["kind"] for i in items] == UI_KINDS
    by = {i["kind"]: i for i in items}
    assert by["equipment_down"]["default_target"] == "oven"
    assert by["supplier_delay"]["default_target"] == "dairy"
    assert by["staff_absent"]["default_target"].startswith("barista")
    assert all(i["label"] and i["description"] for i in items)


@pytest.mark.parametrize("kind", UI_KINDS)
@pytest.mark.parametrize("targeted", [False, True])
def test_each_ui_kind_triggers_and_resolves(gap_client, kind, targeted):
    c = gap_client
    wid = mk(c, seed=4)
    step(c, wid, 3 * 3600)
    default = {i["kind"]: i["default_target"] for i in c.get(f"{API}/chaos/kinds").json()["items"]}[kind]
    body = {"kind": kind, "duration_min": 20}
    if targeted and default:
        body["target"] = default
    r = c.post(f"{API}/worlds/{wid}/chaos", json=body)
    assert r.status_code == 201, r.text
    d = r.json()
    if default:
        assert d["target"] == default
    step(c, wid, 60)
    trig = events(c, wid, {"chaos.triggered"})
    assert trig and trig[-1].data["kind"] == kind
    rows = c.get(f"{API}/worlds/{wid}/disruptions").json()["items"]
    assert any(x["id"] == d["id"] and x["active"] for x in rows)
    step(c, wid, 25 * 60)
    res = events(c, wid, {"chaos.resolved"})
    assert res and res[-1].data["disruption_id"] == d["id"]
    side = {
        "staff_absent": "staff.absent", "equipment_down": "equipment.down", "power_cut": "equipment.down",
        "rain_storm": "weather.changed",
    }.get(kind)
    if side:
        assert events(c, wid, {side})
    if kind == "equipment_down":
        assert events(c, wid, {"equipment.up"})


def test_rain_storm_switches_weather_and_reverts(gap_client):
    c = gap_client
    wid = mk(c, seed=4)
    step(c, wid, 3 * 3600)
    before = c.get(f"{API}/worlds/{wid}/state").json()["weather"]["state"]
    c.post(f"{API}/worlds/{wid}/chaos", json={"kind": "rain_storm", "duration_min": 90})
    step(c, wid, 120)
    w = c.get(f"{API}/worlds/{wid}/state").json()["weather"]
    assert w["state"] == "rain" and w["rain_mm_h"] > 0
    step(c, wid, 3600)  # an hourly weather tick passes: the storm holds
    assert c.get(f"{API}/worlds/{wid}/state").json()["weather"]["state"] == "rain"
    step(c, wid, 1800)
    after = c.get(f"{API}/worlds/{wid}/state").json()["weather"]["state"]
    assert after != "rain" or before == "rain"
    ch = events(c, wid, {"weather.changed"})
    assert any(e.data["state"] == "rain" for e in ch)


def test_rain_storm_shifts_demand_towards_delivery():
    from brew.sim.world import World

    w = World(policy="A", seed=3)
    w.advance_to(9 * 3600)
    base = w.dynamic_mult("student", "zomato")
    w.trigger_chaos("rain_storm", None, 1.0, 60.0)
    w.advance_to(w.now)
    assert w.weather_state == "rain"
    assert w.dynamic_mult("student", "zomato") >= base


def test_unknown_kind_and_target_rejected(gap_client):
    c = gap_client
    wid = mk(c)
    assert c.post(f"{API}/worlds/{wid}/chaos", json={"kind": "meteor"}).status_code == 422
    assert c.post(f"{API}/worlds/{wid}/chaos", json={"kind": "equipment_down", "target": "nope"}).status_code == 422


# ----------------------------------------------------------------------------- cost of chaos
def _run_outage(seed: int) -> tuple[list, list]:
    from fastapi.testclient import TestClient

    from brew.api.app import create_app
    from brew.settings import Settings

    with TestClient(create_app(Settings(db_enabled=False))) as c:
        c.app_ = c.app  # type: ignore[attr-defined]
        wid = mk(c, seed=seed)
        step(c, wid, 4.5 * 3600)  # 11:30: the late-morning rush
        r = c.post(f"{API}/worlds/{wid}/chaos", json={"kind": "equipment_down", "target": "espresso", "duration_min": 40})
        assert r.status_code == 201 and r.json()["cost_tracked"] is True
        step(c, wid, 3600 + 20 * 60)
        mid = c.get(f"{API}/worlds/{wid}/disruptions").json()["items"]
        evs = events(c, wid, {"chaos.cost"})
        return evs, mid


def test_chaos_cost_events_positive_and_deterministic():
    evs, rows = _run_outage(seed=11)
    assert evs
    for e in evs:
        validate_event("chaos.cost", e.data)
    phases = [e.data["phase"] for e in evs]
    assert phases.count("active") >= 7 and phases.count("resolved") == 1 and phases.count("final") == 1
    assert phases[-1] == "final" and phases[-2] == "resolved"
    act = [e for e in evs if e.data["phase"] == "active"]
    assert all(b.sim_s - a.sim_s == pytest.approx(300.0) for a, b in zip(act, act[1:], strict=False))
    for e in evs:
        d = e.data
        assert d["cost_inr"] == pytest.approx(d["profit_counterfactual"] - d["profit_actual"], abs=0.01)
    assert evs[-1].data["cost_inr"] > 0, "an espresso outage in the rush must cost money"
    assert rows[0]["cost_inr"] == evs[-1].data["cost_inr"]
    evs2, _ = _run_outage(seed=11)
    assert [e.data for e in evs2] == [e.data for e in evs]


def test_shadow_limit_and_cleanup(gap_client):
    c = gap_client
    wid = mk(c, seed=4)
    step(c, wid, 3 * 3600)
    tracked = [
        c.post(f"{API}/worlds/{wid}/chaos", json={"kind": "rider_shortage", "duration_min": 10}).json()["cost_tracked"]
        for _ in range(3)
    ]
    assert tracked == [True, True, False]
    mw = c.app_.state.manager.worlds[wid]
    assert len(mw.shadows) == 2
    step(c, wid, 3600)  # resolved + final reading 30 min later: shadows are dropped
    assert len(mw.shadows) == 0
    rows = c.get(f"{API}/worlds/{wid}/disruptions").json()["items"]
    assert sum(1 for r in rows if r["cost_inr"] is not None) == 2
    assert all("cost_inr" in x for x in c.get(f"{API}/worlds/{wid}/state").json()["disruptions"])


def test_headless_world_unaffected_by_probe_absence():
    from brew.sim.world import World

    w = World(policy="A", seed=3)
    w.advance_to(8 * 3600)
    d = w.trigger_chaos("power_cut", None, 1.0, 10.0)
    d.meta["cost_track"] = True  # no probe installed: must be a silent no-op
    w.advance_to(9 * 3600)
    assert d.resolved
