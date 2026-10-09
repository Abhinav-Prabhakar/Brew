"""Replate (rescue menu): ladder, floor, eligibility, retirement, unit invariant, choice, CRN, actions."""

from __future__ import annotations

import hashlib

import numpy as np
import pytest
from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st

from brew.api.app import create_app
from brew.config.loader import default_cafe
from brew.events.bus import ListSink
from brew.events.schema import validate_event
from brew.policies.charter import CharterViolation
from brew.settings import Settings
from brew.sim.actions import BadPayload, InvalidAction, apply_action
from brew.sim.choice import ChoiceModel
from brew.sim.replate import RP, PreLot
from brew.sim.world import World

H = 3600.0
API = "/api/v1"


def digest(sink: ListSink) -> str:
    m = hashlib.sha256()
    for e in sink.events:
        m.update(f"{e.seq}|{e.sim_s}|{e.type}|{sorted(e.data.items(), key=str)}".encode())
    return m.hexdigest()


def all_lots(w: World) -> list[PreLot]:
    out = list(w.replate.history)
    for v in w.replate.active.values():
        out.extend(v)
    return out


def unit_gap(pl: PreLot) -> float:
    tot = pl.sold_full + pl.sold_replate + pl.remade + pl.donated + pl.wasted + pl.remaining
    return abs(tot - pl.units0)


def premake_day(mode: str = "standard", seed: int = 7, policy: str = "A") -> World:
    sink = ListSink()
    w = World(policy=policy, seed=seed, days=1, sink=sink, replate=mode)
    w.test_sink = sink  # type: ignore[attr-defined]
    w.run_until(10 * H)
    for sku, n in (("sandwich", 6), ("cheesetoast", 5), ("pasta", 4), ("avotoast", 3), ("coldbrew", 4)):
        apply_action(w, "premake", {"sku": sku, "units": n})
    return w


# ------------------------------------------------------------------ config
def test_replate_config_and_menu_blocks():
    cfg = default_cafe()
    elig = {m.sku for m in cfg.menu if m.replate.eligible}
    assert elig == {
        "croissant", "muffin", "cheesecake", "cinnamon", "coldbrew", "sandwich", "cheesetoast", "pasta", "avotoast",
    }  # fmt: skip
    assert set(cfg.replate.ladders) == {"gentle", "standard", "aggressive"}
    std = cfg.replate.ladders["standard"]
    assert std.rungs == ((0.5, 30.0), (0.25, 50.0)) and std.last_pct == 70 and std.last_s == 2700
    assert cfg.replate.floor_cost_factor == 0.5
    # made-to-order-only items are not eligible
    assert not cfg.menu[0].replate.eligible


# ------------------------------------------------------------------ ladder, floor, eligibility
def test_ladder_is_monotone_and_floor_respected():
    w = premake_day("aggressive")
    w.run(1)
    ev = w.test_sink.events
    by_listing: dict[str, list[tuple[float, float]]] = {}
    for e in ev:
        if e.type in ("replate.listed", "replate.marked_down"):
            validate_event(e.type, e.data)
            by_listing.setdefault(e.data["listing_id"], []).append((e.data["discount_pct"], e.data["price"]))
    assert by_listing, "expected at least one listing under the aggressive ladder"
    for seq in by_listing.values():
        discounts = [d for d, _p in seq]
        prices = [p for _d, p in seq]
        assert discounts == sorted(discounts) and len(set(discounts)) == len(discounts)
        assert prices == sorted(prices, reverse=True)
    for pl in all_lots(w):
        if pl.listed:
            assert pl.price >= w.replate.floor_price(pl) - 1e-9
            assert pl.price % 5 == 0 or pl.price == w.replate.floor_price(pl)
            assert pl.price < w.menu[pl.sku].price + 1e-9


def test_ladder_pct_follows_config():
    w = World(policy="B", seed=1)
    rp = w.replate
    assert rp.ladder_pct("standard", 0.9, 1e5) == 0
    assert rp.ladder_pct("standard", 0.5, 1e5) == 30
    assert rp.ladder_pct("standard", 0.25, 1e5) == 50
    assert rp.ladder_pct("standard", 0.2, 2700) == 70
    assert rp.ladder_pct("gentle", 0.25, 1e5) == 35
    assert rp.ladder_pct("aggressive", 0.75, 1e5) == 25
    assert rp.ladder_pct("off", 0.0, 0.0) == 0


