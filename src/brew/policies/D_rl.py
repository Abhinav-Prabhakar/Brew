"""Policy D - learned RL manager (MaskablePPO exported to ONNX). Implemented in M3."""

from __future__ import annotations

from typing import Any


class PolicyD:
    """Stub: the RL policy arrives in milestone M3."""

    code = "D"

    def __init__(self) -> None:
        raise NotImplementedError("Policy D (RL) is implemented in M3")

    def reset(self, view: Any, seed: int) -> None:
        raise NotImplementedError("M3")

    def on_manager_tick(self, obs: Any, view: Any) -> Any:
        raise NotImplementedError("M3")

    def accept(self, order: Any, view: Any) -> Any:
        raise NotImplementedError("M3")

    def dispatch(self, ready: Any, view: Any) -> Any:
        raise NotImplementedError("M3")

    def on_day_end(self, view: Any) -> Any:
        raise NotImplementedError("M3")

    def explain(self, decision_id: str) -> Any:
        raise NotImplementedError("M3")
