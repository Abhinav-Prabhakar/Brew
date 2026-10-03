from __future__ import annotations

import hashlib

import orjson

from brew.events.bus import ListSink
from brew.sim.engine import Engine


def digest(sink: ListSink, start: int = 0) -> str:
    m = hashlib.sha256()
    for e in sink.events[start:]:
        m.update(orjson.dumps([e.seq, e.sim_s, e.type, e.data]))
    return m.hexdigest()


def test_event_ordering_by_t_prio_seq():
    eng = Engine()
    out = []
    eng.schedule(10, "b", None, 3)
    eng.schedule(10, "a", None, 0)
    eng.schedule(5, "c", None, 9)
    eng.schedule(10, "b2", None, 3)
    while eng.step(lambda k, p: out.append(k)):
        pass
    assert out == ["c", "a", "b", "b2"]


def test_cancel_and_run_until_boundaries():
    eng = Engine()
    out = []
    h = eng.schedule(3, "x", None)
    eng.schedule(5, "y", None)
    eng.schedule(7, "z", None)
    eng.cancel(h)
    assert eng.run_until(5, lambda k, p: out.append(k))
    assert out == ["y"] and eng.now == 5
    eng.run_until(6.9, lambda k, p: out.append(k))
    assert out == ["y"] and eng.now == 6.9
    eng.run_until(7, lambda k, p: out.append(k))
    assert out == ["y", "z"]


def test_should_stop_interrupts():
    eng = Engine()
    for i in range(200):
        eng.schedule(i, "e", None)
    n = []
    done = eng.run_until(1000, lambda k, p: n.append(1), should_stop=lambda: len(n) >= 64)
    assert not done and len(n) == 64


def test_determinism_same_seed_identical_stream(small_world):
    a, b = small_world(seed=11), small_world(seed=11)
    a.run()
    b.run()
    assert digest(a.test_sink) == digest(b.test_sink)
    assert len(a.test_sink.events) > 5000


def test_different_seed_differs(small_world):
    a, b = small_world(seed=11), small_world(seed=12)
    a.run()
    b.run()
    assert digest(a.test_sink) != digest(b.test_sink)


def test_fork_replays_identically(small_world):
    w = small_world(seed=5, policy="B")
    w.run_until(12 * 3600)
    n0 = len(w.test_sink.events)
    child_sink = ListSink()
    child = w.fork(sink=child_sink)
    w.run()
    child.run()
    assert len(child_sink.events) == len(w.test_sink.events) - n0 > 1000
    assert digest(child_sink) == digest(w.test_sink, n0)


def test_fork_independence(small_world):
    w = small_world(seed=5)
    w.run_until(10 * 3600)
    parent_price = w.menu["cappuccino"].price
    parent_cash = w.fin.cash
    c = w.fork()
    ok, _ = c.set_price("cappuccino", parent_price + 20, "owner", "test")
    assert ok
    c.run()
    assert w.menu["cappuccino"].price == parent_price
    assert w.fin.cash == parent_cash
    assert c.menu["cappuccino"].price != parent_price or c.fin.cash != parent_cash


def test_fork_shares_config_and_is_fast(small_world):
    import time

    w = small_world(seed=5)
    w.run_until(14 * 3600)
    del w.test_sink  # the test sink is not part of the world (sinks never fork)
    t = time.perf_counter()
    c = w.fork()
    dt = time.perf_counter() - t
    assert c.cfg is w.cfg
    assert dt < 0.05, dt


def test_fork_reseed_changes_future(small_world):
    w = small_world(seed=5)
    w.run_until(12 * 3600)
    s = ListSink()
    c = w.fork(reseed=99, sink=s)
    w.run()
    c.run()
    assert digest(s) != digest(w.test_sink, len(w.test_sink.events) - len(s.events))
