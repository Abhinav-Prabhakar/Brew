"""Prep-backed Replate listings, surplus-only ladders, the counter add-on, bake-and-list and the waste breakdown."""

from __future__ import annotations

import numpy as np
import pytest

from brew.analysis.arena import run_replate_ab
from brew.config.loader import default_cafe
from brew.events.bus import ListSink
from brew.events.schema import validate_event
from brew.policies.charter import CharterViolation
from brew.sim.replate import RP, PreLot
from brew.sim.world import World

H = 3600.0


def chai_world(mode: str = "standard", seed: int = 3, at: float = 12 * H) -> World:
    w = World(policy="A", seed=seed, days=1, sink=ListSink(), replate=mode)
    w.run_until(at)
    return w


def add_chai_lot(w: World, qty: float = 3200.0, age_h: float = 2.0) -> PreLot | None:
    """A chai_base lot that is ``age_h`` old (hold window 3 h) and tracked by the next replate tick."""
    lot = w.inv.add_lot("chai_base", qty, w.now - age_h * H, kind="receive", shelf_h=3.0)
    w.replate.tick()
    return w.replate.lots.get(lot.lot_id)


def all_lots(w: World) -> list[PreLot]:
    out = list(w.replate.history)
    for v in w.replate.active.values():
        out.extend(v)
    return out


def gap(pl: PreLot) -> float:
    return abs(pl.sold_full + pl.sold_replate + pl.remade + pl.donated + pl.wasted + pl.remaining - pl.units0)


# ------------------------------------------------------------------ config
def test_prep_backed_map_is_configured_and_rescuable():
    cfg = default_cafe()
    assert cfg.replate.prep_backed == {
        "chai_base": "chai", "fries_cut": "fries", "croissant_dough": "croissant", "paneer_marinade": "sandwich",
        "coldbrew_concentrate": "coldbrew", "avocado": "avotoast",
    }  # fmt: skip
    w = World(policy="A", seed=1, days=1)
    resc = w.replate.rescuable_keys()
    assert {"chai_base", "fries_cut", "avocado", "pm_pasta", "croissant_baked", "croissant_dough"} <= resc
    assert "milk" not in resc
    # dough has no direct recipe usage: it is rescued by baking, not by a backed listing
    assert set(w.replate.backed) == {"chai_base", "fries_cut", "paneer_marinade", "coldbrew_concentrate", "avocado"}
    assert w.replate.backed_use["chai_base"] == 160.0 and w.replate.backed_use["avocado"] == 1.0
    assert w.replate.eligible("chai") and w.replate.eligible("fries") and not w.replate.eligible("latte")


# ------------------------------------------------------------------ listings from a lot's yield
def test_units_come_from_the_lots_yield_and_the_ladder_prices_them():
    w = chai_world("standard")
    pl = add_chai_lot(w, qty=3200.0, age_h=2.0)  # 1 h of 3 h left -> frac 1/3 <= 0.5
    assert pl.backed and pl.sku == "chai" and pl.key == "chai_base"
    assert pl.units0 == pytest.approx(20.0) and pl.per_unit == 160.0 and pl.remaining == pytest.approx(20.0)
    assert pl.hold_s == pytest.approx(3 * H) and pl.frac_left(w.now) == pytest.approx(1 / 3, abs=0.02)
    assert pl.listed and 25.0 <= pl.discount_pct < 50.0  # standard ladder: first rung (30 %, on the Rs5 grid)
    base = w.menu["chai"].price
    assert pl.price <= base * 0.7 + 3.0 and pl.price >= w.replate.floor_price(pl)
    ev = [e for e in w.sink.of_type("replate.listed") if e.data["lot_id"] == pl.lot_id]  # type: ignore[union-attr]
    assert ev and ev[0].data["units"] == pytest.approx(20.0)
    validate_event("replate.listed", ev[0].data)
    view = next(x for x in w.replate.lots_view() if x["lot_id"] == pl.lot_id)
    assert view["kind"] == "backed" and view["key"] == "chai_base" and view["per_unit"] == 160.0


def test_young_lot_is_not_listed_and_a_second_tick_does_not_relist():
    w = chai_world("standard")
    assert add_chai_lot(w, age_h=0.2) is None  # frac 0.93: not at risk yet
    old = add_chai_lot(w, age_h=2.0)
    assert old is not None
    n = old.marks
    w.replate.tick()
    assert old.marks == n


def test_sealed_perishable_listed_only_inside_the_raw_window():
    w = chai_world("standard", at=19 * H)
    far = w.inv.add_lot("avocado", 10.0, w.now, kind="receive", shelf_h=48.0)  # keeps beyond the next open
    w.replate.tick()
    assert far.lot_id not in w.replate.lots
    soon = w.inv.add_lot("avocado", 10.0, w.now - 10 * H, kind="receive", shelf_h=12.0)  # 2 h left
    w.replate.tick()
    pl = w.replate.lots[soon.lot_id]
    assert pl.backed and pl.sku == "avotoast" and pl.units0 == pytest.approx(10.0)


