"""The money and the stock are LIVE on the stream: what the HUD (cash / profit) and the pantry (shelf levels) show
follows the ledger and the inventory, not a 5-minute timer or a REST poll.

Regression tests for the functional audit: raw ingredient stock was never streamed (only finished goods), and
``kpi.tick`` only came every 5 sim-min, so a payment, a refund, a purchase or a truck did not move the HUD for minutes.
"""

from __future__ import annotations

import pytest

from brew.sim.actions import apply_action

H = 3600.0


@pytest.fixture
def world(small_world):
    return small_world(seed=7, policy="A", days=6)


def _ticks(w):
    return w.test_sink.of_type("kpi.tick")


def test_consumption_decreases_stock_and_books_cogs(world):
    w = world
    w.run_until(8.0 * H)
    before = dict(w.inv.onhand)
    cogs0 = w.fin.ledger.day[0]["cogs"]
    w.run_until(11.0 * H)
    assert w.inv.onhand["milk"] < before["milk"] - 1000, "orders consume milk through the bill of materials"
    assert w.inv.onhand["coffee_beans"] < before["coffee_beans"]
    assert w.fin.ledger.day[0]["cogs"] > cogs0 + 1000
    assert w.inv.check_conservation() == {}, "initial + receive - consume - waste - donate == on hand"


def test_raw_stock_is_streamed_as_it_drops(world):
    w = world
    w.run_until(8.0 * H)
    n0 = len(w.test_sink.events)
    before_q = dict(w.inv.onhand)
    w.run_until(11.0 * H)
    ev = [e for e in w.test_sink.events[n0:] if e.type == "stock.changed" and e.data["key"] == "milk"]
    assert len(ev) >= 5, (
        "milk is a raw ingredient: it used to stream nothing until it crossed its reorder point"
    )
    qtys = [e.data["qty"] for e in ev]
    assert qtys == sorted(qtys, reverse=True), "no PO arrives in this window: milk only goes down"
    assert qtys[-1] < qtys[0]
    assert abs(qtys[-1] - w.inv.onhand["milk"]) < 1500, "at most a minute behind the truth"
    # a key that did not move streams nothing (no flood)
    still = [
        k
        for k, q in w.inv.onhand.items()
        if q == before_q.get(k) and k not in w.inv.finished and k not in w.inv.virtual
    ]
    moved = {e.data["key"] for e in w.test_sink.events[n0:] if e.type == "stock.changed"}
    assert still and not (set(still) & moved)


def test_every_payment_is_followed_by_a_kpi_tick_with_that_revenue(world):
    w = world
    w.run_until(12.0 * H)
    ticks = _ticks(w)
    pays = w.test_sink.of_type("payment.received")
    assert pays and len(ticks) > 60
    for p in pays:
        nxt = next((t for t in ticks if t.sim_s >= p.sim_s), None)
        assert nxt is not None and nxt.sim_s == p.sim_s, "the HUD must follow the register"
    # the last tick is within one pulse of the ledger
    last = ticks[-1]
    assert last.data["revenue_today"] <= w.kpi.revenue_today() + 1e-6
    assert w.kpi.revenue_today() - last.data["revenue_today"] < 3000


