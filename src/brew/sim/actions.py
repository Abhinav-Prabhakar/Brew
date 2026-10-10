"""Player / owner actions (backend.md 6.2). Every action emits ``action.applied``."""

from __future__ import annotations

import math
from typing import TYPE_CHECKING, Any

from brew.domain.money import round2
from brew.policies.charter import CharterViolation

from .replate import ReplateBadPayload, ReplateInvalid

if TYPE_CHECKING:
    from .world import World

ACTION_KINDS = (
    "serve_order", "bump_order", "restock_fridge", "set_price", "feature_item", "hide_item", "throttle", "place_po",
    "premake", "replate_list", "replate_mode", "guest_order",
)  # fmt: skip
FINISHED_GOODS = ("muffin_fg", "cheesecake_slice", "cinnamon_roll_fg")
TOPUP_PREMIUM = 1.15


class ActionError(Exception):
    """Base for action failures; ``status`` maps to HTTP."""

    status = 409


class InvalidAction(ActionError):
    """Action is not valid in the current state (HTTP 409)."""

    status = 409


class UnknownTarget(ActionError):
    """Order / sku / supplier does not exist (HTTP 404)."""

    status = 404


class BadPayload(ActionError):
    """Malformed payload (HTTP 422)."""

    status = 422


def _need(p: dict[str, Any], *keys: str) -> None:
    for k in keys:
        if k not in p:
            raise BadPayload(f"missing field {k!r}")


def apply_action(w: World, kind: str, p: dict[str, Any]) -> dict[str, Any]:
    """Validate and apply one action to ``w`` at the current sim time. Returns a result dict."""
    if kind not in ACTION_KINDS:
        raise BadPayload(f"unknown action kind {kind!r}")
    try:
        res = _HANDLERS[kind](w, p)
    except CharterViolation as e:
        w.emit("action.applied", kind=kind, payload=p, ok=False, detail=str(e))
        raise
    except ActionError as e:
        w.emit("action.applied", kind=kind, payload=p, ok=False, detail=str(e))
        raise
    w.emit("action.applied", kind=kind, payload=p, ok=True, detail="")
    return res


def _serve(w: World, p: dict[str, Any]) -> dict[str, Any]:
    _need(p, "order_no")
    no = int(p["order_no"])
    o = w.orders.orders.get(no)
    if o is None:
        raise UnknownTarget(f"order {no} not found")
    if o.state != "ready":
        raise InvalidAction(f"order {no} is {o.state}, not ready")
    w.orders.serve(no, "player")
    return {"order_no": no, "status": o.state}


def _bump(w: World, p: dict[str, Any]) -> dict[str, Any]:
    _need(p, "order_no")
    no = int(p["order_no"])
    on = bool(p.get("on", True))
    if no not in w.orders.orders:
        raise UnknownTarget(f"order {no} not found")
    if not w.orders.bump(no, on):
        raise InvalidAction(f"order {no} cannot be bumped (already ready/served)")
    return {"order_no": no, "bumped": on}


def _restock(w: World, p: dict[str, Any]) -> dict[str, Any]:
    cost = 0.0
    added: dict[str, float] = {}
    for key in FINISHED_GOODS:
        ing = w.ix.ingredient[key]
        need = ing.par - w.inv.onhand[key]
        if need >= 1:
            qty = math.floor(need)
            unit = ing.unit_cost * TOPUP_PREMIUM * w.inv.cost_mult
            w.inv.add_lot(key, qty, w.now, unit_cost=unit)
            cost += qty * unit
            added[key] = qty
    if not added:
        raise InvalidAction("fridge is already at par")
    w.fin.cash -= cost
    w.recheck_availability(w.inv.stock_dirty)
    w.kpi.pulse()
    return {"added": added, "cost": round2(cost)}


def _set_price(w: World, p: dict[str, Any]) -> dict[str, Any]:
    _need(p, "sku", "price")
    sku = p["sku"]
    if sku not in w.menu:
        raise UnknownTarget(f"sku {sku!r} not found")
    ok, why = w.set_price(
        sku, float(p["price"]), "owner", str(p.get("reason") or "owner set it"), strict=True
    )
    if not ok:
        raise CharterViolation(why)
    return {"sku": sku, "price": w.menu[sku].price}


def _feature(w: World, p: dict[str, Any]) -> dict[str, Any]:
    _need(p, "sku")
    sku = p["sku"]
    if sku not in w.menu:
        raise UnknownTarget(f"sku {sku!r} not found")
    on = bool(p.get("on", True))
    w.set_featured(sku, on, "owner", str(p.get("reason", "")))
    return {"sku": sku, "featured": w.menu[sku].featured}


def _hide(w: World, p: dict[str, Any]) -> dict[str, Any]:
    _need(p, "sku")
    sku = p["sku"]
    if sku not in w.menu:
        raise UnknownTarget(f"sku {sku!r} not found")
    on = bool(p.get("on", True))
    w.set_hidden(sku, on, "owner", "owner", str(p.get("reason", "")))
    return {"sku": sku, "hidden": w.menu[sku].hidden is not None}


def _throttle(w: World, p: dict[str, Any]) -> dict[str, Any]:
    _need(p, "channel", "level")
    ch, lvl = p["channel"], p["level"]
    if ch not in ("zomato", "swiggy"):
        raise BadPayload("channel must be zomato or swiggy")
    if lvl not in ("open", "plus5", "plus10", "pause"):
        raise BadPayload("level must be open|plus5|plus10|pause")
    w.delivery.set_throttle(ch, lvl)
    return {"channel": ch, "level": lvl}


