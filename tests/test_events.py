from __future__ import annotations

from collections import Counter

import pytest

from brew.events.bus import FanoutSink, ListSink, RingBufferSink, envelope
from brew.events.schema import ENVELOPES, EVENT_MODELS, event_json_schema, validate_event


def _validate_all(w):
    errs = []
    for e in w.test_sink.events:
        try:
            validate_event(e.type, e.data)
        except KeyError:
            errs.append(f"unknown event type {e.type}")
        except Exception as ex:
            errs.append(f"{e.type}: {ex}")
            if len(errs) > 5:
                break
    return errs


def test_every_event_validates_policy_a(day_a):
    assert _validate_all(day_a) == []


def test_every_event_validates_policy_b(day_b):
    assert _validate_all(day_b) == []


def test_envelope_validates_and_seq_strictly_increasing(day_a):
    evs = day_a.test_sink.events
    seqs = [e.seq for e in evs]
    assert seqs[0] == 1
    assert all(b == a + 1 for a, b in zip(seqs, seqs[1:], strict=False))
    for e in evs[:200]:
        env = envelope(e, day_a.start_date)
        ENVELOPES[e.type].model_validate(env)
        assert env["t"].endswith("+05:30")


def test_event_json_schema_lists_all_types():
    s = event_json_schema()
    assert len(s.get("oneOf", s.get("anyOf", []))) == len(EVENT_MODELS)


def test_required_event_types_present(day_b):
    types = Counter(e.type for e in day_b.test_sink.events)
    for t in (
        "clock.tick", "weather.changed", "day.started", "day.ended", "customer.arrived", "customer.queued",
        "customer.ordering", "customer.waiting", "customer.seated", "customer.eating", "customer.lingering",
        "customer.paying", "customer.left", "order.placed", "order.accepted", "order.progress",
        "rail.reordered", "order.ready", "order.served", "bag.shelved", "rider.assigned", "rider.arrived",
        "rider.picked_up", "receipt.printed", "payment.received", "review.posted", "price.changed",
        "stock.changed", "task.started", "task.finished", "kpi.tick", "decision.made", "batch.started",
    ):  # fmt: skip
        assert types[t] > 0, t


def test_customer_arrived_has_one_seed_per_member(day_a):
    for e in day_a.test_sink.of_type("customer.arrived"):
        assert len(e.data["appearance_seeds"]) == e.data["party_size"]


def test_throttling_rules(day_a):
    evs = day_a.test_sink.events
    ticks = [e for e in evs if e.type == "clock.tick"]
    assert all(b.sim_s - a.sim_s == pytest.approx(60.0) for a, b in zip(ticks, ticks[1:], strict=False))
    kpi = [e for e in evs if e.type == "kpi.tick"]
    # the scheduled kpi.tick is every 5 sim-min; extra ones only follow money moving (payment / refund / PO / purchase)
    grid = [e for e in kpi if e.sim_s % 300.0 < 1e-6]
    assert all(b.sim_s - a.sim_s == pytest.approx(300.0) for a, b in zip(grid, grid[1:], strict=False))
    money = sum(1 for e in evs if e.type in ("payment.received", "po.received", "order.voided", "action.applied"))
    assert len(kpi) - len(grid) <= money + 10
    # order.progress: never two consecutive identical (state, 5% bucket) for an order
    last: dict[int, tuple] = {}
    for e in evs:
        if e.type == "order.progress":
            key = (e.data["state"], e.data["progress"])
            assert last.get(e.data["order_no"]) != key
            last[e.data["order_no"]] = key
    # customer.patience only at 60/30/10 %
    assert {e.data["frac"] for e in evs if e.type == "customer.patience"} <= {0.6, 0.3, 0.1}
    # rail.reordered only when it actually changes
    rails = [
        (tuple(e.data["order_nos"]), tuple((b["id"], tuple(b["order_nos"])) for b in e.data["batches"]))
        for e in evs
        if e.type == "rail.reordered"
    ]
    assert all(a != b for a, b in zip(rails, rails[1:], strict=False))


def test_sinks():
    from brew.events.bus import EventRecord

    ring = RingBufferSink(maxlen=5)
    lst = ListSink()
    fan = FanoutSink(ring, lst)
    for i in range(1, 9):
        fan.emit(EventRecord(i, float(i), "clock.tick", {}))
    assert len(lst.events) == 8
    assert [e.seq for e in ring.since(0)] == [4, 5, 6, 7, 8]
    assert ring.covers(3) and not ring.covers(2)
    assert [e.seq for e in ring.since(6)] == [7, 8]
