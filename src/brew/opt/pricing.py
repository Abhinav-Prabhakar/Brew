"""Pricing ladder search (technical.md 12.2): per category step in {-10,-5,0,+5,+10 %} with elasticity.

For every combination of category steps (5^4 = 625) the expected profit of the next planning window is
``sum_i (p_i - c_i) * q_i(p_i) - capacity_penalty`` with
``q_i(p) = q_i * (p/p0)^beta_i * exp(-loss_i * [max(0, ln(p/ref)) - max(0, ln(p0/ref))])`` (loss aversion above
the reference price).  The charter is applied by the caller; here infeasible prices are skipped.
"""

from __future__ import annotations

import itertools
import math
from dataclasses import dataclass, field

import numpy as np

STEPS = (-0.10, -0.05, 0.0, 0.05, 0.10)


@dataclass
class PriceItem:
    sku: str
    cat: str
    price: float  # current live price p0
    cost: float  # variable cost per unit (INR)
    ref: float  # fairness reference price
    qty: float  # expected units in the window at the current price
    beta: float  # log-price elasticity (<0)
    loss: float = 0.0  # extra elasticity above the reference price (>=0 means demand falls faster)
    min_price: float = 0.0
    max_price: float = 1e9
    base: float = 0.0
    staple: bool = False
    allowed: bool = True  # charter cooldown satisfied
    grid: float = 5.0
    step_cap: float = 0.1  # fraction of base per change
    station_min: dict[str, float] = field(default_factory=dict)  # station -> minutes per unit


@dataclass
class PriceDecision:
    steps: dict[str, float]  # category -> step fraction
    prices: dict[str, float]  # sku -> new price (only changed ones)
    profit: float
    baseline: float
    gain: float
    detail: dict[str, dict[str, float]] = field(default_factory=dict)  # sku -> {old,new,qty_old,qty_new}


def _snap(p: float, grid: float) -> float:
    return round(p / grid) * grid


def demand_at(it: PriceItem, new_price: float) -> float:
    """Expected units at ``new_price`` given the current price / reference."""
    if new_price <= 0 or it.price <= 0:
        return 0.0
    ratio = new_price / it.price
    ln_new = math.log(new_price / max(it.ref, 1e-6))
    ln_old = math.log(it.price / max(it.ref, 1e-6))
    pen = max(0.0, ln_new) - max(0.0, ln_old)
    return it.qty * ratio**it.beta * math.exp(-it.loss * pen)


def candidate_price(it: PriceItem, step: float) -> float | None:
    """The grid price for a step (or ``None`` if it is infeasible under the charter / bounds)."""
    if step == 0.0:
        return it.price
    if not it.allowed:
        return None
    if step > 0 and it.staple:
        return None
    p = _snap(it.price * (1.0 + step), it.grid)
    base = it.base or it.price
    if abs(p - it.price) > it.step_cap * base + 1e-9:
        p = _snap(it.price + math.copysign(it.step_cap * base, step), it.grid)
        if abs(p - it.price) > it.step_cap * base + 1e-9:
            p -= math.copysign(it.grid, step)
    if p < it.min_price - 1e-9 or p > it.max_price + 1e-9 or abs(p - it.price) < 1e-9:
        return None
    return float(p)


def ladder_search(
    items: list[PriceItem],
    station_cap_min: dict[str, float] | None = None,
    shadow_per_min: dict[str, float] | None = None,
    util_threshold: float = 0.9,
    steps: tuple[float, ...] = STEPS,
    min_gain: float = 0.0,
) -> PriceDecision:
    """Brute-force the category step vector maximising expected profit minus the capacity penalty.

    ``station_cap_min[s]``: station minutes available in the window; ``shadow_per_min[s]``: INR per minute of
    overload (from the capacity LP). Without capacity data the penalty is zero.
    """
    cats = sorted({it.cat for it in items})
    by_cat = {c: [it for it in items if it.cat == c] for c in cats}
    # per (category, step): profit, station minutes and the chosen prices
    table: dict[str, list[tuple[float, dict[str, float], dict[str, float], bool]]] = {}
    for c in cats:
        rows = []
        for st in steps:
            prof = 0.0
            mins: dict[str, float] = {}
            ok = True
            for it in by_cat[c]:
                p = candidate_price(it, st)
                if p is None:
                    p = it.price  # item cannot move: stays (the step is applied to the movable ones)
                    if st != 0.0 and it.allowed and not it.staple:
                        pass
                q = demand_at(it, p)
                prof += (p - it.cost) * q
                for s, m in it.station_min.items():
                    mins[s] = mins.get(s, 0.0) + m * q
            rows.append((prof, mins, {it.sku: (candidate_price(it, st) or it.price) for it in by_cat[c]}, ok))
        table[c] = rows
    best: tuple[float, tuple[int, ...]] | None = None
    base_vec = tuple(steps.index(0.0) for _ in cats)
    for combo in itertools.product(range(len(steps)), repeat=len(cats)):
        prof = sum(table[c][k][0] for c, k in zip(cats, combo, strict=True))
        pen = 0.0
        if station_cap_min and shadow_per_min:
            tot: dict[str, float] = {}
            for c, k in zip(cats, combo, strict=True):
                for s, m in table[c][k][1].items():
                    tot[s] = tot.get(s, 0.0) + m
            for s, m in tot.items():
                cap = station_cap_min.get(s)
                if cap and m > util_threshold * cap:
                    pen += shadow_per_min.get(s, 0.0) * (m - util_threshold * cap)
        val = prof - pen
        if best is None or val > best[0] + 1e-9:
            best = (val, combo)
    assert best is not None
    base_val = _combo_value(table, cats, base_vec, station_cap_min, shadow_per_min, util_threshold)
    combo = best[1] if best[0] - base_val > min_gain else base_vec
    chosen_steps = {c: steps[k] for c, k in zip(cats, combo, strict=True)}
    prices: dict[str, float] = {}
    detail: dict[str, dict[str, float]] = {}
    for c, k in zip(cats, combo, strict=True):
        for it in by_cat[c]:
            p = table[c][k][2][it.sku]
            if abs(p - it.price) > 1e-9:
                prices[it.sku] = p
                detail[it.sku] = {"old": it.price, "new": p, "qty_old": it.qty, "qty_new": demand_at(it, p)}
    val = _combo_value(table, cats, combo, station_cap_min, shadow_per_min, util_threshold)
    return PriceDecision(chosen_steps, prices, val, base_val, val - base_val, detail)


