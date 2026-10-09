"""Backend <-> frontend contract tests (no browser): golden streams vs the pydantic schema, staleness, design/contract.json.

The JavaScript store is the source of truth for which event types it handles (BrewStore.describe(), asserted equal to
contract.json in test_store.py); here we check contract.json against the backend.
"""

from __future__ import annotations

import importlib.util
import json
import re
import warnings
from collections import Counter
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

import pytest

from brew.events.schema import EVENT_MODELS, validate_event

from .conftest import FIXTURE_NAMES, FIXTURES, ROOT

pytestmark = pytest.mark.frontend

CONTRACT = ROOT / "design" / "contract.json"
DEMO = ROOT / "design" / "data" / "demo-stream.jsonl"
PENDING_BACKEND = {"station.load", "staff.status", "chaos.cost"}  # reducers exist, backend emits them from the next regeneration on


@lru_cache(maxsize=None)
def load(name: str) -> list[dict[str, Any]]:
    return [json.loads(line) for line in (FIXTURES / f"{name}.jsonl").read_text().splitlines() if line]


def contract() -> dict[str, Any]:
    return json.loads(CONTRACT.read_text())  # type: ignore[no-any-return]


def recorder() -> Any:
    spec = importlib.util.spec_from_file_location("record_stream", ROOT / "scripts" / "record_stream.py")
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ------------------------------------------------------------------ the golden streams
@pytest.mark.parametrize("name", FIXTURE_NAMES)
def test_fixture_structure(name: str) -> None:
    lines = load(name)
    assert lines[0]["kind"] == "meta" and lines[1]["kind"] == "snapshot"
    meta = lines[0]
    assert meta["name"] == name and meta["policy"] == "D" and meta["start_date"] == "2026-10-06"
    events = [x for x in lines if x["kind"] == "event"]
    cps = [x for x in lines if x["kind"] == "checkpoint"]
    assert meta["n_events"] == len(events) > 100
    assert cps and cps[-1]["seq"] == events[-1]["seq"], "the last checkpoint is at the end of the stream"
    assert events[0]["seq"] == meta["first_seq"] == lines[1]["data"]["last_seq"] + 1
    seqs = [e["seq"] for e in events]
    assert seqs == sorted(set(seqs)) and all(b - a == 1 for a, b in zip(seqs, seqs[1:])), "seq strictly increasing, gap-free"
    for e in events:
        assert set(e) == {"kind", "seq", "sim_s", "t", "type", "data"}
        datetime.fromisoformat(e["t"])  # ISO-8601 with the Asia/Kolkata offset
        assert e["t"].endswith("+05:30")
    assert [c["seq"] for c in cps] == sorted(c["seq"] for c in cps)
    assert all(e["sim_s"] >= events[0]["sim_s"] for e in events)


@pytest.mark.parametrize("name", FIXTURE_NAMES)
def test_every_event_validates_against_its_schema(name: str) -> None:
    for e in (x for x in load(name) if x["kind"] == "event"):
        validate_event(e["type"], e["data"])  # raises KeyError (unknown type) or ValidationError


def test_fixtures_are_not_stale() -> None:
    sha = recorder().schema_sha256()
    for name in FIXTURE_NAMES:
        assert load(name)[0]["schema_sha256"] == sha, (
            f"{name}.jsonl was recorded against an older event schema: "
            "regenerate fixtures: uv run python scripts/record_stream.py --all"
        )


def test_demo_stream_is_the_morning_rush_fixture() -> None:
    assert DEMO.read_bytes() == (FIXTURES / "morning_rush.jsonl").read_bytes(), (
        "design/data/demo-stream.jsonl must equal the morning_rush fixture: uv run python scripts/record_stream.py --all"
    )


def test_scenarios_contain_what_they_promise() -> None:
    kinds = {n: Counter(e["type"] for e in load(n) if e["kind"] == "event") for n in FIXTURE_NAMES}
    assert kinds["morning_rush"]["equipment.down"] == 1 and kinds["morning_rush"]["equipment.up"] == 1
    assert kinds["morning_rush"]["price.changed"] and kinds["morning_rush"]["batch.formed"]
    assert kinds["morning_rush"]["action.applied"] == 2  # set_price + serve_order
    d = kinds["lunch_delivery"]
    assert d["bag.shelved"] and d["rider.assigned"] and d["rider.arrived"] and d["rider.picked_up"]
    assert d["chaos.triggered"] == 2 and d["chaos.resolved"] == 2
    c = kinds["closing"]
    assert c["day.ended"] == 1 and c["day.started"] == 1
    meta = load("morning_rush")[0]
    assert [a["kind"] for a in meta["actions"]] == ["set_price", "serve_order"]
    assert meta["chaos"][0]["kind"] == "equipment_down" and meta["chaos"][0]["target"] == "espresso_machine"


