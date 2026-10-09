"""Read models. Every payload carries ``sim_s`` and ISO ``t`` (Asia/Kolkata)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query, Request

from brew.api.deps import MW
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


@router.get("/worlds/{wid}/replate")
def replate(mw: MW) -> dict[str, Any]:
    with mw.lock:
        return _wrap(mw, rm.replate(mw.world))


@router.get("/worlds/{wid}/combos")
def combos(mw: MW) -> dict[str, Any]:
    """Meal combos with live prices (derived from the components' current prices)."""
    with mw.lock:
        return _wrap(mw, {"combos": mw.world.combos.menu_json()})


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
def reviews(mw: MW, request: Request, limit: int = Query(50, ge=1, le=500)) -> dict[str, Any]:
    """Recent reviews: stars, text, the simulator's cause weights and the cause tagger's reading of the text."""
    with mw.lock:
        rows = rm.reviews(mw.world, limit)
    tagger = _tagger(request)
    if tagger is not None and rows:
        probs = tagger.predict_proba([r["text"] for r in rows])
        for i, r in enumerate(rows):
            r["tagged_causes"] = {c: round(float(v[i]), 3) for c, v in probs.items() if v[i] >= tagger.threshold}
    return _wrap(mw, rows)


def _tagger(request: Request) -> Any:
    st = request.app.state
    if not hasattr(st, "tagger"):
        st.tagger = None
        try:
            from brew.models.registry import ModelRegistry
            from brew.models.text_reviews import ReviewCauseTagger

            p = ModelRegistry(str(st.settings.resolved_models_dir())).champion("text", "review_tagger")
            if p is not None:
                st.tagger = ReviewCauseTagger.load(p)
        except Exception:
            st.tagger = None
    return st.tagger


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
