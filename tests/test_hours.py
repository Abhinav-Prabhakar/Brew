"""BREW_HOURS: the opening-hours override for live worlds (brew.config.hours)."""

from __future__ import annotations

import pytest

from brew.config.hours import parse_hours, with_hours
from brew.config.loader import load_cafe
from brew.domain.timeutil import parse_hhmm
from brew.sim.arrivals import slot_rates


def test_parse_hours_clamps_midnight_and_rejects_nonsense():
    assert parse_hours("07:00-24:00") == (7 * 3600, 23 * 3600 + 59 * 60)
    for bad in ("", "7-24", "22:00-08:00", "x"):
        with pytest.raises(ValueError):
            parse_hours(bad)


def test_with_hours_moves_hours_crew_and_demand_without_touching_the_config():
    base = load_cafe()
    cfg = with_hours(base, "07:00-24:00")
    assert (base.cafe.open, base.cafe.close) == ("08:00", "22:00"), "the committed config is untouched"
    assert (cfg.cafe.open, cfg.cafe.close) == ("07:00", "23:59")
    starts = [parse_hhmm(m.shift[0]) for m in cfg.staff]
    ends = [parse_hhmm(m.shift[1]) for m in cfg.staff]
    assert min(starts) <= 7 * 3600 - 900, "someone opens the café"
    assert max(ends) == 23 * 3600 + 59 * 60, "someone closes it"
    late = 23 * 4  # the 23:00-23:15 slot
    assert sum(slot_rates(p, "weekday")[late] for p in cfg.personas.values()) > 0.5, "customers still come at 23:00"
    assert sum(slot_rates(p, "weekday")[late] for p in base.personas.values()) == 0


def test_a_late_day_serves_customers_until_midnight(small_world):
    w = small_world(seed=3, cfg=with_hours(load_cafe(), "07:00-24:00"))
    w.run()
    placed = [e.sim_s % 86400 for e in w.test_sink.of_type("order.placed")]
    assert any(t < 8 * 3600 for t in placed), "orders before the usual 08:00 opening"
    late = [t for t in placed if t >= 22 * 3600]
    assert late, "orders after the usual 22:00 close"
    served = [e.sim_s % 86400 for e in w.test_sink.of_type("order.served")]
    assert any(t >= 22 * 3600 for t in served), "and someone is there to serve them"