# ------------------------------------------------------------------ sales draw the backing lot first
def test_replate_sale_consumes_the_backing_lot_first():
    w = chai_world("standard")
    short = w.inv.add_lot("chai_base", 100.0, w.now - 2.5 * H, kind="receive", shelf_h=3.0)  # expires first, too small
    pl = add_chai_lot(w, qty=3200.0, age_h=2.0)
    assert w.inv.lots["chai_base"][0].lot_id == short.lot_id  # plain FEFO would take the small lot first
    assert w.replate.listing("chai") is pl
    o = w.orders.make_order("takeaway", "student", "Test", None, [("chai", (RP,))], None, [])
    price = o.lines[0]["unit_price"]
    assert price == pytest.approx(pl.price) and o.lines[0]["replate"]
    assert w.orders.commit(o)
    assert pl.lot.qty == pytest.approx(3200.0 - 160.0) and short.qty == pytest.approx(100.0)
    assert pl.sold_replate == pytest.approx(1.0) and pl.sold_full == 0.0
    # a full-price chai afterwards follows plain FEFO: the small, earlier-expiring lot goes first
    o2 = w.orders.make_order("takeaway", "student", "Test", None, [("chai", ())], None, [])
    assert w.orders.commit(o2)
    assert short.qty == 0.0
    assert gap(pl) < 1e-6


def test_backed_unit_invariant_and_conservation_over_a_day():
    for mode in ("gentle", "aggressive"):
        w = World(policy="B", seed=4, days=2, replate=mode)
        w.run(2)
        backed = [pl for pl in all_lots(w) if pl.backed]
        assert backed, "expected prep-backed lots to be tracked"
        for pl in backed:
            assert gap(pl) < 1e-6, (pl.sku, pl.units0, pl.sold_full, pl.sold_replate, pl.wasted, pl.remaining)
        assert w.inv.check_conservation() == {}


# ------------------------------------------------------------------ staples: discount only
def test_staple_listing_is_discount_only_and_monotone():
    w = World(policy="B", seed=5, days=1, sink=ListSink(), replate="aggressive")
    w.run(1)
    base = w.menu["chai"].price
    seen = [e for e in w.sink.events if e.type in ("replate.listed", "replate.marked_down") and e.data["sku"] == "chai"]  # type: ignore[union-attr]
    assert seen
    per_lot: dict[str, list[float]] = {}
    for e in seen:
        assert e.data["price"] < base and e.data["discount_pct"] > 0
        per_lot.setdefault(e.data["lot_id"], []).append(e.data["price"])
    for prices in per_lot.values():
        assert prices == sorted(prices, reverse=True)
    # a staple's markdown can never be reduced again (that would be a price increase)
    w2 = chai_world("custom")
    pl = add_chai_lot(w2)
    w2.replate.set_discount(pl.lot_id, 40.0, "test", strict=True)
    with pytest.raises(CharterViolation):
        w2.replate.set_discount(pl.lot_id, 20.0, "test", strict=True)
    assert pl.price < w2.menu["chai"].price


# ------------------------------------------------------------------ surplus-only ladder
def test_ladder_lists_only_surplus_units():
    w = chai_world("standard", at=17 * H)
    # plenty of expected full-price demand: a small lot is not surplus
    mu = w.replate.expected_units("chai", w.now + 1 * H)
    assert mu >= 0.0
    small = add_chai_lot(w, qty=160.0 * 2, age_h=2.0)
    big = w.inv.add_lot("chai_base", 160.0 * 80, w.now - 2.0 * H, kind="receive", shelf_h=3.0)
    w.replate.tick()
    bp = w.replate.lots[big.lot_id]
    assert bp.listed and bp.cap_until < bp.units0  # only the units beyond expected full-price use are offered
    assert bp.cap_until - bp.sold_replate >= 1
    if mu > 3:
        assert not small.listed or small.cap_until - small.sold_replate < small.units0


def test_surplus_room_shrinks_with_expected_demand():
    w = chai_world("off", at=15 * H)
    pl = add_chai_lot(w, qty=160.0 * 30, age_h=2.0)
    r1 = w.replate._surplus_room(pl)
    pl.sell_by += 2 * H  # a longer selling window expects more full-price use
    r2 = w.replate._surplus_room(pl)
    assert r2 <= r1


# ------------------------------------------------------------------ counter add-on
def _listing_ctx(w: World, pct: float) -> None:
    pl = add_chai_lot(w)
    w.replate.set_discount(pl.lot_id, pct, "test", strict=False)
    w.ensure_choice_ctx()


