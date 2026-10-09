"""Policy C - optimised: forecasts + newsvendor + pricing ladder + CP-SAT rolling plan (technical.md 8.4).

* **Prep / make-ahead**: newsvendor quantile of forecast demand over each item's coverage window; make-ahead
  plates use the replate-adjusted overage cost (leftovers are partly recovered through the rescue menu).
* **Replate**: per-lot markdown chosen by maximising expected revenue minus waste cost with the sell-through
  model (``replate_mode = custom``).
* **Pricing**: hourly ladder search with the elasticity model and capacity shadow prices.
* **Purchasing**: perishable order-up-to levels from the forecast, lead time and delivery calendar.
* **Dispatch**: weighted EDF with batching; every few minutes a CP-SAT plan (20 ms) over the next <= 40
  ready tasks, greedy fallback.  Manual HUD strategies are honoured.
* **Intake**: aggregator orders are accepted with a promise stretched by the projected backlog.
"""

from __future__ import annotations

import math
from collections import defaultdict
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np

from brew.opt.capacity_lp import solve_capacity_lp
from brew.opt.newsvendor import critical_ratio, demand_quantile, expected_overage, perishable_order_up_to
from brew.opt.pricing import PriceItem, ladder_search
from brew.opt.scheduler import SchedStaff, SchedTask, schedule
from brew.policies.base import (
    AcceptDecision,
    DayEndAction,
    Explanation,
    ManagerAction,
    POLine,
    PurchaseOrder,
    TaskChoice,
)
from brew.policies.bundle import ModelBundle, load_bundle
from brew.policies.demand import DemandService
from brew.policies.strategies import priority

if TYPE_CHECKING:
    from brew.sim.observation import Observation
    from brew.sim.state import Task
    from brew.sim.views import OrderView, WorldView

PERSONA_W = {"commuter": 1.5, "family": 1.4, "office_bulk": 2.0}
CHANNEL_W = {"dine_in": 1.15, "takeaway": 1.05, "zomato": 1.0, "swiggy": 1.0}
CLOSE_S = 22 * 3600
KIND_OFFSET = {"prep": 60.0, "clean": 120.0, "wash": 300.0, "premake": 900.0, "bag": 0.0}
DEFAULTS: dict[str, Any] = {
    "solver": {"enabled": True, "time_limit_s": 0.02, "max_tasks": 40, "min_ready": 8, "replan_min_s": 120,
               "replan_delta": 5, "max_solves_per_day": 90},
    "batch_window_s": 45,
    "register_first": True,
    "forecast": {"dispersion": 1.8, "horizon_slots": 24},
    "prep": {"max_batches_per_tick": 2, "underage_floor": 0.25, "waste_shadow_inr_per_kg": 20.0},
    "premake": {"enabled": True, "window_min": 120, "speed_value_inr": 60, "kitchen_load_max": 1.0, "max_units": 8,
                "start_h": 10.0, "stop_h": 20.5, "waste_penalty_inr": 8, "min_window_demand": 1.2, "busy_floor": 0.0},
    "replate": {"custom": True, "levels_pct": [0, 20, 30, 40, 50, 60, 70], "waste_value_inr": 12, "recovery_prior": 0.2,
                "max_hours_before_list": 0.75, "max_hold_frac": 0.25, "surplus_quantile": 0.35, "min_surplus_units": 2.0},
    "pricing": {"enabled": True, "every_min": 60, "first_h": 9.0, "last_h": 20.0, "min_gain_inr": 120,
                "util_threshold": 0.9, "default_beta": -1.1, "default_loss": 1.0},
    "purchasing": {"z": 1.4, "cv": 0.35, "shelf_cap_frac": 0.7, "min_cover_days": 1.2, "late_buffer_days": 0.45},
    "accept": {"max_extra_promise_s": 900, "reject_if_late_s": 2400, "slack_s": 90},
}  # fmt: skip


