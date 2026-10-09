"""Fluid capacity LP with shadow prices (technical.md 12.5, 14.1).

Maximise ``sum_j m_j x_j`` (margin x units served in the horizon) subject to
``sum_j t_{j,r} x_j <= cap_r`` for every resource ``r`` and ``0 <= x_j <= D_j``.  The duals of the resource
constraints are the **shadow prices** (INR per resource-minute): what one more minute of the resource
would earn.  Solved with OR-Tools GLOP.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ortools.linear_solver import pywraplp


@dataclass
class LpResult:
    status: str
    objective: float
    x: dict[str, float]
    shadow: dict[str, float]  # INR per resource-minute
    utilisation: dict[str, float]
    binding: list[str] = field(default_factory=list)


def solve_capacity_lp(
    margin: dict[str, float],
    demand: dict[str, float],
    usage: dict[str, dict[str, float]],
    capacity: dict[str, float],
) -> LpResult:
    """Solve the fluid LP.

    ``margin[j]``: INR per unit; ``demand[j]``: upper bound on units; ``usage[j][r]``: resource-minutes per
    unit; ``capacity[r]``: resource-minutes available.  Resources absent from ``capacity`` are unconstrained.
    """
    solver = pywraplp.Solver.CreateSolver("GLOP")
    if solver is None:  # pragma: no cover - GLOP ships with ortools
        raise RuntimeError("GLOP unavailable")
    items = sorted(margin)
    xv = {j: solver.NumVar(0.0, max(0.0, float(demand.get(j, 0.0))), f"x_{j}") for j in items}
    cons: dict[str, Any] = {}
    for r, cap in capacity.items():
        c = solver.Constraint(-solver.infinity(), max(0.0, float(cap)), f"cap_{r}")
        for j in items:
            t = usage.get(j, {}).get(r, 0.0)
            if t:
                c.SetCoefficient(xv[j], float(t))
        cons[r] = c
    obj = solver.Objective()
    for j in items:
        obj.SetCoefficient(xv[j], float(margin[j]))
    obj.SetMaximization()
    st = solver.Solve()
    status = {pywraplp.Solver.OPTIMAL: "optimal", pywraplp.Solver.FEASIBLE: "feasible"}.get(st, "infeasible")
    if status == "infeasible":
        return LpResult(status, 0.0, dict.fromkeys(items, 0.0), dict.fromkeys(capacity, 0.0), dict.fromkeys(capacity, 0.0))
    x = {j: float(xv[j].solution_value()) for j in items}
    shadow = {r: max(0.0, float(c.dual_value())) for r, c in cons.items()}
    util = {}
    for r, cap in capacity.items():
        used = sum(usage.get(j, {}).get(r, 0.0) * x[j] for j in items)
        util[r] = used / cap if cap > 0 else 0.0
    binding = sorted((r for r, s in shadow.items() if s > 1e-9), key=lambda r: -shadow[r])
    return LpResult("optimal", float(obj.Value()), x, shadow, util, binding)
