from __future__ import annotations

import time

import pytest

from brew.config.loader import default_cafe, default_policies
from brew.policies.base import ManagerAction
from brew.policies.charter import Charter, CharterViolation
from brew.policies.registry import make_policy
from brew.sim.observation import NAMES, ObservationBuilder
from brew.sim.world import World

cfg = default_cafe()
charter = Charter(default_policies().charter)
CAP = cfg.menu[0]  # cappuccino 220, bounds 190-260
CHAI = next(m for m in cfg.menu if m.sku == "chai")


# ------------------------------------------------------------------- charter
def test_price_must_stay_in_bounds():
    r = charter.check_price(CAP, 220, 400, now=1e6, last_change_s=-1e9)
    assert r.ok and r.price <= 260 and r.clipped


def test_step_limit_ten_percent_of_base():
    r = charter.check_price(CAP, 220, 255, now=1e6, last_change_s=-1e9)
    assert r.ok and r.price == 240  # 220 + 22 -> 242 -> grid 240
    r = charter.check_price(CAP, 220, 200, now=1e6, last_change_s=-1e9)
    assert r.ok and r.price == 200
    with pytest.raises(CharterViolation):
        charter.check_price(CAP, 220, 255, now=1e6, last_change_s=-1e9, strict=True)


def test_five_rupee_grid():
    r = charter.check_price(CAP, 220, 232, now=1e6, last_change_s=-1e9)
    assert r.price % 5 == 0


def test_cooldown_two_hours():
    r = charter.check_price(CAP, 220, 230, now=1000, last_change_s=0)
    assert not r.ok and "2 sim-hours" in r.reason
    assert charter.check_price(CAP, 220, 230, now=7300, last_change_s=0).ok


def test_staples_never_increase():
    r = charter.check_price(CHAI, 130, 140, now=1e6, last_change_s=-1e9)
    assert not r.ok
    assert charter.check_price(CHAI, 140, 130, now=1e6, last_change_s=-1e9).ok
    # restoring a promotion back up to base is allowed
    assert charter.check_price(CHAI, 125, 140, now=1e6, last_change_s=-1e9, restore=True).ok


def test_promotion_decrease_only_not_below_min():
    assert charter.check_price(CAP, 220, 190, now=0, last_change_s=0, promotion=True).price == 190
    r = charter.check_price(CAP, 220, 150, now=0, last_change_s=0, promotion=True)
    assert r.price == 190 and r.clipped
    assert not charter.check_price(CAP, 200, 230, now=0, last_change_s=0, promotion=True).ok


def test_placed_orders_keep_their_price():
    w = World(policy="A", seed=3)
    w.run_until(9 * 3600)
    o = next(iter(w.orders.open.values()))
    before = [ln["unit_price"] for ln in o.lines]
    sku = o.lines[0]["sku"]
    item = w.ix.menu[sku]
    if not item.staple:
        w.menu[sku].last_change_s = -1e9
        ok, _ = w.set_price(sku, w.menu[sku].price + 20, "owner")
        assert ok
    assert [ln["unit_price"] for ln in o.lines] == before


def test_feature_limit_and_hide_rule():
    w = World(policy="A", seed=3)
    w.run_until(9 * 3600)
    w.set_featured("cappuccino", True, "owner")
    w.set_featured("latte", True, "owner")
    with pytest.raises(CharterViolation):
        w.set_featured("flatwhite", True, "owner")
    # 86: cannot hide an item that open orders still need to start
    for o in list(w.orders.open.values()):
        for u in o.units:
            u.started = False
    sku = next(iter(w.orders.open.values())).units[0].sku if w.orders.open else None
    if sku:
        with pytest.raises(CharterViolation):
            w.set_hidden(sku, True, "owner", "owner", "x")