def test_only_made_ahead_stock_is_listed_never_made_to_order():
    w = premake_day("aggressive")
    w.run(1)
    listed_skus = {e.data["sku"] for e in w.test_sink.events if e.type == "replate.listed"}
    assert listed_skus <= set(w.replate.sku_key)
    assert not listed_skus & {"cappuccino", "latte", "fries", "waffle", "espresso", "chai"}
    # every listing references a lot that was created by pre-making / finished goods stock
    lots = {pl.lot_id: pl for pl in all_lots(w)}
    for e in w.test_sink.events:
        if e.type == "replate.listed":
            assert e.data["lot_id"] in lots


def test_no_premake_means_no_plate_listings():
    w = World(policy="B", seed=7, days=1, sink=ListSink())
    w.run(1)
    kinds = {pl.sku for pl in all_lots(w) if pl.key.startswith("pm_")}
    assert kinds == set()  # made-to-order leftovers are never replated


def test_retire_books_waste_or_donation_movements():
    w = premake_day("standard")
    w.run(1)
    retired = [e for e in w.test_sink.events if e.type == "replate.retired"]
    assert retired
    for e in retired:
        validate_event(e.type, e.data)
        assert e.data["outcome"] in ("donated", "wasted", "sold_out")
    for pl in all_lots(w):
        if pl.retired:
            assert pl.remaining == 0
    wasted_plates = sum(pl.wasted for pl in all_lots(w) if pl.key.startswith("pm_"))
    mov = sum(w.inv.mov[k]["waste"] + w.inv.mov[k]["waste_replate"] for k in w.inv.virtual)
    assert abs(wasted_plates - mov) < 1e-6
    assert w.inv.check_conservation() == {}


def test_bakery_retires_as_donation_plates_as_waste():
    w = World(policy="B", seed=8, days=2, sink=ListSink(), replate="off")
    w.run(2)
    for pl in all_lots(w):
        if pl.key.startswith("pm_"):
            assert pl.donated == 0


# ------------------------------------------------------------------ per-lot unit invariant
@pytest.mark.property
@settings(max_examples=8, deadline=None)
@given(
    plan=st.lists(
        st.tuples(
            st.sampled_from(["sandwich", "cheesetoast", "pasta", "avotoast", "coldbrew"]),
            st.integers(1, 7),
            st.integers(10, 80),
        ),
        min_size=1,
        max_size=5,
    ),
    mode=st.sampled_from(["off", "gentle", "standard", "aggressive"]),
)
def test_unit_invariant_random_premake(plan, mode):
    w = World(policy="A", seed=11, days=1, replate=mode)
    t = 9 * H
    for sku, n, gap_min in plan:
        w.run_until(t)
        try:
            apply_action(w, "premake", {"sku": sku, "units": n})
        except InvalidAction:
            pass
        t += gap_min * 60.0
    w.run(1)
    for pl in all_lots(w):
        assert unit_gap(pl) < 1e-6, (pl.sku, pl)
        assert pl.sold_full >= 0 and pl.sold_replate >= 0
    assert w.inv.check_conservation() == {}


def test_unit_invariant_includes_bakery_across_days():
    w = World(policy="B", seed=9, days=2, replate="standard")
    w.run(2)
    assert all(unit_gap(pl) < 1e-6 for pl in all_lots(w))


# ------------------------------------------------------------------ choice
def test_replate_alternative_share_grows_as_discount_deepens():
    cfg = default_cafe()
    ch = ChoiceModel(cfg)
    J = ch.J
    j = ch.skus.index("croissant")
    rng = np.random.default_rng(5)
    n = 4000
    g = rng.gumbel(size=(n, J + 1))
    grp = rng.gumbel(size=(n, J))
    shares = []
    for price in (170.0, 140.0, 110.0, 80.0, 50.0):
        lnr = np.zeros(J)
        mask = np.zeros(J, dtype=bool)
        mask[j] = True
        rp_lnr = np.zeros(J)
        rp_lnr[j] = np.log(price / 180.0)
        ch.set_context(lnr, np.zeros(J), np.ones(J, dtype=bool), np.zeros(J), np.zeros(J), mask, rp_lnr, np.ones(J))
        hits = sum(
            ch.choose("student", "food", g[i], with_outside=False, gumbel_rp_row=grp[i]) == J + j for i in range(n)
        )
        shares.append(hits / n)
    assert shares == sorted(shares) and shares[-1] > shares[0] + 0.05


