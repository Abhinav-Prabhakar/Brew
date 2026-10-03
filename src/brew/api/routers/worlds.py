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
from brew.api.world_manager import SPEEDS
from brew.sim import readmodels as rm
from brew.sim.actions import BadPayload

router = APIRouter(tags=["worlds"])


@router.post("/worlds", status_code=201)
async def create_world(body: WorldCreate, mgr: Manager) -> dict[str, Any]:
    """Create a paused world (hydrated to 07:00 of day 0). Use /control to play or step."""
    mw = mgr.create(body.model_dump())
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
        s = rm.state(mw.world)
    s["world"].update({"status": mw.status, "speed": mw.speed, "kind": mw.kind, "lagging": mw.lagging})
    return s


@router.post("/worlds/{wid}/control")
async def control(body: ControlRequest, mw: MW) -> dict[str, Any]:
    """play | pause | speed | step. ``step`` advances ``step_s`` sim-seconds synchronously (no wall sleep)."""
    out: dict[str, Any] = {}
    if body.action == "step":
        import asyncio

        out = await asyncio.to_thread(mw.step, body.step_s or 60.0)
    elif body.action == "pause":
        await stop_pacer(mw)
        mw.status = "paused"
    elif body.action == "speed":
        if body.speed is None or body.speed not in SPEEDS:
            raise BadPayload("speed must be one of 0, 1, 10, 60")
        if body.speed == 0:
            await stop_pacer(mw)
            mw.status = "paused"
        else:
            mw.speed = body.speed
            mw.last_speed = body.speed
            mw.world.speed = float(body.speed)
            mw.status = "playing"
            start_pacer(mw)
    else:  # play
        sp = body.speed if body.speed else (mw.last_speed or 1)
        mw.speed = sp
        mw.last_speed = sp
        mw.world.speed = float(sp)
        mw.status = "playing"
        start_pacer(mw)
    if mw.speed:
        mw.world.speed = float(mw.speed)
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
