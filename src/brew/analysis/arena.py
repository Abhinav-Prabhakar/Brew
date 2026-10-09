"""Policy Arena: policies x seeds x days headless, with CRN pairing and statistics (technical.md 14.3)."""

from __future__ import annotations

import time
from collections.abc import Sequence
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from .stats import compare, cvar

KPI_KEYS = (
    "net_profit", "revenue", "orders", "waste_kg", "waste_inr", "donated_kg", "sla_breach_rate", "rating", "balks",
    "reneges", "walkouts", "co2e_kg", "overload_min", "replate_units_sold", "replate_revenue",
    "replate_waste_avoided_kg", "price_changes",
)  # fmt: skip


def run_one(spec: dict[str, Any]) -> list[dict[str, Any]]:
    """Run one ``(policy, seed)`` world for ``days`` days; returns one KPI row per day.

    ``spec``: ``policy, seed, days, scenario, replate (None|mode), models_dir, chaos``.
    """
    from brew.policies.registry import make_policy
    from brew.sim.world import World

    kw = {"params": spec["params"]} if spec.get("params") and spec["policy"] in ("C", "E") else {}
    pol = make_policy(spec["policy"], models_dir=spec.get("models_dir"), **kw)
    cfg = None
    if spec.get("replate_cfg"):  # experiment: override Replate sim parameters (replate.yaml fields)
        from brew.config.loader import load_cafe

        base = load_cafe()
        cfg = base.model_copy(update={"replate": base.replate.model_copy(update=spec["replate_cfg"])})
    w = World(
        policy=pol, cfg=cfg, scenario=spec.get("scenario", "weekday_normal"), seed=int(spec["seed"]),
        days=int(spec["days"]), replate=spec.get("replate"), cash_start=spec.get("cash_start"),
    )  # fmt: skip
    if spec.get("oracle", False) and hasattr(pol, "attach_world"):
        pol.attach_world(w)
    t0 = time.perf_counter()
    w.run(int(spec["days"]))
    wall = time.perf_counter() - t0
    rows = []
    for k in w.daily_kpis:
        r = {key: k.get(key, 0.0) for key in KPI_KEYS}
        r.update(policy=spec["policy"], seed=int(spec["seed"]), day=int(k["day"]), wall_s=wall / max(1, len(w.daily_kpis)))
        r["replate"] = spec.get("replate") or "auto"
        rows.append(r)
    if rows:  # per-key waste of the whole run (kg), carried on the first row
        rows[0]["waste_by_key"] = dict(w.waste_by_key)
        rows[0]["rescuable_keys"] = sorted(w.replate.rescuable_keys())
    return rows


@dataclass
class ArenaResult:
    rows: list[dict[str, Any]]
    policies: list[str]
    seeds: list[int]
    days: int
    scenario: str
    meta: dict[str, Any] = field(default_factory=dict)

    def per_seed(self, policy: str, key: str = "net_profit") -> np.ndarray:
        """Mean per-day value of ``key`` for each seed (ordered by ``self.seeds``)."""
        out = []
        for s in self.seeds:
            v = [r[key] for r in self.rows if r["policy"] == policy and r["seed"] == s]
            out.append(float(np.mean(v)) if v else float("nan"))
        return np.array(out)

    def waste_breakdown(self, policy: str) -> dict[str, float]:
        """Mean kg/day wasted per inventory key (over seeds and days)."""
        acc: dict[str, float] = {}
        n = 0
        for r in self.rows:
            wk = r.get("waste_by_key")
            if wk is None or r["policy"] != policy:
                continue
            n += 1
            for k, v in wk.items():
                acc[k] = acc.get(k, 0.0) + v
        return {k: v / max(1, n * self.days) for k, v in sorted(acc.items(), key=lambda kv: -kv[1])}

    def rescuable(self) -> set[str]:
        for r in self.rows:
            if "rescuable_keys" in r:
                return set(r["rescuable_keys"])
        return set()

    def daily(self, policy: str, key: str = "net_profit") -> np.ndarray:
        return np.array([r[key] for r in self.rows if r["policy"] == policy], dtype=float)

    def summary(self) -> dict[str, Any]:
        base = self.per_seed("A") if "A" in self.policies else None
        out: dict[str, Any] = {"scenario": self.scenario, "seeds": self.seeds, "days": self.days, "policies": {}}
        for p in self.policies:
            prof = self.per_seed(p)
            row: dict[str, Any] = {
                "mean_profit": float(np.nanmean(prof)), "profit_by_seed": prof.tolist(),
                "cvar10_daily_profit": cvar(self.daily(p)),
                "mean_waste_kg": float(np.nanmean(self.per_seed(p, "waste_kg"))),
                "mean_sla_breach": float(np.nanmean(self.per_seed(p, "sla_breach_rate"))),
                "mean_rating": float(np.nanmean(self.per_seed(p, "rating"))),
                "mean_revenue": float(np.nanmean(self.per_seed(p, "revenue"))),
                "mean_walkouts": float(np.nanmean(self.per_seed(p, "walkouts"))),
            }  # fmt: skip
            if base is not None and p != "A":
                row["vs_A"] = compare(base, prof)
            out["policies"][p] = row
        return out


