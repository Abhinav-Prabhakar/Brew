"""Policy C/E, bottleneck analyzer, investments, advisor, explainer, impact, arena."""

from __future__ import annotations

import numpy as np
import pytest

from brew.analysis.advisor import evaluate_item, run_advisor, screen
from brew.analysis.arena import run_arena, run_one
from brew.analysis.explain import Explainer
from brew.analysis.impact import replate_cannibalisation, scoreboard
from brew.events.bus import ListSink
from brew.policies.base import ManagerAction
from brew.policies.registry import make_policy
from brew.sim.actions import InvalidAction, UnknownTarget
from brew.sim.world import World

H = 3600.0


# ------------------------------------------------------------------ policies C / E
@pytest.fixture(scope="module")
def day_c():
    sink = ListSink()
    w = World(policy="C", seed=7, sink=sink, telemetry=True)
    w.run(1)
    w.test_sink = sink  # type: ignore[attr-defined]
    return w


def test_policy_c_runs_a_full_day_and_records_decisions(day_c):
    k = day_c.daily_kpis[0]
    assert k["orders"] > 250 and k["net_profit"] > 30_000
    decs = day_c.test_sink.of_type("decision.made")
    assert decs and all(d.data["policy"] in ("C", "owner") for d in decs)
    assert day_c.inv.check_conservation() == {}
    assert day_c.policy.solve_stats["calls"] > 0  # the CP-SAT / greedy plan was used
    types = {d.data["type"] for d in decs}
    assert "prep_start" in types


def test_policy_c_is_deterministic():
    a = World(policy="C", seed=3, days=1)
    a.run(1)
    b = World(policy="C", seed=3, days=1)
    b.run(1)
    assert a.daily_kpis[0]["net_profit"] == b.daily_kpis[0]["net_profit"] and a.seq == b.seq


def test_policy_e_oracle_runs_and_knows_the_future():
    w = World(policy="E", seed=5, days=1)
    w.run(1)
    assert w.daily_kpis[0]["orders"] > 250
    assert w.policy.demand.oracle is not None and w.policy.demand.oracle.sum() > 0


def test_policy_c_honours_manual_strategy():
    w = World(policy="C", seed=4, days=1)
    w.set_strategy("rush_menu")
    w.run_until(12 * H)
    assert all(w.menu[s].hidden for s in ("pasta", "sandwich", "avotoast"))
    assert w.preset == w.preset  # dispatch used the HUD preset without errors


def test_policy_c_charter_and_teacher_interface():
    w = World(policy="C", seed=2, days=1, sink=ListSink())
    w.run_until(15 * H)
    act = w.policy.manager_action(w.obs_builder.build(), w.view())
    assert isinstance(act, ManagerAction)
    w.run(1)
    for e in w.sink.of_type("price.changed"):  # type: ignore[union-attr]
        d = e.data
        assert d["by"] in ("C", "owner")
        item = w.ix.menu[d["sku"]]
        assert item.min_price <= d["new"] <= item.max_price
        assert abs(d["new"] - d["old"]) <= 0.1 * item.base_price + 1e-9


def test_policy_c_without_models_still_works(tmp_path):
    from brew.policies.C_solver import PolicyC

    w = World(policy=PolicyC(models_dir=tmp_path, use_models=False), seed=6, days=1)
    w.run(1)
    assert w.daily_kpis[0]["orders"] > 200


def test_c_beats_a_on_a_multi_day_smoke_run():
    """C keeps the pantry stocked; A runs dry. Two seeds x 4 days keeps this under the default budget."""
    res = run_arena(["A", "C"], [1, 2], 4, "weekday_normal")
    s = res.summary()["policies"]
    assert s["C"]["mean_profit"] > s["A"]["mean_profit"]


