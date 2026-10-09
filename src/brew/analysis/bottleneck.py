"""Bottleneck analyzer (technical.md 14.1).

Every sim minute the analyzer samples each resource (stations incl. register / prep, tables, the dish pool,
the delivery shelf).  Over a trailing 30-minute window it reports per resource

* **rho** - mean utilisation, **queue** - mean queue length,
* **wait attribution** - the share of all task queue-wait accumulated in the window,
* **active-period share** (Roser) - the share of samples where the resource was saturated (util > 85 %),
* **shadow price** - INR per resource-minute from the fluid capacity LP over the next two hours,

and ranks them by ``0.4 * wait_attr + 0.3 * active_share + 0.3 * shadow_price_norm``.  A change of the
primary bottleneck emits ``bottleneck.changed``.
"""

from __future__ import annotations

from collections import deque
from typing import TYPE_CHECKING, Any

from brew.opt.capacity_lp import solve_capacity_lp

if TYPE_CHECKING:
    from brew.sim.world import World

WINDOW = 30  # samples (sim minutes)
SAT = 0.85


class BottleneckAnalyzer:
    """Samples a :class:`World` every sim minute; ``report()`` ranks the binding resources."""

    def __init__(self, w: World) -> None:
        self.w = w
        names = list(w.kitchen.stations)
        self.util: dict[str, deque[float]] = {n: deque(maxlen=WINDOW) for n in names}
        self.queue: dict[str, deque[float]] = {n: deque(maxlen=WINDOW) for n in names}
        self.wait_mark: dict[str, float] = {n: 0.0 for n in names}
        self.wait_win: dict[str, deque[float]] = {n: deque(maxlen=WINDOW) for n in names}
        for extra in ("tables", "dish_pool", "shelf"):
            self.util[extra] = deque(maxlen=WINDOW)
            self.queue[extra] = deque(maxlen=WINDOW)
            self.wait_win[extra] = deque(maxlen=WINDOW)
        self.primary = ""
        self._cache: tuple[float, list[dict[str, Any]]] | None = None
        self.shadow: dict[str, float] = {}
        self.shadow_at = -1e9

    # ----------------------------------------------------------------- sampling
    def sample(self) -> None:
        w = self.w
        k = w.kitchen
        util = k.station_util()
        for n, st in k.stations.items():
            self.util[n].append(min(1.5, util.get(n, 0.0)))
            self.queue[n].append(float(k.queue_len(n)))
            d = st.queue_wait_s - self.wait_mark[n]
            self.wait_mark[n] = st.queue_wait_s
            self.wait_win[n].append(max(0.0, d))
        tabs = list(w.tables.values())
        busy = sum(1 for t in tabs if t.state != "free") / max(1, len(tabs))
        self.util["tables"].append(busy)
        self.queue["tables"].append(float(len(w.customers.seat_wait)))
        self.wait_win["tables"].append(0.0)
        tot = sum(d["clean"] + d["dirty"] + d["washing"] for d in w.dish.values()) or 1
        self.util["dish_pool"].append(sum(d["dirty"] + d["washing"] for d in w.dish.values()) / tot)
        self.queue["dish_pool"].append(0.0)
        self.wait_win["dish_pool"].append(float(k.wait_by_reason.get("dishpit", 0.0)) * 0.0)
        used = sum(1 for s in w.delivery.shelf if s is not None)
        self.util["shelf"].append(used / max(1, w.delivery.slots_total))
        self.queue["shelf"].append(float(len(w.delivery.waiting_for_slot)))
        self.wait_win["shelf"].append(0.0)
        if w.tod_minutes() % 5 == 0:
            self._maybe_emit()

    # ------------------------------------------------------------------- report
    def _shadow_prices(self) -> dict[str, float]:
        w = self.w
        if w.now - self.shadow_at < 600 and self.shadow:
            return self.shadow
        self.shadow_at = w.now
        cfg = w.cfg
        margin: dict[str, float] = {}
        demand: dict[str, float] = {}
        usage: dict[str, dict[str, float]] = {}
        horizon_h = 2.0
        for m in cfg.menu:
            daily = w.ma.sku_usage_per_day(m.sku)
            demand[m.sku] = daily * horizon_h / 14.0 * 1.4
            cost = sum(q * w.inv.unit_cost[k] for k, q in w.inv.sku_keys[m.sku])
            margin[m.sku] = max(1.0, w.menu[m.sku].price - cost)
            use: dict[str, float] = {}
            for s in cfg.recipes.recipes[m.sku].steps:
                use[s.station] = use.get(s.station, 0.0) + s.duration[0] * s.attention / 60.0
            usage[m.sku] = use
        cap: dict[str, float] = {}
        for n, st in w.kitchen.stations.items():
            spec = sum(1 for s in w.kitchen.staff_list if s.present and s.skills.get(n, 0.0) >= 0.8)
            cap[n] = max(1, min(st.max_staff, spec)) * horizon_h * 60.0 * 0.9
        res = solve_capacity_lp(margin, demand, usage, cap)
        self.shadow = res.shadow
        return self.shadow

    def report(self, force: bool = False) -> list[dict[str, Any]]:
        """Resources ranked by bottleneck score (highest first)."""
        w = self.w
        if self._cache is not None and not force and self._cache[0] == w.now:
            return self._cache[1]
        shadow = self._shadow_prices()
        tot_wait = sum(sum(d) for d in self.wait_win.values()) or 1.0
        max_sh = max(shadow.values(), default=0.0) or 1.0
        rows: list[dict[str, Any]] = []
        for n in self.util:
            u = self.util[n]
            if not u:
                continue
            q = self.queue[n]
            rho = sum(u) / len(u)
            active = sum(1 for x in u if x > SAT) / len(u)
            wattr = sum(self.wait_win[n]) / tot_wait
            sh = shadow.get(n, 0.0)
            score = 0.4 * wattr + 0.3 * active + 0.3 * (sh / max_sh)
            rows.append(
                {
                    "resource": n, "rho": round(rho, 3), "avg_queue": round(sum(q) / max(1, len(q)), 2),
                    "wait_attribution": round(wattr, 3), "active_share": round(active, 3),
                    "shadow_price": round(sh, 2), "score": round(score, 4),
                }  # fmt: skip
            )
        # ingredients that are 86'd right now are hard constraints too
        for sku, m in w.menu.items():
            if m.hidden and m.hidden_kind == "stock":
                for key, need in w.inv.sku_keys[sku]:
                    if w.inv.usable(key, w.now) < need:
                        rows.append(
                            {"resource": f"ingredient:{key}", "rho": 1.0, "avg_queue": 0.0, "wait_attribution": 0.0,
                             "active_share": 1.0, "shadow_price": 0.0, "score": 0.3, "blocks": sku}  # fmt: skip
                        )
                        break
        rows.sort(key=lambda r: (-r["score"], r["resource"]))
        self._cache = (w.now, rows)
        return rows

    def _maybe_emit(self) -> None:
        rows = self.report(force=True)
        if not rows:
            return
        top = rows[0]
        if top["score"] < 0.15:
            return
        if top["resource"] != self.primary:
            self.primary = top["resource"]
            self.w.emit(
                "bottleneck.changed", resource=top["resource"], rho=top["rho"], shadow_price=top["shadow_price"]
            )  # fmt: skip