def test_shield_clips_manager_action():
    w = World(policy="A", seed=3)
    w.run_until(9 * 3600)
    a = ManagerAction(price_steps={"coffee": 0.10, "notcoffee": 0.10}, reason="test")
    res = w.apply_manager_action(a, by="test")
    assert res["applied"]
    # staples excluded from increases
    assert w.menu["chai"].price == 140 and w.menu["filtercoffee"].price == 120
    # second change within 2 hours is clipped
    res2 = w.apply_manager_action(ManagerAction(price_steps={"coffee": 0.05}), by="test")
    assert not res2["applied"] and res2["clipped"]


# ------------------------------------------------------------------ strategies
def test_manual_strategies_change_menu_and_dispatch():
    w = World(policy="B", seed=3)
    w.run_until(9 * 3600)
    w.set_strategy("happy_hour")
    assert w.menu["latte"].price < w.menu["latte"].base
    assert w.menu["latte"].price >= w.ix.menu["latte"].min_price
    assert w.menu["croissant"].price == w.menu["croissant"].base
    w.set_strategy("balanced")
    assert w.menu["latte"].price == w.menu["latte"].base
    w.set_strategy("rush_menu")
    w.run_until(w.now + 3 * 3600)
    for sku in ("pasta", "sandwich", "avotoast"):
        assert w.menu[sku].hidden == "Sold out for now"
    assert w.effective_preset() == "throughput"
    w.set_strategy("delivery_first")
    assert w.menu["pasta"].hidden is None
    assert w.effective_preset() == "delivery_jit"
    with pytest.raises(ValueError):
        w.set_strategy("nope")


# -------------------------------------------------------------------- policies
def test_policies_satisfy_protocol_and_run_full_day(day_a, day_b):
    for w, code in ((day_a, "A"), (day_b, "B")):
        p = w.policy
        assert p.code == code
        for m in ("reset", "on_manager_tick", "accept", "dispatch", "on_day_end", "explain"):
            assert callable(getattr(p, m))
        assert w.daily_kpis[0]["orders"] > 250


def test_b_pauses_aggregators_under_load():
    w = World(policy="B", seed=9, scenario="rainy_delivery_surge")
    w.run()
    evs = w.__dict__.get("test_sink")
    assert evs is None
    assert any("pausing" in d["summary"] for d in w.decisions) or w.delivery.paused_hours_today is not None


def test_b_happy_hour_prices_in_dead_hours():
    w = World(policy="B", seed=9)
    w.run_until(15.5 * 3600)
    assert w.menu["latte"].price < w.menu["latte"].base
    w.run_until(17.5 * 3600)
    assert w.menu["latte"].price == w.menu["latte"].base


def test_policy_d_is_a_stub_c_and_e_exist():
    with pytest.raises(NotImplementedError, match="M3"):
        make_policy("D")
    assert make_policy("C").code == "C" and make_policy("E").code == "E"


def test_policy_decisions_recorded(day_b):
    decs = day_b.test_sink.of_type("decision.made")
    assert decs and all(d.data["policy"] in ("B", "owner") for d in decs)


# ------------------------------------------------------------------ observation
def test_observation_is_named_183(day_b):
    obs = ObservationBuilder(day_b).build()
    assert obs.vec.shape == (183,) and len(NAMES) == 183 and len(set(NAMES)) == 183
    assert obs.get("tod_sin") is not None
    assert all(abs(v) <= 3.5 for v in obs.vec)


def test_world_view_is_read_only():
    w = World(policy="A", seed=3)
    v = w.view()
    with pytest.raises(AttributeError):
        v.now = 5  # type: ignore[misc]
    assert isinstance(v.open_orders(), dict)
    v.open_orders()["dine_in"] = 99
    assert w.view().open_orders()["dine_in"] != 99


# ----------------------------------------------------------------- performance
def test_perf_guard_one_day_under_two_seconds():
    from brew.events.bus import ListSink

    for pol in ("A", "B"):
        w = World(policy=pol, seed=7, sink=ListSink(), telemetry=True)
        t = time.perf_counter()
        w.run()
        dt = time.perf_counter() - t
        assert dt < 2.0, (pol, dt)