def run_arena(
    policies: Sequence[str],
    seeds: Sequence[int],
    days: int,
    scenario: str = "weekday_normal",
    *,
    workers: int = 0,
    models_dir: str | Path | None = None,
    replate: str | None = None,
    progress: Any = None,
    params: dict[str, Any] | None = None,
    replate_cfg: dict[str, Any] | None = None,
) -> ArenaResult:
    """Run every policy on every seed (CRN: the same seed gives every policy the same customers)."""
    specs = [
        {"policy": p, "seed": s, "days": days, "scenario": scenario, "replate": replate,
         "models_dir": str(models_dir) if models_dir else None, "params": params,
         "replate_cfg": replate_cfg}
        for p in policies for s in seeds
    ]  # fmt: skip
    rows: list[dict[str, Any]] = []
    if workers and workers > 1:
        with ProcessPoolExecutor(max_workers=workers) as ex:
            for i, r in enumerate(ex.map(run_one, specs)):
                rows.extend(r)
                if progress:
                    progress(i + 1, len(specs))
    else:
        for i, sp in enumerate(specs):
            rows.extend(run_one(sp))
            if progress:
                progress(i + 1, len(specs))
    return ArenaResult(rows, list(policies), list(seeds), days, scenario)


def run_replate_ab(
    policy: str, seeds: Sequence[int], days: int, scenario: str = "weekday_normal", *,
    models_dir: str | Path | None = None, workers: int = 0, params: dict[str, Any] | None = None,
    replate_cfg: dict[str, Any] | None = None,
) -> dict[str, Any]:  # fmt: skip
    """Replate on vs off for one policy on identical seeds (CRN): waste kg, profit, replate KPIs."""
    on = run_arena([policy], seeds, days, scenario, workers=workers, models_dir=models_dir, replate=None, params=params, replate_cfg=replate_cfg)
    off = run_arena([policy], seeds, days, scenario, workers=workers, models_dir=models_dir, replate="off", params=params, replate_cfg=replate_cfg)

    def agg(res: ArenaResult) -> dict[str, float]:
        return {
            "profit": float(np.nanmean(res.per_seed(policy))),
            "waste_kg": float(np.nanmean(res.per_seed(policy, "waste_kg"))),
            "donated_kg": float(np.nanmean(res.per_seed(policy, "donated_kg"))),
            "replate_units": float(np.nanmean(res.per_seed(policy, "replate_units_sold"))),
            "replate_revenue": float(np.nanmean(res.per_seed(policy, "replate_revenue"))),
            "revenue": float(np.nanmean(res.per_seed(policy, "revenue"))),
        }

    a_on, a_off = agg(on), agg(off)
    wb_on, wb_off = on.waste_breakdown(policy), off.waste_breakdown(policy)
    resc = on.rescuable() | off.rescuable()
    breakdown = [
        {"key": k, "kg_off": wb_off.get(k, 0.0), "kg_on": wb_on.get(k, 0.0), "rescuable": k in resc}
        for k in sorted(set(wb_on) | set(wb_off), key=lambda k: -max(wb_on.get(k, 0.0), wb_off.get(k, 0.0)))
    ]
    red = 100.0 * (1.0 - a_on["waste_kg"] / a_off["waste_kg"]) if a_off["waste_kg"] > 0 else 0.0
    return {
        "policy": policy, "seeds": list(seeds), "days": days, "on": a_on, "off": a_off, "waste_reduction_pct": red,
        "profit_delta": a_on["profit"] - a_off["profit"], "waste_breakdown": breakdown,
        "profit_by_seed_on": on.per_seed(policy).tolist(), "profit_by_seed_off": off.per_seed(policy).tolist(),
        "waste_by_seed_on": on.per_seed(policy, "waste_kg").tolist(), "waste_by_seed_off": off.per_seed(policy, "waste_kg").tolist(),
        "compare_profit": compare(off.per_seed(policy), on.per_seed(policy)),
    }  # fmt: skip
