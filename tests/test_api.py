from __future__ import annotations

import asyncio

import httpx
import pytest
from fastapi.testclient import TestClient

from brew.api.app import create_app
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
    body = {"policy": "A", "seed": 3, "scenario": "weekday_normal", **kw}
    r = c.post(f"{API}/worlds", json=body)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def step(c, wid, s):
    r = c.post(f"{API}/worlds/{wid}/control", json={"action": "step", "step_s": s})
    assert r.status_code == 200, r.text
    return r.json()


def mgr_world(c, wid):
    return c.app_.state.manager.worlds[wid]


# ------------------------------------------------------------------ worlds
def test_create_list_get_delete(api_client):
    c = api_client
    wid = mk(c)
    r = c.get(f"{API}/worlds/{wid}")
    assert r.status_code == 200
    j = r.json()
    assert j["status"] == "paused" and j["scenario"] == "weekday_normal" and j["policy"] == "A"
    assert j["clock"]["hhmm"] == "07:00" and "sim_s" in j["clock"] and j["clock"]["t"].endswith("+05:30")
    assert wid in [w["id"] for w in c.get(f"{API}/worlds").json()["items"]]
    assert c.delete(f"{API}/worlds/{wid}").status_code == 204
    assert c.get(f"{API}/worlds/{wid}").status_code == 404


def test_error_envelope_shapes(api_client):
    c = api_client
    r = c.get(f"{API}/worlds/nope")
    assert r.status_code == 404 and set(r.json()["error"]) == {"code", "message", "details"}
    r = c.post(f"{API}/worlds", json={"policy": "A", "speed": 7})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    r = c.post(f"{API}/worlds", json={"scenario": "nope"})
    assert r.status_code == 422
    r = c.post(f"{API}/worlds", json={"policy": "Z"})
    assert r.status_code == 422


def test_unimplemented_endpoints_return_501_with_milestone(api_client):
    c = api_client
    wid = mk(c)
    for method, path in (
        ("get", f"/worlds/{wid}/forecast"), ("get", f"/worlds/{wid}/bottlenecks"), ("get", f"/worlds/{wid}/advisor"),
        ("post", f"/worlds/{wid}/invest"), ("get", "/models"), ("get", "/decisions/abc/explain"), ("post", "/arena"),
        ("get", "/arena/xyz"),
    ):  # fmt: skip
        r = getattr(c, method)(
            API + path,
            **({"json": {"catalog_key": "x"} if "invest" in path else {}} if method == "post" else {}),
        )
        assert r.status_code == 501, (path, r.status_code, r.text)
        assert r.json()["error"]["code"] == "not_implemented" and "milestone" in r.json()["error"]["details"]
    r = c.post(f"{API}/worlds", json={"policy": "C"})
    assert r.status_code == 501 and r.json()["error"]["details"]["milestone"] == "M2"
    assert c.post(f"{API}/worlds", json={"policy": "D"}).json()["error"]["details"]["milestone"] == "M3"


def test_openapi_health_cafe_schema(api_client):
    c = api_client
    spec = c.get("/openapi.json").json()
    for p in ("/api/v1/worlds", "/api/v1/worlds/{wid}/actions", "/api/v1/worlds/{wid}/state", "/api/v1/cafe"):
        assert p in spec["paths"]
    h = c.get(f"{API}/health").json()
    assert h["status"] == "ok" and "git_sha" in h and "version" in h
    cafe = c.get(f"{API}/cafe").json()
    assert len(cafe["menu"]) == 23 and {t["id"] for t in cafe["tables"]["tables"]} == {
        f"T{i}" for i in range(1, 7)
    }
    assert len(cafe["personas"]) == 9 and len(cafe["scenarios"]) == 8
    sch = c.get(f"{API}/events/schema").json()
    assert "oneOf" in sch or "anyOf" in sch


