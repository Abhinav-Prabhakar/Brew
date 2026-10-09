"""Policy D - learned RL manager (technical.md 8.4, 13).

``ManagerExecutor`` is Policy C's machinery parametrised by an 18-dimensional RL action:

* prices: category steps (charter shield in ``World``), RL strategy preset + batch window drive C's
  weighted-EDF dispatch with batching (no CP-SAT, so a manager tick stays cheap);
* prep: C's newsvendor batch logic with the RL service level kappa per prep class (off / P50 .. P90);
* make-ahead plates: C's newsvendor at the RL level (none / P50 / P70 / P85 of the next-2 h forecast);
* Replate: the world's own ladder mode (off / gentle / standard / aggressive);
* intake: C's feasibility check + the RL throttles; purchasing: C's newsvendor order-up-to.

``PolicyD`` adds the learned decider: an ONNX MLP (CPU onnxruntime) over the 183-float observation with
normalisation, action masks and a per-dimension masked argmax, plus decision explanations from a surrogate
decision tree.  The training env drives the same executor through :meth:`ManagerExecutor.act`.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np

from brew.models.registry import ModelRegistry
from brew.policies.base import Explanation, ManagerAction
from brew.policies.bundle import ModelBundle
from brew.policies.C_solver import CLOSE_S, KIND_OFFSET, PolicyC
from brew.policies.strategies import priority

if TYPE_CHECKING:
    from brew.config.schemas import Preset
    from brew.sim.observation import Observation
    from brew.sim.state import Task
    from brew.sim.views import WorldView

Decider = Callable[["Observation", "WorldView"], np.ndarray]


class ManagerExecutor(PolicyC):
    """Executes RL action vectors with Policy C's prep / purchasing / intake / dispatch machinery."""

    code = "D"
    default_preset = "edf"
    default_batch_window_s = 45.0
    default_replate_mode = "standard"

    def __init__(
        self,
        models_dir: str | Path | None = None,
        params: dict[str, Any] | None = None,
        use_models: bool = True,
        bundle: ModelBundle | None = None,
    ) -> None:
        super().__init__(models_dir=models_dir, params=params, use_models=use_models, use_cpsat=False, bundle=bundle)
        self.decide: Decider | None = None  # None = the env supplies actions (training)
        self.tick_pending = False  # set at every manager tick when ``decide`` is None
        self.last_obs: Observation | None = None
        self._preset: Preset | None = None
        self._boost: dict[str, float] = {}
        self.last_vec: np.ndarray | None = None

    def __getstate__(self) -> dict[str, Any]:
        st = super().__getstate__()
        st["decide"] = None
        st["last_obs"] = None
        return st

    # --------------------------------------------------------------- lifecycle
    def reset(self, view: WorldView, seed: int) -> None:
        super().reset(view, seed)
        self.tick_pending = False
        self.last_obs = None
        self._preset = view.strategies.presets["edf"]
        self._boost = {}

    # ----------------------------------------------------------------- manager
    def on_manager_tick(self, obs: Observation, view: WorldView) -> ManagerAction:
        self.last_obs = obs
        if self.decide is None:  # training env: pause here, the env applies the agent's action
            self.tick_pending = True
            return ManagerAction()
        return self.act(self.decide(obs, view), obs, view)

    def act(self, vec: np.ndarray, obs: Observation | None, view: WorldView) -> ManagerAction:
        """Turn an action vector into a :class:`ManagerAction` (RL fields + C-executed prep / make-ahead / POs)."""
        from brew.rl.actions import D_KAPPA, D_PREMAKE, KAPPA_LEVELS, PREMAKE_LEVELS, decode_action
        from brew.sim.observation import KAPPA_CLASSES

        self.last_vec = np.asarray(vec, dtype=np.int64)
        a = decode_action(self.last_vec, view._w)
        self._fc(view)
        if view.tod_s < CLOSE_S - 1800:
            self.kappa_ovr = {k: KAPPA_LEVELS[int(vec[D_KAPPA + i])] for i, k in enumerate(KAPPA_CLASSES)}
            try:
                self._prep(view, a)
                self._salvage(view, a)
                lvl = PREMAKE_LEVELS[int(vec[D_PREMAKE])]
                if lvl > 0 and self.P["premake"]["enabled"]:
                    self.premake_q_ovr = lvl
                    self._premake(view, a)
            finally:
                self.premake_q_ovr = None
                self.kappa_ovr = None
            self._replenish(view, a)
        return a

    # ---------------------------------------------------------------- dispatch
    def dispatch(self, ready: list[Task], view: WorldView) -> list[Any]:
        if view.strategy == "balanced":  # a HUD strategy overrides the RL preset (manual dispatch in C)
            self._preset = view.strategies.presets[view.preset]
            self._boost = view.channel_boost
        return super().dispatch(ready, view)

    def _key(self, t: Task, now: float, reg_wait: int) -> float:
        """Ascending sort key: register first when someone waits, prep jobs soon, steps by preset priority."""
        k = t.kind
        if k == "register":
            return now - 3600.0 + (0.0 if reg_wait else 1e4)
        if k != "step" and k != "bag":
            return now + KIND_OFFSET.get(k, 600.0)
        assert self._preset is not None
        return now - priority(t, now, self._preset, self._boost)