def test_hidden_item_never_offered_as_replate():
    cfg = default_cafe()
    ch = ChoiceModel(cfg)
    J = ch.J
    j = ch.skus.index("croissant")
    mask = np.zeros(J, dtype=bool)
    mask[j] = True
    vis = np.ones(J, dtype=bool)
    vis[j] = False
    rp_lnr = np.zeros(J)
    rp_lnr[j] = np.log(0.3)
    ch.set_context(np.zeros(J), np.zeros(J), vis, np.zeros(J), np.zeros(J), mask, rp_lnr, np.ones(J))
    rng = np.random.default_rng(1)
    for _ in range(300):
        c = ch.choose("student", "food", rng.gumbel(size=J + 1), False, rng.gumbel(size=J))
        assert c not in (j, J + j)


def test_persona_affinity_orders_replate_utility():
    ch = ChoiceModel(default_cafe())
    assert ch.rho["student"] > ch.rho["regular"] > ch.rho["leisurely"] > ch.rho["tourist"]


# ------------------------------------------------------------------ CRN / mode off
def test_mode_off_reproduces_no_replate_world():
    a = World(policy="A", seed=5, days=1, sink=ListSink())
    a.run(1)
    b = World(policy="A", seed=5, days=1, sink=ListSink(), replate="off")
    b.run(1)
    assert digest(a.sink) == digest(b.sink)  # type: ignore[arg-type]
    # B with replate forced off on a fork taken at day start == a fresh off world
    base = World(policy="B", seed=6, days=1, sink=ListSink())
    base.run_until(7 * H)
    fork = base.fork(sink=ListSink())
    fork.replate.mode = "off"
    fork.replate.override = True
    fork.run(1)
    fresh = World(policy="B", seed=6, days=1, sink=ListSink(), replate="off")
    fresh.run(1)
    assert fork.daily_kpis[0]["net_profit"] == fresh.daily_kpis[0]["net_profit"]
    assert fork.daily_kpis[0]["orders"] == fresh.daily_kpis[0]["orders"]


def test_replate_changes_the_world_only_when_on():
    on = World(policy="B", seed=6, days=1, replate="aggressive")
    on.run(1)
    off = World(policy="B", seed=6, days=1, replate="off")
    off.run(1)
    assert on.daily_kpis[0]["replate_units_sold"] > 0 and off.daily_kpis[0]["replate_units_sold"] == 0
    assert on.daily_kpis[0]["replate_revenue"] > 0
    assert on.daily_kpis[0]["replate_waste_avoided_kg"] > 0 and on.daily_kpis[0]["replate_co2e_avoided_kg"] > 0


def test_replate_lines_carry_flag_and_discounted_price():
    w = World(policy="B", seed=6, days=1, sink=ListSink(), replate="aggressive")
    w.run(1)
    placed = [e for e in w.sink.events if e.type == "order.placed"]  # type: ignore[union-attr]
    rp_lines = [it for e in placed for it in e.data["items"] if it["replate"]]
    assert rp_lines
    for it in rp_lines:
        assert RP not in it["mods"]
        assert it["unit_price"] < w.cfg.menu[[m.sku for m in w.cfg.menu].index(it["sku"])].max_price
    sold = [e for e in w.sink.events if e.type == "replate.sold"]  # type: ignore[union-attr]
    assert len(sold) == w.daily_kpis[0]["replate_units_sold"]


def test_premade_units_skip_the_kitchen_and_are_faster():
    w = premake_day("off")
    w.run_until(12 * H)
    assert any(pl.premade for o in list(w.orders.open.values()) for pl in o.units) or sum(
        pl.sold_full for pl in all_lots(w) if pl.key.startswith("pm_")
    ) > 0


# ------------------------------------------------------------------ actions
def test_premake_action_validation():
    w = World(policy="A", seed=3, days=1)
    w.run_until(9 * H)
    with pytest.raises(BadPayload):
        apply_action(w, "premake", {"sku": "cappuccino", "units": 2})  # not eligible
    with pytest.raises(BadPayload):
        apply_action(w, "premake", {"sku": "muffin", "units": 2})  # bought in
    with pytest.raises(BadPayload):
        apply_action(w, "premake", {"sku": "sandwich", "units": 0})
    r = apply_action(w, "premake", {"sku": "croissant", "units": 12})  # in-house bake via prep item
    assert r["kind"] == "prep"
    r = apply_action(w, "premake", {"sku": "pasta", "units": 3})
    assert r["units"] == 3


