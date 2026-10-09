"""Import torch safely next to LightGBM / OR-tools and keep everything offline.

On macOS, torch and LightGBM / OR-tools ship separate OpenMP runtimes.  Import order is fixed here (LightGBM,
OR-tools, then torch): the other order segfaults LightGBM; and with LightGBM first,
``torch.nn.init.orthogonal_`` (LAPACK QR) can deadlock unless torch is limited to one intra-op thread
(and is plenty for the small MLPs: the simulation dominates).  On Linux the thread count is capped at 4 so a
learner sharing the box with N simulation workers does not oversubscribe the cores.
"""

from __future__ import annotations

import importlib
import os
import sys

os.environ.setdefault("WANDB_DISABLED", "true")
os.environ.setdefault("WANDB_MODE", "disabled")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

# Order matters on macOS: LightGBM and OR-tools must load their OpenMP runtimes *before* torch does,
# otherwise LightGBM segfaults on the first Booster load.
for _m in ("lightgbm", "ortools.sat.python.cp_model"):
    importlib.import_module(_m)

import torch  # noqa: E402

_threads = 1 if sys.platform == "darwin" else min(4, os.cpu_count() or 1)
torch.set_num_threads(_threads)


def pick_device(device: str = "auto") -> str:
    """``auto`` -> ``cuda`` when available, else ``cpu`` (MPS is not used: small MLPs are CPU-bound)."""
    if device == "auto":
        return "cuda" if torch.cuda.is_available() else "cpu"
    return device


def vec_start_method() -> str:
    """Start method for ``SubprocVecEnv`` workers.

    SB3's worker module imports torch before the pickled env factory (and so LightGBM) is unpickled, so
    plain ``spawn`` workers hit the macOS import-order segfault above.  A forkserver that preloads LightGBM and
    OR-tools forks workers with those runtimes already loaded; torch is then imported afterwards, as required.
    Elsewhere ``spawn`` is fine (one OpenMP runtime).
    """
    if sys.platform != "darwin":
        return "spawn"
    import multiprocessing

    multiprocessing.set_forkserver_preload(["lightgbm", "ortools.sat.python.cp_model"])
    return "forkserver"
