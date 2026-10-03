from __future__ import annotations

import pytest

from brew.config.loader import default_cafe
from brew.events.bus import ListSink
from brew.sim.world import World


@pytest.fixture(scope="session")
def cafe_cfg():
    return default_cafe()


@pytest.fixture
def small_world():
    """Factory: a World with a ListSink attached (sink exposed as ``world.test_sink``)."""

    def make(seed: int = 7, policy: str = "A", scenario: str = "weekday_normal", days: int = 1, **kw) -> World:
        sink = ListSink()
        w = World(policy=policy, scenario=scenario, seed=seed, days=days, sink=sink, **kw)
        w.test_sink = sink  # type: ignore[attr-defined]
        return w

    return make


@pytest.fixture(scope="session")
def day_a():
    """One full day of policy A (shared, read-only)."""
    sink = ListSink()
    w = World(policy="A", seed=7, sink=sink, telemetry=True, keep_ledger_entries=True)
    w.run(1)
    w.test_sink = sink  # type: ignore[attr-defined]
    return w


@pytest.fixture(scope="session")
def day_b():
    sink = ListSink()
    w = World(policy="B", seed=7, sink=sink, telemetry=True)
    w.run(1)
    w.test_sink = sink  # type: ignore[attr-defined]
    return w
