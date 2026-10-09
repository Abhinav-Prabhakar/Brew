"""Event record, envelope and sinks (docs/implementation-spec.md section 9)."""

from __future__ import annotations

import threading
from collections import deque
from pathlib import Path
from typing import Any, NamedTuple, Protocol

import orjson

from brew.domain.timeutil import iso


class EventRecord(NamedTuple):
    """Hot-path event: ``data`` is a plain dict validated lazily against ``events.schema``."""

    seq: int
    sim_s: float
    type: str
    data: dict[str, Any]


def envelope(rec: EventRecord, start_date: str) -> dict[str, Any]:
    """Wire form ``{seq, sim_s, t, type, data}`` with ISO time in Asia/Kolkata."""
    return {
        "seq": rec.seq,
        "sim_s": rec.sim_s,
        "t": iso(rec.sim_s, start_date),
        "type": rec.type,
        "data": rec.data,
    }


def dumps(obj: Any) -> bytes:
    return orjson.dumps(obj, option=orjson.OPT_SERIALIZE_NUMPY)


class EventSink(Protocol):
    """Anything that can receive events."""

    def emit(self, ev: EventRecord) -> None: ...


class ListSink:
    """Collects every event in a list (tests, CLI)."""

    def __init__(self) -> None:
        self.events: list[EventRecord] = []

    def emit(self, ev: EventRecord) -> None:
        self.events.append(ev)

    def of_type(self, *types: str) -> list[EventRecord]:
        return [e for e in self.events if e.type in types]


class RingBufferSink:
    """Keeps the last ``maxlen`` events; thread-safe appends, snapshot reads."""

    def __init__(self, maxlen: int = 10_000) -> None:
        self.buf: deque[EventRecord] = deque(maxlen=maxlen)
        self.maxlen = maxlen
        self.last_seq = 0
        self._lock = threading.Lock()

    def emit(self, ev: EventRecord) -> None:
        with self._lock:
            self.buf.append(ev)
            self.last_seq = ev.seq

    def since(self, seq: int, limit: int | None = None) -> list[EventRecord]:
        """Events with ``seq > seq`` currently in the buffer."""
        with self._lock:
            out = [e for e in self.buf if e.seq > seq]
        return out[:limit] if limit else out

    @property
    def first_seq(self) -> int:
        with self._lock:
            return self.buf[0].seq if self.buf else self.last_seq + 1

    def covers(self, since_seq: int) -> bool:
        """True if every event after ``since_seq`` is still buffered."""
        with self._lock:
            if not self.buf:
                return since_seq >= self.last_seq
            return since_seq >= self.buf[0].seq - 1


class FanoutSink:
    """Forwards each event to several sinks."""

    def __init__(self, *sinks: EventSink) -> None:
        self.sinks: list[EventSink] = list(sinks)

    def add(self, sink: EventSink) -> None:
        self.sinks.append(sink)

    def remove(self, sink: EventSink) -> None:
        if sink in self.sinks:
            self.sinks.remove(sink)

    def emit(self, ev: EventRecord) -> None:
        for s in self.sinks:
            s.emit(ev)


class ParquetSink:
    """Buffers events and writes ``events.parquet`` (zstd) on :meth:`flush` / :meth:`close`."""

    def __init__(self, path: str | Path, flush_every: int = 50_000) -> None:
        self.path = Path(path)
        self.rows: list[tuple[int, float, str, str]] = []
        self.flush_every = flush_every
        self._writer: Any = None
        self.count = 0

    def emit(self, ev: EventRecord) -> None:
        self.rows.append((ev.seq, ev.sim_s, ev.type, dumps(ev.data).decode()))
        if len(self.rows) >= self.flush_every:
            self.flush()

    def flush(self) -> None:
        if not self.rows:
            return
        import pyarrow as pa
        import pyarrow.parquet as pq

        seq, t, ty, d = zip(*self.rows, strict=True)
        table = pa.table(
            {
                "seq": pa.array(seq, pa.int64()),
                "sim_s": pa.array(t, pa.float64()),
                "type": pa.array(ty, pa.string()),
                "data": pa.array(d, pa.string()),
            }
        )
        if self._writer is None:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self._writer = pq.ParquetWriter(self.path, table.schema, compression="zstd")
        self._writer.write_table(table)
        self.count += len(self.rows)
        self.rows = []

    def close(self) -> None:
        self.flush()
        if self._writer is not None:
            self._writer.close()
            self._writer = None