def _po(w: World, p: dict[str, Any]) -> dict[str, Any]:
    _need(p, "supplier", "lines")
    sup = p["supplier"]
    if sup not in w.ix.supplier:
        raise UnknownTarget(f"supplier {sup!r} not found")
    lines_in = p["lines"]
    lines: dict[str, float] = {}
    items = (
        lines_in.items() if isinstance(lines_in, dict) else [(ln["ingredient"], ln["qty"]) for ln in lines_in]
    )
    ok = {it.ingredient for it in w.ix.supplier[sup].items}
    for ing, qty in items:
        if ing not in ok:
            raise BadPayload(f"{ing!r} is not sold by {sup}")
        lines[ing] = float(qty)
    tod = p.get("arrive_tod_s")  # optional: standing-delivery time of day (the proposal's order carries it)
    try:
        arrive = None if tod is None else float(tod)
    except (TypeError, ValueError) as e:
        raise BadPayload("arrive_tod_s must be a number of seconds since midnight") from e
    po = w.suppliers.place(sup, lines, source="owner", arrive_tod_s=arrive)
    if po is None:
        raise BadPayload("empty purchase order")
    return {"po_id": po["id"], "eta_s": po["eta_s"], "total": round2(po["total"])}


def _rp_call(fn: Any, *args: Any) -> Any:
    """Map Replate errors onto action errors (422 ineligible / bad payload, 409 nothing to act on)."""
    try:
        return fn(*args)
    except ReplateBadPayload as e:
        raise BadPayload(str(e)) from e
    except ReplateInvalid as e:
        raise InvalidAction(str(e)) from e


def _premake(w: World, p: dict[str, Any]) -> dict[str, Any]:
    _need(p, "sku", "units")
    sku = p["sku"]
    if sku not in w.menu:
        raise UnknownTarget(f"sku {sku!r} not found")
    try:
        units = int(p["units"])
    except (TypeError, ValueError) as e:
        raise BadPayload("units must be an integer") from e
    return _rp_call(w.replate.premake, sku, units, "owner")  # type: ignore[no-any-return]


def _replate_list(w: World, p: dict[str, Any]) -> dict[str, Any]:
    _need(p, "sku")
    sku = p["sku"]
    if sku not in w.menu:
        raise UnknownTarget(f"sku {sku!r} not found")
    pct = p.get("discount_pct")
    return _rp_call(w.replate.list_sku, sku, None if pct is None else float(pct), "owner")  # type: ignore[no-any-return]


def _replate_mode(w: World, p: dict[str, Any]) -> dict[str, Any]:
    _need(p, "mode")
    mode = str(p["mode"])
    if mode == "auto":  # hand control back to the active policy
        w.replate.override = False
        w.replate.mode = str(getattr(w.policy, "default_replate_mode", "off"))
        return {"mode": w.replate.mode, "override": False}
    if mode not in ("off", "gentle", "standard", "aggressive"):
        raise BadPayload("mode must be off|gentle|standard|aggressive")
    _rp_call(w.replate.set_mode, mode, "owner", True)
    return {"mode": w.replate.mode, "override": True}


GUEST_MAX_ITEMS = 12


def _guest_order(w: World, p: dict[str, Any]) -> dict[str, Any]:
    """An order taken at the counter by the waiter for the person at the screen: a paid takeaway ticket on the rail."""
    _need(p, "items")
    raw = p["items"]
    if not isinstance(raw, list) or not raw:
        raise BadPayload("items must be a non-empty list of {sku, qty}")
    td = w.now % 86400.0
    if not w.cfg.cafe.open_s <= td < w.cfg.cafe.close_s:
        raise InvalidAction("the café is closed")
    items: list[tuple[str, tuple[str, ...]]] = []
    for it in raw:
        if not isinstance(it, dict) or "sku" not in it:
            raise BadPayload("each item needs a sku")
        sku = str(it["sku"])
        try:
            qty = int(it.get("qty", 1))
        except (TypeError, ValueError) as e:
            raise BadPayload(f"qty for {sku!r} must be a whole number") from e
        if sku not in w.menu:
            raise UnknownTarget(f"sku {sku!r} is not on the menu")
        if qty < 1:
            raise BadPayload(f"qty for {sku!r} must be at least 1")
        if w.menu[sku].hidden is not None:
            raise InvalidAction(f"{sku} is off the menu right now ({w.menu[sku].hidden})")
        items += [(sku, ())] * qty
    if len(items) > GUEST_MAX_ITEMS:
        raise BadPayload(f"at most {GUEST_MAX_ITEMS} items per order")
    note = str(p["note"])[:120] if p.get("note") else None
    o = w.orders.make_order("takeaway", "regular", str(p.get("name") or "you")[:24], None, items, note, [])
    if not w.orders.commit(o):
        raise InvalidAction("sold out: nothing on that order can be made right now")
    w.fin.collect(o, 0.5)
    return {
        "order_no": o.order_no,
        "total": o.total,
        "promised_s": round(o.promised_s, 1),
        "items": [{"sku": ln["sku"], "qty": ln["qty"], "unit_price": ln["unit_price"]} for ln in o.lines],
    }


_HANDLERS = {
    "serve_order": _serve,
    "bump_order": _bump,
    "restock_fridge": _restock,
    "set_price": _set_price,
    "feature_item": _feature,
    "hide_item": _hide,
    "throttle": _throttle,
    "place_po": _po,
    "premake": _premake,
    "replate_list": _replate_list,
    "replate_mode": _replate_mode,
    "guest_order": _guest_order,
}
