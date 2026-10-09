"""Optimisation components: newsvendor, capacity LP duals, scheduler, pricing ladder."""

from __future__ import annotations

import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from scipy.stats import norm

from brew.opt.capacity_lp import solve_capacity_lp
from brew.opt.newsvendor import (
    critical_ratio,
    demand_quantile,
    expected_overage,
    fit_lognormal,
    newsvendor_qty,
    perishable_order_up_to,
    quantile_from_bands,
    replate_adjusted_overage,
)
from brew.opt.pricing import (
    PriceItem,
    candidate_price,
    demand_at,
    ladder_search,
    milp_prices,
    optimal_price_constant_elasticity,
)
from brew.opt.scheduler import (
    SchedStaff,
    SchedTask,
    brute_force_optimal,
    cpsat_schedule,
    greedy_schedule,
    schedule,
)


# ------------------------------------------------------------------ newsvendor
def test_critical_ratio_and_quantile_formula():
    assert critical_ratio(3, 1) == pytest.approx(0.75)
    assert critical_ratio(0, 0) == 0.5
    # Poisson-limit demand: q* is the 75% quantile of Poisson(10)
    assert demand_quantile(10, 0.75, dispersion=1.0) == 12
    assert newsvendor_qty(10, 3, 1, dispersion=1.0) == 12
    # more underage cost -> stock more; more overage cost -> stock less
    assert newsvendor_qty(10, 9, 1) > newsvendor_qty(10, 1, 1) > newsvendor_qty(10, 1, 9)
    # over-dispersion widens the quantile
    assert demand_quantile(10, 0.9, 3.0) > demand_quantile(10, 0.9, 1.0)
    assert demand_quantile(0, 0.9) == 0


def test_lognormal_band_interpolation_recovers_quantiles():
    mu, sigma = 2.0, 0.4
    p10, p50, p90 = np.exp(mu + sigma * norm.ppf([0.1, 0.5, 0.9]))
    m2, s2 = fit_lognormal(p10, p50, p90)
    assert m2 == pytest.approx(mu, abs=1e-6) and s2 == pytest.approx(sigma, abs=1e-6)
    assert quantile_from_bands(p10, p50, p90, 0.75) == pytest.approx(float(np.exp(mu + sigma * norm.ppf(0.75))))


def test_replate_recovery_lowers_overage_and_raises_stocking():
    co = 40.0
    co_replate = replate_adjusted_overage(co, recovery_price=90.0, p_sell=0.6)
    assert co_replate < co
    assert newsvendor_qty(8, 60, co_replate) >= newsvendor_qty(8, 60, co)


def test_expected_overage_conserves_units():
    sales, left = expected_overage(6.0, 8.0)
    assert sales + left == pytest.approx(8.0, abs=1e-6)
    assert 0 < sales < 8


def test_perishable_order_up_to_capped_by_shelf_life():
    big = perishable_order_up_to(100, 10, shelf_days=30)
    capped = perishable_order_up_to(100, 10, shelf_days=3)
    assert capped == pytest.approx(100 * 3 * 0.8) and capped < big


# ------------------------------------------------------------------ capacity LP
def test_lp_duals_match_analytic_two_resource_toy():
    # max 5a + 4b  s.t. 6a + 4b <= 24 (oven), a + 2b <= 6 (barista), a,b <= 10. Optimum a=3, b=1.5, obj=21.
    # Both constraints bind; duals solve 6y1 + y2 = 5, 4y1 + 2y2 = 4 -> y1 = 0.75, y2 = 0.5.
    res = solve_capacity_lp(
        margin={"a": 5.0, "b": 4.0}, demand={"a": 10, "b": 10},
        usage={"a": {"oven": 6, "barista": 1}, "b": {"oven": 4, "barista": 2}},
        capacity={"oven": 24, "barista": 6},
    )  # fmt: skip
    assert res.status == "optimal"
    assert res.objective == pytest.approx(21.0)
    assert res.x["a"] == pytest.approx(3.0) and res.x["b"] == pytest.approx(1.5)
    assert res.shadow["oven"] == pytest.approx(0.75)
    assert res.shadow["barista"] == pytest.approx(0.5)
    assert set(res.binding) == {"oven", "barista"}


def test_lp_slack_resource_has_zero_shadow_price():
    res = solve_capacity_lp({"a": 5.0}, {"a": 2}, {"a": {"r1": 1, "r2": 1}}, {"r1": 100, "r2": 1})
    assert res.shadow["r1"] == 0.0 and res.shadow["r2"] > 0
    assert res.binding[0] == "r2"


# ------------------------------------------------------------------ scheduler
def mk_tasks(n, seed, att=1.0):
    rng = np.random.default_rng(seed)
    return [
        SchedTask(i, float(rng.integers(5, 40)), att, float(rng.integers(20, 90)), float(rng.integers(1, 4)), eligible=("s1", "s2"))
        for i in range(n)
    ]


