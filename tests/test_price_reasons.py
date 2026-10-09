"""price.changed carries a short reason, up to 3 plain-word drivers and the decision id; menu rows mirror them."""

from __future__ import annotations

import pytest

from brew.analysis.drivers import short_drivers, short_label
from brew.events.bus import RingBufferSink
from brew.events.schema import EVENT_MODELS
from brew.sim.world import World


def _world(policy: str = "A") -> tuple[World, RingBufferSink]:
    w = World(policy=policy, seed=3, days=1)
    ring = RingBufferSink(50_000)
    w.sink = ring
    w.advance_to(w.day_start_t(0))
    return w, ring


def test_owner_price_is_short_and_lowercase() -> None:
    w, ring = _world()
    w.advance_to(w.now + 3 * 3600)
    ok, _ = w.set_price("cappuccino", 240, "owner", "Owner Set It", strict=True)
    assert ok
    ev = [e for e in ring.since(0) if e.type == "price.changed" and e.data["sku"] == "cappuccino"][-1]
    assert ev.data["reason_text"] == "owner set it" and ev.data["drivers"] == [] and "decision_id" not in ev.data
    EVENT_MODELS["price.changed"].model_validate(ev.data)
    long = "x" * 80
    w.advance_to(w.now + 3 * 3600)
    w.set_price("latte", 250, "owner", long)
    assert len([e for e in ring.since(0) if e.data.get("sku") == "latte"][-1].data["reason_text"]) <= 30


def test_combo_reasons_are_short() -> None:
    w, ring = _world()
    w.advance_to(w.now + 3 * 3600)
    w.set_price("cappuccino", 240, "owner", "owner set it", strict=True)
    combos = [e for e in ring.since(0) if e.type == "price.changed" and e.data["sku"].startswith("combo:")]
    assert combos and all(e.data["reason_text"] == "combo repriced" for e in combos)


def test_policy_d_prices_carry_drivers_and_a_decision_id() -> None:
    w, ring = _world("D")
    w.advance_to(w.day_start_t(0) + 15 * 3600)
    evs = [e for e in ring.since(0) if e.type == "price.changed" and not e.data["sku"].startswith("combo:")]
    assert evs, "policy D repriced something during the day"
    decisions = {e.data["decision_id"] for e in ring.since(0) if e.type == "decision.made"}
    for e in evs:
        d = e.data
        assert len(d["reason_text"]) <= 30 and d["reason_text"] == d["reason_text"].lower() and "(" not in d["reason_text"]
        assert len(d["drivers"]) <= 3
        for x in d["drivers"]:
            assert set(x) == {"name", "label", "value"} and -1 <= x["value"] <= 1 and len(x["label"].split()) <= 3
        assert d["decision_id"] in decisions
        EVENT_MODELS["price.changed"].model_validate(d)
    from brew.sim import readmodels as rm

    rows = [m for m in rm.menu(w) if m["chip"]]
    assert rows and all(len(m["chip"]["text"]) < 45 and len(m["drivers"]) <= 3 for m in rows)
    assert all(m["decision_id"] in decisions for m in rows)
    plain = [m for m in rm.menu(w) if not m["chip"]]
    assert all(m["drivers"] == [] and m["decision_id"] is None for m in plain)


def test_short_drivers_labels_dedupe_and_clip() -> None:
    assert short_label("util_espresso") == "kitchen load" and short_label("wx_rain") == "rain"
    assert short_label("tod_sin") == "time of day" and short_label("fatigue_mean") == "staff fatigue"
    f = [
        {"name": "tod_sin", "value": -0.87, "dim": "price_coffee"},
        {"name": "tod_cos", "value": 0.4, "dim": "price_coffee"},
        {"name": "cash", "value": 7.5, "dim": "price_coffee"},
        {"name": "util_oven", "value": 0.3, "dim": "throttle_x"},
        {"name": "wx_rain", "value": 1.0, "dim": "price_coffee"},
    ]
    out = short_drivers(f, "price_")
    assert [d["label"] for d in out] == ["time of day", "cash", "rain"] and out[1]["value"] == 1.0
    assert short_drivers([]) == []
    assert short_drivers([{"name": "cash", "value": 0.0}]) == [{"name": "cash", "label": "cash", "value": 0.0}]


@pytest.mark.parametrize("reason", ["", "  "])
def test_empty_reason_stays_empty(reason: str) -> None:
    w, ring = _world()
    w.advance_to(w.now + 3 * 3600)
    w.set_price("cappuccino", 240, "owner", reason, strict=True)
    assert next(e for e in ring.since(0) if e.type == "price.changed").data["reason_text"] == ""
