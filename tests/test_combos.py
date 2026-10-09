"""Meal combos (backend.md 3.12): live derived prices, pairing, up-sell, order lines, events, API."""

from __future__ import annotations

import pytest

from brew.sim.combos import CB, combo_of, real_mods
from brew.sim.world import World


@pytest.fixture(scope="module")
def day_pair():
    on = World(policy="B", seed=5, days=1)
    on.run(1)
    off = World(policy="B", seed=5, days=1)
    off.combos.enabled = False
    off.run(1)
    return on, off


def test_markers_are_stripped_from_real_mods():
    assert combo_of(("oat", CB + "morning_fuel")) == "morning_fuel"
    assert combo_of(("oat",)) is None
    assert real_mods(("oat", "~rp", CB + "x")) == ("oat",)


def test_combo_price_is_derived_from_live_component_prices():
    w = World(policy="A", seed=1, days=1)
    cb = w.combos
    full = cb.list_sum("morning_fuel")
    assert cb.price("morning_fuel") < full
    assert cb.price("morning_fuel") % 5 == 0  # rounded to the Rs5 grid
    events = []
    w.sink = type("S", (), {"emit": lambda self, e: events.append(e)})()
    old = cb.price("morning_fuel")
    ok, _ = w.set_price("cappuccino", w.menu["cappuccino"].price + 20, by="test", reason="test")
    assert ok
    assert cb.price("morning_fuel") > old
    ch = [e for e in events if e.type == "price.changed" and e.data["sku"] == "combo:morning_fuel"]
    assert ch and ch[-1].data["old"] == old and ch[-1].data["new"] == cb.price("morning_fuel")


def test_pairing_and_upsell_rules():
    w = World(policy="A", seed=1, days=1)
    cb = w.combos
    # both halves present -> paired, nothing added
    items = cb.mark_basket([("cappuccino", ()), ("croissant", ())], "commuter", 0.99, False)
    assert len(items) == 2 and all(combo_of(m) == "morning_fuel" for _, m in items)
    # one half + a lucky draw -> the other half is added at the combo price
    items = cb.mark_basket([("chai", ())], "student", 0.0, False)
    assert [s for s, _ in items] == ["chai", "cinnamon"] and all(combo_of(m) == "chai_bun" for _, m in items)
    # one half + an unlucky draw -> unchanged
    assert cb.mark_basket([("chai", ())], "student", 0.999, False) == [("chai", ())]
    # replate-priced units are never part of a combo
    assert cb.mark_basket([("chai", ("~rp",))], "student", 0.0, False) == [("chai", ("~rp",))]
    # a hidden component blocks the combo
    w.menu["cinnamon"].hidden = "sold out"
    assert cb.mark_basket([("chai", ())], "student", 0.0, False) == [("chai", ())]


def test_combo_lines_sum_to_the_combo_price(day_pair):
    on, _ = day_pair
    found = 0
    for o in on.orders.orders.values():
        lines = [ln for ln in o.lines if ln.get("combo")]
        if len(lines) == 2 and all(ln["qty"] == 1 and not ln["mods"] for ln in lines):
            cid = lines[0]["combo"]
            assert lines[1]["combo"] == cid
            found += 1
    assert found > 0


def test_combos_lift_the_ticket_without_losing_profit(day_pair):
    on, off = day_pair
    k_on, k_off = on.daily_kpis[0], off.daily_kpis[0]
    assert k_on["combo_orders"] > 0 and k_on["combo_upsells"] > 0
    assert k_off["combo_orders"] == 0
    assert k_on["revenue"] > k_off["revenue"]
    assert k_on["net_profit"] > k_off["net_profit"] * 0.99


def test_combo_api_and_state():
    from fastapi.testclient import TestClient

    from brew.api.app import create_app
    from brew.settings import Settings

    with TestClient(create_app(Settings(db_enabled=False))) as c:
        _check_api(c)


def _check_api(c):
    wid = c.post("/api/v1/worlds", json={"policy": "A", "seed": 3}).json()["id"]
    r = c.get(f"/api/v1/worlds/{wid}/combos")
    assert r.status_code == 200
    combos = r.json()["data"]["combos"] if "data" in r.json() else r.json()["combos"]
    assert {x["id"] for x in combos} >= {"morning_fuel", "chai_bun"}
    assert all(x["price"] < x["list_price"] for x in combos)
    assert "combos" in c.get(f"/api/v1/worlds/{wid}/state").json()
