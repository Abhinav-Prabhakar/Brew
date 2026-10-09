"""Policy factory."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .A_fcfs import PolicyA
from .B_heuristic import PolicyB


def make_policy(code: str, models_dir: str | Path | None = None, **kw: Any) -> Any:
    """Instantiate policy ``code`` (A..E).  D needs a trained champion (``models/rl_policy/D``)."""
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

        return PolicyD(models_dir=models_dir, **kw)
    if code == "E":
        from .E_oracle import PolicyE

        return PolicyE(models_dir=models_dir, **kw)
    raise ValueError(f"unknown policy {code!r}")


AVAILABLE = ("A", "B", "C", "E")  # always present; D needs a trained champion, see ``available``
PLANNED = {"D": "M3"}  # reported for D while no champion exists


def has_champion_d(models_dir: str | Path | None = None) -> bool:
    """True when ``models/rl_policy/D`` holds a champion ONNX policy."""
    from brew.models.registry import ModelRegistry

    p = ModelRegistry(models_dir).champion("rl_policy", "D")
    return p is not None and (p / "policy.onnx").exists()


def available(models_dir: str | Path | None = None) -> tuple[str, ...]:
    """Policy codes that can be instantiated now (D only when a trained champion is registered)."""
    return (*AVAILABLE[:3], "D", "E") if has_champion_d(models_dir) else AVAILABLE


def planned(models_dir: str | Path | None = None) -> dict[str, str]:
    """Codes that exist in the spec but cannot run yet."""
    return {} if has_champion_d(models_dir) else dict(PLANNED)
