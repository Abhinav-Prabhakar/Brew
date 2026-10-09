"""Per-station load rows and per-staff status rows (``station.load`` / ``staff.status`` events, snapshot, read models).

Cheap by design: one pass over stations, equipment, ready tasks and staff (O(stations + staff + ready)). Utilisation is
the mean of the last 15 per-sim-minute occupancy samples (no RNG, no engine events of its own: it piggybacks on the
minute clock).
"""

from __future__ import annotations

from collections import deque
from typing import TYPE_CHECKING, Any

from brew.domain.timeutil import hhmm

from .state import T_READY

if TYPE_CHECKING:
    from .world import World

WINDOW_MIN = 15  # utilisation window, sim minutes (= samples)


class Loadboard:
    """Rolling station occupancy plus row builders."""

    def __init__(self, w: World) -> None:
        self.w = w
        self.samples: dict[str, deque[float]] = {k: deque(maxlen=WINDOW_MIN) for k in w.kitchen.stations}

    def _occupancy(self, key: str) -> tuple[float, int, int]:
        """(busy share 0..1, slots in use or staff working, total slots) of one station right now."""
        k = self.w.kitchen
        st = k.stations[key]
        slots = used = 0
        for ei in st.eq:
            e = k.equip[ei]
            slots += e.slots
            used += e.slots_used
        if slots > 0:
            return min(1.0, used / slots), used, slots
        att = 0.0
        for s in k.staff_list:
            for t in s.active:
                if t.station == key:
                    att += t.attention / max(1, t.batch_n)
        return min(1.0, att / max(1, st.max_staff)), len(st.staff_active), 0

    def sample(self) -> None:
        """Record one occupancy sample per station (called every sim minute)."""
        for key, dq in self.samples.items():
            dq.append(self._occupancy(key)[0])

    def station_rows(self) -> list[dict[str, Any]]:
        """One row per station: util (15 sim-min mean, 0..1), queue, in_use, slots, status, down_until_s."""
        k = self.w.kitchen
        queued: dict[str, int] = {}
        for t in k.ready:
            if t.state == T_READY:
                queued[t.station] = queued.get(t.station, 0) + 1
        rows = []
        for key, st in k.stations.items():
            _busy, in_use, slots = self._occupancy(key)
            dq = self.samples[key]
            util = round(sum(dq) / len(dq), 3) if dq else 0.0
            eqs = [k.equip[i] for i in st.eq]
            down = bool(eqs) and not any(e.up for e in eqs)
            rows.append(
                {
                    "station": key, "util": util, "queue": queued.get(key, 0), "in_use": in_use, "slots": slots,
                    "status": "down" if down else "up",
                    "down_until_s": round(max(e.down_until for e in eqs), 1) if down else None,
                }
            )  # fmt: skip
        return rows

    def staff_rows(self) -> list[dict[str, Any]]:
        """One row per staff member: fatigue, station/task (when working), state, break_due_s, break_end_s."""
        out = []
        for s in self.w.kitchen.staff_list:
            if s.absent:
                state = "absent"
            elif not s.present:
                state = "off"
            elif s.on_break:
                state = "break"
            elif s.active:
                state = "working"
            else:
                state = "idle"
            out.append(
                {
                    "staff_id": s.key, "fatigue": round(s.fatigue, 3),
                    "station": s.station if state == "working" else None,
                    "task": s.task_name if state == "working" else None,
                    "state": state, "break_due_s": break_due_s(s),
                    "break_end_s": round(s.break_end_s, 1) if s.on_break else None,
                }
            )  # fmt: skip
        return out

    def any_staff_present(self) -> bool:
        return any(s.present for s in self.w.kitchen.staff_list)


def break_due_s(s: Any) -> float | None:
    """Next scheduled break start (sim s); None when the break is done or the person has none."""
    if s.break_min <= 0 or s.break_done or s.on_break:
        return None
    return round(s.break_at_s, 1)


def break_rule(s: Any) -> str | None:
    """Human description of the enforced break policy, derived from the staff config (one break per shift)."""
    if s.break_min <= 0:
        return None
    return (
        f"{s.break_min:g} min break from {hhmm(s.break_at_s)}, "
        "starting as soon as the current task is finished (no fatigue trigger)"
    )
