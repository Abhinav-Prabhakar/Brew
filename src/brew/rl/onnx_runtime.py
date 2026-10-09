"""Runtime for the exported manager policy: onnxruntime (CPU) + VecNormalize statistics + action masks.

The ONNX graph maps a *normalised* observation to the concatenated per-dimension logits
(``sum(NVEC) = 96``).  :class:`OnnxManagerModel` normalises with ``obs_norm.json``, runs the session,
applies the validity mask (``-inf`` on forbidden indices) and takes an argmax inside each dimension.
No network access, no torch import.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

from .actions import N_LOGITS, NVEC, OFFSETS


def normalize_obs(obs: np.ndarray, mean: np.ndarray, var: np.ndarray, clip: float, eps: float) -> np.ndarray:
    """Exactly ``VecNormalize.normalize_obs``: ``clip((x - mean) / sqrt(var + eps), +-clip)``."""
    return np.clip((obs - mean) / np.sqrt(var + eps), -clip, clip).astype(np.float32)


def masked_argmax(logits: np.ndarray, mask: np.ndarray | None) -> np.ndarray:
    """Per-dimension argmax of the flat logits (invalid indices excluded)."""
    lg = np.asarray(logits, dtype=np.float64).reshape(-1)
    if mask is not None:
        lg = np.where(mask, lg, -np.inf)
    out = np.zeros(len(NVEC), dtype=np.int64)
    for d, (o, n) in enumerate(zip(OFFSETS, NVEC, strict=True)):
        out[d] = int(np.argmax(lg[o : o + n]))
    return out


class OnnxManagerModel:
    """Loaded champion: ``policy.onnx`` + ``obs_norm.json`` (+ ``meta.json``)."""

    def __init__(self, session: Any, mean: np.ndarray, var: np.ndarray, clip: float, eps: float, meta: dict[str, Any]):
        self.session = session
        self.mean = mean.astype(np.float32)
        self.var = var.astype(np.float32)
        self.clip = float(clip)
        self.eps = float(eps)
        self.meta = meta
        self.input_name = session.get_inputs()[0].name

    @classmethod
    def load(cls, path: str | Path) -> OnnxManagerModel:
        import onnxruntime as ort

        d = Path(path)
        so = ort.SessionOptions()
        so.intra_op_num_threads = 1
        so.inter_op_num_threads = 1
        so.log_severity_level = 3
        sess = ort.InferenceSession(str(d / "policy.onnx"), so, providers=["CPUExecutionProvider"])
        norm = json.loads((d / "obs_norm.json").read_text())
        meta: dict[str, Any] = {}
        if (d / "meta.json").exists():
            meta = json.loads((d / "meta.json").read_text())
        return cls(
            sess, np.asarray(norm["mean"]), np.asarray(norm["var"]), norm.get("clip_obs", 10.0), norm.get("epsilon", 1e-8), meta
        )

    def logits(self, obs: np.ndarray) -> np.ndarray:
        """Logits for raw observations ``(n, 183)`` (or ``(183,)``) -> ``(n, 96)``."""
        x = np.atleast_2d(np.asarray(obs, dtype=np.float32))
        z = normalize_obs(x, self.mean, self.var, self.clip, self.eps)
        out = self.session.run(None, {self.input_name: z})[0]
        assert out.shape[1] == N_LOGITS
        return np.asarray(out)

    def act(self, obs: np.ndarray, mask: np.ndarray | None) -> np.ndarray:
        """Deterministic action vector for one observation."""
        return masked_argmax(self.logits(obs)[0], mask)
