"""Policy factory."""

from __future__ import annotations

from typing import Any

from .A_fcfs import PolicyA
from .B_heuristic import PolicyB


def make_policy(code: str) -> Any:
    """Instantiate policy ``code`` (A..E). C/D/E are stubs that raise NotImplementedError."""
    code = code.upper()
    if code == "A":
        return PolicyA()
    if code == "B":
        return PolicyB()
    if code == "C":
        from .C_solver import PolicyC

        return PolicyC()
    if code == "D":
        from .D_rl import PolicyD

        return PolicyD()
    if code == "E":
        from .E_oracle import PolicyE

        return PolicyE()
    raise ValueError(f"unknown policy {code!r}")


AVAILABLE = ("A", "B")
PLANNED = {"C": "M2", "D": "M3", "E": "M2"}