# ----------------------------------------------------- state vs events coherence
def test_state_snapshot_coherent_with_events(api_client):
    c = api_client
    wid = mk(c, policy="B")
    step(c, wid, 4 * 3600 + 20 * 60)  # 11:20
    mw = mgr_world(c, wid)
    st = c.get(f"{API}/worlds/{wid}/state").json()
    for k in (
        "world",
        "clock",
        "weather",
        "kpis",
        "menu",
        "rail",
        "board",
        "customers",
        "tables",
        "fridge",
        "shelf",
        "staff",
        "equipment",
        "policy",
        "strategy",
        "last_seq",
    ):
        assert k in st, k
    assert st["last_seq"] == mw.world.seq == mw.ring.last_seq
    evs = mw.ring.since(0)
    placed = {
        e.data["order_no"]
        for e in evs
        if e.type == "order.placed" and e.data["channel"] in ("dine_in", "takeaway")
    }
    done = {e.data["order_no"] for e in evs if e.type in ("order.served", "order.voided")}
    rail_nos = set(st["rail"]["order_nos"])
    assert rail_nos <= placed
    assert not (rail_nos & done)
    # every open dine-in/takeaway order is on the rail
    open_ = {
        o["order_no"]
        for o in c.get(f"{API}/worlds/{wid}/orders").json()["items"]
        if o["status"] in ("queued", "brewing", "almost", "ready") and o["channel"] in ("dine_in", "takeaway")
    }
    assert open_ <= rail_nos
    arrived = {e.data["party_id"] for e in evs if e.type == "customer.arrived"}
    gone = {
        e.data["party_id"] for e in evs if e.type in ("customer.left", "customer.balked", "customer.reneged")
    }
    assert {x["party_id"] for x in st["customers"]} == arrived - gone
    assert st["kpis"]["open_orders"] == len(mw.world.orders.open)
    assert st["clock"]["hhmm"] == "11:20" and st["weather"]["state"]
    assert {m["sku"] for m in st["menu"]} == {
        m["sku"] for m in c.get(f"{API}/worlds/{wid}/menu").json()["items"]
    }


def test_read_models_have_sim_time(api_client):
    c = api_client
    wid = mk(c)
    step(c, wid, 5 * 3600)
    for p in (
        "menu",
        "orders",
        "rail",
        "board",
        "customers",
        "tables",
        "inventory",
        "fridge",
        "shelf",
        "staff",
        "equipment",
        "kpis",
        "impact",
        "reviews",
        "decisions",
        "disruptions",
    ):
        j = c.get(f"{API}/worlds/{wid}/{p}").json()
        assert "sim_s" in j and j["t"].startswith("2026-10-05T12:"), p
    lots = c.get(f"{API}/worlds/{wid}/inventory/milk/lots").json()["items"]
    assert lots and {"lot_id", "expires_s", "quality", "status"} <= set(lots[0])
    assert c.get(f"{API}/worlds/{wid}/inventory/nope/lots").status_code == 404
    inv = c.get(f"{API}/worlds/{wid}/inventory").json()["items"]
    assert {"coffee_beans", "chai_base"} <= {i["key"] for i in inv}
    assert len(c.get(f"{API}/worlds/{wid}/fridge").json()["items"]) == 5
    assert c.get(f"{API}/worlds/{wid}/shelf").json()["slots"] == 6


def test_receipt_endpoint(api_client):
    c = api_client
    wid = mk(c)
    step(c, wid, 5 * 3600)
    mw = mgr_world(c, wid)
    rec = next(e for e in mw.ring.since(0) if e.type == "receipt.printed")
    r = c.get(f"{API}/worlds/{wid}/receipts/{rec.data['order_no']}").json()
    assert (
        r["total"] == rec.data["total"] and abs(r["cgst"] - r["sgst"]) < 0.02 and r["qr"].startswith("upi://")
    )
    assert c.get(f"{API}/worlds/{wid}/receipts/99999").status_code == 404


# ------------------------------------------------------------------ control
def test_control_speed_pause_play(api_client):
    c = api_client
    wid = mk(c)
    for sp in (1, 10, 60):
        r = c.post(f"{API}/worlds/{wid}/control", json={"action": "speed", "speed": sp}).json()
        assert r["speed"] == sp and r["status"] == "playing"
        r = c.post(f"{API}/worlds/{wid}/control", json={"action": "pause"}).json()
        assert r["speed"] == 0 and r["status"] == "paused"
    assert c.post(f"{API}/worlds/{wid}/control", json={"action": "speed", "speed": 7}).status_code == 422
    r = c.post(f"{API}/worlds/{wid}/control", json={"action": "speed", "speed": 0}).json()
    assert r["status"] == "paused"
    before = c.get(f"{API}/worlds/{wid}").json()["clock"]["sim_s"]
    r = step(c, wid, 600)
    assert r["clock"]["sim_s"] == before + 600 and r["events"] > 0