@pytest.mark.parametrize("seed", range(6))
def test_cpsat_matches_brute_force_on_tiny_instances(seed):
    tasks = mk_tasks(5, seed)
    staff = [SchedStaff("s1"), SchedStaff("s2")]
    opt = brute_force_optimal(tasks, staff, 0.0)
    res = cpsat_schedule(tasks, staff, 0.0, time_limit_s=5.0, seed=1)
    assert res is not None and res.status == "optimal"
    assert res.cost == pytest.approx(opt, abs=1e-6)
    g = greedy_schedule(tasks, staff, 0.0)
    assert g.cost >= opt - 1e-6


def test_schedule_respects_precedence_and_staff_availability():
    tasks = [
        SchedTask(1, 30, 1.0, 100, eligible=("a",)),
        SchedTask(2, 20, 1.0, 100, eligible=("a",), preds=(1,)),
    ]
    staff = [SchedStaff("a", avail_at=50.0)]
    res = schedule(tasks, staff, 0.0, time_limit_s=1.0)
    assert res.start[1] >= 50 and res.start[2] >= res.start[1] + 30
    assert res.order == [1, 2]


def test_schedule_returns_within_a_tight_limit_with_greedy_fallback():
    tasks = mk_tasks(40, 3, att=0.5)
    staff = [SchedStaff("s1"), SchedStaff("s2")]
    res = schedule(tasks, staff, 0.0, time_limit_s=0.02, seed=0)
    assert set(res.order) == {t.id for t in tasks}
    assert res.status in ("optimal", "feasible", "greedy")
    assert res.cost <= greedy_schedule(tasks, staff, 0.0).cost + 1e-6


def test_equipment_slots_limit_concurrency():
    tasks = [SchedTask(i, 100, 0.1, 1000, eligible=("a", "b", "c"), slot="oven") for i in range(3)]
    staff = [SchedStaff("a"), SchedStaff("b"), SchedStaff("c")]
    res = cpsat_schedule(tasks, staff, 0.0, slots={"oven": 1}, time_limit_s=2.0)
    assert res is not None
    starts = sorted(res.start.values())
    assert starts[1] - starts[0] >= 100 - 1e-6 and starts[2] - starts[1] >= 100 - 1e-6


@pytest.mark.property
@settings(max_examples=25, deadline=None)
@given(n=st.integers(1, 6), seed=st.integers(0, 50))
def test_greedy_is_feasible_and_never_better_than_optimal(n, seed):
    tasks = mk_tasks(n, seed)
    staff = [SchedStaff("s1"), SchedStaff("s2")]
    g = greedy_schedule(tasks, staff, 0.0)
    assert g.cost >= brute_force_optimal(tasks, staff, 0.0) - 1e-6
    assert len(g.order) == n


# ------------------------------------------------------------------ pricing
def item(sku, cat, p, c, qty, beta=-1.2, **kw):
    return PriceItem(sku, cat, p, c, ref=kw.pop("ref", p), qty=qty, beta=beta, min_price=0.8 * p, max_price=1.3 * p, base=p, **kw)


def test_candidate_price_charter_rules():
    it = item("x", "coffee", 220, 60, 10)
    assert candidate_price(it, 0.05) == 230 and candidate_price(it, -0.10) == 200
    assert candidate_price(item("s", "coffee", 120, 30, 10, staple=True), 0.05) is None  # staples never rise
    assert candidate_price(item("c", "coffee", 220, 60, 10, allowed=False), 0.05) is None  # cooldown
    capped = item("m", "coffee", 220, 60, 10)
    capped.max_price = 222
    assert candidate_price(capped, 0.10) is None


def test_elastic_demand_and_loss_aversion():
    it = item("x", "coffee", 200, 60, 100, beta=-1.0, loss=1.0)
    assert demand_at(it, 200) == pytest.approx(100)
    assert demand_at(it, 220) < 100 / 1.1  # loss aversion hurts more than the plain elasticity
    assert demand_at(it, 180) > 100


def test_ladder_prefers_price_rise_when_demand_is_inelastic_and_cut_when_elastic():
    inel = [item("a", "coffee", 200, 60, 50, beta=-0.3)]
    el = [item("b", "plates", 200, 60, 50, beta=-2.5)]
    assert ladder_search(inel).steps["coffee"] > 0
    d = ladder_search(el)
    assert d.steps["plates"] < 0 and d.gain > 0


def test_ladder_capacity_penalty_discourages_demand_growth():
    el = [item("b", "plates", 200, 60, 50, beta=-2.5, station_min={"oven": 10.0})]
    free = ladder_search(el)
    pen = ladder_search(el, station_cap_min={"oven": 400.0}, shadow_per_min={"oven": 30.0})
    assert free.steps["plates"] < 0 and pen.steps["plates"] >= free.steps["plates"]


def test_constant_elasticity_optimum_formula():
    assert optimal_price_constant_elasticity(60, -3.0) == pytest.approx(90.0)
    assert optimal_price_constant_elasticity(60, -0.5) == float("inf")


def test_milp_prices_respects_capacity():
    items = [item("a", "plates", 200, 60, 50, beta=-2.5, station_min={"oven": 10.0})]
    unconstrained = milp_prices(items)
    constrained = milp_prices(items, station_cap_min={"oven": 400.0})
    assert unconstrained.get("a", 200) <= 200
    assert constrained.get("a", 200) >= unconstrained.get("a", 200)
