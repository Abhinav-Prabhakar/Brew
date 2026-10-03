"""Policy C - optimised (CP-SAT scheduler, newsvendor, pricing ladder). Implemented in M2."""

from __future__ import annotations

from typing import Any


class PolicyC:
    """Stub: the solver policy arrives in milestone M2."""

    code = "C"

    def __init__(self) -> None:
        raise NotImplementedError("Policy C (solver) is implemented in M2")

    def reset(self, view: Any, seed: int) -> None:
        raise NotImplementedError("M2")

    def on_manager_tick(self, obs: Any, view: Any) -> Any:
        raise NotImplementedError("M2")

    def accept(self, order: Any, view: Any) -> Any:
        raise NotImplementedError("M2")

    def dispatch(self, ready: Any, view: Any) -> Any:
        raise NotImplementedError("M2")

    def on_day_end(self, view: Any) -> Any:
        raise NotImplementedError("M2")

    def explain(self, decision_id: str) -> Any:
        raise NotImplementedError("M2")
