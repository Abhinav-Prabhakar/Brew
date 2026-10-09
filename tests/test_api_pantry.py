"""Pantry read models: inventory rows + freshness, usage forecast, proposed PO round trip, waste baseline."""

from __future__ import annotations

import pytest
from gaps_common import API, events, mk, step

pytestmark = pytest.mark.integration


def test_inventory_rows_and_freshness(gap_client):
    c = gap_client
    wid = mk(c, seed=5)
    step(c, wid, 5 * 3600)
    j = c.get(f"{API}/worlds/{wid}/inventory").json()
    assert isinstance(j["items"], list) and {"coffee_beans", "milk"} <= {r["key"] for r in j["items"]}
    fr = j["freshness"]
    assert set(fr) == {"fresh", "soon", "expiring"} and sum(fr.values()) == pytest.approx(1.0, abs=2e-4)
    assert j["value_inr"] > 0 and j["freshness_rules"]
    milk = next(r for r in j["items"] if r["key"] == "milk")
    assert milk["supplier"] and milk["supplier_key"] == "dairy"
    assert milk["unit_cost"] > 0 and milk["value_inr"] > 0 and milk["co2e_kg_per_kg"] > 0
    assert milk["freshness"] in ("fresh", "soon", "expiring")
    beans = next(r for r in j["items"] if r["key"] == "coffee_beans")
    assert beans["freshness"] == "fresh"
    assert all(r["freshness"] in (None, "fresh", "soon", "expiring") for r in j["items"])
    # value-weighted: recompute from the lots endpoint
    w = c.app_.state.manager.worlds[wid].world
    tot = sum(lt.qty * lt.unit_cost for k, ls in w.inv.lots.items() if k not in w.inv.virtual for lt in ls)
    assert j["value_inr"] == pytest.approx(tot, abs=0.5)


def test_freshness_thresholds():
    from types import SimpleNamespace

    from brew.sim.readmodels import freshness_of

    w = SimpleNamespace(now=1000.0 * 3600)
    mk_lot = lambda left_h, life_h: SimpleNamespace(  # noqa: E731
        expires_s=w.now + left_h * 3600, received_s=w.now + left_h * 3600 - life_h * 3600
    )
    assert freshness_of(w, mk_lot(20, 4000)) == "expiring"  # <= 24 h
    assert freshness_of(w, mk_lot(30, 600)) == "expiring"  # 5 % of life left, 30 h
    assert freshness_of(w, mk_lot(60, 100)) == "soon"  # <= 72 h
    assert freshness_of(w, mk_lot(100, 400)) == "soon"  # 25 % left, < 14 d
    assert freshness_of(w, mk_lot(300, 400)) == "fresh"
    assert freshness_of(w, mk_lot(400, 4320)) == "fresh"  # 9 % but > 14 d left: long-life stock is not urgent
    assert freshness_of(w, mk_lot(150, 4320)) == "expiring"  # 3.5 %, 6 d left


def test_inventory_usage_forecast(gap_client):
    c = gap_client
    wid = mk(c, seed=5)
    step(c, wid, 3 * 3600)  # 10:00
    r = c.get(f"{API}/worlds/{wid}/inventory/milk/forecast").json()
    assert {"key", "uom", "p50", "p90", "used_so_far", "on_hand", "days_of_cover"} <= set(r)
    assert r["uom"] == "ml" and r["used_so_far"] > 0
    assert r["p90"] >= r["p50"] >= r["used_so_far"] > 0
    assert r["p50"] == pytest.approx(r["used_so_far"] + r["remaining_p50"], abs=0.02)
    # the day's demand scales usage: remaining usage is positive in the morning and zero after closing
    assert r["remaining_p50"] > 0
    assert r["days_of_cover"] == pytest.approx(r["on_hand"] / r["p50"], abs=0.02)
    again = c.get(f"{API}/worlds/{wid}/inventory/milk/forecast").json()  # cached slot
    assert again["p50"] == r["p50"]
    assert c.get(f"{API}/worlds/{wid}/inventory/nope/forecast").status_code == 404
    step(c, wid, 14 * 3600)  # after close
    late = c.get(f"{API}/worlds/{wid}/inventory/milk/forecast").json()
    assert late["remaining_p50"] == 0 and late["p50"] == late["used_so_far"]


