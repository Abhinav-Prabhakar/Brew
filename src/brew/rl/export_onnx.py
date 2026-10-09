"""ONNX export of the manager policy + parity check + champion directory (docs/implementation-spec.md 13.5).

The exported graph maps a *normalised* observation to the concatenated logits of all 18 action dimensions
(``features_extractor -> mlp_extractor.policy_net -> action_net``).  ``obs_norm.json`` carries the VecNormalize
statistics so the runtime (``rl/onnx_runtime.py``) can reproduce ``clip((x - mean) / sqrt(var + eps), +-clip)``.
"""

from __future__ import annotations

import json
import pickle
import shutil
from pathlib import Path
from typing import Any

import numpy as np

from brew.models.registry import git_sha
from brew.sim.observation import NAMES

from . import torch_setup  # noqa: F401
from .actions import DIM_NAMES, N_LOGITS, NVEC
from .onnx_runtime import OnnxManagerModel


def _logits_module(policy: Any) -> Any:
    import torch

    class PolicyLogits(torch.nn.Module):
        """features_extractor + policy_net + action_net of a MaskableActorCriticPolicy."""

        def __init__(self, pol: Any) -> None:
            super().__init__()
            self.features = pol.features_extractor
            self.policy_net = pol.mlp_extractor.policy_net
            self.action_net = pol.action_net

        def forward(self, obs: Any) -> Any:
            return self.action_net(self.policy_net(self.features(obs)))

    return PolicyLogits(policy).eval()


def load_vecnorm_stats(path: str | Path) -> dict[str, Any]:
    """Mean / var / clip / epsilon of a saved ``VecNormalize`` (works without building the env)."""
    with open(path, "rb") as f:
        vn = pickle.load(f)
    return {
        "mean": np.asarray(vn.obs_rms.mean, dtype=np.float64).tolist(),
        "var": np.asarray(vn.obs_rms.var, dtype=np.float64).tolist(),
        "clip_obs": float(vn.clip_obs), "epsilon": float(vn.epsilon), "obs_names": list(NAMES),
    }  # fmt: skip


def export_onnx(model: Any, onnx_path: Path) -> None:
    """Write ``policy.onnx`` (opset 17, dynamic batch)."""
    import torch

    mod = _logits_module(model.policy).cpu()
    dummy = torch.zeros(2, 183, dtype=torch.float32)
    onnx_path.parent.mkdir(parents=True, exist_ok=True)
    with torch.no_grad():
        torch.onnx.export(
            mod, (dummy,), str(onnx_path), input_names=["obs"], output_names=["logits"], opset_version=17,
            dynamic_axes={"obs": {0: "batch"}, "logits": {0: "batch"}}, dynamo=False,
        )  # fmt: skip


def parity_check(
    model: Any, champion_dir: Path, obs: np.ndarray, tol: float = 1e-4
) -> dict[str, Any]:  # fmt: skip
    """Max |logit difference| between the torch policy and the ONNX runtime on raw observations ``obs``.

    The torch path uses the VecNormalize arithmetic (float64 then float32); the ONNX path is the production
    runtime (numpy float32 normalisation + onnxruntime).  Also checks the argmax actions agree.
    """
    import torch

    rt = OnnxManagerModel.load(champion_dir)
    norm = json.loads((champion_dir / "obs_norm.json").read_text())
    mean, var = np.asarray(norm["mean"]), np.asarray(norm["var"])
    ref_in = np.clip((obs - mean) / np.sqrt(var + norm["epsilon"]), -norm["clip_obs"], norm["clip_obs"]).astype(np.float32)
    mod = _logits_module(model.policy).cpu()
    with torch.no_grad():
        ref = mod(torch.as_tensor(ref_in)).numpy()
    got = rt.logits(obs)
    diff = float(np.max(np.abs(ref - got)))
    from .onnx_runtime import masked_argmax

    agree = float(np.mean([np.array_equal(masked_argmax(ref[i], None), masked_argmax(got[i], None)) for i in range(len(obs))]))
    return {"max_abs_diff": diff, "tol": tol, "ok": bool(diff < tol), "n_obs": len(obs), "argmax_agreement": agree}


def parity_observations(n: int, seed: int, real: np.ndarray | None = None) -> np.ndarray:
    """256 test observations: half uniform in [-1, 1.5], half resampled (with noise) from real ones if given."""
    rng = np.random.default_rng(seed)
    a = rng.uniform(-1.0, 1.5, size=(n, 183)).astype(np.float32)
    if real is not None and len(real):
        idx = rng.integers(0, len(real), size=n // 2)
        a[: n // 2] = real[idx] + rng.normal(0.0, 0.05, size=(n // 2, 183)).astype(np.float32)
    return a


def write_champion(
    model: Any, vecnorm_pkl: Path, out_dir: Path, meta: dict[str, Any], parity_obs: np.ndarray, tol: float = 1e-4
) -> dict[str, Any]:  # fmt: skip
    """Export ``policy.onnx`` + ``obs_norm.json`` + ``meta.json`` into ``out_dir`` and run the parity test."""
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    export_onnx(model, out_dir / "policy.onnx")
    (out_dir / "obs_norm.json").write_text(json.dumps(load_vecnorm_stats(vecnorm_pkl)))
    par = parity_check(model, out_dir, parity_obs, tol)
    full = {
        **meta, "git_sha": git_sha(), "obs_dim": 183, "n_logits": N_LOGITS, "nvec": NVEC, "dim_names": DIM_NAMES,
        "opset": 17, "parity": par,
    }  # fmt: skip
    (out_dir / "meta.json").write_text(json.dumps(full, indent=2, default=str))
    return par
