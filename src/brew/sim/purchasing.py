"""Proposed purchase order: what the active policy would order now, without touching the real world.

The policy's own ``on_day_end`` purchasing code runs on a **fork** of the world (identical RNG streams, no sink), the
resulting purchase orders are placed *on the fork* (so pack rounding, MOQ, price and the ETA are exactly what the real
``Suppliers.place`` would produce if the owner approves immediately), and then read back. The fork is discarded.

Policies C / D: order-up-to newsvendor (``_po_plan``), sized to the service level implied by ``purchasing.z``.
Policy B: (s, S) par logic. Policy A orders only on Mon/Thu; on other days the proposal falls back to B's (s, S)
par / reorder-point rule so the owner always has something sensible to approve.
"""

from __future__ import annotations

import math
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .world import World


def _phi(z: float) -> float:
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def _service_level(w: World, basis: str) -> str:
    pol = w.policy
    if basis == "newsvendor":
        z = float(getattr(pol, "P", {}).get("purchasing", {}).get("z", 0.0))
        if z > 0:
            return f"sized to P{round(100 * _phi(z))} (z = {z:g})"
    if basis == "par":
        return "order up to par whenever on hand + on order <= reorder point (B-style s,S)"
    return "fixed cover (A: ~3.5 days of average use)"


def _day_end_action(fork: World) -> tuple[Any, str]:
    """(DayEndAction, basis) from the fork's policy; ``basis`` in newsvendor | par | fixed."""
    from brew.policies.B_heuristic import PolicyB

    code = fork.policy.code
    view = fork.view()
    act = fork.policy.on_day_end(view)
    basis = "newsvendor" if code in ("C", "D", "E") else ("par" if code == "B" else "fixed")
    if code == "A" and not act.pos:
        act = PolicyB().on_day_end(view)
        basis = "par"
    return act, basis


def _reason(w: World, key: str, basis: str) -> str:
    on = w.inv.onhand.get(key, 0.0)
    oo = w.suppliers.open_for(key)
    use = w.ma.key_usage_per_day(key)
    ing = w.ix.ingredient[key]
    cover = f"{on / use:.1f} d cover" if use > 0 else "no recent use"
    tail = f"{on:g}{ing.base_uom} on hand" + (f" + {oo:g} on order" if oo else "") + f", {cover}"
    if basis == "newsvendor":
        return f"forecast-sized restock: {tail}"
    if basis == "par":
        return f"below reorder point ({ing.reorder_point:g}): {tail}"
    return f"scheduled restock: {tail}"


def propose(w: World) -> dict[str, Any]:
    """The policy's next purchase order(s), grouped by supplier, plus the next scheduled delivery."""
    fork = w.fork()  # identical RNG streams, no sink: nothing below touches the real world
    act, basis = _day_end_action(fork)
    orders: list[dict[str, Any]] = []
    for po in act.pos:
        lines = {ln.ingredient: ln.qty for ln in po.lines if ln.qty > 0}
        if not lines:
            continue
        placed = fork.suppliers.place(po.supplier, lines, source="proposal", arrive_tod_s=po.arrive_tod_s)
        if placed is None:
            continue
        sup = w.ix.supplier[po.supplier]
        out_lines = []
        co2 = 0.0
        for ln in placed["lines"]:
            key = ln["ingredient"]
            ing = w.ix.ingredient[key]
            co2 += w.inv.kg_of(key, ln["qty"]) * ing.co2e_kg_per_kg
            out_lines.append(
                {
                    "ingredient": key, "name": ing.name, "qty": ln["qty"], "packs": ln["packs"], "uom": ing.base_uom,
                    "cost_inr": round(ln["packs"] * ln["price"], 2), "reason": _reason(w, key, basis),
                }
            )  # fmt: skip
        orders.append(
            {
                "supplier": po.supplier, "supplier_name": sup.name, "eta_s": round(placed["eta_s"], 1),
                "arrive_tod_s": po.arrive_tod_s, "lines": out_lines, "total_inr": round(placed["total"], 2),
                "co2e_kg": round(co2, 2),
            }
        )  # fmt: skip
    # `orders` keep the policy's placement order: ETAs are drawn from the (shared) inventory RNG stream, so approving
    # them in this order reproduces exactly the ETAs shown (approving out of order re-draws them).
    open_pos = [p for p in w.suppliers.pos.values() if p["status"] == "open" and p["eta_s"] > w.now]
    nxt = min(open_pos, key=lambda p: p["eta_s"]) if open_pos else None
    first = orders[0] if orders else None
    return {
        "policy": w.policy.code, "basis": basis, "service_level": _service_level(w, basis),
        "supplier": first["supplier"] if first else None, "eta_s": first["eta_s"] if first else None,
        "lines": first["lines"] if first else [], "orders": orders,
        "total_inr": round(sum(o["total_inr"] for o in orders), 2),
        "co2e_kg": round(sum(o["co2e_kg"] for o in orders), 2),
        "next_delivery_s": round(nxt["eta_s"], 1) if nxt else None,
        "next_delivery": {"po_id": nxt["id"], "supplier": nxt["supplier"], "eta_s": round(nxt["eta_s"], 1)} if nxt else None,
        "approve": "POST /worlds/{id}/actions {kind: place_po, supplier, lines}  (one call per entry of `orders`)",
    }  # fmt: skip
