"""Import torch safely next to LightGBM / OR-tools and keep everything offline.

On macOS, torch and LightGBM / OR-tools ship separate OpenMP runtimes; when LightGBM is imported first,
``torch.nn.init.orthogonal_`` (LAPACK QR) can deadlock.  Limiting torch to one intra-op thread avoids it
(and is plenty for the small MLPs: the simulation dominates).  On Linux the thread count is capped at 4 so a
learner sharing the box with N simulation workers does not oversubscribe the cores.
"""

from __future__ import annotations

import os
import sys

os.environ.setdefault("WANDB_DISABLED", "true")
os.environ.setdefault("WANDB_MODE", "disabled")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

import torch  # noqa: E402

_threads = 1 if sys.platform == "darwin" else min(4, os.cpu_count() or 1)
torch.set_num_threads(_threads)


def pick_device(device: str = "auto") -> str:
    """``auto`` -> ``cuda`` when available, else ``cpu`` (MPS is not used: small MLPs are CPU-bound)."""
    if device == "auto":
        return "cuda" if torch.cuda.is_available() else "cpu"
    return device
