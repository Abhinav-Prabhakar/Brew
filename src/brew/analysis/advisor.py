"""Investment advisor (docs/implementation-spec.md 14.2): counterfactual forks with common random numbers.

For each catalog item (pre-screened by the bottleneck report) the live world is forked ``K`` times with
seeds ``s_1..s_K``; every seed is run twice - once as is and once with the investment's effect applied - for
``H`` full days under the current policy.  Because both runs share the seed they see the same customers
(CRN), so the paired difference isolates the effect.  Reported per item: mean daily profit change net of
operating cost, a 90 % bootstrap CI, payback days, and the change in P95 wait / waste / CO2e.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import TYPE_CHECKING, Any

import numpy as np

from .stats import paired_bootstrap_ci

if TYPE_CHECKING:
    from brew.sim.world import World

ALWAYS = ("barista_morning", "marketing_push", "oatmilk_standing", "dishwasher_upgrade")
SCREEN = {  # catalog key -> resources whose pressure makes it worth testing
    "espresso_2nd": ("espresso", "grinder"),
    "press_2nd": ("press",),
    "table_2top": ("tables",),
    "bar_stools": ("tables",),
    "fridge_bigger": ("display",),
    "dishwasher_upgrade": ("dishpit", "dish_pool"),
}


@dataclass
class Recommendation:
    catalog_key: str
    name: str
    capex: float
    opex_per_day: float
    delta_profit_per_day: float
    ci90: tuple[float, float]
    payback_days: float | None
    delta_p95_wait_s: float
    delta_waste_kg: float
    delta_co2e_kg: float
    seeds: int
    days: int
    rank: int = 0
    reason: str = ""
    detail: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def screen(world: World) -> dict[str, str]:
    """Catalog keys worth simulating and why (shadow price / pressure on their resource, or always-on)."""
    rep = {r["resource"]: r for r in world.bn.report(force=True)}
    out: dict[str, str] = {}
    for key in world.ix.catalog:
        res = SCREEN.get(key)
        if res is None:
            if key in ALWAYS:
                out[key] = "always evaluated (staffing / marketing / purchasing)"
            continue
        hit = [r for r in res if r in rep and (rep[r]["shadow_price"] > 0 or rep[r]["rho"] > 0.6 or rep[r]["active_share"] > 0.25)]
        if hit:
            r0 = rep[hit[0]]
            out[key] = f"{hit[0]} is under pressure (rho {r0['rho']:.2f}, active {r0['active_share']:.0%}, shadow {r0['shadow_price']:.1f}/min)"
    return out


def _run(world: World, seed: int, days: int, effect: dict[str, Any] | None, opex: float) -> dict[str, float]:
    """Fork ``world``, optionally apply ``effect`` at once, run ``days`` full days; return mean daily KPIs."""
    f = world.fork(reseed=seed)
    f.continuous = True
    f.done = False
    n0 = len(f.daily_kpis)
    if effect is not None:
        f.invest.apply(effect)
        f.invest_log.append({"key": "_what_if", "opex": opex, "delivered": True, "capex": 0.0})
    target_day = f.day + days  # complete today, then `days` more
    # run until `days` additional day-ends after the current day has ended
    while len(f.daily_kpis) < n0 + 1 + days and f.engine.peek() is not None:
        f.run_until(min(f.day_end_t(f.day) + 1.0 + 86400.0 * days, f.next_event_time() or 1e18))
        if f.day > target_day + 1:
            break
    ks = f.daily_kpis[n0 + 1 : n0 + 1 + days]
    if not ks:
        ks = f.daily_kpis[n0:]
    out = {
        "profit": float(np.mean([k["net_profit"] for k in ks])),
        "p95_wait": float(np.mean([max(k["p95_wait_s"].values(), default=0.0) for k in ks])),
        "waste_kg": float(np.mean([k["waste_kg"] for k in ks])),
        "co2e_kg": float(np.mean([k["co2e_kg"] for k in ks])),
    }
    return out


def evaluate_item(world: World, key: str, seeds: int = 3, days: int = 1, base: list[dict[str, float]] | None = None) -> Recommendation:
    """CRN counterfactual of one catalog item (base runs can be shared between items)."""
    item = world.ix.catalog[key]
    seed_list = [world.seed * 1000 + i + 1 for i in range(seeds)]
    if base is None:
        base = [_run(world, s, days, None, 0.0) for s in seed_list]
    treated = [_run(world, s, days, dict(item.effect), item.opex_per_day) for s in seed_list]
    d = np.array([t["profit"] - b["profit"] for t, b in zip(treated, base, strict=True)])
    mean, lo, hi = paired_bootstrap_ci(d, n_boot=2000, alpha=0.10, seed=1)
    pay = item.capex / mean if mean > 1e-6 and item.capex > 0 else (0.0 if item.capex == 0 and mean > 0 else None)
    return Recommendation(
        key, item.name, item.capex, item.opex_per_day, mean, (lo, hi), pay,
        float(np.mean([t["p95_wait"] - b["p95_wait"] for t, b in zip(treated, base, strict=True)])),
        float(np.mean([t["waste_kg"] - b["waste_kg"] for t, b in zip(treated, base, strict=True)])),
        float(np.mean([t["co2e_kg"] - b["co2e_kg"] for t, b in zip(treated, base, strict=True)])),
        seeds, days,
        detail={"diffs": d.tolist(), "seed_list": seed_list},
    )  # fmt: skip


def run_advisor(world: World, seeds: int = 3, days: int = 1, keys: list[str] | None = None) -> list[Recommendation]:
    """Evaluate the screened catalog and rank by profit gain per day (payback as tie-break)."""
    why = screen(world)
    todo = keys if keys is not None else list(why)
    seed_list = [world.seed * 1000 + i + 1 for i in range(seeds)]
    base = [_run(world, s, days, None, 0.0) for s in seed_list]
    recs = []
    for key in todo:
        r = evaluate_item(world, key, seeds, days, base)
        r.reason = why.get(key, "requested")
        recs.append(r)
    recs.sort(key=lambda r: (-r.delta_profit_per_day, r.payback_days if r.payback_days is not None else 1e9))
    for i, r in enumerate(recs):
        r.rank = i + 1
    return recs