def test_usage_forecast_is_ordered_across_keys(gap_client):
    c = gap_client
    wid = mk(c, seed=5)
    step(c, wid, 3 * 3600)
    for key in ("coffee_beans", "chai_base", "paneer_marinade", "croissant_baked"):
        r = c.get(f"{API}/worlds/{wid}/inventory/{key}/forecast").json()
        assert r["p90"] >= r["p50"] >= 0, key


@pytest.mark.parametrize("policy", ["A", "B", "C"])
def test_purchasing_proposal_round_trip(gap_client, policy):
    c = gap_client
    wid = mk(c, seed=5, policy=policy)
    step(c, wid, 6 * 3600)
    p = c.get(f"{API}/worlds/{wid}/purchasing/proposal").json()
    assert p["policy"] == policy and p["service_level"]
    assert p["orders"], "a proposal should always give the owner something to approve"
    assert p["total_inr"] == pytest.approx(sum(o["total_inr"] for o in p["orders"]), abs=0.02)
    assert p["supplier"] == p["orders"][0]["supplier"] and p["lines"] == p["orders"][0]["lines"]
    if policy == "C":
        assert p["service_level"].startswith("sized to P9")
    o = p["orders"][0]
    for ln in o["lines"]:
        assert {"ingredient", "name", "qty", "packs", "uom", "cost_inr", "reason"} <= set(ln)
        assert ln["qty"] > 0 and ln["packs"] >= 1
    # proposal has no side effects
    n_before = len(events(c, wid, {"po.created"}))
    p2 = c.get(f"{API}/worlds/{wid}/purchasing/proposal").json()
    assert p2["orders"] == p["orders"] and len(events(c, wid, {"po.created"})) == n_before
    # approve: place_po with exactly the proposal's lines -> po.created with the same packs and ETA
    r = c.post(
        f"{API}/worlds/{wid}/actions",
        json={"kind": "place_po", "supplier": o["supplier"], "lines": o["lines"], "arrive_tod_s": o["arrive_tod_s"]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["result"]["eta_s"] == pytest.approx(o["eta_s"], abs=0.2)
    assert r.json()["result"]["total"] == pytest.approx(o["total_inr"], abs=0.02)
    created = events(c, wid, {"po.created"})[-1].data
    assert created["supplier"] == o["supplier"]
    assert {(x["ingredient"], x["packs"]) for x in created["lines"]} == {(x["ingredient"], x["packs"]) for x in o["lines"]}
    # the PO book changed: the next proposal reflects the open order and next_delivery points at it
    p3 = c.get(f"{API}/worlds/{wid}/purchasing/proposal").json()
    assert p3["next_delivery_s"] is not None and p3["next_delivery_s"] <= o["eta_s"]
    assert p3["next_delivery"]["eta_s"] == p3["next_delivery_s"]


def test_proposal_does_not_change_the_world(gap_client):
    c = gap_client
    wid = mk(c, seed=5, policy="C")
    step(c, wid, 6 * 3600)
    before = c.get(f"{API}/worlds/{wid}/state").json()["last_seq"]
    c.get(f"{API}/worlds/{wid}/purchasing/proposal")
    assert c.get(f"{API}/worlds/{wid}/state").json()["last_seq"] == before
    # same continuation with or without having asked
    wid2 = mk(c, seed=5, policy="C")
    step(c, wid2, 6 * 3600)
    step(c, wid, 3600)
    step(c, wid2, 3600)
    a = c.get(f"{API}/worlds/{wid}/kpis").json()["rolling"]
    b = c.get(f"{API}/worlds/{wid2}/kpis").json()["rolling"]
    assert a == b


def test_impact_waste_baseline_fields(gap_client):
    c = gap_client
    wid = mk(c, seed=5)
    step(c, wid, 6 * 3600)
    j = c.get(f"{API}/worlds/{wid}/impact").json()
    assert j["waste_kg_today"] >= 0
    assert j["waste_kg_by_day"][-1]["day"] == 0 and j["waste_kg_by_day"][-1]["partial"] is True
    assert j["waste_kg_by_day"][-1]["waste_kg"] == j["waste_kg_today"]
    assert "economic" in j and "environmental" in j  # existing shape kept
    for _ in range(2):  # two more days
        step(c, wid, 86400)
    j = c.get(f"{API}/worlds/{wid}/impact").json()
    days = [r["day"] for r in j["waste_kg_by_day"]]
    assert days == sorted(days) and len(days) <= 7 and days[-1] == c.get(f"{API}/worlds/{wid}/state").json()["clock"]["day"]
