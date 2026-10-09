"""Synthetic POS history generator: policy A/B worlds with price, pre-make and ladder exploration.

The exploration wrapper injects charter-compliant random price steps (so elasticity is identifiable),
random make-ahead batches of plates and random markdown ladders (so the replate sell-through model sees
a spread of discounts).  Telemetry is written under ``<runs>/history/<name>/``.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np

from brew.policies.B_heuristic import PolicyB
from brew.policies.base import (
    AcceptDecision,
    DayEndAction,
    Explanation,
    ManagerAction,
    POLine,
    PurchaseOrder,
    TaskChoice,
)
from brew.policies.registry import make_policy
from brew.sim.telemetry import write_run
from brew.sim.world import World

from .config import HistoryCfg, RunSpec

if TYPE_CHECKING:
    from brew.sim.observation import Observation
    from brew.sim.state import Task
    from brew.sim.views import OrderView, WorldView

PLATES = ("sandwich", "cheesetoast", "pasta", "avotoast", "coldbrew")


class StockedB(PolicyB):
    """Policy B with generous purchasing and prep so history is (almost) free of stock-outs.

    Demand history must not be censored by 86'd items - otherwise visible items look busier than they
    are.  Waste does not matter for history generation."""

    def on_manager_tick(self, obs: Observation, view: WorldView) -> ManagerAction:
        act = super().on_manager_tick(obs, view)
        for key in ("coldbrew_concentrate", "chai_base", "croissant_baked", "paneer_marinade", "fries_cut"):
            p = view.config_prep(key)
            have = view.usable(key) + view.prep_inflight(key)
            if have < 0.8 * p.batch_size and view.hour < 19.5:
                act.prep_now[key] = max(act.prep_now.get(key, 0.0), p.batch_size)
        return act

    def on_day_end(self, view: WorldView) -> DayEndAction:
        act = super().on_day_end(view)
        have = {ln.ingredient for po in act.pos for ln in po.lines}
        extra: dict[str, list[POLine]] = {}
        for ing in view.config.ingredients:
            if ing.key in have:
                continue
            use = view.usage_per_day(ing.key)
            target = max(ing.par * 1.5, use * 4.0)
            pos = view.onhand(ing.key) + view.on_order(ing.key)
            if pos < 0.75 * target and not ing.finished_good:
                extra.setdefault(view.supplier_for(ing.key), []).append(POLine(ing.key, target - pos))
        for sup, lines in sorted(extra.items()):
            act.pos.append(PurchaseOrder(sup, lines))
        return act


class ExplorationPolicy:
    """Wraps a base policy; adds random price / pre-make / ladder actions at manager ticks."""

    def __init__(
        self,
        base: Any,
        seed: int,
        price_prob: float = 0.8,
        premake: bool = True,
        ladder: bool = True,
    ) -> None:
        self.base = base
        self.code = base.code
        self.rng = np.random.default_rng(seed)
        self.price_prob = price_prob
        self.premake = premake
        self.ladder = ladder
        self.target: dict[str, float] = {}
        self.day_seen = -1

    # world reads these defaults via getattr
    @property
    def default_preset(self) -> str:
        return str(getattr(self.base, "default_preset", "fcfs"))

    @property
    def default_batch_window_s(self) -> float:
        return float(getattr(self.base, "default_batch_window_s", 0.0))

    @property
    def default_replate_mode(self) -> str:
        return str(getattr(self.base, "default_replate_mode", "off"))

    def reset(self, view: WorldView, seed: int) -> None:
        self.base.reset(view, seed)

    def accept(self, order: OrderView, view: WorldView) -> AcceptDecision:
        return self.base.accept(order, view)  # type: ignore[no-any-return]

    def dispatch(self, ready: list[Task], view: WorldView) -> list[TaskChoice]:
        return self.base.dispatch(ready, view)  # type: ignore[no-any-return]

    def on_day_end(self, view: WorldView) -> DayEndAction:
        return self.base.on_day_end(view)  # type: ignore[no-any-return]

    def explain(self, decision_id: str) -> Explanation | None:
        return self.base.explain(decision_id)  # type: ignore[no-any-return]

    def on_manager_tick(self, obs: Observation, view: WorldView) -> ManagerAction:
        act: ManagerAction = self.base.on_manager_tick(obs, view)
        rng = self.rng
        hour = view.hour
        if view.day != self.day_seen:
            self.day_seen = view.day
            if self.ladder:
                act.replate_mode = str(rng.choice(["gentle", "standard", "aggressive"]))
        if self.premake and hour in (9.5, 14.5):
            for sku in PLATES:
                if rng.random() < 0.55:
                    act.premake[sku] = int(rng.choice([2, 4, 6]))
        # block-randomised price levels: every SKU gets a fresh random level (within one charter step of
        # the current one) every 8 ticks = 2 h, at its own phase - a designed experiment so elasticities are
        # identifiable.  The base policy's own price moves (e.g. happy hour) are suppressed.
        act.sku_prices.clear()
        act.promotion = False
        act.restore = False
        act.price_steps.clear()
        if hour < 8.0:
            return act
        tick = int(round((hour - 8.0) * 4))
        ups: dict[str, float] = {}
        for k, m in enumerate(view.config.menu):
            cur = view.price(m.sku)
            if (tick + k) % 8 == 0 and rng.random() < self.price_prob:
                self.target[m.sku] = self._draw_level(m, cur)
            tgt = self.target.get(m.sku, cur)
            if abs(tgt - cur) < 1e-9:
                continue
            if m.staple and tgt > cur:
                ups[m.sku] = tgt  # staples may only return to base through a restore action
            else:
                act.sku_prices[m.sku] = tgt
        if ups and not act.sku_prices:
            act.sku_prices.update(ups)
            act.restore = True
        return act

    def _draw_level(self, m: Any, cur: float) -> float:
        """A random price on the Rs5 grid within +-10 % of base, one charter step from ``cur``."""
        base = m.base_price
        hi = 1.0 if m.staple else 1.10
        grid = [round(base * r / 5.0) * 5.0 for r in np.arange(0.90, hi + 1e-9, 0.025)]
        cand = [p for p in grid if abs(p - cur) <= 0.10 * base + 1e-9 and p >= m.min_price and p <= m.max_price]
        return float(self.rng.choice(cand)) if cand else cur


class PriceDayPolicy:
    """Base policy with a fixed price vector applied at the start of the day (CRN price experiment)."""

    def __init__(self, base: Any, prices: dict[str, float]) -> None:
        self.base = base
        self.code = base.code
        self.prices = prices
        self.done = False

    default_replate_mode = "off"

    @property
    def default_preset(self) -> str:
        return str(getattr(self.base, "default_preset", "fcfs"))

    @property
    def default_batch_window_s(self) -> float:
        return float(getattr(self.base, "default_batch_window_s", 0.0))

    def reset(self, view: WorldView, seed: int) -> None:
        self.base.reset(view, seed)

    def accept(self, order: OrderView, view: WorldView) -> AcceptDecision:
        return self.base.accept(order, view)  # type: ignore[no-any-return]

    def dispatch(self, ready: list[Task], view: WorldView) -> list[TaskChoice]:
        return self.base.dispatch(ready, view)  # type: ignore[no-any-return]

    def on_day_end(self, view: WorldView) -> DayEndAction:
        return self.base.on_day_end(view)  # type: ignore[no-any-return]

    def explain(self, decision_id: str) -> Explanation | None:
        return self.base.explain(decision_id)  # type: ignore[no-any-return]

    def on_manager_tick(self, obs: Observation, view: WorldView) -> ManagerAction:
        act: ManagerAction = self.base.on_manager_tick(obs, view)
        act.sku_prices.clear()
        act.promotion = False
        act.restore = False
        act.price_steps.clear()
        if not self.done:
            self.done = True
            for sku, p in self.prices.items():
                if abs(p - view.price(sku)) > 1e-9:
                    act.sku_prices[sku] = p
        return act


def generate_price_experiment(pcfg: Any, scenario: str, out: Path) -> dict[str, Any]:
    """CRN price experiment: for each seed ("group") run ``variants`` one-day worlds that share the
    arrival plan (same seed) but price every SKU independently at random within one charter step of
    base; variant 0 is all-base.  Writes one ``demand_dense.parquet`` with ``day_id`` (= group) and
    ``variant`` columns; the common day shock is absorbed by day fixed effects downstream."""
    import polars as pl

    from brew.config.loader import default_cafe

    cfg = default_cafe()
    rng = np.random.default_rng(pcfg.seed)
    frames = []
    t0 = time.perf_counter()
    for g in range(pcfg.groups):
        seed = pcfg.seed + g
        for v in range(pcfg.variants):
            prices: dict[str, float] = {}
            for m in cfg.menu:
                if v == 0:
                    prices[m.sku] = m.base_price
                    continue
                hi = 1.0 if m.staple else 1.10
                grid = [round(m.base_price * r / 5.0) * 5.0 for r in np.arange(0.90, hi + 1e-9, 0.025)]
                prices[m.sku] = float(rng.choice(grid))
            pol = PriceDayPolicy(StockedB() if pcfg.policy == "B" else make_policy(pcfg.policy), prices)
            w = World(policy=pol, scenario=scenario, seed=seed, days=1, replate="off")
            w.run(1)
            df = w.dlog.dense_frame({m.sku: m.cat for m in cfg.menu})
            frames.append(df.with_columns(pl.lit(g).alias("day_id"), pl.lit(v).alias("variant")))
    big = pl.concat(frames)
    out.mkdir(parents=True, exist_ok=True)
    big.write_parquet(out / "demand_dense.parquet", compression="zstd")
    return {
        "name": out.name, "groups": pcfg.groups, "variants": pcfg.variants, "rows": len(big),
        "wall_s": round(time.perf_counter() - t0, 2), "path": str(out),
    }  # fmt: skip


def generate_one(spec: RunSpec, hcfg: HistoryCfg, out: Path, name: str) -> dict[str, Any]:
    """Run one exploration world and write its telemetry; returns a manifest row."""
    base = StockedB() if spec.policy == "B" else make_policy(spec.policy)
    pol = ExplorationPolicy(
        base, spec.seed, hcfg.price_explore_prob, hcfg.premake_explore, hcfg.ladder_explore
    )
    scenario = spec.scenario or hcfg.scenario
    w = World(policy=pol, scenario=scenario, seed=spec.seed, days=spec.days, telemetry=True)
    t0 = time.perf_counter()
    w.run(spec.days)
    dt = time.perf_counter() - t0
    d = out / name
    counts = write_run(w, d, {"history_policy": spec.policy, "explore": True})
    return {
        "name": name, "policy": spec.policy, "seed": spec.seed, "days": spec.days, "scenario": scenario,
        "wall_s": round(dt, 2), "path": str(d), "rows": counts,
        "profit": [k["net_profit"] for k in w.daily_kpis],
    }  # fmt: skip


def generate_history(hcfg: HistoryCfg, runs_dir: Path) -> list[dict[str, Any]]:
    """Generate all configured runs under ``<runs_dir>/history``; writes ``manifest.json``."""
    import json

    out = runs_dir / "history"
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    for i, spec in enumerate(hcfg.runs):
        rows.append(generate_one(spec, hcfg, out, f"{i:02d}_{spec.policy}_{spec.seed}"))
    (out / "manifest.json").write_text(json.dumps(rows, indent=2))
    if hcfg.price_experiment.groups > 0:
        exp = generate_price_experiment(hcfg.price_experiment, hcfg.scenario, out / "price_exp")
        (out / "price_exp" / "manifest.json").write_text(json.dumps(exp, indent=2))
    return rows


def load_history_logs(runs_dir: Path, skus: list[str]) -> list[Any]:
    """Rebuild the per-run :class:`DemandLog` objects from the Parquet history."""
    import json

    import polars as pl

    from brew.sim.demandlog import DemandLog

    man = json.loads((runs_dir / "history" / "manifest.json").read_text())
    logs = []
    for row in man:
        df = pl.read_parquet(Path(row["path"]) / "demand_dense.parquet")
        logs.append(DemandLog.from_frame(df, skus))
    return logs