def test_po_is_paid_on_receipt_stock_rises_and_cash_moves_on_the_stream(world):
    w = world
    w.run_until(9.0 * H)
    sup = w.suppliers.supplier_for("milk")
    it = w.ix.supplier[sup].items[0]
    ing = it.ingredient
    cash0 = w.fin.cash
    res = apply_action(w, "place_po", {"supplier": sup, "lines": {ing: it.pack_size * 2}})
    po = w.suppliers.pos[res["po_id"]]
    assert w.fin.cash == pytest.approx(cash0), "cash is paid when the truck arrives, not when it is ordered"
    seen: dict[str, float] = {}
    orig = w.suppliers.on_arrive

    def spy(pid):  # cash and stock around the delivery itself (revenue keeps flowing between events)
        seen["cash0"], seen["on0"], seen["profit0"] = (
            w.fin.cash,
            w.inv.onhand[ing],
            w.fin.ledger.profit(w.day),
        )
        orig(pid)
        seen["cash1"], seen["on1"], seen["profit1"] = (
            w.fin.cash,
            w.inv.onhand[ing],
            w.fin.ledger.profit(w.day),
        )

    w.suppliers.on_arrive = spy  # type: ignore[method-assign]
    w._h["PO_ARRIVE"] = spy
    n0 = len(w.test_sink.events)
    w.run_until(po["eta_s"] + 60.0)
    assert po["status"] == "received" and po["paid"] > 0
    assert seen["cash0"] - seen["cash1"] == pytest.approx(po["paid"]), (
        "cash falls by exactly what was delivered"
    )
    assert seen["on1"] > seen["on0"], "stock rises on receipt"
    assert seen["profit1"] == pytest.approx(seen["profit0"]), (
        "stock is an asset: profit is hit only when it is used (COGS)"
    )
    rec = next(e for e in w.test_sink.events[n0:] if e.type == "po.received")
    tick = next(e for e in w.test_sink.events[n0:] if e.type == "kpi.tick" and e.seq > rec.seq)
    assert tick.sim_s == pytest.approx(rec.sim_s)
    assert tick.data["cash"] == pytest.approx(round(seen["cash1"], 2)), (
        "the HUD cash drops the moment the truck is paid"
    )


def test_invest_deducts_cash_now_and_streams_it(world):
    w = world
    w.run_until(9.0 * H)
    key = next(iter(w.ix.catalog))
    capex = w.ix.catalog[key].capex
    cash0 = w.fin.cash
    seen = len(w.test_sink.events)
    w.invest.buy(key)
    assert w.fin.cash == pytest.approx(cash0 - capex)
    tick = next(e for e in w.test_sink.events[seen:] if e.type == "kpi.tick")
    assert tick.data["cash"] == pytest.approx(round(w.fin.cash, 2)), (
        "the stream carries the new cash immediately"
    )


def test_refund_moves_cash_and_streams(small_world):
    w = small_world(seed=7, policy="A", days=1)
    w.run_until(9.5 * H)
    o = next(o for o in w.orders.orders.values() if o.paid and o.receipt and not o.receipt.get("refunded"))
    cash0, seen = w.fin.cash, len(w.test_sink.events)
    w.fin.refund(o)
    assert w.fin.cash == pytest.approx(cash0 - o.receipt["total"])
    tick = next(e for e in w.test_sink.events[seen:] if e.type == "kpi.tick")
    assert tick.data["cash"] == pytest.approx(round(w.fin.cash, 2))


def test_expiry_removes_lots_and_books_waste(world):
    w = world
    w.run_until(8.0 * H)
    key = "milk"
    lot = w.inv.add_lot(key, 60000.0, w.now, shelf_h=1.0)
    w0 = w.fin.ledger.day[0]["waste"]
    on0 = w.inv.onhand[key]
    w.run_until(w.now + 2 * H)
    assert all(lt.lot_id != lot.lot_id for lt in w.inv.lots[key])
    assert any(e.data["lot_id"] == lot.lot_id for e in w.test_sink.of_type("lot.expired"))
    assert w.fin.ledger.day[0]["waste"] > w0
    assert w.inv.onhand[key] < on0 + 60000.0


def test_hud_profit_matches_the_closed_books(small_world):
    """kpi.tick profit_today: close to the final net profit late in the day, and EXACTLY it once the day is closed
    (it used to subtract the day's rent a second time after close-out)."""
    w = small_world(seed=7, policy="A", days=1)
    w.run_until(21.9 * H)
    late = w.kpi.profit_live()
    w.run_until(26 * H)
    final = w.daily_kpis[0]["net_profit"]
    assert abs(late - final) < 0.01 * abs(final) + 50, (late, final)
    ended = w.test_sink.of_type("day.ended")[0].sim_s
    closed = [e for e in w.test_sink.of_type("kpi.tick") if ended <= e.sim_s <= 24 * H]
    assert closed and all(e.data["profit_today"] == pytest.approx(final) for e in closed)
