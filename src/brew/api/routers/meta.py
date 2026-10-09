"""Static / meta endpoints: health, cafe profile, event schema, later-milestone placeholders."""

from __future__ import annotations

import subprocess
from functools import lru_cache
from typing import Any

from fastapi import APIRouter

from brew.api.schemas import ArenaRequest
from brew.api.world_manager import NotImplementedYet
from brew.config.loader import default_cafe, default_policies, list_scenarios, load_scenario, repo_root
from brew.events.schema import event_json_schema
from brew.policies.registry import AVAILABLE, PLANNED
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
def health() -> dict[str, Any]:
    return {"status": "ok", "version": __version__, "git_sha": git_sha(), "models_loaded": 0}


@router.get("/cafe")
def cafe() -> dict[str, Any]:
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
            "available": list(AVAILABLE),
            "planned": PLANNED,
            "strategies": list(pol.strategies.manual),
            "presets": list(pol.strategies.presets),
        },
        "charter": pol.charter.model_dump(mode="json"),
    }  # fmt: skip


@router.get("/events/schema")
def events_schema() -> dict[str, Any]:
    """JSON Schema of the event union (for frontend codegen)."""
    return event_json_schema()


# ---------------------------------------------------------------- later milestones
@router.get("/models")
def models() -> Any:
    raise NotImplementedYet("M2/M3", "model registry")


@router.post("/arena")
def arena_create(body: ArenaRequest) -> Any:
    raise NotImplementedYet("M2", "policy arena")


@router.get("/arena/{arena_id}")
def arena_get(arena_id: str) -> Any:
    raise NotImplementedYet("M2", "policy arena")


@router.get("/decisions/{decision_id}/explain")
def explain(decision_id: str) -> Any:
    raise NotImplementedYet("M2", "decision explanations")
