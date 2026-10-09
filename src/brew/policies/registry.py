"""Policy factory."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .A_fcfs import PolicyA
from .B_heuristic import PolicyB


def make_policy(code: str, models_dir: str | Path | None = None, **kw: Any) -> Any:
    """Instantiate policy ``code`` (A..E). D (RL) arrives in M3 and raises NotImplementedError."""
    code = code.upper()
    if code == "A":
        return PolicyA()
    if code == "B":
        return PolicyB()
    if code == "C":
        from .C_solver import PolicyC

        return PolicyC(models_dir=models_dir, **kw)
    if code == "D":
        from .D_rl import PolicyD

        return PolicyD()
    if code == "E":
        from .E_oracle import PolicyE

        return PolicyE(models_dir=models_dir, **kw)
    raise ValueError(f"unknown policy {code!r}")


AVAILABLE = ("A", "B", "C", "E")
PLANNED = {"D": "M3"}
