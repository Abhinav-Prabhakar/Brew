"""Discrete-event engine: a heap ordered by (t, prio, seq) with lazy cancellation."""

from __future__ import annotations

import heapq
from collections.abc import Callable
from typing import Any

# Priorities: lower runs first at equal t.
P_CLOCK = 0
P_DISRUPT = 1
P_DONE = 2
P_ARRIVAL = 3
P_TIMEOUT = 4
P_DECIDE = 5
P_TELEMETRY = 9


class Engine:
    """Priority-queue event loop. Payloads must be picklable (no lambdas) so worlds can fork."""

    __slots__ = ("dead", "heap", "now", "processed", "seq")

    def __init__(self) -> None:
        self.heap: list[tuple[float, int, int, str, Any]] = []
        self.seq = 0
        self.now = 0.0
        self.dead: set[int] = set()
        self.processed = 0

    def schedule(self, t: float, kind: str, payload: Any = None, prio: int = P_DECIDE) -> int:
        """Schedule ``kind`` at sim time ``t`` (s). Returns a handle usable with :meth:`cancel`."""
        if t < self.now:
            t = self.now
        self.seq += 1
        heapq.heappush(self.heap, (t, prio, self.seq, kind, payload))
        return self.seq

    def cancel(self, handle: int | None) -> None:
        """Lazily cancel a scheduled event."""
        if handle is not None:
            self.dead.add(handle)

    def peek(self) -> float | None:
        """Time of the next live event, or None."""
        h = self.heap
        dead = self.dead
        while h and h[0][2] in dead:
            dead.discard(heapq.heappop(h)[2])
        return h[0][0] if h else None

    def step(self, dispatch: Callable[[str, Any], None]) -> bool:
        """Pop and dispatch one live event. Returns False if the queue is empty."""
        h = self.heap
        dead = self.dead
        while h:
            t, _p, seq, kind, payload = heapq.heappop(h)
            if seq in dead:
                dead.discard(seq)
                continue
            self.now = t
            self.processed += 1
            dispatch(kind, payload)
            return True
        return False

    def run_until(
        self,
        t_end: float,
        dispatch: Callable[[str, Any], None],
        should_stop: Callable[[], bool] | None = None,
    ) -> bool:
        """Process all events with ``t <= t_end``. Returns True if it reached ``t_end``.

        ``should_stop`` is polled every 64 events (used by the live pacer to cap CPU per tick).
        """
        h = self.heap
        dead = self.dead
        n = 0
        while h and h[0][0] <= t_end:
            t, _p, seq, kind, payload = heapq.heappop(h)
            if seq in dead:
                dead.discard(seq)
                continue
            self.now = t
            self.processed += 1
            dispatch(kind, payload)
            n += 1
            if should_stop is not None and (n & 63) == 0 and should_stop():
                return False
        if self.now < t_end:
            self.now = t_end
        return True

    def __len__(self) -> int:
        return len(self.heap) - len(self.dead)
