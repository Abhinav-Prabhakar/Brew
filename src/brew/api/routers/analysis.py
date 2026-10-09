"""Analysis endpoints: forecast, decisions/explain, bottlenecks, advisor, invest, arena, models."""

from __future__ import annotations

import os
from typing import Any

import numpy as np
from fastapi import APIRouter, Query, Request

from brew.api.deps import MW
from brew.api.jobs import Job
from brew.api.schemas import ArenaRequest, InvestRequest
from brew.api.world_manager import UnknownWorld
from brew.domain.timeutil import hhmm
from brew.models.registry import ModelRegistry
from brew.policies.bundle import load_bundle
from brew.policies.demand import DemandService
from brew.policies.registry import AVAILABLE
from brew.sim import readmodels as rm
from brew.sim.actions import BadPayload, UnknownTarget

router = APIRouter(tags=["analysis"])


def _models_dir(request: Request) -> str | None:
    s = request.app.state.settings
    return str(s.resolved_models_dir())


def _wrap(mw: Any, data: Any) -> dict[str, Any]:
    base = rm.t_fields(mw.world)
    return {**base, **data} if isinstance(data, dict) else {**base, "items": data}


# ------------------------------------------------------------------ forecast
@router.get("/worlds/{wid}/forecast")
def forecast(
    mw: MW,
    request: Request,
    target: str = "demand",
    key: str | None = None,
    horizon_min: int = Query(120, ge=15, le=360),
) -> dict[str, Any]:
    """P10/P50/P90 buckets for the next ``horizon_min`` minutes (``key`` = sku or category) + actuals so far."""
    if target != "demand":
        raise BadPayload("only target=demand is supported")
    with mw.lock:
        w = mw.world
        cfg = w.cfg
        bundle = load_bundle(_models_dir(request))
        skus = [m.sku for m in cfg.menu]
        cats: list[str] = [str(m.cat) for m in cfg.menu]
        if key is not None and key not in skus and key not in set(cats):
            raise UnknownTarget(f"unknown sku or category {key!r}")
        sel = [i for i, (s, c) in enumerate(zip(skus, cats, strict=True)) if key is None or key in (s, c)]
        svc = DemandService(skus, cats, bundle.forecaster)
        view = w.view()
        fa = svc.refresh(view, max(1, horizon_min // 15))
        rows = []
        for k, slot in enumerate(fa.slots):
            for g, name in enumerate(("offline", "delivery")):
                rows.append(
                    {
                        "slot": int(slot), "hhmm": hhmm(int(slot) * 900.0), "channel_group": name,
                        "p10": float(fa.p10[k][sel, g].sum()), "p50": float(fa.p50[k][sel, g].sum()),
                        "p90": float(fa.p90[k][sel, g].sum()), "mean": float(fa.mean[k][sel, g].sum()),
                    }  # fmt: skip
                )
        cur = w.dlog.cur
        actual = []
        if cur is not None:
            now_slot = int(w.view().tod_s // 900)
            for s in range(max(32, now_slot - 8), now_slot):
                actual.append(
                    {"slot": s, "hhmm": hhmm(s * 900.0), "offline": float(cur.counts[s][sel, 0].sum()),
                     "delivery": float(cur.counts[s][sel, 1].sum())}  # fmt: skip
                )
        return _wrap(
            mw,
            {"target": target, "key": key, "horizon_min": horizon_min, "buckets": rows, "actual": actual,
             "model": "lightgbm" if bundle.forecaster is not None else "moving_average"},  # fmt: skip
        )


# ----------------------------------------------------------- decisions / explain
@router.get("/decisions/{decision_id}/explain")
def explain(decision_id: str, request: Request, world_id: str | None = None) -> dict[str, Any]:
    """Top factors + a natural-language note for a policy decision (``world_id`` disambiguates ids)."""
    from brew.analysis.explain import Explainer

    mgr = request.app.state.manager
    worlds = [mgr.get(world_id)] if world_id else list(mgr.worlds.values())
    for mw in worlds:
        with mw.lock:
            for rec in reversed(mw.world.decisions):
                if rec["decision_id"] == decision_id:
                    out = Explainer.from_world(mw.world).explain(rec)
                    out["world_id"] = mw.world.world_id
                    return out
    if world_id is None and not worlds:
        raise UnknownWorld("no worlds")
    raise UnknownTarget(f"decision {decision_id!r} not found")


# ---------------------------------------------------------------- bottlenecks
@router.get("/worlds/{wid}/bottlenecks")
def bottlenecks(mw: MW) -> dict[str, Any]:
    """Binding resources ranked: rho, queue, wait attribution, active-period share, shadow price."""
    with mw.lock:
        rows = mw.world.bn.report(force=True)
        return _wrap(mw, {"primary": mw.world.bn.primary or (rows[0]["resource"] if rows else None), "resources": rows})


# -------------------------------------------------------------------- advisor
@router.get("/worlds/{wid}/advisor")
def advisor(
    mw: MW, request: Request, seeds: int = Query(3, ge=1, le=20), days: int = Query(1, ge=1, le=7),
    wait: bool = False, refresh: bool = False,
) -> dict[str, Any]:  # fmt: skip
    """Ranked investment recommendations (counterfactual forks, CRN). Starts a job; poll until ``status=done``."""
    from brew.analysis.advisor import run_advisor

    jobs = request.app.state.jobs
    st = mw.__dict__.setdefault("_advisor", {"job": None, "day": -1})
    job: Job | None = st["job"]
    stale = job is None or refresh or job.status == "error" or st["day"] != mw.world.day
    if stale:
        with mw.lock:
            snap = mw.world.fork(world_id=mw.world.world_id + "-advisor")
        snap.bn = mw.world.bn  # reports are read only; the fork keeps its own copy after pickling

        def fn(j: Job) -> list[dict[str, Any]]:
            recs = run_advisor(snap, seeds=seeds, days=days)
            j.progress(1, 1)
            return [r.to_dict() for r in recs]

        job = jobs.submit("advisor", {"world": mw.world.world_id, "seeds": seeds, "days": days}, fn, run_inline=wait)
        st["job"], st["day"] = job, mw.world.day
    elif wait and job is not None and job.future is not None:
        job.future.result(timeout=600)
    assert job is not None
    return _wrap(mw, {"job": job.json(with_result=False), "status": job.status, "recommendations": job.result if job.status == "done" else []})


@router.post("/worlds/{wid}/invest", status_code=201)
def invest(mw: MW, body: InvestRequest) -> dict[str, Any]:
    """Buy a catalog item: spends sim cash now, the effect lands after the lead time."""
    with mw.lock:
        res = mw.world.invest.buy(body.catalog_key, by="owner")
        mw.world.advance_to(mw.world.now)
        return _wrap(mw, {**res, "cash": round(mw.world.fin.cash, 2)})


# ---------------------------------------------------------------------- arena
@router.post("/arena", status_code=202)
def arena_create(body: ArenaRequest, request: Request) -> dict[str, Any]:
    """Run policies x seeds x days headless (CRN) as a background job."""
    from brew.analysis.arena import run_arena
    from brew.config.loader import list_scenarios

    pols = [p.upper() for p in body.policies]
    bad = [p for p in pols if p not in AVAILABLE]
    if bad:
        raise BadPayload(f"unavailable policies {bad}; available: {list(AVAILABLE)}")
    if body.scenario not in list_scenarios():
        raise BadPayload(f"unknown scenario {body.scenario!r}")
    if not body.seeds or len(body.seeds) > 50 or not 1 <= body.days <= 30:
        raise BadPayload("seeds must have 1-50 entries and days must be 1-30")
    models_dir = _models_dir(request)
    workers = int(os.environ.get("BREW_ARENA_WORKERS", "0"))

    def fn(job: Job) -> dict[str, Any]:
        res = run_arena(pols, body.seeds, body.days, body.scenario, workers=workers, models_dir=models_dir, progress=job.progress)
        return {"summary": res.summary(), "rows": res.rows}

    job = request.app.state.jobs.submit(
        "arena", {"policies": pols, "scenario": body.scenario, "seeds": body.seeds, "days": body.days}, fn
    )
    return {"id": job.id, "status": job.status}


@router.get("/arena/{arena_id}")
def arena_get(arena_id: str, request: Request) -> dict[str, Any]:
    job = request.app.state.jobs.get(arena_id)
    if job is None or job.kind != "arena":
        raise UnknownTarget(f"arena {arena_id!r} not found")
    out = job.json(with_result=False)
    if job.status == "done":
        out["summary"] = job.result["summary"]
        out["rows"] = job.result["rows"]
    return out


# --------------------------------------------------------------------- models
@router.get("/models")
def models(request: Request) -> dict[str, Any]:
    reg = ModelRegistry(_models_dir(request))
    rows = reg.list()
    return {"items": rows, "champions": [r for r in rows if r.get("champion")], "models_loaded": reg.models_loaded()}


def _np_default(x: Any) -> Any:  # pragma: no cover
    return float(x) if isinstance(x, np.floating) else x