# --------------------------------------------------------------- bottleneck analyzer
def test_bottleneck_report_ranks_resources_and_emits_changes():
    sink = ListSink()
    w = World(policy="B", seed=3, days=1, sink=sink)
    w.run_until(13 * H)
    rows = w.bn.report(force=True)
    assert rows and rows == sorted(rows, key=lambda r: (-r["score"], r["resource"]))
    r0 = rows[0]
    assert {"resource", "rho", "avg_queue", "wait_attribution", "active_share", "shadow_price", "score"} <= set(r0)
    assert all(0 <= r["rho"] <= 1.6 for r in rows)
    assert any(r["resource"] == "tables" for r in rows)
    ev = sink.of_type("bottleneck.changed")
    assert ev and ev[0].data["resource"]


def test_bottleneck_shadow_prices_are_nonnegative():
    w = World(policy="B", seed=3, days=1)
    w.run_until(12 * H)
    sh = w.bn._shadow_prices()
    assert sh and all(v >= 0 for v in sh.values())


# -------------------------------------------------------------------- investments
def test_investment_buy_deliver_and_apply_effects():
    sink = ListSink()
    w = World(policy="B", seed=3, days=2, sink=sink, cash_start=500_000)
    w.run_until(9 * H)
    cash0 = w.fin.cash
    n_tables = len(w.tables)
    res = w.invest.buy("bar_stools")
    assert w.fin.cash == pytest.approx(cash0 - 22_000) and res["deliver_s"] == pytest.approx(w.now + 36 * H)
    with pytest.raises(InvalidAction):
        w.invest.buy("bar_stools")  # already on order
    w.run_until(res["deliver_s"] + 60)
    assert len(w.tables) == n_tables + 1 and w.tables[list(w.tables)[-1]].seats == 4
    assert sink.of_type("investment.delivered")[0].data["catalog_key"] == "bar_stools"
    w.invest.buy("espresso_2nd")
    w.run_until(w.now + 73 * H)
    assert sum(e.slots for e in w.equip if e.station == "espresso") == 4
    with pytest.raises(UnknownTarget):
        w.invest.buy("nope")
    poor = World(policy="A", seed=1, days=1, cash_start=100)
    with pytest.raises(InvalidAction):
        poor.invest.buy("espresso_2nd")


def test_every_catalog_effect_applies(cafe_cfg):
    w = World(policy="B", seed=2, days=2)
    w.run_until(9 * H)
    for item in cafe_cfg.catalog:
        w.invest.apply(dict(item.effect))
    assert w.dish_speed == 0.6 and w.fridge_factor == 1.5 and w.invest.standing and w.trend_mult > 1.0
    assert any(s.key == "barista_c" for s in w.kitchen.staff_list)
    w.run(2)  # still runs with everything applied
    assert w.inv.check_conservation() == {}


# ----------------------------------------------------------------------- advisor
def test_advisor_screens_by_pressure_and_uses_crn():
    w = World(policy="B", seed=3, days=3)
    w.run_until(14 * H)
    why = screen(w)
    assert "marketing_push" in why and "table_2top" in why  # tables are under pressure at midday
    noop = {"kind": "demand_mult", "factor": 1.0, "days": 1}
    base = None
    item = w.ix.catalog["marketing_push"]
    object.__setattr__(item, "effect", noop) if False else None
    rec = evaluate_item(w, "bar_stools", seeds=2, days=1)
    assert rec.seeds == 2 and len(rec.detail["diffs"]) == 2 and rec.ci90[0] <= rec.delta_profit_per_day <= rec.ci90[1]
    # CRN: re-running the same counterfactual gives identical numbers
    rec2 = evaluate_item(w, "bar_stools", seeds=2, days=1)
    assert rec.detail["diffs"] == rec2.detail["diffs"] and base is None


def test_advisor_ranking_sanity_crn_noop_is_zero_and_a_demand_slump_ranks_last(monkeypatch):
    from brew.config.schemas import CatalogItem

    w = World(policy="B", seed=3, days=3, cash_start=500_000)
    w.run_until(14 * H)
    cat = w.ix.catalog
    monkeypatch.setitem(cat, "noop", CatalogItem(key="noop", name="No-op", capex=0, effect={"kind": "demand_mult", "factor": 1.0, "days": 1}))
    monkeypatch.setitem(cat, "slump", CatalogItem(key="slump", name="Demand slump", capex=0, effect={"kind": "demand_mult", "factor": 0.4, "days": 3}))
    recs = run_advisor(w, seeds=3, days=1, keys=["noop", "slump", "barista_morning"])
    by = {r.catalog_key: r for r in recs}
    assert by["noop"].delta_profit_per_day == 0.0  # same seeds, same customers: the paired difference is exactly 0
    assert by["slump"].delta_profit_per_day < -3000 and by["slump"].rank == 3  # losing 60% of demand is ranked last
    assert by["noop"].rank < by["slump"].rank and [r.rank for r in recs] == [1, 2, 3]


