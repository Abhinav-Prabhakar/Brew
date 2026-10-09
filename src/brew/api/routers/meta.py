"""Static / meta endpoints: health, cafe profile, event schema, later-milestone placeholders."""

from __future__ import annotations

import subprocess
from functools import lru_cache
from typing import Any

from fastapi import APIRouter, Request

from brew.config.loader import default_cafe, default_policies, list_scenarios, load_scenario, repo_root
from brew.events.schema import event_json_schema
from brew.policies.registry import available, planned
from brew.settings import get_settings
from brew.version import __version__

router = APIRouter(tags=["meta"])


@lru_cache(maxsize=1)
def git_sha() -> str:
    s = get_settings().git_sha
    if s != "unknown":
        return s
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=repo_root(),
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
        return out.stdout.strip() or "unknown"
    except Exception:
        return "unknown"


@router.get("/health")
def health(request: Request) -> dict[str, Any]:
    from brew.models.registry import ModelRegistry

    n = ModelRegistry(str(request.app.state.settings.resolved_models_dir())).models_loaded()
    return {"status": "ok", "version": __version__, "git_sha": git_sha(), "models_loaded": n}


@router.get("/cafe")
def cafe(request: Request) -> dict[str, Any]:
    """Cafe profile, menu, channels, personas, stations, equipment, tables, catalog."""
    c = default_cafe()
    pol = default_policies()
    return {
        "cafe": c.cafe.model_dump(mode="json", exclude={"params", "initial_reputation", "reputation_prior"}),
        "menu": [m.model_dump(mode="json") for m in c.menu],
        "modifiers": [m.model_dump(mode="json", exclude={"recipe_delta", "pick_prob"}) for m in c.modifiers],
        "channels": [ch.model_dump(mode="json") for ch in c.channels],
        "personas": {
            k: {"key": k, "name": p.name, "icon": p.icon, "party_size": {str(s): v for s, v in p.party_size.items()}, "channels": p.channels}
            for k, p in c.personas.items()
        },
        "stations": [s.model_dump(mode="json") for s in c.stations],
        "equipment": [e.model_dump(mode="json") for e in c.equipment],
        "staff": [s.model_dump(mode="json", exclude={"skills"}) for s in c.staff],
        "tables": c.tables.model_dump(mode="json"),
        "catalog": [i.model_dump(mode="json") for i in c.catalog],
        "ingredients": [{"key": i.key, "name": i.name, "uom": i.base_uom, "par": i.par, "is_packaging": i.is_packaging} for i in c.ingredients],
        "suppliers": [{"key": s.key, "name": s.name, "lead_time_h": s.lead_time_h, "is_local": s.is_local} for s in c.suppliers],
        "scenarios": [{"key": k, "name": load_scenario(k).name, "description": load_scenario(k).description} for k in list_scenarios()],
        "policies": {
            "available": list(available(request.app.state.settings.resolved_models_dir())),
            "planned": planned(request.app.state.settings.resolved_models_dir()),
            "strategies": list(pol.strategies.manual),
            "presets": list(pol.strategies.presets),
        },
        "charter": pol.charter.model_dump(mode="json"),
    }  # fmt: skip


_CHAOS_UI = (
    ("staff_absent", "barista sick", "Calls in sick: a barista is out for the duration."),
    ("equipment_down", "oven breaks", "The oven breaks down until the technician fixes it."),
    ("supplier_delay", "milk delivery late", "The dairy supplier's deliveries run late (+12 h x severity)."),
    ("rain_storm", "rain storm", "Heavy rain: delivery demand surges, dine-in drops, riders slow down."),
    ("rider_shortage", "rider shortage", "Few delivery riders: platform ETAs stretch by (1 + severity)."),
    ("power_cut", "power cut", "Power cut: every high-draw appliance stops until power returns."),
)


@router.get("/chaos/kinds")
def chaos_kinds() -> dict[str, Any]:
    """The kitchen chaos-card buttons: ``POST /worlds/{id}/chaos {kind, target?, severity?, duration_min?}``."""
    c = default_cafe()
    barista = next((s.key for s in c.staff if s.role == "barista"), None)
    oven = "oven" if any(e.station == "oven" or e.key == "oven" for e in c.equipment) else None
    dairy = next((s.key for s in c.suppliers if any(i.ingredient == "milk" for i in s.items)), None)
    default = {"staff_absent": barista, "equipment_down": oven, "supplier_delay": dairy}
    items = [
        {"kind": k, "label": label, "default_target": default.get(k), "description": desc}
        for k, label, desc in _CHAOS_UI
    ]
    return {"items": items}


@router.get("/events/schema")
def events_schema() -> dict[str, Any]:
    """JSON Schema of the event union (for frontend codegen)."""
    return event_json_schema()
