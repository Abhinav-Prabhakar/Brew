"""Recording is deterministic: the same arguments give a byte-identical file, whatever the string-hash seed.

Slow (each recording replays the sim, ~5 s): run with ``uv run pytest -m slow tests/frontend/test_record_determinism.py``.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from .conftest import FIXTURES, ROOT

pytestmark = [pytest.mark.slow, pytest.mark.frontend]


@pytest.mark.parametrize("hash_seed", ["1", "12345"])
def test_rerecording_closing_is_byte_identical(tmp_path: Path, hash_seed: str) -> None:
    committed = FIXTURES / "closing.jsonl"
    sha = json.loads(committed.read_text().splitlines()[0])["recorded_with"]
    env = {**os.environ, "PYTHONHASHSEED": hash_seed}
    subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "record_stream.py"), "--name", "closing", "--out-dir", str(tmp_path), "--recorded-with", sha],
        cwd=ROOT, env=env, check=True, capture_output=True,
    )  # fmt: skip
    again = (tmp_path / "closing.jsonl").read_bytes()
    assert again == committed.read_bytes(), (
        "re-recording 'closing' changed the bytes: either the sim is no longer deterministic "
        "(look for iteration over sets / dicts of str hashes) or the fixtures are stale "
        "(uv run python scripts/record_stream.py --all)"
    )
