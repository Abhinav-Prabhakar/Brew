"""Run monitor: human-readable log lines (no carriage returns) + ``progress.json`` heartbeat.

``progress.json`` = ``{stage, stage_index, n_stages, step, total_steps, steps_per_s, eta_s,
last_eval: {mean_reward, mean_profit}, updated, ...}`` and is rewritten at least every ``heartbeat_s``
seconds by a daemon thread (so a long stage with no step counter still shows signs of life).
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from collections import deque
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, TextIO


class RunMonitor:
    """Thread-safe progress file + log sink for one run directory."""

    def __init__(self, run_dir: str | Path, n_stages: int, heartbeat_s: float = 20.0, stream: TextIO | None = None):
        self.run_dir = Path(run_dir)
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self.path = self.run_dir / "progress.json"
        self.stream = stream or sys.stdout
        self.n_stages = n_stages
        self.state: dict[str, Any] = {
            "stage": "init", "stage_index": 0, "n_stages": n_stages, "step": 0, "total_steps": 0,
            "steps_per_s": 0.0, "eta_s": None, "last_eval": {"mean_reward": None, "mean_profit": None},
            "updated": "", "started": datetime.now(UTC).isoformat(), "status": "running",
        }  # fmt: skip
        self._lock = threading.Lock()
        self._win: deque[tuple[float, int]] = deque(maxlen=20)
        self._stop = threading.Event()
        self._last_write = 0.0
        self._heartbeat_s = heartbeat_s
        self._thread = threading.Thread(target=self._beat, daemon=True)
        self._t0 = time.time()
        self.write(force=True)
        self._thread.start()

    # ------------------------------------------------------------------ logging
    def log(self, msg: str) -> None:
        ts = time.strftime("%H:%M:%S")
        with self._lock:
            print(f"[{ts}] {msg}", file=self.stream, flush=True)

    # ----------------------------------------------------------------- progress
    def begin_stage(self, name: str, index: int, total_steps: int = 0, step: int = 0) -> None:
        with self._lock:
            self.state.update(stage=name, stage_index=index, step=step, total_steps=total_steps, steps_per_s=0.0, eta_s=None)
            self._win.clear()
        self.write(force=True)

    def update(self, step: int | None = None, total_steps: int | None = None, **extra: Any) -> None:
        now = time.time()
        with self._lock:
            if total_steps is not None:
                self.state["total_steps"] = total_steps
            if step is not None:
                self.state["step"] = step
                self._win.append((now, step))
                if len(self._win) >= 2:
                    (t0, s0), (t1, s1) = self._win[0], self._win[-1]
                    if t1 > t0:
                        sps = (s1 - s0) / (t1 - t0)
                        self.state["steps_per_s"] = round(sps, 2)
                        tot = self.state["total_steps"]
                        self.state["eta_s"] = round((tot - s1) / sps, 1) if sps > 0 and tot else None
            self.state.update(extra)
        self.write()

    def set_eval(self, mean_reward: float, mean_profit: float, **extra: Any) -> None:
        with self._lock:
            self.state["last_eval"] = {"mean_reward": mean_reward, "mean_profit": mean_profit, **extra}
        self.write(force=True)

    def finish(self, status: str = "done") -> None:
        with self._lock:
            self.state["status"] = status
            self.state["eta_s"] = 0.0 if status == "done" else None
        self.write(force=True)
        self._stop.set()

    # --------------------------------------------------------------------- file
    def write(self, force: bool = False) -> None:
        now = time.time()
        if not force and now - self._last_write < 5.0:
            return
        with self._lock:
            self.state["updated"] = datetime.now(UTC).isoformat()
            self.state["elapsed_s"] = round(now - self._t0, 1)
            data = json.dumps(self.state, indent=2, default=str)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(data)
        os.replace(tmp, self.path)
        self._last_write = now

    def _beat(self) -> None:
        while not self._stop.wait(self._heartbeat_s):
            try:
                self.write(force=True)
            except Exception:  # pragma: no cover - never kill the run for a heartbeat
                pass
