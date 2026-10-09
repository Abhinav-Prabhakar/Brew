"""Calendar events -> per-slot demand multipliers (persona / channel / category)."""

from __future__ import annotations

from datetime import date

from brew.config.schemas import CalendarEvent
from brew.domain.timeutil import parse_hhmm

SLOTS = 96  # 15-minute slots per day


class Calendar:
    """Holds dated events and resolves them for a given date."""

    def __init__(self, events: list[CalendarEvent]) -> None:
        self.events = events
        self._by_date: dict[str, list[CalendarEvent]] = {}

    def active(self, d: date) -> list[CalendarEvent]:
        key = d.isoformat()
        hit = self._by_date.get(key)
        if hit is None:
            hit = [e for e in self.events if e.date <= key <= e.end_date]
            self._by_date[key] = hit
        return hit

    def day_arrays(self, d: date) -> dict[str, dict[str, list[float]]]:
        """Multipliers per slot: ``{"persona": {p: [96]}, "channel": {...}, "category": {...}}``.

        Only keys touched by an active event are present (callers default to 1.0).
        """
        out: dict[str, dict[str, list[float]]] = {"persona": {}, "channel": {}, "category": {}}
        for e in self.active(d):
            s0, s1 = 0, SLOTS
            if e.start_time:
                s0 = parse_hhmm(e.start_time) // 900
            if e.end_time:
                s1 = min(SLOTS, parse_hhmm(e.end_time) // 900 + 1)
            for kind, mults in e.multipliers.items():
                if kind not in out:
                    continue
                for key, v in mults.items():
                    arr = out[kind].setdefault(key, [1.0] * SLOTS)
                    for s in range(s0, s1):
                        arr[s] *= v
        return out

    def flags(self, d: date) -> dict[str, bool]:
        """Calendar flags for the observation/forecast features."""
        ev = self.active(d)
        kinds = {e.kind for e in ev}
        return {
            "holiday": bool(kinds & {"public_holiday", "festival", "long_weekend"}),
            "cricket": "cricket_match" in kinds,
            "exam": "exam_season" in kinds,
            "payday": "payday" in kinds or d.day in (1, 2, 30, 31),
        }

    def names(self, d: date) -> list[str]:
        return [e.name for e in self.active(d)]
