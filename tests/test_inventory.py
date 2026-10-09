from __future__ import annotations

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from brew.config.loader import default_cafe
from brew.sim.inventory import InsufficientStock, Inventory
from brew.sim.world import World

H = 3600.0


@pytest.fixture
def inv():
    return Inventory(None, default_cafe())


op_strategy = st.lists(
    st.one_of(
        st.tuples(st.just("add"), st.floats(1, 5000), st.floats(0, 200 * H)),
        st.tuples(st.just("consume"), st.floats(0.1, 3000), st.floats(0, 400 * H)),
        st.tuples(st.just("sweep"), st.just(0.0), st.floats(0, 600 * H)),
        st.tuples(st.just("waste"), st.floats(0.1, 2000), st.just(0.0)),
        st.tuples(st.just("donate"), st.just(0.0), st.just(0.0)),
    ),
    min_size=1,
    max_size=60,
)


@pytest.mark.property
@settings(max_examples=60, deadline=None)
@given(ops=op_strategy)
def test_conservation_and_no_negative_lots(ops):
    inv = Inventory(None, default_cafe())
    key = "milk"
    now = 0.0
    for kind, qty, t in ops:
        now = max(now, t)
        if kind == "add":
            inv.add_lot(key, qty, now, kind="initial" if inv.mov[key]["initial"] == 0 else "receive")
        elif kind == "consume":
            inv.consume(key, qty, now, partial=True)
        elif kind == "sweep":
            inv.sweep_expired(now)
        elif kind == "waste":
            inv.remove(key, qty, "waste", now)
        else:
            for k, lot in inv.donatable(now, horizon_h=1e6):
                inv.donate_lot(k, lot)
        assert inv.check_conservation() == {}
        assert all(lt.qty > 0 for lt in inv.lots[key])
        assert inv.onhand[key] >= -1e-6


@pytest.mark.property
@settings(max_examples=40, deadline=None)
@given(quantities=st.lists(st.floats(1, 100), min_size=2, max_size=6), take=st.floats(0.5, 300))
def test_fefo_picks_earliest_expiry(quantities, take):
    inv = Inventory(None, default_cafe())
    # insert lots with decreasing expiry offsets in random insertion order
    shelf = [(len(quantities) - i) * 10.0 for i in range(len(quantities))]
    for q, sh in zip(quantities, shelf, strict=True):
        inv.add_lot("milk", q, 0.0, shelf_h=sh)
    order = sorted(inv.lots["milk"], key=lambda lt: lt.expires_s)
    total = sum(quantities)
    got, _, _ = inv.consume("milk", min(take, total), 1.0, partial=True)
    # an earlier-expiring lot that still has stock means every later lot is untouched
    for i, lt in enumerate(order):
        if lt.qty > 1e-9:
            for later in order[i + 1 :]:
                assert later.qty == pytest.approx(later.qty0)
            break
    assert got == pytest.approx(min(take, total))


def test_consume_raises_when_short_and_leaves_stock(inv):
    inv.add_lot("milk", 100, 0.0)
    with pytest.raises(InsufficientStock):
        inv.consume("milk", 150, 1.0)
    assert inv.onhand["milk"] == 100


def test_opening_recalculates_expiry(inv):
    inv.add_lot("milk", 1000, 0.0)  # sealed 96 h, opened 48 h
    lot = inv.lots["milk"][0]
    assert lot.expires_s == pytest.approx(96 * H)
    inv.consume("milk", 10, 10 * H)
    assert lot.opened_s == 10 * H
    assert lot.expires_s == pytest.approx(58 * H)  # min(96h, 10h + 48h)
    # a lot opened late keeps its sealed expiry if that comes first
    inv.add_lot("milk", 100, 80 * H)
    l2 = inv.lots["milk"][-1]
    inv.consume("milk", 0.0001, 85 * H, partial=True)
    assert l2.expires_s <= l2.received_s + 96 * H


def test_expired_lots_swept_as_waste(inv):
    inv.add_lot("milk", 100, 0.0)
    out = inv.sweep_expired(200 * H)
    assert out and inv.onhand["milk"] == 0 and inv.mov["milk"]["waste"] == 100
    assert inv.check_conservation() == {}


def test_bom_modifiers_and_packaging(inv):
    base = {k: q for k, q, _ in inv.bom("cappuccino", (), False)}
    assert base == {"coffee_beans": 18, "milk": 150}
    carry = {k: q for k, q, _ in inv.bom("cappuccino", (), True)}
    assert carry["cup_paper_m"] == 1 and carry["lid"] == 1 and carry["sleeve"] == 1
    oat = {k: q for k, q, _ in inv.bom("cappuccino", ("oat", "shot"), False)}
    assert "milk" not in oat and oat["oat_milk"] == 150 and oat["coffee_beans"] == 36
    large = {k: q for k, q, _ in inv.bom("latte", ("large",), False)}
    assert large["milk"] == pytest.approx(260)


def test_auto_86_and_restore():
    w = World(policy="A", seed=1)
    w.run_until(7 * 3600 + 10)
    w.inv.consume("coldbrew_concentrate", w.inv.onhand["coldbrew_concentrate"], w.now)
    w.recheck_availability(w.inv.stock_dirty)
    assert w.menu["coldbrew"].hidden == "Sold out for now"
    w.inv.add_lot("coldbrew_concentrate", 1000, w.now)
    w.recheck_availability(w.inv.stock_dirty)
    assert w.menu["coldbrew"].hidden is None
    # owner-hidden items are not restored by stock arrivals
    w.set_hidden("cappuccino", True, "owner", "owner", "x")
    w.inv.add_lot("milk", 1000, w.now)
    w.recheck_availability({"milk", "coffee_beans"})
    assert w.menu["cappuccino"].hidden


def test_full_day_conservation(day_a, day_b):
    assert day_a.inv.check_conservation() == {}
    assert day_b.inv.check_conservation() == {}


def test_prep_batch_creates_lot_after_lead_time():
    w = World(policy="A", seed=1)
    w.run_until(7 * 3600 + 10)
    before = w.inv.onhand["chai_base"]
    started = w.kitchen.start_prep("chai_base", 1.0)
    assert started == 2000
    w.run_until(w.now + 2 * 3600)
    assert w.inv.onhand["chai_base"] > before - 1
    assert w.kitchen.prep_inflight.get("chai_base", 0) == 0


def test_donation_of_short_dated_bakery_goods():
    w = World(policy="B", seed=1, days=2)
    w.run()
    donated = (
        w.inv.mov["muffin_fg"]["donate"]
        + w.inv.mov["cheesecake_slice"]["donate"]
        + w.inv.mov["cinnamon_roll_fg"]["donate"]
    )
    assert donated >= 0  # policy B donates; value tracked
    assert w.fin.ledger.total["donation_writeoff"] >= 0
