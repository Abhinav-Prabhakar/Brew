from __future__ import annotations

import pytest

from brew.policies.A_fcfs import PolicyA
from brew.policies.base import AcceptDecision
from brew.sim.reviews import Reputation, cause_weights, satisfaction
from brew.sim.world import World


# ------------------------------------------------------------------ delivery
class DelayPolicy(PolicyA):
    def accept(self, order, view):
        return AcceptDecision("delay")


def test_acceptance_timeout_rejects(small_world):
    w = small_world(seed=4)
    w.set_policy(DelayPolicy(), announce=False)
    w.run()
    rej = [e.data["reason"] for e in w.test_sink.of_type("order.rejected")]
    assert rej and set(rej) == {"timeout"}
    placed = {e.data["order_no"]: e for e in w.test_sink.of_type("order.placed") if e.data["channel"] in ("zomato", "swiggy")}
    for e in w.test_sink.of_type("order.rejected"):
        # rejected exactly at the 90 s acceptance timeout (15 s retry granularity)
        assert 90 <= e.sim_s - placed[e.data["order_no"]].sim_s <= 105


def test_pause_throttle_rejects_aggregator_orders(small_world):
    w = small_world(seed=4)
    w.delivery.set_throttle("zomato", "pause")
    w.delivery.set_throttle("swiggy", "pause")
    w.run()
    rej = w.test_sink.of_type("order.rejected")
    assert rej and all(e.data["reason"] == "paused" for e in rej)
    assert not w.test_sink.of_type("bag.shelved")
    assert w.delivery.rank["zomato"] < 1.0  # pausing costs platform ranking


def test_plus10_throttle_extends_promise(small_world):
    a = small_world(seed=4)
    b = small_world(seed=4)
    b.delivery.set_throttle("zomato", "plus10")
    b.delivery.set_throttle("swiggy", "plus10")
    a.run_until(14 * 3600)
    b.run_until(14 * 3600)

    def lead(w):
        out = []
        for e in w.test_sink.of_type("order.placed"):
            if e.data["channel"] in ("zomato", "swiggy"):
                out.append(e.data["promised_s"] - e.sim_s)
        return sum(out) / len(out) if out else 0

    assert lead(b) > lead(a) + 400


def test_rider_waits_if_not_ready_and_shelf_capacity(day_a):
    evs = day_a.test_sink.events
    waiting = [e for e in evs if e.type == "rider.arrived" and e.data["waiting"]]
    assert waiting, "expected some riders to arrive before the bag was ready"
    occ = 0
    peak = 0
    for e in evs:
        if e.type == "bag.shelved":
            occ += 1
        elif e.type == "rider.picked_up" and e.data["slot"] is not None:
            occ -= 1
        peak = max(peak, occ)
        assert 0 <= occ <= day_a.cfg.cafe.shelf_slots
    pk = [e for e in evs if e.type == "rider.picked_up"]
    assert any(e.data["rider_wait_s"] > 0 for e in pk)


def test_quality_decays_by_half_life(small_world):
    w = small_world(seed=3)
    w.run_until(8.5 * 3600)
    o = next(iter(w.orders.open.values()), None)
    if o is None:
        w.run_until(9.5 * 3600)
        o = next(iter(w.orders.open.values()))
    half = w.ix.menu[o.units[0].sku].quality_half_life_s
    for u in o.units:
        u.ready_s = w.now - half
        u.ing_quality = 1.0
    # single-unit orders only: q = 2^-1 (hold penalty applies past hold_time)
    o.units = o.units[:1]
    hold = w.ix.menu[o.units[0].sku].hold_time_s
    q = w.orders.handoff_quality(o, w.now)
    expect = 0.5 * (0.92 if half > hold else 1.0)
    assert q == pytest.approx(expect, rel=0.01)


def test_platform_score_moves_with_lateness(day_a):
    assert 0.5 <= day_a.delivery.rank["zomato"] <= 1.05
    assert day_a.delivery.deliveries_today > 0


# ------------------------------------------------------------------- reviews
def test_bayesian_reputation_math():
    rep = Reputation({"offline": (4.6, 100), "zomato": (4.0, 0), "swiggy": (4.5, 10)}, prior_mean=4.3, prior_w=50)
    assert rep.rating("offline") == pytest.approx((50 * 4.3 + 460) / 150)
    assert rep.rating("zomato") == pytest.approx(4.3)  # no reviews -> prior
    rep.add("zomato", 1)
    assert rep.rating("zomato") == pytest.approx((50 * 4.3 + 1) / 51)
    tot = rep.n["offline"] + rep.n["zomato"] + rep.n["swiggy"]
    assert rep.overall() == pytest.approx(sum(rep.rating(g) * rep.n[g] for g in rep.n) / tot)