def _combo_value(
    table: dict[str, list[tuple[float, dict[str, float], dict[str, float], bool]]],
    cats: list[str],
    combo: tuple[int, ...],
    cap: dict[str, float] | None,
    shadow: dict[str, float] | None,
    thr: float,
) -> float:
    prof = sum(table[c][k][0] for c, k in zip(cats, combo, strict=True))
    if not cap or not shadow:
        return float(prof)
    tot: dict[str, float] = {}
    for c, k in zip(cats, combo, strict=True):
        for s, m in table[c][k][1].items():
            tot[s] = tot.get(s, 0.0) + m
    pen = sum(shadow.get(s, 0.0) * max(0.0, m - thr * cap[s]) for s, m in tot.items() if cap.get(s))
    return float(prof - pen)


def optimal_price_constant_elasticity(cost: float, beta: float) -> float:
    """Unconstrained optimum ``p* = c * beta / (1 + beta)`` for ``q ~ p^beta`` (``beta < -1``)."""
    if beta >= -1.0:
        return float("inf")
    return float(cost * beta / (1.0 + beta))


def milp_prices(
    items: list[PriceItem], price_levels: int = 5, station_cap_min: dict[str, float] | None = None
) -> dict[str, float]:
    """Exact selection of one price level per SKU maximising profit s.t. station capacity (CP-SAT MILP).

    Levels are the current price plus the 5/10 % up / down candidates; demand follows :func:`demand_at`
    (scaled to integers). Used as the exact counterpart of :func:`ladder_search` when stations bind.
    """
    from ortools.sat.python import cp_model

    model = cp_model.CpModel()
    scale = 100.0
    choice: dict[tuple[str, int], cp_model.IntVar] = {}
    cand: dict[str, list[float]] = {}
    for it in items:
        ps = [it.price]
        for st in STEPS:
            p = candidate_price(it, st) if st != 0.0 else None
            if p is not None and p not in ps:
                ps.append(p)
        cand[it.sku] = ps[:price_levels]
        vars_ = [model.NewBoolVar(f"{it.sku}_{k}") for k in range(len(cand[it.sku]))]
        for k, v in enumerate(vars_):
            choice[(it.sku, k)] = v
        model.AddExactlyOne(vars_)
    obj = []
    for it in items:
        for k, p in enumerate(cand[it.sku]):
            obj.append(int(round((p - it.cost) * demand_at(it, p) * scale)) * choice[(it.sku, k)])
    if station_cap_min:
        for s, cap in station_cap_min.items():
            use = []
            for it in items:
                m = it.station_min.get(s, 0.0)
                if m:
                    for k, p in enumerate(cand[it.sku]):
                        use.append(int(round(m * demand_at(it, p) * scale)) * choice[(it.sku, k)])
            if use:
                model.Add(sum(use) <= int(cap * scale))
    model.Maximize(sum(obj))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 0.5
    solver.parameters.num_workers = 1
    st = solver.Solve(model)
    out: dict[str, float] = {}
    if st in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for it in items:
            for k, p in enumerate(cand[it.sku]):
                if solver.BooleanValue(choice[(it.sku, k)]) and abs(p - it.price) > 1e-9:
                    out[it.sku] = p
    return out


__all__ = [
    "STEPS", "PriceDecision", "PriceItem", "candidate_price", "demand_at", "ladder_search", "milp_prices",
    "np", "optimal_price_constant_elasticity",
]  # fmt: skip
