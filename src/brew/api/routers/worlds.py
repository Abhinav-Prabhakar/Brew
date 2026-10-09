"""Worlds, control, policy/strategy, fork, chaos, actions."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from brew.api.deps import MW, Manager
from brew.api.pacing import start_pacer, stop_pacer
from brew.api.schemas import (
    ActionRequest,
    ChaosRequest,
    ControlRequest,
    ForkRequest,
    PolicyRequest,
    WorldCreate,
)
from brew.sim import readmodels as rm
from brew.sim.actions import BadPayload

router = APIRouter(tags=["worlds"])


@router.post("/worlds", status_code=201)
async def create_world(body: WorldCreate, mgr: Manager) -> dict[str, Any]:
    """Create a paused world. ``clock="open"``: hydrated to 07:00 of day 0. ``clock="wall"``: today's date,
    fast-forwarded to the current local time. Use /control ``play`` to run it live (real time)."""
    import asyncio

    mw = mgr.create(body.model_dump())
    if mw.clock == "wall":
        await asyncio.to_thread(mw.advance, mw.wall_sim_now())
    return mw.json()


@router.get("/worlds")
def list_worlds(mgr: Manager) -> dict[str, Any]:
    return {"items": mgr.list()}


@router.get("/worlds/{wid}")
def get_world_(mw: MW) -> dict[str, Any]:
    return mw.json()


@router.delete("/worlds/{wid}", status_code=204)
async def delete_world(wid: str, mgr: Manager) -> None:
    mw = mgr.get(wid)
    await stop_pacer(mw)
    if mw.db_sink is not None:
        await mw.db_sink.close()
    mgr.delete(wid)


@router.get("/worlds/{wid}/state")
def world_state(mw: MW) -> dict[str, Any]:
    with mw.lock:
        mw.refresh_costs()
        s = rm.state(mw.world)
    s["world"].update({"status": mw.status, "clock_mode": mw.clock, "kind": mw.kind, "lagging": mw.lagging})
    return s


@router.post("/worlds/{wid}/control")
async def control(body: ControlRequest, mw: MW) -> dict[str, Any]:
    """play | pause | step. The café runs live (real time); there are no playback speeds.

    ``play`` on a wall-clock world first catches up to the current local time. ``step`` advances ``step_s``
    sim-seconds synchronously (tests and debugging).
    """
    import asyncio

    out: dict[str, Any] = {}
    if body.action == "step":
        out = await asyncio.to_thread(mw.step, body.step_s or 60.0)
    elif body.action == "pause":
        await stop_pacer(mw)
        mw.status = "paused"
    else:  # play
        if mw.clock == "wall":
            await asyncio.to_thread(mw.advance, mw.wall_sim_now())
        mw.status = "playing"
        start_pacer(mw)
    return {**mw.json(), **out}


@router.post("/worlds/{wid}/policy")
def set_policy(body: PolicyRequest, mw: MW) -> dict[str, Any]:
    if body.policy is None and body.strategy is None:
        raise BadPayload("give a policy and/or a strategy")
    mw.set_policy(body.policy, body.strategy)
    return mw.json()


@router.post("/worlds/{wid}/fork", status_code=201)
async def fork(wid: str, body: ForkRequest, mgr: Manager) -> dict[str, Any]:
    if body.at != "now":
        raise BadPayload("only at='now' is supported")
    child = mgr.fork(wid, body.kind, body.reseed)
    return child.json()


@router.post("/worlds/{wid}/chaos", status_code=201)
def chaos(body: ChaosRequest, mw: MW) -> dict[str, Any]:
    return mw.chaos(body.kind, body.target, body.severity, body.duration_min)


@router.post("/worlds/{wid}/actions")
def actions(body: ActionRequest, mw: MW) -> dict[str, Any]:
    """Player / owner actions (409 on invalid state, 422 on charter violations)."""
    res = mw.act(body.kind, body.payload())
    return {"ok": True, "kind": body.kind, "result": res, "sim_s": mw.world.now}
