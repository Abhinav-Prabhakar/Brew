"""Immediate re-plan on manual chaos + decision headlines."""

from __future__ import annotations

import pytest

from brew.events.bus import ListSink
from brew.events.schema import validate_event
from brew.sim.world import World


def _check_headlines(w: World) -> None:
    assert w.decisions
    for d in w.decisions:
        assert d["headline"] and len(d["headline"]) <= 60, d
        assert d["headline"] == d["headline"].strip()


def _decisions(sink: ListSink) -> list:
    return [e for e in sink.events if e.type == "decision.made"]


@pytest.mark.parametrize("policy", ["A", "B", "C"])
def test_headlines_for_a_day_and_replan_on_manual_chaos(policy):
    sink = ListSink()
    w = World(policy=policy, seed=5, days=1, sink=sink)
    w.run_until(12 * 3600)
    n0 = len(_decisions(sink))
    d = w.trigger_chaos("equipment_down", "espresso", duration_min=30)
    w.run_until(12 * 3600 + 1)
    got = [e for e in _decisions(sink)[n0:] if e.data["trigger"] == d.id]
    assert len(got) == 1
    assert got[0].sim_s == pytest.approx(12 * 3600)
    assert got[0].data["headline"].startswith("espresso down")
    validate_event("decision.made", got[0].data)
    w.run(1)
    _check_headlines(w)
    assert all(e.data["trigger"] in (None, d.id) for e in _decisions(sink))


def test_no_manual_chaos_means_no_replan_and_is_deterministic():
    def run() -> list:
        sink = ListSink()
        w = World(policy="B", seed=9, days=1, sink=sink)
        w.run(1)
        return [(e.type, round(e.sim_s, 3)) for e in sink.events]

    a = run()
    assert a == run()
    sink = ListSink()
    World(policy="B", seed=9, days=1, sink=sink).run(1)
    assert all(e.data["trigger"] is None for e in _decisions(sink))


def test_replan_is_deterministic_with_manual_chaos():
    def run() -> list:
        sink = ListSink()
        w = World(policy="B", seed=9, days=1, sink=sink)
        w.run_until(11 * 3600)
        w.trigger_chaos("equipment_down", "espresso", duration_min=45)
        w.run(1)
        return [(e.type, round(e.sim_s, 3), e.data.get("headline")) for e in sink.events]

    assert run() == run()