async def test_pacer_advances_world_without_sleeping_in_tests():
    """Run the pacer coroutine with a huge base rate so a few ticks cover hours of sim time."""
    app = create_app(Settings(db_enabled=False, live_base_rate=2_000_000.0, pacer_tick_s=0.001))
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            wid = (await c.post(f"{API}/worlds", json={"policy": "A", "seed": 3})).json()["id"]
            start = (await c.get(f"{API}/worlds/{wid}")).json()["clock"]["sim_s"]
            r = await c.post(f"{API}/worlds/{wid}/control", json={"action": "play", "speed": 60})
            assert r.json()["status"] == "playing"
            for _ in range(500):
                await asyncio.sleep(0.002)
                if app.state.manager.worlds[wid].world.now - start > 3600 * 4:
                    break
            await c.post(f"{API}/worlds/{wid}/control", json={"action": "pause"})
            j = (await c.get(f"{API}/worlds/{wid}")).json()
            assert j["clock"]["sim_s"] - start > 3600 * 4 and j["status"] == "paused"


# ------------------------------------------------------------------ actions
def _step_until_ready(c, wid, channel=("dine_in", "takeaway")):
    mw = mgr_world(c, wid)
    step(c, wid, 3600 * 1.2)
    for _ in range(600):
        for no in sorted(mw.world.orders.ready_now):
            o = mw.world.orders.orders.get(no)
            if o is not None and o.channel in channel:
                return no
        mw.step(2)
    raise AssertionError("no ready order found")


def test_serve_order_ok_and_conflicts(api_client):
    c = api_client
    wid = mk(c)
    no = _step_until_ready(c, wid)
    r = c.post(f"{API}/worlds/{wid}/actions", json={"kind": "serve_order", "order_no": no})
    assert r.status_code == 200, r.text
    evs = mgr_world(c, wid).ring.since(0)
    assert any(
        e.type == "order.served" and e.data["order_no"] == no and e.data["by"] == "player" for e in evs
    )
    assert any(e.type == "action.applied" and e.data["kind"] == "serve_order" and e.data["ok"] for e in evs)
    # already served -> 409
    r = c.post(f"{API}/worlds/{wid}/actions", json={"kind": "serve_order", "order_no": no})
    assert r.status_code == 409 and r.json()["error"]["code"] == "invalid_action"
    # an order that is still being made -> 409
    mw = mgr_world(c, wid)
    open_ = next((o for o in mw.world.orders.open.values() if o.state != "ready"), None)
    if open_ is not None:
        assert (
            c.post(
                f"{API}/worlds/{wid}/actions", json={"kind": "serve_order", "order_no": open_.order_no}
            ).status_code
            == 409
        )
    assert (
        c.post(f"{API}/worlds/{wid}/actions", json={"kind": "serve_order", "order_no": 99999}).status_code
        == 404
    )
    assert c.post(f"{API}/worlds/{wid}/actions", json={"kind": "serve_order"}).status_code == 422
    assert c.post(f"{API}/worlds/{wid}/actions", json={"kind": "dance"}).status_code == 422


def test_bump_order(api_client):
    c = api_client
    wid = mk(c)
    step(c, wid, 3600 * 1.5)
    mw = mgr_world(c, wid)
    o = None
    for _ in range(200):
        o = next(
            (
                o
                for o in mw.world.orders.open.values()
                if o.state in ("queued", "brewing") and o.channel != "dine_in"
            ),
            None,
        )
        if o is not None:
            break
        mw.step(20)
    assert o is not None
    r = c.post(f"{API}/worlds/{wid}/actions", json={"kind": "bump_order", "order_no": o.order_no, "on": True})
    assert r.status_code == 200 and mw.world.orders.open[o.order_no].bumped
    rail = c.get(f"{API}/worlds/{wid}/rail").json()["order_nos"]
    assert rail[0] == o.order_no
    r = c.post(f"{API}/worlds/{wid}/actions", json={"kind": "bump_order", "order_no": 99999})
    assert r.status_code == 404


