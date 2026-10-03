"""Read models. Every payload carries ``sim_s`` and ISO ``t`` (Asia/Kolkata)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from brew.api.deps import MW
from brew.api.schemas import InvestRequest
from brew.api.world_manager import NotImplementedYet
from brew.sim import readmodels as rm
from brew.sim.actions import UnknownTarget

router = APIRouter(tags=["read"])


def _wrap(mw: Any, data: Any, key: str = "items") -> dict[str, Any]:
    w = mw.world
    base = rm.t_fields(w)
    if isinstance(data, dict):
        return {**base, **data}
    return {**base, key: data}


@router.get("/worlds/{wid}/menu")
def menu(mw: MW) -> dict[str, Any]:
    with mw.lock:
        return _wrap(mw, rm.menu(mw.world))


@router.get("/worlds/{wid}/orders")
def orders(
    mw: MW, status: str | None = None, channel: str | None = None, limit: int = Query(200, ge=1, le=1000)
) -> dict[str, Any]:
    with mw.lock:
        return _wrap(mw, rm.orders(mw.world, status, channel, limit))


@router.get("/worlds/{wid}/rail")
def rail(mw: MW) -> dict[str, Any]:
    with mw.lock:
        return _wrap(mw, rm.rail(mw.world))


@router.get("/worlds/{wid}/board")
def board(mw: MW) -> dict[str, Any]:
    with mw.lock:
        return _wrap(mw, rm.board(mw.world))


@router.get("/worlds/{wid}/customers")
def customers(mw: MW) -> dict[str, Any]:
    with mw.lock:
        return _wrap(mw, rm.customers(mw.world))


@router.get("/worlds/{wid}/tables")
def tables(mw: MW) -> dict[str, Any]:
    with mw.lock:
        return _wrap(mw, rm.tables(mw.world))


@router.get("/worlds/{wid}/inventory")
def inventory(mw: MW) -> dict[str, Any]:
    with mw.lock:
        return _wrap(mw, rm.inventory(mw.world))


@router.get("/worlds/{wid}/inventory/{key}/lots")
def inventory_lots(mw: MW, key: str) -> dict[str, Any]:
    with mw.lock:
        if key not in mw.world.inv.onhand:
            raise UnknownTarget(f"inventory key {key!r} not found")
        return _wrap(mw, rm.inventory_lots(mw.world, key))


@router.get("/worlds/{wid}/fridge")
def fridge(mw: MW) -> dict[str, Any]:
    with mw.lock:
        return _wrap(mw, rm.fridge(mw.world))


@router.get("/worlds/{wid}/shelf")
def shelf(mw: MW) -> dict[str, Any]:
    with mw.lock:
        return _wrap(mw, rm.shelf(mw.world))


@router.get("/worlds/{wid}/staff")
def staff(mw: MW) -> dict[str, Any]:
    with mw.lock:
        return _wrap(mw, rm.staff(mw.world))


@router.get("/worlds/{wid}/equipment")
def equipment(mw: MW) -> dict[str, Any]:
    with mw.lock:
        return _wrap(mw, rm.equipment(mw.world))


@router.get("/worlds/{wid}/kpis")
def kpis(mw: MW, from_: int | None = Query(None, alias="from"), to: int | None = None) -> dict[str, Any]:
    with mw.lock:
        return _wrap(mw, rm.kpis(mw.world, from_, to))


@router.get("/worlds/{wid}/impact")
def impact(mw: MW) -> dict[str, Any]:
    with mw.lock:
        return _wrap(mw, rm.impact(mw.world))


@router.get("/worlds/{wid}/reviews")
def reviews(mw: MW, limit: int = Query(50, ge=1, le=500)) -> dict[str, Any]:
    with mw.lock:
        return _wrap(mw, rm.reviews(mw.world, limit))


@router.get("/worlds/{wid}/receipts/{order_no}")
def receipt(mw: MW, order_no: int) -> dict[str, Any]:
    with mw.lock:
        r = rm.receipt(mw.world, order_no)
    if r is None:
        raise UnknownTarget(f"no receipt for order {order_no}")
    return _wrap(mw, r)


@router.get("/worlds/{wid}/decisions")
def decisions(mw: MW, since_seq: int = 0) -> dict[str, Any]:
    with mw.lock:
        return _wrap(mw, rm.decisions(mw.world, since_seq))


@router.get("/worlds/{wid}/disruptions")
def disruptions(mw: MW) -> dict[str, Any]:
    with mw.lock:
        return _wrap(mw, rm.disruptions(mw.world))


# --------------------------------------------------------- later milestones (501)
@router.get("/worlds/{wid}/forecast")
def forecast(mw: MW, target: str = "demand", key: str | None = None, horizon_min: int = 120) -> Any:
    raise NotImplementedYet("M2", "demand forecast")


@router.get("/worlds/{wid}/bottlenecks")
def bottlenecks(mw: MW) -> Any:
    raise NotImplementedYet("M2", "bottleneck analysis")


@router.get("/worlds/{wid}/advisor")
def advisor(mw: MW) -> Any:
    raise NotImplementedYet("M2", "investment advisor")


@router.post("/worlds/{wid}/invest")
def invest(mw: MW, body: InvestRequest) -> Any:
    raise NotImplementedYet("M2", "investments")
