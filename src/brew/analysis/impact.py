"""Impact metrics (docs/implementation-spec.md 14.5): economic / environmental / social scoreboard, absolute and vs a
baseline, plus the Replate cannibalisation counterfactual (CRN fork with ``replate_mode = off``)."""

from __future__ import annotations

from typing import Any

import numpy as np

from .stats import cvar


def scoreboard(world: Any, baseline: dict[str, Any] | None = None) -> dict[str, Any]:
    """Triple-bottom-line numbers for a world (per day averages) and, optionally, deltas vs ``baseline``."""
    ds = world.daily_kpis
    n = max(1, len(ds))

    def avg(k: str) -> float:
        return float(sum(d.get(k, 0.0) for d in ds) / n) if ds else 0.0

    profits = [d["net_profit"] for d in ds]
    off = [max(d["p95_wait_s"].get("dine_in", 0), d["p95_wait_s"].get("takeaway", 0)) for d in ds]
    out: dict[str, Any] = {
        "economic": {
            "net_profit_per_day": avg("net_profit"), "cvar10_daily_profit": cvar(profits) if profits else 0.0,
            "revenue_per_labour_hour": avg("revenue_per_labour_hour"),
            "replate_revenue_per_day": avg("replate_revenue"), "replate_units_per_day": avg("replate_units_sold"),
        },
        "environmental": {
            "waste_kg_per_day": avg("waste_kg"), "waste_inr_per_day": avg("waste_inr"), "co2e_kg_per_day": avg("co2e_kg"),
            "energy_kwh_per_day": avg("energy_kwh"), "donated_kg_per_day": avg("donated_kg"),
            "replate_waste_avoided_kg_per_day": avg("replate_waste_avoided_kg"),
            "replate_co2e_avoided_kg_per_day": avg("replate_co2e_avoided_kg"),
        },
        "social": {
            "overload_min_per_day": avg("overload_min"), "p95_offline_wait_s": float(max(off)) if off else 0.0,
            "walkouts_per_day": avg("walkouts"), "rating": float(world.reviews.rep.overall()),
            "price_changes_per_day": avg("price_changes"), "charter_compliant": True,
        },
        "days": len(ds),
    }  # fmt: skip
    if baseline is not None:
        out["vs_baseline"] = {
            sect: {k: out[sect][k] - baseline[sect][k] for k in out[sect] if isinstance(out[sect][k], float) and k in baseline[sect]}
            for sect in ("economic", "environmental", "social")
        }
    return out


def replate_cannibalisation(
    policy: str, seed: int, days: int = 1, scenario: str = "weekday_normal", models_dir: str | None = None
) -> dict[str, Any]:
    """Run the same world (same seed -> same customers) with Replate as the policy runs it and with
    ``replate_mode = off`` from day start; the difference isolates the rescue menu.

    * ``replate_revenue`` - what sold through the rescue menu,
    * ``full_price_revenue_lost`` - full-price revenue that disappeared versus the off world
      (customers who traded down) - the cannibalisation,
    * ``net_profit_effect`` - profit(on) - profit(off).
    """
    from brew.policies.registry import make_policy
    from brew.sim.world import World

    res: dict[str, Any] = {}
    for tag, mode in (("on", None), ("off", "off")):
        w = World(policy=make_policy(policy, models_dir=models_dir), scenario=scenario, seed=seed, days=days, replate=mode)
        w.run(days)
        res[tag] = {
            "profit": float(np.sum([k["net_profit"] for k in w.daily_kpis])),
            "revenue": float(np.sum([k["revenue"] for k in w.daily_kpis])),
            "replate_revenue": float(np.sum([k["replate_revenue"] for k in w.daily_kpis])),
            "replate_units": float(np.sum([k["replate_units_sold"] for k in w.daily_kpis])),
            "waste_kg": float(np.sum([k["waste_kg"] for k in w.daily_kpis])),
        }
    on, off = res["on"], res["off"]
    full_on = on["revenue"] - on["replate_revenue"]
    return {
        "policy": policy, "seed": seed, "days": days, "on": on, "off": off,
        "replate_revenue": on["replate_revenue"], "full_price_revenue_lost": max(0.0, off["revenue"] - full_on),
        "net_revenue_effect": on["revenue"] - off["revenue"], "net_profit_effect": on["profit"] - off["profit"],
        "waste_kg_avoided": off["waste_kg"] - on["waste_kg"],
    }  # fmt: skip