def test_set_price_charter(api_client):
    c = api_client
    wid = mk(c)
    r = c.post(f"{API}/worlds/{wid}/actions", json={"kind": "set_price", "sku": "cappuccino", "price": 400})
    assert r.status_code == 422 and r.json()["error"]["code"] == "charter_violation"
    r = c.post(f"{API}/worlds/{wid}/actions", json={"kind": "set_price", "sku": "chai", "price": 150})
    assert r.status_code == 422
    r = c.post(f"{API}/worlds/{wid}/actions", json={"kind": "set_price", "sku": "cappuccino", "price": 240})
    assert r.status_code == 200
    menu = {m["sku"]: m for m in c.get(f"{API}/worlds/{wid}/menu").json()["items"]}
    assert menu["cappuccino"]["price"] == 240 and menu["cappuccino"]["chip"]["dir"] == "up"
    ev = [e for e in mgr_world(c, wid).ring.since(0) if e.type == "price.changed"]
    assert ev and ev[-1].data["by"] == "owner"
    # second change inside 2 sim-hours -> cooldown violation
    r = c.post(f"{API}/worlds/{wid}/actions", json={"kind": "set_price", "sku": "cappuccino", "price": 250})
    assert r.status_code == 422


def test_feature_hide_throttle_restock_po(api_client):
    c = api_client
    wid = mk(c)
    A = f"{API}/worlds/{wid}/actions"
    assert c.post(A, json={"kind": "feature_item", "sku": "latte", "on": True}).status_code == 200
    assert c.post(A, json={"kind": "feature_item", "sku": "flatwhite", "on": True}).status_code == 200
    assert c.post(A, json={"kind": "feature_item", "sku": "matcha", "on": True}).status_code == 422  # max 2
    menu = {m["sku"]: m for m in c.get(f"{API}/worlds/{wid}/menu").json()["items"]}
    assert menu["latte"]["featured"]
    assert c.post(A, json={"kind": "hide_item", "sku": "waffle", "on": True}).status_code == 200
    menu = {m["sku"]: m for m in c.get(f"{API}/worlds/{wid}/menu").json()["items"]}
    assert menu["waffle"]["hidden"]
    assert c.post(A, json={"kind": "hide_item", "sku": "waffle", "on": False}).status_code == 200
    assert c.post(A, json={"kind": "throttle", "channel": "zomato", "level": "pause"}).status_code == 200
    assert c.get(f"{API}/worlds/{wid}/state").json()["policy"]["throttles"]["zomato"] == "pause"
    assert c.post(A, json={"kind": "throttle", "channel": "dine_in", "level": "pause"}).status_code == 422
    step(c, wid, 3 * 3600)
    r = c.post(A, json={"kind": "restock_fridge"})
    assert r.status_code in (200, 409)
    r = c.post(A, json={"kind": "place_po", "supplier": "dairy", "lines": {"milk": 20000}})
    assert r.status_code == 200 and r.json()["result"]["po_id"].startswith("po-")
    assert c.post(A, json={"kind": "place_po", "supplier": "nobody", "lines": {"milk": 1}}).status_code == 404
    assert (
        c.post(A, json={"kind": "place_po", "supplier": "dairy", "lines": {"coffee_beans": 1}}).status_code
        == 422
    )


# -------------------------------------------------------- policy / chaos / fork
def test_policy_and_strategy_switch(api_client):
    c = api_client
    wid = mk(c)
    r = c.post(f"{API}/worlds/{wid}/policy", json={"policy": "B", "strategy": "rush_menu"})
    assert r.status_code == 200 and r.json()["policy"] == "B" and r.json()["strategy"] == "rush_menu"
    types = [e.type for e in mgr_world(c, wid).ring.since(0)]
    assert "policy.changed" in types and "strategy.changed" in types
    assert c.post(f"{API}/worlds/{wid}/policy", json={"policy": "C"}).status_code == 501
    assert c.post(f"{API}/worlds/{wid}/policy", json={"strategy": "nope"}).status_code == 422
    assert c.post(f"{API}/worlds/{wid}/policy", json={}).status_code == 422