class PolicyD(ManagerExecutor):
    """Learned manager: ONNX policy (normalise -> logits -> masks -> per-dimension argmax) + explanations."""

    def __init__(
        self,
        models_dir: str | Path | None = None,
        params: dict[str, Any] | None = None,
        use_models: bool = True,
        bundle: ModelBundle | None = None,
        champion: str | Path | None = None,
    ) -> None:
        super().__init__(models_dir=models_dir, params=params, use_models=use_models, bundle=bundle)
        from brew.rl.onnx_runtime import OnnxManagerModel

        path = Path(champion) if champion else ModelRegistry(models_dir).champion("rl_policy", "D")
        if path is None or not (Path(path) / "policy.onnx").exists():
            raise FileNotFoundError(
                "no Policy D champion found (models/rl_policy/D/<version>/policy.onnx); run `brew-train all` first"
            )
        self.champion_dir = Path(path)
        self.model = OnnxManagerModel.load(self.champion_dir)
        self.decide = self._decide
        self.surrogate: Any = None
        sp = self.champion_dir / "surrogate.joblib"
        if sp.exists():
            from brew.rl.surrogate import Surrogate

            self.surrogate = Surrogate.load(sp)
        self.explanations: dict[str, Explanation] = {}

    def __getstate__(self) -> dict[str, Any]:
        st = super().__getstate__()
        st["model"] = None
        st["surrogate"] = None
        return st

    def __setstate__(self, st: dict[str, Any]) -> None:
        super().__setstate__(st)
        from brew.rl.onnx_runtime import OnnxManagerModel

        self.model = OnnxManagerModel.load(self.champion_dir)
        self.decide = self._decide
        sp = self.champion_dir / "surrogate.joblib"
        if sp.exists():
            from brew.rl.surrogate import Surrogate

            self.surrogate = Surrogate.load(sp)

    def _decide(self, obs: Observation, view: WorldView) -> np.ndarray:
        from brew.rl.masks import compute_masks

        return self.model.act(obs.vec, compute_masks(view._w))

    def act(self, vec: np.ndarray, obs: Observation | None, view: WorldView) -> ManagerAction:
        a = super().act(vec, obs, view)
        if self.surrogate is not None and obs is not None:
            factors, summary = self.surrogate.explain(obs.vec, np.asarray(vec))
            a.factors = factors + a.factors
            a.reason = summary if not a.reason else f"{summary}; {a.reason}"
        return a

    def explain(self, decision_id: str) -> Explanation | None:
        return self.explanations.get(decision_id)


__all__ = ["ManagerExecutor", "PolicyD"]
