"""Validate human-saved LLM outputs, dedupe, write clean datasets (docs/implementation-spec.md 15.3)."""

from __future__ import annotations

import json
import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ValidationError

from brew.config.loader import repo_root

from .schemas import MIN_ROWS, SCHEMAS

DATASETS = tuple(SCHEMAS)
TEXT_KEY: dict[str, Any] = {
    "reviews": lambda r: r.text,
    "order_notes": lambda r: r.text,
    "calendar_bengaluru": lambda r: f"{r.date}|{r.name}",
    "explanations": lambda r: r.template,
    "customer_names": lambda r: r.name,
    "ask_brew_eval": lambda r: r.question,
    "supplier_catalog": lambda r: f"{r.ingredient}|{r.supplier_name}",
}
_FENCE = re.compile(r"^\s*```")


def raw_root(path: str | Path | None = None) -> Path:
    return Path(path) if path else repo_root() / "data" / "synthetic" / "raw"


def clean_root(path: str | Path | None = None) -> Path:
    return Path(path) if path else repo_root() / "data" / "synthetic" / "clean"


@dataclass
class Report:
    name: str
    files: int = 0
    read: int = 0
    valid: int = 0
    dupes: int = 0
    written: int = 0
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def iter_records(path: Path) -> list[tuple[int, str | dict[str, Any], str | None]]:
    """Tolerantly parse a file into ``(line_no, record_or_text, parse_error)``.

    Handles JSONL with blank lines / code fences / stray prose lines, and whole-file JSON arrays.
    """
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    stripped = text.strip()
    out: list[tuple[int, str | dict[str, Any], str | None]] = []
    if stripped.startswith("[") or (stripped.startswith("```") and "\n[" in stripped[:20]):
        body = "\n".join(ln for ln in stripped.splitlines() if not _FENCE.match(ln))
        try:
            arr = json.loads(body)
            if isinstance(arr, list):
                return [(i + 1, r, None) for i, r in enumerate(arr)]
        except json.JSONDecodeError:
            pass  # fall through to line-wise parsing so errors carry line numbers
    for i, line in enumerate(text.splitlines(), start=1):
        s = line.strip().rstrip(",")
        if not s or _FENCE.match(s):
            continue
        try:
            obj = json.loads(s)
        except json.JSONDecodeError as e:
            out.append((i, s[:80], f"invalid JSON ({e.msg})"))
            continue
        if not isinstance(obj, dict):
            out.append((i, s[:80], "expected a JSON object per line"))
            continue
        out.append((i, obj, None))
    return out


def _distribution_checks(name: str, rows: list[BaseModel]) -> list[str]:
    msgs: list[str] = []
    n = len(rows)
    if n < 30:
        return msgs
    if name == "reviews":
        c = Counter(r.stars for r in rows)  # type: ignore[attr-defined]
        for s in range(1, 6):
            if c.get(s, 0) < 0.10 * n:
                msgs.append(f"distribution: star level {s} is {c.get(s, 0) / n:.0%} of rows (< 10%)")
    elif name == "order_notes":
        c = Counter(i for r in rows for i in r.intents)  # type: ignore[attr-defined]
        for intent in ("allergy", "modifier", "rush"):
            if c.get(intent, 0) < 0.03 * n:
                msgs.append(f"distribution: intent {intent!r} is under 3% of rows")
    return msgs


def validate_dataset(name: str, files: list[Path]) -> tuple[Report, list[BaseModel]]:
    """Validate ``files`` against ``name``'s schema; returns the report and deduped valid rows."""
    model = SCHEMAS[name]
    rep = Report(name, files=len(files))
    seen_id: set[str] = set()
    seen_text: set[str] = set()
    rows: list[BaseModel] = []
    keyfn = TEXT_KEY[name]
    for f in files:
        for ln, rec, perr in iter_records(f):
            rep.read += 1
            loc = f"{f.name}:{ln}"
            if perr:
                rep.errors.append(f"{loc}: {perr}")
                continue
            try:
                row = model.model_validate(rec)
            except ValidationError as e:
                msg = "; ".join(
                    f"{'.'.join(str(x) for x in err['loc'])}: {err['msg']}" for err in e.errors()[:3]
                )
                rep.errors.append(f"{loc}: {msg}")
                continue
            rid = getattr(row, "id", None)
            tkey = _norm(str(keyfn(row)))
            if (rid and rid in seen_id) or tkey in seen_text:
                rep.dupes += 1
                continue
            if rid:
                seen_id.add(rid)
            seen_text.add(tkey)
            rows.append(row)
    rep.valid = len(rows)
    rep.warnings += _distribution_checks(name, rows)
    return rep, rows


def validate_all(
    only: str | None = None, raw_dir: str | Path | None = None, clean_dir: str | Path | None = None
) -> list[Report]:
    """Validate every ``raw/{name}/*`` dataset and write ``clean/{name}.jsonl`` (sorted by id)."""
    raw = raw_root(raw_dir)
    clean = clean_root(clean_dir)
    clean.mkdir(parents=True, exist_ok=True)
    names = [only] if only else list(DATASETS)
    if only and only not in SCHEMAS:
        raise ValueError(f"unknown dataset {only!r}; choose from {', '.join(DATASETS)}")
    reports: list[Report] = []
    for name in names:
        d = raw / name
        files = (
            sorted(
                p for p in d.glob("*") if p.is_file() and p.suffix in (".jsonl", ".json", ".txt", ".ndjson")
            )
            if d.is_dir()
            else []
        )
        if not files:
            reports.append(Report(name))
            continue
        rep, rows = validate_dataset(name, files)
        if rows:
            rows.sort(key=lambda r: (getattr(r, "id", None) or "", _norm(str(TEXT_KEY[name](r)))))
            out = clean / f"{name}.jsonl"
            with open(out, "w", encoding="utf-8") as fh:
                for r in rows:
                    fh.write(json.dumps(r.model_dump(mode="json"), ensure_ascii=False) + "\n")
            rep.written = len(rows)
        reports.append(rep)
    return reports


def _count_lines(p: Path) -> int:
    return sum(1 for ln in p.read_text(encoding="utf-8").splitlines() if ln.strip()) if p.exists() else 0


def status(raw_dir: str | Path | None = None, clean_dir: str | Path | None = None) -> list[dict[str, Any]]:
    """Per-dataset presence / row counts / whether the minimum is met."""
    raw = raw_root(raw_dir)
    clean = clean_root(clean_dir)
    out = []
    for name in DATASETS:
        d = raw / name
        raw_files = [p for p in d.glob("*") if p.is_file() and p.name != ".gitkeep"] if d.is_dir() else []
        n = _count_lines(clean / f"{name}.jsonl")
        minimum = MIN_ROWS[name]
        if n >= minimum:
            state = "ok"
        elif n > 0:
            state = f"below minimum ({n}/{minimum})"
        elif raw_files:
            state = "raw present - run `brew-synth validate`"
        else:
            state = "missing"
        out.append(
            {"name": name, "raw_files": len(raw_files), "clean_rows": n, "min_rows": minimum, "state": state}
        )
    return out