def test_chaos_creates_disruption_and_event(api_client):
    c = api_client
    wid = mk(c)
    step(c, wid, 3600)
    r = c.post(
        f"{API}/worlds/{wid}/chaos",
        json={"kind": "equipment_down", "target": "espresso_machine", "severity": 1, "duration_min": 30},
    )
    assert r.status_code == 201, r.text
    did = r.json()["id"]
    evs = mgr_world(c, wid).ring.since(0)
    assert any(e.type == "chaos.triggered" and e.data["kind"] == "equipment_down" for e in evs)
    assert any(e.type == "equipment.down" for e in evs)
    assert any(
        d["id"] == did and d["active"] for d in c.get(f"{API}/worlds/{wid}/disruptions").json()["items"]
    )
    eq = {e["key"]: e for e in c.get(f"{API}/worlds/{wid}/equipment").json()["items"]}
    assert eq["espresso_machine"]["status"] == "down"
    step(c, wid, 31 * 60)
    eq = {e["key"]: e for e in c.get(f"{API}/worlds/{wid}/equipment").json()["items"]}
    assert eq["espresso_machine"]["status"] == "up"
    assert any(e.type == "chaos.resolved" for e in mgr_world(c, wid).ring.since(0))
    assert c.post(f"{API}/worlds/{wid}/chaos", json={"kind": "zombie"}).status_code == 422
    assert (
        c.post(f"{API}/worlds/{wid}/chaos", json={"kind": "staff_absent", "target": "nobody"}).status_code
        == 422
    )


def test_staff_absent_chaos_removes_staff(api_client):
    c = api_client
    wid = mk(c)
    step(c, wid, 3 * 3600)
    c.post(
        f"{API}/worlds/{wid}/chaos", json={"kind": "staff_absent", "target": "barista_a", "duration_min": 120}
    )
    staff = {s["id"]: s for s in c.get(f"{API}/worlds/{wid}/staff").json()["items"]}
    assert staff["barista_a"]["absent"] and not staff["barista_a"]["present"]


def test_fork_creates_independent_world(api_client):
    c = api_client
    wid = mk(c, policy="B")
    step(c, wid, 4 * 3600)
    r = c.post(f"{API}/worlds/{wid}/fork", json={"at": "now", "kind": "counterfactual"})
    assert r.status_code == 201, r.text
    child = r.json()
    assert child["id"] != wid and child["parent_id"] == wid and child["kind"] == "counterfactual"
    assert child["clock"]["sim_s"] == c.get(f"{API}/worlds/{wid}").json()["clock"]["sim_s"]
    step(c, child["id"], 3 * 3600)
    assert c.get(f"{API}/worlds/{wid}").json()["clock"]["hhmm"] == "11:00"
    assert c.get(f"{API}/worlds/{child['id']}").json()["clock"]["hhmm"] == "14:00"
    c.post(f"{API}/worlds/{child['id']}/chaos", json={"kind": "power_cut", "duration_min": 60})
    assert not any(d["active"] for d in c.get(f"{API}/worlds/{wid}/disruptions").json()["items"])


# --------------------------------------------------------------------- DB
def test_api_persists_to_db(tmp_path):
    from sqlalchemy import func, select

    from brew.db import models as m
    from brew.db.session import make_sync_engine, sync_session_factory

    url = f"sqlite:///{tmp_path}/api.db"
    app = create_app(Settings(db_enabled=True, database_url=url))
    with TestClient(app) as c:
        wid = mk(c)
        step(c, wid, 8 * 3600)
        mw = app.state.manager.worlds[wid]
        c.portal.call(mw.db_sink.flush)
    eng = make_sync_engine(url)
    with sync_session_factory(eng)() as s:
        assert s.scalar(select(func.count()).select_from(m.Order).where(m.Order.world_id == wid)) > 100
        assert s.scalar(select(func.count()).select_from(m.World).where(m.World.id == wid)) == 1
        assert s.scalar(select(func.count()).select_from(m.SimEvent).where(m.SimEvent.world_id == wid)) > 1000