def test_addon_probability_rises_with_discount_and_respects_the_mask():
    shares = {}
    rng = np.random.default_rng(0)
    for pct in (20.0, 50.0):
        w = chai_world("custom")
        _listing_ctx(w, pct)
        ch = w.choice
        assert ch.rp_mask is not None
        j_chai = ch.skus.index("chai")
        hits = 0
        n = 4000
        for _ in range(n):
            j = ch.addon_choice("student", rng.gumbel(size=ch.J), float(rng.gumbel()))
            if j >= 0:
                assert j == j_chai  # only the listed SKU can be added
                hits += 1
        shares[pct] = hits / n
    assert 0.01 < shares[20.0] < shares[50.0] < 0.6
    w = chai_world("off")
    assert w.choice.addon_choice("student", np.zeros(w.choice.J), 0.0) == -1  # no listing, no add-on


def test_addon_adds_incremental_units_without_touching_the_off_world():
    def run(cfg_over: dict[str, object], mode: str) -> World:
        cfg = default_cafe()
        cfg = cfg.model_copy(update={"replate": cfg.replate.model_copy(update=cfg_over)})
        w = World(policy="B", seed=8, days=1, replate=mode, cfg=cfg)
        w.run(1)
        return w

    on = run({"addon_enabled": True}, "aggressive")
    no = run({"addon_enabled": False}, "aggressive")
    assert on.daily_kpis[0]["replate_units_sold"] > no.daily_kpis[0]["replate_units_sold"]
    # with the add-on the café sells more units overall (incremental), not just re-labelled ones
    tot = lambda w: sum(w.dlog.cur.counts.sum() + w.dlog.cur.rp.sum() for _ in (0,))  # noqa: E731
    assert tot(on) > tot(no)
    # replate off: the add-on flag cannot change anything
    a, b = run({"addon_enabled": True}, "off"), run({"addon_enabled": False}, "off")
    assert a.daily_kpis[0]["net_profit"] == b.daily_kpis[0]["net_profit"]


def test_demand_history_excludes_rescue_units():
    w = World(policy="B", seed=8, days=1, replate="aggressive")
    w.run(1)
    cur = w.dlog.cur
    assert cur is not None and float(cur.rp.sum()) > 0
    sold = sum(m.sold_today for m in w.menu.values())
    assert float(cur.counts.sum() + cur.rp.sum()) == pytest.approx(sold)
    assert float(cur.rp.sum()) == pytest.approx(w.daily_kpis[0]["replate_units_sold"])


# ------------------------------------------------------------------ C: bake-and-list, recovery, breakdown
def _c_world(mode: str | None) -> World:
    w = World(policy="C", seed=2, days=1, replate=mode)
    w.run_until(15 * H)
    return w


def test_salvage_bakes_a_batch_from_expiring_dough_only_when_replate_is_on():
    for mode, expect in (("custom", True), ("off", False)):
        w = _c_world(mode)
        for lt in w.inv.lots["croissant_baked"]:
            lt.qty = 0.0
        w.inv.lots["croissant_baked"] = []
        w.inv.onhand["croissant_baked"] = 0.0
        w.inv.add_lot("croissant_baked", 30.0, w.now, kind="receive")  # ample stock: only salvage would bake
        # one opened dough lot that expires in 4 h (the bake takes 110 min)
        w.inv.lots["croissant_dough"] = []
        w.inv.onhand["croissant_dough"] = 0.0
        w.inv.add_lot("croissant_dough", 24.0, w.now - 20 * H, kind="receive", shelf_h=24.0)
        act = w.policy.manager_action(w.obs_builder.build(), w.view())
        assert ("croissant_baked" in act.prep_now) is expect, (mode, act.prep_now)


def test_c_recovery_estimate_is_zero_when_disabled_and_bounded_otherwise():
    w = _c_world("custom")
    pol = w.policy
    pol.P["replate"]["recovery_scale"] = 0.0
    assert pol._recovery(w.view(), "pasta", 7200.0) == 0.0
    pol.P["replate"]["recovery_scale"] = 1.0
    if pol.bundle.sellthrough is not None:
        r = pol._recovery(w.view(), "pasta", 7200.0)
        assert 0.0 <= r <= 1.0


def test_replate_ab_reports_a_waste_breakdown_with_rescuable_flags():
    ab = run_replate_ab("B", [1], 1)
    rows = {r["key"]: r for r in ab["waste_breakdown"]}
    assert rows and all({"kg_off", "kg_on", "rescuable"} <= set(r) for r in rows.values())
    assert abs(sum(r["kg_on"] for r in rows.values()) - ab["on"]["waste_kg"]) < 1e-6
    assert abs(sum(r["kg_off"] for r in rows.values()) - ab["off"]["waste_kg"]) < 1e-6
    assert rows.get("milk", {"rescuable": False})["rescuable"] is False
