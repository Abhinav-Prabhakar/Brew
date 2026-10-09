"""JSON-friendly read models over a World (used by the API; pure reads)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from brew.domain.timeutil import DAY_S, hhmm, iso, tod_s
from brew.domain.timeutil import WEEKDAYS as _WD

from .loadboard import break_rule

if TYPE_CHECKING:
    from .state import Order
    from .world import World

FRIDGE = {
    "croissant": "croissant_baked",
    "muffin": "muffin_fg",
    "cheesecake": "cheesecake_slice",
    "cinnamon": "cinnamon_roll_fg",
}


def t_fields(w: World, sim_s: float | None = None) -> dict[str, Any]:
    s = w.now if sim_s is None else sim_s
    return {"sim_s": round(s, 1), "t": iso(s, w.start_date)}


def clock(w: World) -> dict[str, Any]:
    cfg = w.cfg.cafe
    td = tod_s(w.now)
    return {
        **t_fields(w),
        "day": w.day,
        "hhmm": hhmm(w.now),
        "weekday": _WD[w.weekday()],
        "date": w.date_str(),
        "speed": w.speed,
        "is_open": cfg.open_s <= td < cfg.close_s,
        "open_s": w.day * DAY_S + cfg.open_s,
        "close_s": w.day * DAY_S + cfg.close_s,
    }


def world_summary(w: World) -> dict[str, Any]:
    return {
        "id": w.world_id,
        "scenario": w.scenario.key,
        "policy": w.policy.code,
        "strategy": w.manual_strategy,
        "seed": w.seed,
        "start_date": w.start_date,
        "clock": clock(w),
        "last_seq": w.seq,
    }


def weather(w: World) -> dict[str, Any]:
    return {"state": w.weather_state, "temp_c": w.temp_c, "rain_mm_h": w.rain_mm_h}


def menu(w: World) -> list[dict[str, Any]]:
    out = []
    for m in w.cfg.menu:
        ms = w.menu[m.sku]
        out.append(
            {
                "sku": m.sku, "name": m.name, "cat": m.cat, "price": ms.price, "base": ms.base,
                "min_price": m.min_price, "max_price": m.max_price, "staple": m.staple, "featured": ms.featured,
                "hidden": ms.hidden is not None, "hidden_reason": ms.hidden,
                "chip": {"dir": ms.chip_dir, "text": ms.chip_text} if ms.chip_dir and ms.price != ms.base else None,
                "desc": m.desc, "temp": m.temp, "allergens": list(m.allergens), "veg": m.veg, "vegan": m.vegan,
                "station": m.station, "sold_today": ms.sold_today, "promo": ms.promo,
            }
        )  # fmt: skip
    return out


def order_json(w: World, o: Order, batches: dict[int, int] | None = None) -> dict[str, Any]:
    state, prog = (
        w.orders.progress_of(o) if o.state not in ("served", "voided", "rejected") else (o.state, 1.0)
    )
    return {
        "order_no": o.order_no, "order_id": o.id, "channel": o.channel, "persona": o.persona, "name": o.name,
        "party_id": o.party_id, "status": o.state, "progress_state": state, "progress": round(prog, 2),
        "items": [{"sku": ln["sku"], "qty": ln["qty"], "mods": ln["mods"], "unit_price": ln["unit_price"], "replate": ln["replate"], "combo": ln.get("combo")} for ln in o.lines],
        "note": o.note, "note_flags": o.note_flags, "placed_s": round(o.placed_s, 1),
        "promised_s": round(o.promised_s, 1), "ready_s": round(o.ready_s, 1) if o.ready_s else None,
        "served_s": round(o.served_s, 1) if o.served_s else None, "bumped": o.bumped,
        "batch": (batches or {}).get(o.order_no), "paid": o.paid, "total": o.total or None,
        "quality": round(o.quality, 3) if o.state == "served" else None, "remakes": o.remakes,
    }  # fmt: skip


def _batch_index(w: World) -> dict[int, int]:
    idx: dict[int, int] = {}
    for bid, ons in w.kitchen.live_batches.items():
        if len(ons) >= 2:
            for no in ons:
                idx[no] = bid
    return idx


def orders(
    w: World, status: str | None = None, channel: str | None = None, limit: int = 200
) -> list[dict[str, Any]]:
    bi = _batch_index(w)
    rows = list(w.orders.open.values()) + list(w.orders.archive)[-80:]
    out = []
    for o in rows:
        if channel and o.channel != channel:
            continue
        if status and status not in (
            o.state,
            "open" if o.state in ("queued", "brewing", "almost", "ready") else "",
        ):
            continue
        out.append(order_json(w, o, bi))
    return out[-limit:]


def rail(w: World) -> dict[str, Any]:
    nos, batches = w.orders.rail_state()
    bi = _batch_index(w)
    return {
        "order_nos": nos,
        "batches": batches,
        "orders": [order_json(w, w.orders.open[n], bi) for n in nos if n in w.orders.open],
    }


def board(w: World) -> dict[str, Any]:
    cols: dict[str, list[dict[str, Any]]] = {"brewing": [], "almost": [], "ready": []}
    for o in w.orders.open.values():
        if o.channel in ("zomato", "swiggy") and o.state == "ready":
            continue
        state, _ = w.orders.progress_of(o)
        key = {"queued": "brewing"}.get(state, state)
        cols[key].append(
            {"order_no": o.order_no, "name": o.name, "short": o.name.upper()[:5], "channel": o.channel}
        )
    return cols


def customers(w: World) -> list[dict[str, Any]]:
    out = []
    for p in w.customers.in_venue():
        left = p.patience_left
        if p.patience_rate > 0:
            left -= p.patience_rate * (w.now - p.patience_mark)
        out.append(
            {
                "party_id": p.id, "customer_id": p.cust_id, "name": p.name, "persona": p.persona, "party_size": p.size,
                "channel": p.channel, "state": p.state, "appearance_seeds": p.seeds, "laptop": p.laptop,
                "patience_s": round(p.patience_total, 1), "patience_left_s": round(max(0.0, left), 1) if p.patience_rate > 0 else None,
                "patience_frac": round(max(0.0, left) / p.patience_total, 3) if p.patience_total else None,
                "unhappy": p.unhappy, "tables": p.table_ids, "order_nos": p.order_nos, "arrived_s": round(p.arrive_s, 1),
            }
        )  # fmt: skip
    return out


def tables(w: World) -> dict[str, Any]:
    tabs = []
    for tid in w.table_order:
        t = w.tables[tid]
        tabs.append(
            {
                "id": tid,
                "seats": t.seats,
                "state": t.state,
                "occupants": [x for x in t.occ if x],
                "merged": t.merged,
                "turns": t.turns,
            }
        )
    return {"tables": tabs, "combinable": [list(p) for p in w.cfg.tables.combinable]}


def inventory(w: World) -> list[dict[str, Any]]:
    out = []
    for key in w.inv.onhand:
        if key in w.inv.virtual:
            continue
        ing = w.ix.ingredient.get(key)
        prep = w.ix.prep.get(key)
        uom = ing.base_uom if ing else prep.base_uom  # type: ignore[union-attr]
        use = w.ma.key_usage_per_day(key)
        on = w.inv.onhand[key]
        lots = w.inv.lots[key]
        out.append(
            {
                "key": key, "name": ing.name if ing else prep.name,  # type: ignore[union-attr]
                "kind": "ingredient" if ing else "prep", "uom": uom, "on_hand": round(on, 2),
                "par": ing.par if ing else prep.par,  # type: ignore[union-attr]
                "reorder_point": ing.reorder_point if ing else prep.reorder_point,  # type: ignore[union-attr]
                "lots": len(lots), "next_expiry_s": round(lots[0].expires_s, 1) if lots else None,
                "days_of_cover": round(on / use, 2) if use > 0 else None,
                "in_progress": round(w.kitchen.prep_inflight.get(key, 0.0), 1) if prep else 0.0,
                "on_order": round(w.suppliers.open_for(key), 1) if ing else 0.0,
            }
        )  # fmt: skip
    return out


def inventory_lots(w: World, key: str) -> list[dict[str, Any]]:
    return [
        {
            "lot_id": lt.lot_id, "qty": round(lt.qty, 3), "qty_initial": lt.qty0, "unit_cost": round(lt.unit_cost, 4),
            "received_s": round(lt.received_s, 1), "expires_s": round(lt.expires_s, 1),
            "opened_s": lt.opened_s, "quality": round(max(0.5, 1 - 0.5 * (w.now - lt.received_s) / max(1.0, lt.expires_s - lt.received_s)), 3),
            "status": "opened" if lt.opened_s is not None else "sealed",
        }
        for lt in w.inv.lots[key]
    ]  # fmt: skip


def replate(w: World) -> dict[str, Any]:
    """Replate (rescue menu): mode, held lots, active listings and KPIs."""
    rp = w.replate
    lots = rp.lots_view()
    return {
        "mode": rp.mode,
        "override": rp.override,
        "category": {"key": "replate", "title": "Replate", "tagline": "Still lovely, just made earlier"},
        "eligible": sorted(rp.active),
        "prep_backed": dict(rp.backed),
        "listings": [x for x in lots if x["listed"]],
        "lots": lots,
        "kpis": rp.kpis(),
        "ladders": {k: v.model_dump(mode="json") for k, v in w.cfg.replate.ladders.items()},
        "premake_inflight": {s: rp.inflight(s) for s in rp.premake_skus if rp.inflight(s) > 0},
    }


def fridge(w: World) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = [
        {"sku": sku, "key": key, "qty": round(w.inv.onhand[key], 1), "low": w.low_flag.get(key, False), "par": (w.ix.ingredient.get(key) or w.ix.prep[key]).par}
        for sku, key in FRIDGE.items()
    ]  # fmt: skip
    for r in out:
        pl = w.replate.listing(r["sku"])
        r["replate"] = (
            {"listing_id": pl.listing_id, "price": pl.price, "discount_pct": pl.discount_pct, "units": pl.remaining}
            if pl is not None
            else None
        )
    cb = w.inv.onhand["coldbrew_concentrate"]
    out.append(
        {
            "sku": "coldbrew",
            "key": "coldbrew_concentrate",
            "qty": round(cb / 330.0, 1),
            "low": cb < 1200,
            "par": round(6000 / 330.0, 1),
            "replate": None,
        }
    )
    pm = w.replate.pm_key("coldbrew")
    if pm:
        out[-1]["premade_units"] = round(w.inv.onhand[pm], 1)
        pl = w.replate.listing("coldbrew")
        if pl is not None:
            out[-1]["replate"] = {
                "listing_id": pl.listing_id, "price": pl.price, "discount_pct": pl.discount_pct, "units": pl.remaining
            }
    return out


def shelf(w: World) -> dict[str, Any]:
    return {
        "slots": w.delivery.slots_total,
        "bags": w.delivery.shelf_view(),
        "waiting_for_slot": list(w.delivery.waiting_for_slot),
    }


def stations(w: World) -> list[dict[str, Any]]:
    """Per-station load rows (same shape as the ``station.load`` event)."""
    return w.loadboard.station_rows()


def staff(w: World) -> list[dict[str, Any]]:
    out = []
    status = {r["staff_id"]: r for r in w.loadboard.staff_rows()}
    for s in w.kitchen.staff_list:
        r = status[s.key]
        out.append(
            {
                "state": r["state"], "break_due_s": r["break_due_s"], "break_end_s": r["break_end_s"],
                "break_rule": break_rule(s), "break_min": s.break_min,
                "id": s.key, "name": s.name, "role": s.role, "present": s.present, "on_break": s.on_break, "absent": s.absent,
                "station": s.station if s.active else None, "task": s.task_name if s.active else None,
                "attention": round(s.attention_used, 2), "fatigue": round(s.fatigue, 3), "wage_per_h": s.wage,
                "shift": [round(s.shift_start_s, 0), round(s.shift_end_s, 0)], "skills": s.skills,
                "tasks_done": s.tasks_done,
            }
        )  # fmt: skip
    return out


def equipment(w: World) -> list[dict[str, Any]]:
    return [
        {
            "idx": e.idx, "key": e.key, "station": e.station, "slots": e.slots, "slots_in_use": e.slots_used, "status": "up" if e.up else "down",
            "down_until_s": round(e.down_until, 1) if not e.up else None, "condition": round(e.condition, 2),
        }
        for e in w.equip
    ]  # fmt: skip


def kpis(w: World, from_day: int | None = None, to_day: int | None = None) -> dict[str, Any]:
    daily = [
        d
        for d in w.daily_kpis
        if (from_day is None or d["day"] >= from_day) and (to_day is None or d["day"] <= to_day)
    ]
    return {"daily": daily, "rolling": w.kpi.tick_payload(), "day": w.day}


def impact(w: World) -> dict[str, Any]:
    days = max(1, len(w.daily_kpis))
    ds = w.daily_kpis
    last = ds[-1] if ds else None

    def avg(k: str) -> float:
        return round(sum(d[k] for d in ds) / days, 2) if ds else 0.0

    off = []
    for d in ds:
        off.append(max(d["p95_wait_s"].get("dine_in", 0), d["p95_wait_s"].get("takeaway", 0)))
    return {
        "economic": {
            "net_profit_per_day": avg("net_profit"), "revenue_per_day": avg("revenue"),
            "revenue_per_labour_hour": avg("revenue_per_labour_hour"), "profit_today": w.kpi.profit_today(),
        },
        "environmental": {
            "waste_kg_per_day": avg("waste_kg"), "waste_inr_per_day": avg("waste_inr"), "co2e_kg_per_day": avg("co2e_kg"),
            "energy_kwh_per_day": avg("energy_kwh"), "donated_kg_per_day": avg("donated_kg"),
        },
        "social": {
            "overload_min_per_day": avg("overload_min"), "p95_offline_wait_s": round(max(off), 1) if off else 0.0,
            "walkouts_per_day": avg("walkouts"), "rating": round(w.reviews.rep.overall(), 3),
            "price_changes_per_day": avg("price_changes"), "charter_compliant": True,
        },
        "days": len(ds), "last_day": last["day"] if last else None,
    }  # fmt: skip


def reviews(w: World, limit: int = 50) -> list[dict[str, Any]]:
    return list(reversed(w.reviews.log[-limit:]))


def receipt(w: World, order_no: int) -> dict[str, Any] | None:
    o = w.orders.orders.get(order_no)
    if o is None:
        for a in w.orders.archive:
            if a.order_no == order_no:
                o = a
                break
    if o is None or o.receipt is None:
        return None
    r = o.receipt
    return {
        "order_no": order_no, "channel": o.channel, "name": o.name, "lines": r["lines"], "subtotal": r["subtotal"],
        "discount": r["discount"], "cgst": r["cgst"], "sgst": r["sgst"], "gst_total": round(r["cgst"] + r["sgst"], 2),
        "round_off": r["round_off"], "total": r["total"], "payment": r["payment"], "qr": r.get("qr"),
        "refunded": bool(r.get("refunded")),
    }  # fmt: skip


def decisions(w: World, since_seq: int = 0) -> list[dict[str, Any]]:
    return [d for d in w.decisions if int(d["decision_id"].split("-")[1]) > since_seq]


def disruptions(w: World) -> list[dict[str, Any]]:
    return [
        {"id": d.id, "kind": d.kind, "target": d.target, "severity": d.severity, "start_s": d.start_s, "end_s": d.end_s, "source": d.source, "active": d.active, "resolved": d.resolved, "cost_inr": d.meta.get("cost_inr")}
        for d in w.dis.items.values()
    ]  # fmt: skip


def state(w: World) -> dict[str, Any]:
    """Full hydration snapshot (backend.md 6.4)."""
    return {
        "world": world_summary(w),
        "clock": clock(w),
        "weather": weather(w),
        "kpis": w.kpi.tick_payload(),
        "menu": menu(w),
        "rail": rail(w),
        "board": board(w),
        "customers": customers(w),
        "tables": tables(w),
        "fridge": fridge(w),
        "replate": replate(w),
        "combos": w.combos.menu_json(),
        "shelf": shelf(w),
        "staff": staff(w),
        "equipment": equipment(w),
        "stations": stations(w),
        "policy": {
            "policy": w.policy.code,
            "strategy": w.manual_strategy,
            "preset": w.effective_preset(),
            "batch_window_s": w.batch_window_s,
            "throttles": dict(w.delivery.throttle),
        },  # fmt: skip
        "strategy": w.manual_strategy,
        "disruptions": [d for d in disruptions(w) if d["active"]],
        "last_seq": w.seq,
    }