# ------------------------------------------------------------------ design/contract.json
def test_contract_covers_every_backend_event_type() -> None:
    c = contract()["events"]
    missing = sorted(set(EVENT_MODELS) - set(c))
    assert not missing, f"backend event types neither handled nor ignored in design/contract.json: {missing}"
    for t, row in c.items():
        if t not in EVENT_MODELS:
            assert t in PENDING_BACKEND, f"contract lists {t!r} which is not in the backend schema (and is not pending)"
            continue
        if "ignored" in row:
            assert row["ignored"].strip(), t
        else:
            assert row["handlers"] and all(re.fullmatch(r"reduce/\w+\.js:\w+", h) for h in row["handlers"]), t
            assert row["visual"] and row["visual"] != "TODO", f"{t}: say what it drives on screen"


def test_pending_backend_events_are_reported() -> None:
    c = contract()["events"]
    pending = sorted(t for t, r in c.items() if r.get("pending_backend"))
    assert set(pending) == PENDING_BACKEND
    not_yet = [t for t in pending if t not in EVENT_MODELS]
    arrived = [t for t in pending if t in EVENT_MODELS]
    if not_yet:
        warnings.warn(f"pending backend (reducers exist, schema does not): {not_yet}", stacklevel=1)
    if arrived:
        warnings.warn(f"backend now emits {arrived}: drop them from PENDING_BACKEND and regenerate fixtures", stacklevel=1)


def _section_6_3_types() -> set[str]:
    text = (ROOT / "backend.md").read_text()
    sec = text[text.index("### 6.3 WebSocket") : text.index("### 6.4 Hydration")]
    out: set[str] = set()
    for line in sec.splitlines():
        if not line.startswith("| `"):
            continue
        first = line.split("|")[1]
        for tok in re.findall(r"`([^`]+)`", first):
            if not re.fullmatch(r"[a-z_]+\.[a-z_*/]+", tok):
                continue
            head, tail = tok.split(".", 1)
            if tail == "*":
                out |= {t for t in EVENT_MODELS if t.startswith(head + ".")}
            elif "/" in tail:
                out |= {f"{head}.{x}" for x in tail.split("/")}
            else:
                out.add(tok)
    return out


def test_every_event_in_backend_md_6_3_is_handled_or_ignored() -> None:
    doc = _section_6_3_types()
    assert len(doc) >= 60, "parsed the §6.3 table"
    assert not doc - set(EVENT_MODELS), f"backend.md §6.3 lists types the schema lacks: {sorted(doc - set(EVENT_MODELS))}"
    c = contract()["events"]
    assert not doc - set(c), f"§6.3 types missing from contract.json: {sorted(doc - set(c))}"


def test_fixture_event_types_are_all_in_the_contract() -> None:
    seen = {e["type"] for n in FIXTURE_NAMES for e in load(n) if e["kind"] == "event"}
    assert seen <= set(contract()["events"])
    never = sorted(set(EVENT_MODELS) - seen)
    # not a failure: those types are covered by the synthetic-event tests in test_store.py
    print("event types no fixture exercises:", never)
    assert len(never) < 12


def _resolve(node: Any, parts: list[str]) -> bool:
    if not parts:
        return True
    head, rest = parts[0], parts[1:]
    if head.endswith("[]"):
        key = head[:-2]
        lst = node.get(key) if isinstance(node, dict) else None
        return isinstance(lst, list) and any(_resolve(x, rest) for x in lst)
    return isinstance(node, dict) and head in node and _resolve(node[head], rest)


def test_snapshot_fields_exist_in_the_fixtures() -> None:
    snaps = [x["data"] for n in FIXTURE_NAMES for x in load(n) if x["kind"] in ("snapshot", "checkpoint")]
    assert snaps
    fields = contract()["snapshot_fields"]
    assert set(fields) == {"hud", "lobby", "kitchen", "pantry"}
    for room, paths in fields.items():
        for path in paths:
            assert any(_resolve(s, path.split(".")) for s in snaps), f"{room}: GET /state has no {path!r} in any fixture snapshot"


def test_known_gaps_are_documented() -> None:
    gaps = contract()["known_gaps"]
    assert gaps and all(isinstance(v, str) and len(v) > 20 for v in gaps.values())


def test_contract_file_is_what_the_script_would_write() -> None:
    # cheap structural check that does not need a browser; the byte-exact check is `build_contract.py --check`
    c = contract()
    assert set(c) >= {"events", "rest", "snapshot_fields", "known_gaps"}
    assert Path(ROOT / "scripts" / "build_contract.py").exists()
