"""In-memory job registry for arena runs and advisor counterfactuals (docs/implementation-spec.md 10.5).

Jobs run on a small thread pool; arena jobs fan out to a process pool themselves (``workers``)."""

from __future__ import annotations

import threading
import time
import traceback
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any


class Job:
    def __init__(self, job_id: str, kind: str, params: dict[str, Any]) -> None:
        self.id = job_id
        self.kind = kind
        self.params = params
        self.status = "queued"  # queued | running | done | error
        self.done = 0
        self.total = 1
        self.result: Any = None
        self.error: str | None = None
        self.created = time.time()
        self.finished: float | None = None
        self.future: Future[None] | None = None

    def progress(self, done: int, total: int) -> None:
        self.done, self.total = done, max(1, total)

    def json(self, with_result: bool = True) -> dict[str, Any]:
        out: dict[str, Any] = {
            "id": self.id, "kind": self.kind, "status": self.status, "progress": {"done": self.done, "total": self.total},
            "params": self.params, "error": self.error,
        }  # fmt: skip
        if with_result and self.status == "done":
            out["result"] = self.result
        return out


class JobRegistry:
    """Thread-safe registry; ``submit`` runs ``fn(job)`` on the pool."""

    def __init__(self, workers: int = 2) -> None:
        self.jobs: dict[str, Job] = {}
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="brew-job")
        self._lock = threading.Lock()
        self._seq = 0

    def new_id(self, kind: str) -> str:
        with self._lock:
            self._seq += 1
            return f"{kind}-{self._seq:05d}"

    def submit(self, kind: str, params: dict[str, Any], fn: Callable[[Job], Any], run_inline: bool = False) -> Job:
        job = Job(self.new_id(kind), kind, params)
        with self._lock:
            self.jobs[job.id] = job

        def runner() -> None:
            job.status = "running"
            try:
                job.result = fn(job)
                job.status = "done"
            except Exception as e:
                job.error = f"{type(e).__name__}: {e}"
                job.status = "error"
                job.result = traceback.format_exc(limit=3)
            finally:
                job.finished = time.time()

        if run_inline:
            runner()
        else:
            job.future = self.pool.submit(runner)
        return job

    def get(self, job_id: str) -> Job | None:
        return self.jobs.get(job_id)

    def shutdown(self) -> None:
        self.pool.shutdown(wait=False, cancel_futures=True)
