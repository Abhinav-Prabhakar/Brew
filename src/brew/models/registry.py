"""Model registry: ``models/{kind}/{name}/{version}/`` artifacts + ``models/registry.json`` index.

Every entry records params, metrics, git SHA and data lineage.  The filesystem index is the source of
truth (committed with small champions); :func:`sync_db` mirrors it into the ``model_registry`` table.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from brew.config.loader import repo_root

INDEX = "registry.json"


def git_sha() -> str:
    """Short git SHA of the working tree (``unknown`` outside a repo)."""
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], cwd=repo_root(), capture_output=True, text=True,
            timeout=2, check=False,
        )  # fmt: skip
        return out.stdout.strip() or "unknown"
    except Exception:
        return "unknown"


class ModelRegistry:
    """Filesystem registry under ``root`` (default ``<repo>/models``)."""

    def __init__(self, root: str | Path | None = None) -> None:
        self.root = Path(root) if root else repo_root() / "models"

    # ----------------------------------------------------------------- index
    def _read(self) -> list[dict[str, Any]]:
        f = self.root / INDEX
        if not f.exists():
            return []
        return list(json.loads(f.read_text()))

    def _write(self, rows: list[dict[str, Any]]) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / INDEX).write_text(json.dumps(rows, indent=2, sort_keys=True))

    def dir_for(self, kind: str, name: str, version: str) -> Path:
        return self.root / kind / name / version

    # --------------------------------------------------------------- register
    def register(
        self,
        kind: str,
        name: str,
        version: str,
        *,
        artifact_dir: str | Path | None = None,
        metrics: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
        lineage: dict[str, Any] | None = None,
        champion: bool = True,
    ) -> dict[str, Any]:
        """Add (or replace) a version.  ``artifact_dir`` is copied into the registry layout if given;
        a new champion demotes the previous champion of the same ``kind/name``."""
        dest = self.dir_for(kind, name, version)
        if artifact_dir is not None and Path(artifact_dir).resolve() != dest.resolve():
            if dest.exists():
                shutil.rmtree(dest)
            shutil.copytree(artifact_dir, dest)
        dest.mkdir(parents=True, exist_ok=True)
        entry = {
            "kind": kind, "name": name, "version": version, "path": str(dest.relative_to(self.root)),
            "metrics": _clean(metrics or {}), "params": _clean(params or {}), "lineage": _clean(lineage or {}),
            "git_sha": git_sha(), "champion": champion, "created_at": datetime.now(UTC).isoformat(),
        }  # fmt: skip
        (dest / "meta.json").write_text(json.dumps(entry, indent=2, sort_keys=True))
        rows = [r for r in self._read() if not (r["kind"] == kind and r["name"] == name and r["version"] == version)]
        if champion:
            for r in rows:
                if r["kind"] == kind and r["name"] == name:
                    r["champion"] = False
        rows.append(entry)
        self._write(rows)
        return entry

    # ----------------------------------------------------------------- lookup
    def list(self, kind: str | None = None) -> list[dict[str, Any]]:
        rows = self._read()
        return [r for r in rows if kind is None or r["kind"] == kind]

    def champion(self, kind: str, name: str | None = None) -> Path | None:
        """Directory of the champion artifact for ``kind`` (and ``name``), or ``None``."""
        for r in reversed(self._read()):
            if r["kind"] == kind and r.get("champion") and (name is None or r["name"] == name):
                p = self.root / r["path"]
                if p.exists():
                    return p
        return None

    def champion_entry(self, kind: str, name: str | None = None) -> dict[str, Any] | None:
        for r in reversed(self._read()):
            if r["kind"] == kind and r.get("champion") and (name is None or r["name"] == name):
                return r
        return None

    def models_loaded(self) -> int:
        return sum(1 for r in self._read() if r.get("champion"))

    def sync_db(self, url: str | None = None) -> int:
        """Mirror the index into the ``model_registry`` table; returns rows written."""
        from sqlalchemy import select

        from brew.db import models as m
        from brew.db.session import create_all, make_sync_engine, sync_session_factory
        from brew.domain.ids import uuid7

        eng = make_sync_engine(url)
        create_all(eng)
        n = 0
        with sync_session_factory(eng)() as s:
            have = {(r.kind, r.name, r.version) for r in s.scalars(select(m.ModelRegistry))}
            for i, r in enumerate(self._read()):
                key = (r["kind"], r["name"], r["version"])
                if key in have:
                    continue
                s.add(
                    m.ModelRegistry(
                        id=uuid7(1_700_000_000_000 + i, i * 31 + 7, i * 17 + 3), kind=r["kind"], name=r["name"],
                        version=r["version"], path=r["path"], metrics=r["metrics"], params=r["params"],
                        git_sha=r["git_sha"], champion=bool(r["champion"]),
                        created_at=datetime.fromisoformat(r["created_at"]),
                    )
                )  # fmt: skip
                n += 1
            s.commit()
        return n


def _clean(x: Any) -> Any:
    """JSON-safe copy (numpy scalars -> python, NaN -> None)."""
    import math

    if isinstance(x, dict):
        return {str(k): _clean(v) for k, v in x.items()}
    if isinstance(x, list | tuple):
        return [_clean(v) for v in x]
    if hasattr(x, "item") and not isinstance(x, str | bytes):
        try:
            x = x.item()
        except Exception:
            return str(x)
    if isinstance(x, float) and (math.isnan(x) or math.isinf(x)):
        return None
    return x