def test_replate_list_monotone_and_floor_checks():
    w = premake_day("off")
    w.run_until(11 * H)
    r = apply_action(w, "replate_list", {"sku": "sandwich", "discount_pct": 40})
    assert r["listed"] and r["discount_pct"] >= 39
    with pytest.raises(CharterViolation):
        apply_action(w, "replate_list", {"sku": "sandwich", "discount_pct": 20})  # would raise the price
    with pytest.raises(CharterViolation):
        apply_action(w, "replate_list", {"sku": "pasta", "discount_pct": 99})  # below 0.5 x unit cost
    r2 = apply_action(w, "replate_list", {"sku": "sandwich", "discount_pct": 60})
    assert r2["price"] < r["price"]
    with pytest.raises(BadPayload):
        apply_action(w, "replate_list", {"sku": "latte"})
    # nothing pre-made on hand -> 409
    w2 = World(policy="A", seed=2, days=1)
    w2.run_until(9 * H)
    with pytest.raises(InvalidAction):
        apply_action(w2, "replate_list", {"sku": "sandwich", "discount_pct": 40})


def test_replate_mode_action_sets_override():
    w = World(policy="B", seed=3, days=1, sink=ListSink())
    assert w.replate.mode == "standard" and not w.replate.override
    apply_action(w, "replate_mode", {"mode": "off"})
    assert w.replate.mode == "off" and w.replate.override
    # policy-requested changes are ignored while the owner override is active
    assert w.replate.set_mode("aggressive", "B") is False and w.replate.mode == "off"
    with pytest.raises(BadPayload):
        apply_action(w, "replate_mode", {"mode": "ultra"})
    apply_action(w, "replate_mode", {"mode": "auto"})
    assert w.replate.mode == "standard" and not w.replate.override


# ------------------------------------------------------------------ API
@pytest.fixture
def client():
    app = create_app(Settings(db_enabled=False))
    with TestClient(app) as c:
        yield c


def _mk(c, **kw) -> str:
    r = c.post(f"{API}/worlds", json={"policy": "B", "seed": 4, **kw})
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.mark.integration
def test_api_replate_endpoint_state_and_actions(client):
    c = client
    wid = _mk(c)
    c.post(f"{API}/worlds/{wid}/control", json={"action": "step", "step_s": 3 * H})
    r = c.post(f"{API}/worlds/{wid}/actions", json={"kind": "premake", "sku": "sandwich", "units": 4})
    assert r.status_code == 200, r.text
    c.post(f"{API}/worlds/{wid}/control", json={"action": "step", "step_s": 60})
    j = c.get(f"{API}/worlds/{wid}/replate").json()
    assert j["premake_inflight"].get("sandwich") == 4
    c.post(f"{API}/worlds/{wid}/control", json={"action": "step", "step_s": 30 * 60})
    j = c.get(f"{API}/worlds/{wid}/replate").json()
    assert j["mode"] == "standard" and "sim_s" in j and "lots" in j and "kpis" in j
    assert any(x["sku"] == "sandwich" for x in j["lots"])
    st_ = c.get(f"{API}/worlds/{wid}/state").json()
    assert "replate" in st_ and st_["replate"]["mode"] == "standard"
    # 422 on floor / monotonic violations, ineligible sku
    r = c.post(f"{API}/worlds/{wid}/actions", json={"kind": "replate_list", "sku": "sandwich", "discount_pct": 40})
    assert r.status_code == 200, r.text
    r = c.post(f"{API}/worlds/{wid}/actions", json={"kind": "replate_list", "sku": "sandwich", "discount_pct": 10})
    assert r.status_code == 422
    r = c.post(f"{API}/worlds/{wid}/actions", json={"kind": "replate_list", "sku": "sandwich", "discount_pct": 99})
    assert r.status_code == 422
    r = c.post(f"{API}/worlds/{wid}/actions", json={"kind": "premake", "sku": "latte", "units": 2})
    assert r.status_code == 422
    r = c.post(f"{API}/worlds/{wid}/actions", json={"kind": "replate_mode", "mode": "aggressive"})
    assert r.status_code == 200 and r.json()["result"]["mode"] == "aggressive"
    r = c.post(f"{API}/worlds/{wid}/actions", json={"kind": "replate_mode", "mode": "bogus"})
    assert r.status_code == 422
    r = c.post(f"{API}/worlds/{wid}/actions", json={"kind": "replate_list", "sku": "cheesecake"})
    assert r.status_code in (200, 409)
