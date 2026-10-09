"""Process-pool context that is safe after torch / LightGBM / OR-tools have started their thread pools.

The Linux default start method is ``fork``; forking a parent whose OpenMP / intra-op thread pools are already running
can deadlock the child (seen as an arena stage that never finishes inside ``brew-train all``).  ``spawn`` starts clean
interpreters instead.  On macOS a forkserver that preloads LightGBM / OR-tools avoids the torch-before-LightGBM
OpenMP segfault (see ``brew.rl.torch_setup``).
"""

from __future__ import annotations

import multiprocessing
import sys
from multiprocessing.context import BaseContext


def pool_context() -> BaseContext:
    if sys.platform == "darwin":
        ctx = multiprocessing.get_context("forkserver")
        ctx.set_forkserver_preload(["lightgbm", "ortools.sat.python.cp_model"])
        return ctx
    return multiprocessing.get_context("spawn")
