"""Manager reward (docs/implementation-spec.md 13.4), evaluated between two manager ticks.

``r = d_profit - shape*lam_late*sum(w_persona*late_min) - lam_walk*sum(LTV_persona*walkouts)
      - shape*lam_price*price_changes - lam_waste*(waste_inr + co2e_shadow*co2e_kg) - shape*lam_staff*overload_min``
scaled by ``1/1000``.  Replate revenue is already part of ``d_profit``; waste is charged at retirement, so the
agent learns the pre-make <-> replate trade-off.  ``shape`` is the curriculum ``shaping_scale`` (1.0 -> 0.3): it
anneals the *shaping* penalties (lateness, price churn, staff overload) but never the real costs (profit,
walkouts, waste).  The terminal step adds ``salvage_frac`` x (usable stock value now - at the start) minus the
open obligations (orders still open, valued at an average ticket).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from brew.sim.world import World


@dataclass
class RewardConfig:
    """Reward weights (INR unless noted)."""

    scale: float = 1.0 / 1000.0
    lam_late: float = 6.0  # per late minute
    persona_w: dict[str, float] = field(
        default_factory=lambda: {"commuter": 1.5, "family": 1.4, "office_bulk": 2.0}
    )  # others 1.0
    lam_walk: float = 1.0
    ltv: dict[str, float] = field(default_factory=lambda: {"commuter": 600.0, "regular": 1500.0})  # others 400
    default_ltv: float = 400.0
    lam_price: float = 20.0  # per price change
    lam_waste: float = 1.0
    co2e_shadow: float = 8.0  # INR per kg CO2e
    waste_co2e_per_kg: float = 2.0  # kg CO2e per kg wasted food (matches kpis.daily)
    lam_staff: float = 10.0  # per staff overload minute
    shaping_scale: float = 1.0
    salvage_frac: float = 0.5
    obligation_inr: float = 250.0  # per order still open at the end of the episode


def stock_value(w: World) -> float:
    """INR value (at cost) of usable (non-expired) *prepared* stock: prep items and make-ahead goods.

    Raw ingredients are not counted: the ledger books them as COGS only when consumed, so crediting their
    stock at the end of the episode would double count consumption.
    """
    now = w.now
    prep = w.ix.prep
    return float(
        sum(lt.qty * lt.unit_cost for key, lots in w.inv.lots.items() if key in prep for lt in lots if lt.expires_s > now)
    )


class RewardTracker:
    """Cumulative-counter deltas -> per-step reward.  Works on any world (env, BC rollouts, adversary)."""

    def __init__(self, w: World, cfg: RewardConfig | None = None) -> None:
        self.w = w
        self.cfg = cfg or RewardConfig()
        self._closed_n = 0
        self._closed_profit = 0.0
        self.prev = self.snapshot()
        self.stock0 = stock_value(w)

    # ----------------------------------------------------------------- counters
    def cum_profit(self) -> float:
        """Net profit of closed days plus the running estimate of the open day."""
        w = self.w
        dk = w.daily_kpis
        while self._closed_n < len(dk):
            self._closed_profit += float(dk[self._closed_n]["net_profit"])
            self._closed_n += 1
        today = w.kpi.profit_today() if len(dk) <= w.day else 0.0
        return self._closed_profit + today

    def snapshot(self) -> dict[str, float]:
        w, c = self.w, self.cfg
        k = w.kpi
        late = sum(c.persona_w.get(p, 1.0) * m for p, m in k.cum_late_min.items())
        walk = sum(c.ltv.get(p, c.default_ltv) * n for p, n in k.cum_walkouts.items())
        return {
            "profit": self.cum_profit(), "late": late, "walk": walk, "price": float(k.cum_price_changes),
            "waste": k.cum_waste_inr + c.co2e_shadow * c.waste_co2e_per_kg * k.cum_waste_kg,
            "staff": k.cum_overload_s / 60.0,
        }  # fmt: skip

    def rebase(self) -> None:
        """Start accounting from the current world state (call after the first tick: stock is initialised)."""
        self.prev = self.snapshot()
        self.stock0 = stock_value(self.w)

    # --------------------------------------------------------------------- step
    def step(self, terminal: bool = False) -> tuple[float, dict[str, float]]:
        """Reward since the previous call and its components (already scaled)."""
        c = self.cfg
        cur = self.snapshot()
        p = self.prev
        s = c.scale
        parts = {
            "d_profit": s * (cur["profit"] - p["profit"]),
            "late": -s * c.shaping_scale * c.lam_late * (cur["late"] - p["late"]),
            "walkouts": -s * c.lam_walk * (cur["walk"] - p["walk"]),
            "price": -s * c.shaping_scale * c.lam_price * (cur["price"] - p["price"]),
            "waste": -s * c.lam_waste * (cur["waste"] - p["waste"]),
            "staff": -s * c.shaping_scale * c.lam_staff * (cur["staff"] - p["staff"]),
            "terminal": 0.0,
        }
        if terminal:
            w = self.w
            parts["terminal"] = s * (
                c.salvage_frac * (stock_value(w) - self.stock0) - c.obligation_inr * len(w.orders.open)
            )
        self.prev = cur
        return float(sum(parts.values())), parts

    def totals(self) -> dict[str, Any]:
        """Raw cumulative quantities (for logging)."""
        return self.snapshot()
