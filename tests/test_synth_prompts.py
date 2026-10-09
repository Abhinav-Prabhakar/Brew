from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from pydantic import ValidationError

from brew.config.loader import repo_root
from brew.synth.schemas import SCHEMAS, ExplanationRow

PROMPTS = repo_root() / "data" / "prompts"
NAMES = list(SCHEMAS)


@pytest.mark.parametrize("name", NAMES)
def test_prompt_examples_validate_against_schema(name):
    """Every example line shown in a prompt must itself be a valid row."""
    text = (PROMPTS / f"{name}.md").read_text()
    ex = [ln for ln in text.splitlines() if ln.startswith('{"id":')]
    assert len(ex) >= 3, name
    for ln in ex:
        SCHEMAS[name].model_validate(json.loads(ln))


def _norm(s: str) -> str:
    return re.sub(r"\{[^}]+\}", "{}", s)


def test_known_routes_match_api_and_ask_prompt():
    from brew.api.app import create_app
    from brew.settings import Settings
    from brew.synth.schemas import KNOWN_ROUTES

    app = create_app(Settings(db_enabled=False))
    live = set()
    for path, ops in app.openapi()["paths"].items():
        for m in ops:
            if m.upper() in ("GET", "POST"):
                live.add(_norm(f"{m.upper()} {path[len('/api/v1') :]}"))
    known = {_norm(k) for k in KNOWN_ROUTES}
    assert known <= live, known - live
    prompt = (PROMPTS / "ask_brew_eval.md").read_text()
    in_prompt = {_norm(p) for p in re.findall(r"`((?:GET|POST) /[^`]*)`", prompt)}
    assert {_norm(k) for k in KNOWN_ROUTES if k not in ("GET /worlds", "POST /worlds")} <= in_prompt


def test_explanation_rules_enforced():
    base = {
        "id": "EXP-9-1",
        "decision_type": "reorder",
        "direction": "none",
        "factors": ["stock"],
        "tone": "crisp",
    }
    ExplanationRow(**base, template="Ordered {qty} of {ingredient} because only {stock_days} days remain.")
    for bad in (
        "Ordered {qty} of {unicorn} because stock is low today.",
        "Only one {qty} slot is not enough here.",
    ):
        with pytest.raises(ValidationError):
            ExplanationRow(**base, template=bad)
    with pytest.raises(ValidationError):
        ExplanationRow(**{**base, "factors": ["vibes"]}, template="Ordered {qty} of {ingredient} for cover.")


def test_ask_rows_require_real_routes():
    from brew.synth.schemas import AskRow

    ok = {
        "id": "ASK-9-1",
        "question": "How is today going so far?",
        "intent": "kpi_lookup",
        "params": {},
        "answer_sketch": "Read the rolling KPIs.",
    }
    AskRow(**ok, endpoints=["GET /worlds/{id}/kpis"])
    with pytest.raises(ValidationError):
        AskRow(**ok, endpoints=["GET /worlds/{id}/magic"])


def test_prompts_dir_has_readme_and_seven_prompts():
    files = {p.name for p in Path(PROMPTS).glob("*.md")}
    assert files >= {f"{n}.md" for n in NAMES} | {"README.md"}