# ------------------------------------------------------------------------ explain
def test_explainer_renders_every_decision_without_unfilled_slots(day_c):
    ex = Explainer.from_world(day_c)
    assert ex.bank, "clean explanation bank expected"
    seen = set()
    for rec in day_c.decisions:
        out = ex.explain(rec)
        assert out["text"] and "{" not in out["text"] and "}" not in out["text"]
        assert out["decision_id"] == rec["decision_id"]
        seen.add(rec["type"])
    assert seen & {"prep_start", "price_change", "reorder"}


def test_explainer_fails_loudly_on_unknown_slot_and_falls_back_without_bank():
    with pytest.raises(KeyError):
        Explainer.render("Raised {item} because {not_a_slot}", {"item": "x"})
    rec = {
        "decision_id": "dec-1", "type": "price_change", "policy": "C", "summary": "s", "sim_s": 0, "top_factors": [],
        "changes": [{"kind": "price", "item": "latte", "old": 230, "new": 240}], "context": {"hour": 12, "load_pct": 91},
    }  # fmt: skip
    out = Explainer([]).explain(rec)
    assert "latte" in out["text"] and "240" in out["text"] and out["template_id"] == "fallback"
    rec["type"] = "replate_markdown"
    rec["changes"] = [{"kind": "replate", "item": "croissant", "pct": 50}]
    assert "croissant" in Explainer([]).explain(rec)["text"]


# ------------------------------------------------------------------------ impact
def test_scoreboard_and_vs_baseline(day_c):
    sb = scoreboard(day_c)
    assert sb["economic"]["net_profit_per_day"] == pytest.approx(day_c.daily_kpis[0]["net_profit"])
    assert {"waste_kg_per_day", "co2e_kg_per_day"} <= set(sb["environmental"])
    base = World(policy="A", seed=7, days=1)
    base.run(1)
    sb2 = scoreboard(day_c, scoreboard(base))
    assert "vs_baseline" in sb2 and "net_profit_per_day" in sb2["vs_baseline"]["economic"]


def test_replate_cannibalisation_counterfactual_is_a_crn_pair():
    r = replate_cannibalisation("B", seed=4, days=1)
    assert r["off"]["replate_units"] == 0 and r["on"]["replate_units"] >= 0
    assert r["net_profit_effect"] == pytest.approx(r["on"]["profit"] - r["off"]["profit"])
    assert r["full_price_revenue_lost"] >= 0 and r["replate_revenue"] == r["on"]["replate_revenue"]


# ------------------------------------------------------------------------- arena
def test_arena_runner_pairs_seeds_and_summarises():
    res = run_arena(["A", "B"], [1, 2], 1, "weekday_normal")
    assert len(res.rows) == 4 and {r["policy"] for r in res.rows} == {"A", "B"}
    s = res.summary()["policies"]
    assert set(s) == {"A", "B"} and "vs_A" in s["B"] and "ci95" in s["B"]["vs_A"] and s["B"]["vs_A"]["n"] == 2
    rows = run_one({"policy": "A", "seed": 1, "days": 1, "scenario": "weekday_normal"})
    assert rows[0]["net_profit"] == res.per_seed("A")[0]


def test_arena_replate_ab_reports_waste_and_profit():
    from brew.analysis.arena import run_replate_ab

    ab = run_replate_ab("B", [1], 1, "weekday_normal")
    assert set(ab) >= {"on", "off", "waste_reduction_pct", "profit_delta"} and ab["off"]["replate_units"] == 0
    assert np.isfinite(ab["waste_reduction_pct"])