def _merge(base: dict[str, Any], over: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for k, v in over.items():
        out[k] = _merge(base[k], v) if isinstance(v, dict) and isinstance(base.get(k), dict) else v
    return out


class PolicyC:
    """Optimised policy (solver + forecasts). Usable as a behaviour-cloning teacher via :meth:`manager_action`."""

    code = "C"
    default_preset = "edf"
    default_batch_window_s = 45.0
    default_replate_mode = "custom"

    def __init__(
        self,
        models_dir: str | Path | None = None,
        params: dict[str, Any] | None = None,
        use_models: bool = True,
        use_cpsat: bool | None = None,
        bundle: ModelBundle | None = None,
    ) -> None:
        self.models_dir = models_dir
        self.use_models = use_models
        self._params_over = params or {}
        self.use_cpsat_override = use_cpsat
        self.bundle: ModelBundle = bundle or ModelBundle()
        self._bundle_given = bundle is not None
        self.P: dict[str, Any] = _merge(DEFAULTS, {})
        self.demand: DemandService | None = None
        self.last_decision: dict[str, Explanation] = {}
        self.plan_start: dict[int, float] = {}
        self.plan_at = -1e9
        self.plan_n = 0
        self.solves_today = 0
        self.solve_day = -1
        self.solve_stats = {"cpsat": 0, "greedy": 0, "wall_s": 0.0, "calls": 0}
        self._ready_cache: dict[str, Any] = {}
        self.last_price_hour = -1
        self.cache_sku: dict[str, dict[str, Any]] = {}
        self.sku_stations: dict[str, tuple[str, ...]] = {}
        self.sku_step_min: dict[str, dict[str, float]] = {}
        self.unit_cost: dict[str, float] = {}
        self.decisions: list[dict[str, Any]] = []

    # ------------------------------------------------------------------ fork support
    def __getstate__(self) -> dict[str, Any]:
        """Forks (``World.fork`` pickles the policy) must stay cheap: the champion models are shared
        read-only objects, so they are re-attached from the module cache instead of being copied."""
        st = dict(self.__dict__)
        if not self._bundle_given:
            st["bundle"] = None
            if st.get("demand") is not None:
                d = st["demand"]
                st["demand"] = d.__class__.__new__(d.__class__)
                st["demand"].__dict__.update({**d.__dict__, "forecaster": None})
        return st

    def __setstate__(self, st: dict[str, Any]) -> None:
        self.__dict__.update(st)
        if not self._bundle_given and self.bundle is None:
            self.bundle = load_bundle(self.models_dir, self.use_models)
            if self.demand is not None:
                self.demand.forecaster = self.bundle.forecaster

    # --------------------------------------------------------------- lifecycle
    def reset(self, view: WorldView, seed: int) -> None:
        self.seed = seed
        self.P = _merge(_merge(DEFAULTS, view.pol_params), self._params_over)
        if self.use_cpsat_override is not None:
            self.P["solver"]["enabled"] = self.use_cpsat_override
        cfg = view.config
        if not self._bundle_given:
            self.bundle = load_bundle(self.models_dir, self.use_models)
        skus = [m.sku for m in cfg.menu]
        cats = [m.cat for m in cfg.menu]
        self.demand = DemandService(skus, cats, self.bundle.forecaster, self.P["forecast"]["dispersion"])
        self.last_decision = {}
        self.plan_start = {}
        self.plan_at = -1e9
        self.solves_today = 0
        self.solve_day = -1
        self.last_price_hour = -1
        self.decisions = []
        for m in cfg.menu:
            r = cfg.recipes.recipes[m.sku]
            self.sku_stations[m.sku] = tuple(sorted({s.station for s in r.steps}))
            mins: dict[str, float] = {}
            for s in r.steps:
                mins[s.station] = mins.get(s.station, 0.0) + s.duration[0] * s.attention / 60.0
            self.sku_step_min[m.sku] = mins
            self.unit_cost[m.sku] = view.unit_cost(m.sku)

    # ------------------------------------------------------------ small helpers
    def _fc(self, view: WorldView) -> Any:
        assert self.demand is not None
        return self.demand.refresh(view, int(self.P["forecast"]["horizon_slots"]))

    def _note(self, act: ManagerAction, view: WorldView, text: str, **factors: float) -> None:
        act.reason = (act.reason + "; " if act.reason else "") + text
        for k, v in factors.items():
            act.factors.append({"name": k, "value": round(float(v), 3)})

    def _margin(self, view: WorldView, sku: str) -> float:
        return max(1.0, view.price(sku) - self.unit_cost[sku])

    # ---------------------------------------------------------------- manager
    def on_manager_tick(self, obs: Observation, view: WorldView) -> ManagerAction:
        act = ManagerAction()
        self._fc(view)
        if view.tod_s >= CLOSE_S - 1800:
            return act
        self._prep(view, act)
        if self.P["premake"]["enabled"]:
            self._premake(view, act)
        if self.P["replate"]["custom"]:
            self._replate(view, act)
        if self.P["pricing"]["enabled"]:
            self._pricing(view, act)
        self._replenish(view, act)
        act.strategy = None
        return act

    def manager_action(self, obs: Observation, view: WorldView) -> ManagerAction:
        """Teacher interface (BC): the action C would take now."""
        return self.on_manager_tick(obs, view)

    # ------------------------------------------------------------------- prep
    def _prep(self, view: WorldView, act: ManagerAction) -> None:
        """Start prep batches by marginal newsvendor analysis over the item's hold window.

        For a batch of size B on top of the usable stock S0: demand D over the hold horizon H (negative
        binomial, count units of the items that consume the prep item).  Starting ``b`` batches is worth
        ``c_u * E[sales] - c_o * E[leftover]`` with S = S0 + b*B; pick the best ``b``.  ``c_u`` is the lost
        margin during a stock-out (as long as re-prep takes), ``c_o`` the ingredient cost of an unused unit.
        """
        d = self.demand
        assert d is not None
        cfg = view.config
        P = self.P["prep"]
        now = view.now
        tod = view.tod_s
        phi = d.dispersion
        started: list[str] = []
        users: dict[str, list[tuple[str, float]]] = defaultdict(list)
        for sku in d.skus:
            for k, q, _p in view.bom(sku, False):
                users[k].append((sku, q))
        close_in = max(0.0, now - tod + CLOSE_S - now)
        nxt_day = d.next_day_units(view)
        for p in cfg.prep_items:
            key = p.key
            if not users.get(key):
                continue
            lead_s, hold_s = p.lead_time_min * 60.0, p.hold_time_min * 60.0
            horizon_s = min(hold_s, close_in + 3 * 3600.0)
            if close_in < 900 or horizon_s < 600:
                continue
            until = now + min(horizon_s, close_in)
            extra_days = max(0.0, (min(hold_s, 36 * 3600.0) - close_in - 10 * 3600.0) / (14 * 3600.0))
            mean_units = 0.0
            qty_w = 0.0
            margin_w = 0.0
            for sku, q in users[key]:
                u = d.units_until(sku, until, now)
                if extra_days > 0:
                    u += extra_days * float(nxt_day[d.idx[sku]])
                mean_units += u
                qty_w += u * q
                margin_w += u * self._margin(view, sku)
            if mean_units < 0.3:
                continue
            avg_q = qty_w / mean_units
            margin = margin_w / mean_units
            c_u = margin * min(1.0, max(P["underage_floor"], 2.0 * lead_s / 3600.0 / max(horizon_s / 3600.0, 0.5)))
            kg_per_unit = view._w.inv.kg_of(key, avg_q)  # weight of one consumption event of this prep item
            c_o = max(1e-6, avg_q * self._prep_cost(view, key)) + P["waste_shadow_inr_per_kg"] * kg_per_unit
            # stock on hand when a new batch would land: current usable minus what is sold meanwhile
            lead_demand = 0.0
            if lead_s > 1200.0:
                lead_demand = sum(d.units_until(sku, now + lead_s, now) * q for sku, q in users[key]) / avg_q
                if lead_s > 4 * 3600.0:  # long-lead items (cold brew): add the nights' share of the next day
                    lead_demand += max(0.0, (lead_s - close_in - 8 * 3600.0) / (14 * 3600.0)) * sum(
                        float(nxt_day[d.idx[sku]]) * q for sku, q in users[key]
                    ) / avg_q
            s0 = max(0.0, (view.usable(key)) / avg_q - lead_demand) + view.prep_inflight(key) / avg_q
            if lead_s > 4 * 3600.0:
                mean_units = mean_units + lead_demand * 0.5
            batch = p.batch_size / avg_q
            best_b, best_v = 0, -1e18
            for b in range(0, int(P["max_batches_per_tick"]) + 1):
                sales, left = expected_overage(mean_units, s0 + b * batch, phi)
                v = c_u * sales - c_o * left
                if v > best_v + 1e-9:
                    best_b, best_v = b, v
            if best_b > 0:
                act.prep_now[key] = best_b * p.batch_size
                started.append(f"{key} x{best_b}")
                self._note(
                    act, view, f"prep {key}", expected_demand_units=mean_units, stock_units=s0, horizon_h=horizon_s / 3600.0,
                    underage=c_u, overage=c_o,
                )  # fmt: skip
        if started:
            act.reason = "newsvendor prep: " + ", ".join(started)

    def _prep_cost(self, view: WorldView, key: str) -> float:
        inv = view._w.inv
        return float(inv.unit_cost.get(key, 0.1))

    # -------------------------------------------------------------- make-ahead
    def _premake(self, view: WorldView, act: ManagerAction) -> None:
        d = self.demand
        assert d is not None
        Pm = self.P["premake"]
        hour = view.hour
        if hour < Pm["start_h"] or hour > Pm["stop_h"]:
            return
        if view.load_pct() / 100.0 > Pm["kitchen_load_max"]:
            return
        now = view.now
        mode_on = view.replate_mode != "off"
        phi = d.dispersion
        parts = []
        for sku in view.replate_eligible():
            if view._w.replate.pm_key(sku) is None:
                continue
            item = view.config.menu[d.idx[sku]]
            hold_s = item.replate.premake_hold_s
            window_s = min(hold_s, Pm["window_min"] * 60.0, CLOSE_S - view.tod_s)
            if window_s < 900:
                continue
            mu = d.units_until(sku, now + window_s, now)
            if mu < Pm["min_window_demand"]:
                continue
            stock = view.stock_units(sku) + view.premake_inflight(sku)
            cost = self.unit_cost[sku]
            if mode_on:
                p_sell = self.P["replate"]["recovery_prior"]
                rec_price = 0.5 * view.price(sku)
                co = max(5.0, cost - p_sell * rec_price) + Pm["waste_penalty_inr"] * (1 - p_sell)
            else:
                co = cost + Pm["waste_penalty_inr"]
            # a pre-made unit only saves time when the kitchen is busy: scale the speed value with expected load
            busy = max(Pm.get("busy_floor", 0.0), min(1.0, max(0.0, (self._expected_load(view) - 0.35) / 0.4)))
            cu = Pm["speed_value_inr"] * busy
            if cu <= 0.5:
                continue
            q = demand_quantile(mu, critical_ratio(cu, co), phi)
            n = int(min(Pm["max_units"], max(0, math.floor(q - stock + 0.0))))
            if n >= 1:
                act.premake[sku] = n
                parts.append(f"{sku} x{n}")
                self._note(act, view, f"make ahead {sku}", demand=mu, stock=stock, target=q, overage_cost=co)
        if parts:
            act.reason = (act.reason + "; " if act.reason else "") + "make ahead: " + ", ".join(parts)

    def _expected_load(self, view: WorldView) -> float:
        """Kitchen load (0-1) expected over the premake window: blend of now and forecast demand intensity."""
        d = self.demand
        assert d is not None
        fa = d.fa
        now_load = view.load_pct() / 100.0
        if fa is None or len(fa.slots) == 0:
            return now_load
        tot = float(fa.mean[:4].sum())  # expected items in the next hour
        # ~9 items/hour saturates the kitchen in the sim (calibrated: 330 orders ~ 4.5 items per 15 min peak)
        return max(now_load, min(1.2, tot / 70.0))

    # ------------------------------------------------------------------ replate
    def _replate(self, view: WorldView, act: ManagerAction) -> None:
        """Per-lot markdown of *surplus* units only.

        A discount on the rescue menu also pulls full-price buyers over (the choice model has no outside
        option for food), so listing early gives revenue away.  C lists a lot only when its units exceed the
        demand expected to reach it at full price before the use-by (negative-binomial quantile), and then
        picks the shallowest ladder level whose sell-through (model) clears the surplus in the time left.
        """
        d = self.demand
        assert d is not None
        lots = view.replate_lots()
        if not lots or view.replate_mode == "off":
            return
        Pr = self.P["replate"]
        now = view.now
        tod = view.tod_s
        st = self.bundle.sellthrough
        phi = d.dispersion
        parts: list[str] = []
        by_sku: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for lot in lots:
            by_sku[lot["sku"]].append(lot)
        n_listed = sum(1 for x in lots if x["listed"])
        for sku, group in by_sku.items():
            group.sort(key=lambda x: x["use_by_s"])
            ahead = 0.0
            for lot in group:
                units = lot["units"]
                left_s = lot["use_by_s"] - now
                if units < 1 or left_s <= 0:
                    continue
                f_mu = d.units_until(sku, min(lot["use_by_s"], now - tod + CLOSE_S), now)
                reach = max(0.0, f_mu - ahead)
                ahead += units
                hold_s = max(1.0, lot["use_by_s"] - lot["made_at_s"])
                if left_s > min(Pr["max_hours_before_list"] * 3600.0, Pr.get("max_hold_frac", 0.35) * hold_s):
                    continue
                full_q = demand_quantile(reach, Pr["surplus_quantile"], phi) if reach > 0 else 0.0
                surplus = units - full_q
                if surplus < Pr["min_surplus_units"]:
                    continue
                base = lot["base_price"]
                ticks = max(1.0, left_s / 300.0)
                chosen = 0.0
                for pct in Pr["levels_pct"]:
                    if pct <= 0 or pct < lot["discount_pct"] - 1e-9:
                        continue
                    price = max(lot["floor"], round(base * (1 - pct / 100.0) / 5.0) * 5.0)
                    if st is not None:
                        try:
                            rate = st.rate(
                                sku, lot["frac_left"], pct, price / max(1.0, base), view.hour, view.weather, 0.0,
                                n_listed, units,
                            )  # fmt: skip
                        except Exception:
                            rate = 0.04 * (1 + pct / 30.0)
                    else:
                        rate = 0.04 * (1 + pct / 30.0)
                    chosen = float(pct)
                    if rate * ticks >= surplus:  # the shallowest level that clears the surplus
                        break
                if chosen > lot["discount_pct"] + 0.5:
                    act.replate_discounts[lot["lot_id"]] = chosen
                    act.replate_caps[lot["lot_id"]] = float(max(1.0, math.ceil(surplus)))
                    parts.append(f"{sku} -{chosen:.0f}%")
                    self._note(
                        act, view, f"markdown {sku}", units=units, expected_full_price_demand=reach,
                        surplus_units=surplus, hours_left=left_s / 3600.0, discount_pct=chosen,
                    )  # fmt: skip
        if parts:
            act.reason = (act.reason + "; " if act.reason else "") + "replate: " + ", ".join(parts)

    # ------------------------------------------------------------------ pricing
    def _pricing(self, view: WorldView, act: ManagerAction) -> None:
        Pp = self.P["pricing"]
        tod = view.tod_s
        h = view.hour
        if h < Pp["first_h"] or h > Pp["last_h"] or int(tod) % int(Pp["every_min"] * 60) != 0:
            return
        if view.day * 24 + int(h) == self.last_price_hour:
            return
        if view.strategy != "balanced" or view.replate_mode == "never":
            return
        self.last_price_hour = view.day * 24 + int(h)
        d = self.demand
        assert d is not None
        el = self.bundle.elasticity
        cfg = view.config
        charter = view.charter
        horizon = int(Pp["every_min"] / 15)
        items: list[PriceItem] = []
        station_min_cap: dict[str, float] = {}
        for st_key in {s for v in self.sku_stations.values() for s in v}:
            n = max(1, view.specialists(st_key))
            station_min_cap[st_key] = min(n, cfg.stations[[s.key for s in cfg.stations].index(st_key)].max_staff) * Pp["every_min"]
        for m in cfg.menu:
            if view.hidden(m.sku):
                continue
            q = d.units(m.sku, horizon)
            beta = el.beta(m.sku, Pp["default_beta"]) if el is not None else Pp["default_beta"]
            loss = 0.0
            if el is not None and el.result is not None and el.result.loss:
                loss = max(0.0, -float(el.result.loss.get(m.cat, -Pp["default_loss"])))
            else:
                loss = Pp["default_loss"]
            items.append(
                PriceItem(
                    m.sku, m.cat, view.price(m.sku), self.unit_cost[m.sku], view.ref_price(m.sku), max(q, 0.0), beta,
                    loss=min(loss, 3.0), min_price=m.min_price, max_price=m.max_price, base=m.base_price,
                    staple=m.staple, allowed=view.price_change_allowed(m.sku), grid=charter.price_grid,
                    step_cap=charter.max_step_frac, station_min=self.sku_step_min[m.sku],
                )
            )  # fmt: skip
        if not items:
            return
        # capacity LP over the window: shadow prices of the stations
        margin = {it.sku: it.price - it.cost for it in items}
        demand = {it.sku: it.qty * 1.3 for it in items}
        usage = {it.sku: dict(it.station_min) for it in items}
        lp = solve_capacity_lp(margin, demand, usage, station_min_cap)
        shadow = lp.shadow
        dec = ladder_search(
            items, station_min_cap, shadow, Pp["util_threshold"], min_gain=Pp["min_gain_inr"]
        )  # fmt: skip
        if not dec.prices:
            return
        act.sku_prices.update(dec.prices)
        act.promotion = False
        self._note(
            act, view, "pricing ladder " + ", ".join(f"{c} {s:+.0%}" for c, s in dec.steps.items() if s),
            modelled_gain_inr=dec.gain, kitchen_load_pct=view.load_pct(),
            max_shadow_price=max(shadow.values()) if shadow else 0.0,
        )  # fmt: skip

    # ---------------------------------------------------------------- intake
    def accept(self, order: OrderView, view: WorldView) -> AcceptDecision:
        Pa = self.P["accept"]
        wait_default = order.promise_s - view.now
        proj = order.est_prep_s
        worst = 0.0
        for sku in set(order.skus):
            for st in self.sku_stations.get(sku, ()):
                if st in ("pass", "register"):
                    continue
                n = max(1, view.specialists(st))
                worst = max(worst, view.station_backlog_s(st) / n)
        proj += worst + 300.0
        late = proj - wait_default
        if late > Pa["reject_if_late_s"] and order.open_agg_orders > 7:
            return AcceptDecision("reject", reason="kitchen backlog")
        extra = float(min(Pa["max_extra_promise_s"], max(0.0, late + Pa["slack_s"])))
        return AcceptDecision("accept", extra_promise_s=extra)

    # -------------------------------------------------------------- dispatch
    def _key(self, t: Task, now: float, reg_wait: int) -> float:
        """Sort key in sim seconds (lower = sooner): latest start time, weighted; plan start if planned."""
        k = t.kind
        if k == "register":
            return now - 3600.0 + (0.0 if reg_wait else 1e4)
        if k != "step" and k != "bag":
            return now + KIND_OFFSET.get(k, 600.0)
        ps = self.plan_start.get(t.id)
        if ps is not None:
            return ps - 120.0
        slack = (t.due_s - now - t.est_s) if t.due_s else 1e4
        w = PERSONA_W.get(t.persona, 1.0) * CHANNEL_W.get(t.channel, 1.0)
        if t.bumped:
            return now - 7200.0
        return now + (slack * w if slack < 0 else slack / w)

    def dispatch(self, ready: list[Task], view: WorldView) -> list[TaskChoice]:
        now = view.now
        if view.strategy != "balanced":
            return self._manual_dispatch(ready, view)
        self._maybe_replan(ready, view)
        window = view.batch_window_s
        reg_wait = view.register_queue()
        out: list[tuple[float, int, TaskChoice]] = []
        groups: dict[tuple[str, str], list[tuple[float, Task]]] = defaultdict(list)
        key = self._key
        for t in ready:
            kv = key(t, now, reg_wait)
            if t.batchable and window > 0:
                groups[(t.station, t.name)].append((kv, t))
            else:
                out.append((kv, t.id, TaskChoice([t])))
        for members in groups.values():
            members.sort(key=lambda x: (x[0], x[1].id))
            mb = members[0][1].max_batch
            for i in range(0, len(members), mb):
                chunk = members[i : i + mb]
                kv = chunk[0][0]
                hold = 0.0
                if len(chunk) == 1:
                    t = chunk[0][1]
                    slack = (t.due_s - now - t.est_s) if t.due_s else 1e4
                    if now - t.ready_s < window and slack > 240.0 and t.channel != "dine_in":
                        hold = t.ready_s + window
                out.append((kv, chunk[0][1].id, TaskChoice([t for _k, t in chunk], hold)))
        out.sort(key=lambda x: (x[0], x[1]))
        return [c for _k, _i, c in out]

    def _manual_dispatch(self, ready: list[Task], view: WorldView) -> list[TaskChoice]:
        """Honour a player-selected HUD strategy: use its preset weights with simple batching."""
        preset = view.strategies.presets[view.preset]
        boost = view.channel_boost
        now = view.now
        window = view.batch_window_s
        groups: dict[tuple[str, str], list[Task]] = defaultdict(list)
        out: list[tuple[float, int, TaskChoice]] = []
        for t in ready:
            if t.batchable and window > 0:
                groups[(t.station, t.name)].append(t)
            else:
                out.append((priority(t, now, preset, boost), t.id, TaskChoice([t])))
        for members in groups.values():
            members.sort(key=lambda t: (-priority(t, now, preset, boost), t.id))
            mb = members[0].max_batch
            for i in range(0, len(members), mb):
                chunk = members[i : i + mb]
                pr = max(priority(t, now, preset, boost) for t in chunk)
                out.append((pr, chunk[0].id, TaskChoice(chunk)))
        out.sort(key=lambda x: (-x[0], x[1]))
        return [c for _p, _i, c in out]

    # --------------------------------------------------------------- planning
    def _maybe_replan(self, ready: list[Task], view: WorldView) -> None:
        S = self.P["solver"]
        if not S["enabled"]:
            return
        now = view.now
        n = len(ready)
        if n < S["min_ready"]:
            return
        if view.day != self.solve_day:
            self.solve_day = view.day
            self.solves_today = 0
        if self.solves_today >= S["max_solves_per_day"]:
            return
        if now - self.plan_at < S["replan_min_s"] and abs(n - self.plan_n) < S["replan_delta"]:
            return
        self.plan_at = now
        self.plan_n = n
        self.solves_today += 1
        reg_wait = view.register_queue()
        cand = sorted(ready, key=lambda t: (self._key_plain(t, now, reg_wait), t.id))[: int(S["max_tasks"])]
        staff = view.staff_snapshot()
        if not staff:
            return
        slots_all = view.equipment_slots()
        st_equip: dict[str, str | None] = {}
        tasks: list[SchedTask] = []
        for t in cand:
            elig = [s["key"] for s in staff if s["skills"].get(t.station, 0.0) >= 0.8]
            if not elig:
                elig = [s["key"] for s in staff if s["skills"].get(t.station, 0.0) >= 0.5]
            if not elig:
                continue
            slot = None
            if t.uses_slot:
                if t.station not in st_equip:
                    st_equip[t.station] = view.station_equipment(t.station)
                slot = st_equip[t.station]
            w = PERSONA_W.get(t.persona, 1.0) * CHANNEL_W.get(t.channel, 1.0)
            tasks.append(
                SchedTask(
                    t.id, max(5.0, t.duration_mean), max(0.05, t.attention),
                    t.due_s if t.due_s else now + 1800.0 + t.duration_mean, w, max(now, t.ready_s), tuple(elig), slot,
                )  # fmt: skip
            )
        if not tasks:
            return
        sstaff = [SchedStaff(s["key"], s["busy_until"] if s["attention"] > 0.95 else view.now) for s in staff]
        slots = {k: max(1, tot - used) for k, (tot, used) in slots_all.items()}
        res = schedule(tasks, sstaff, now, slots, float(S["time_limit_s"]), seed=self.seed + int(now))
        self.solve_stats["calls"] += 1
        self.solve_stats["wall_s"] += res.wall_s
        self.solve_stats["cpsat" if res.status != "greedy" else "greedy"] += 1
        self.plan_start = dict(res.start)

    def _key_plain(self, t: Task, now: float, reg_wait: int) -> float:
        k = t.kind
        if k == "register":
            return now - 3600.0
        if k != "step" and k != "bag":
            return now + KIND_OFFSET.get(k, 600.0)
        slack = (t.due_s - now - t.est_s) if t.due_s else 1e4
        return now + slack

    # -------------------------------------------------------------- purchasing
    OPEN_S, CLOSE_S_ = 8 * 3600, 22 * 3600
    OPEN_LEN = 14 * 3600.0

    def _open_frac(self, t0: float, t1: float) -> float:
        """Open service days (fraction of a 14 h opening window) elapsing between two absolute times."""
        if t1 <= t0:
            return 0.0
        tot = 0.0
        d = int(t0 // 86400)
        while d * 86400 + self.OPEN_S < t1:
            lo = max(t0, d * 86400 + self.OPEN_S)
            hi = min(t1, d * 86400 + self.CLOSE_S_)
            tot += max(0.0, hi - lo)
            d += 1
        return tot / self.OPEN_LEN

    def on_day_end(self, view: WorldView) -> DayEndAction:
        assert self.demand is not None
        self.demand.end_day(view)
        act = DayEndAction(donate=True)
        by_sup, bakery = self._po_plan(view, view.day * 86400 + CLOSE_S, intraday=False)
        for sup, lines in sorted(by_sup.items()):
            act.pos.append(PurchaseOrder(sup, lines))
        if bakery:
            for tod, share in (("07:30", 0.6), ("13:00", 0.4)):
                part = [POLine(k, math.ceil(q * share)) for k, q in bakery.items()]
                h, m = tod.split(":")
                act.pos.append(PurchaseOrder("bakery", part, arrive_tod_s=int(h) * 3600 + int(m) * 60))
        return act

    def _replenish(self, view: WorldView, act: ManagerAction) -> None:
        """Hourly urgent top-ups: order what would run out before the next delivery could arrive."""
        if view.tod_s % 3600 != 0 or not (8.0 <= view.hour <= 18.0):
            return
        by_sup, _bak = self._po_plan(view, view.now, intraday=True)
        parts = []
        for sup, lines in sorted(by_sup.items()):
            act.pos.append(PurchaseOrder(sup, lines))
            parts.append(f"{sup}: " + ", ".join(ln.ingredient for ln in lines[:4]))
        if parts:
            self._note(act, view, "urgent top-up " + "; ".join(parts))

    def _po_plan(
        self, view: WorldView, t_ref: float, intraday: bool
    ) -> tuple[dict[str, list[POLine]], dict[str, float]]:
        """Order-up-to purchasing from forecast usage, lead time + delivery calendar and shelf life."""
        d = self.demand
        assert d is not None
        Pu = self.P["purchasing"]
        cfg = view.config
        nxt = d.next_day_units(view)
        ma = np.array([view.sku_usage_per_day(s) for s in d.skus])
        nxt = np.maximum(nxt, 0.8 * ma) if len(nxt) == len(ma) else ma
        sku_units = {s: float(u) for s, u in zip(d.skus, nxt, strict=True)}
        use = d.key_usage(view, sku_units, view.carry_share())
        by_sup: dict[str, list[POLine]] = defaultdict(list)
        bakery: dict[str, float] = {}
        sup_of = {it.ingredient: s.key for s in cfg.suppliers for it in s.items}
        sup_cfg = {s.key: s for s in cfg.suppliers}
        for ing in cfg.ingredients:
            key = ing.key
            u = use.get(key, 0.0)
            sup = sup_of.get(key)
            if sup is None:
                continue
            if u <= 0:
                u = view.usage_per_day(key) * 0.5
            if u <= 0:
                continue
            sc = sup_cfg[sup]
            standing = bool(sc.standing_times)
            if intraday and (standing or ing.finished_good):
                continue
            first, gap = self._arrival(view, sup, t_ref)
            open_before = self._open_frac(t_ref, first)
            late_buf = Pu["late_buffer_days"] if sc.on_time_rate < 0.985 else 0.0
            shelf_days = ing.shelf_life_sealed_h / 24.0
            if ing.finished_good:
                days = 1.15 + (0.4 if shelf_days >= 2 else 0.0)
                target = perishable_order_up_to(u, days, shelf_days, 1.3, Pu["cv"], 0.9)
                keep_after = view.now + 86400.0 + 8 * 3600.0
                pos = sum(q for q, e in view.lots(key) if e > keep_after) + view.on_order(key)
            else:
                cover = max(Pu["min_cover_days"], gap + late_buf + open_before)
                target = perishable_order_up_to(u, cover, shelf_days, Pu["z"], Pu["cv"], Pu["shelf_cap_frac"])
                pos = self._usable_at(view, key, open_before, u) + view.on_order(key)
            qty = target - pos
            if not ing.finished_good and pos < u * 1.0 and view.on_order(key) <= 0:
                qty = max(qty, u * 1.2 - pos)
            if ing.shelf_life_opened_h < 60.0 and not ing.finished_good:
                # a lot spoils soon after it is opened: never deliver more than ~one opening's worth at once
                qty = min(qty, u * max(0.6, ing.shelf_life_opened_h / 14.0) * 1.15)
            floor = 0.25 * u if intraday else 0.02 * max(target, 1.0)
            if qty > floor:
                if ing.finished_good and standing:
                    bakery[key] = qty
                else:
                    by_sup[sup].append(POLine(key, math.ceil(qty)))
        return by_sup, bakery

    def _usable_at(self, view: WorldView, key: str, open_days_until: float, use_per_day: float) -> float:
        """Stock expected to remain when the next delivery lands: usable lots minus the demand in between."""
        now = view.now
        horizon = now + max(open_days_until, 0.01) * 86400.0
        total = sum(q for q, exp in view.lots(key) if exp > min(horizon, now + 43200.0))
        return max(0.0, total - use_per_day * open_days_until)

    def _arrival(self, view: WorldView, supplier: str, close_abs: float) -> tuple[float, float]:
        """``(absolute time of the next delivery, open days until the one after it)`` for a PO placed at
        ``close_abs`` (the closing time for day-end orders, the current time for urgent top-ups)."""
        lead_h, dd, standing = view.supplier_delivery(supplier)
        if standing:
            nxt = (int(close_abs // 86400) + 1) * 86400 + 7.5 * 3600
            return nxt, 1.0
        t = close_abs + lead_h * 3600.0
        tod = t % 86400
        if tod < 6.5 * 3600:
            t = t - tod + 6.5 * 3600
        elif tod > 20 * 3600:
            t = t - tod + 86400 + 6.5 * 3600
        day0 = view.day
        wd0 = view.weekday_of_day(day0)

        def wd_of(tt: float) -> int:
            return (wd0 + int(tt // 86400) - day0) % 7

        for _ in range(8):
            if wd_of(t) in dd:
                break
            t = (int(t // 86400) + 1) * 86400 + 6.5 * 3600
        first = t
        t2 = first + 86400
        for _ in range(8):
            if wd_of(t2) in dd:
                break
            t2 += 86400
        gap = max(1.0, self._open_frac(first, t2))
        return first, gap

    def explain(self, decision_id: str) -> Explanation | None:
        return self.last_decision.get(decision_id)


__all__ = ["PolicyC"]