def test_satisfaction_responds_to_lateness_and_quality():
    s_fast, _ = satisfaction(0, 300, 1.0, 400, 400, 1.0, 0.8, 0.0)
    s_late, _ = satisfaction(600, 300, 1.0, 400, 400, 1.0, 0.8, 0.0)
    s_cold, _ = satisfaction(0, 300, 0.4, 400, 400, 1.0, 0.8, 0.0)
    s_pricey, _ = satisfaction(0, 300, 1.0, 600, 400, 1.0, 0.8, 0.3)
    assert s_fast > s_late and s_fast > s_cold and s_fast > s_pricey
    assert 0 <= s_late <= s_fast <= 1


def test_stars_distribution_follows_lateness():
    import numpy as np

    rng = np.random.default_rng(1)

    def stars(s):
        return [int(min(5, max(1, 1 + round(4 * s + rng.normal(0, 0.35))))) for _ in range(500)]

    assert np.mean(stars(0.9)) > np.mean(stars(0.5)) > np.mean(stars(0.2))


def test_causes_are_normalised():
    comp = {"wait": 0.1, "quality": 0.7, "value": 0.6, "accuracy": 1.0, "ambience": 0.9, "unfair": 0.2}
    c = cause_weights(comp, 2, "zomato", errors=1, pack_short=False)
    assert abs(sum(c.values()) - 1) < 0.05
    assert c["wait"] == max(c.values())
    assert set(c) <= {"wait", "cold_food", "price", "quality", "ambience", "staff", "accuracy", "packaging", "value"}
    pos = cause_weights({**comp, "wait": 0.95}, 5, "dine_in", 0, False)
    assert abs(sum(pos.values()) - 1) < 0.05


def test_reviews_posted_in_a_day(day_a):
    revs = day_a.test_sink.of_type("review.posted")
    assert revs
    for e in revs:
        assert 1 <= e.data["stars"] <= 5 and len(e.data["text"]) > 5
    assert day_a.reviews.rep.count() > 214


# ------------------------------------------------------------------- finance
def test_receipt_math_and_gst_split(day_a):
    recs = day_a.test_sink.of_type("receipt.printed")
    assert recs
    for e in recs[:200]:
        d = e.data
        lines = sum(ln["amount"] for ln in d["lines"])
        assert lines == pytest.approx(d["subtotal"], abs=0.02)
        assert d["cgst"] == pytest.approx(d["sgst"], abs=0.011)
        base = d["subtotal"] - d["discount"]
        assert d["cgst"] == pytest.approx(round(base * 0.025, 2), abs=0.011)
        assert d["total"] == pytest.approx(d["subtotal"] - d["discount"] + d["cgst"] + d["sgst"] + d["round_off"], abs=0.02)
        assert d["total"] == int(d["total"])  # whole rupees
        assert abs(d["round_off"]) <= 0.5


def test_ledger_sums_to_daily_profit(day_a):
    k = day_a.daily_kpis[0]
    led = k["ledger"]
    costs = sum(led[a] for a in ("discount", "cogs", "commission", "payment_fee", "packaging", "labour", "energy", "waste", "rent", "maintenance", "depreciation", "refund", "donation_writeoff"))
    assert k["net_profit"] == pytest.approx(led["revenue"] - costs, abs=0.05)
    # entries independently sum to the same figure
    entries = day_a.fin.ledger.entries
    rev = sum(a for _, d, acc, a in entries if d == 0 and acc == "revenue")
    assert rev == pytest.approx(led["revenue"], abs=0.05)
    # revenue cross-check against order-level accounting
    assert day_a.fin.ledger.revenue(0) == pytest.approx(day_a.fin.daily_orders_rev[0], abs=1.0)


def test_gst_excluded_from_profit_and_capex_ignored(day_a):
    assert day_a.fin.ledger.day[0]["gst_collected"] > 0
    assert day_a.fin.ledger.day[0]["capex"] == 0


def test_cash_moves_with_sales(day_a):
    assert day_a.fin.cash > day_a.cfg.cafe.cash_start


def test_refund_on_walkout_keeps_books_consistent():
    w = World(policy="A", seed=8)
    w.run()
    led = w.fin.ledger.day[0]
    assert led["refund"] >= 0
    assert w.fin.ledger.revenue(0) == pytest.approx(led["revenue"] - led["refund"])
