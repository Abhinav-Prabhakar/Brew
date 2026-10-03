"""Sim-time helpers. ``sim_s`` = seconds since day-0 00:00 local (Asia/Kolkata)."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

DAY_S = 86400
IST = timezone(timedelta(hours=5, minutes=30))
WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def day_of(sim_s: float) -> int:
    """Day index (0-based) of ``sim_s`` seconds."""
    return int(sim_s // DAY_S)


def tod_s(sim_s: float) -> float:
    """Seconds since local midnight."""
    return sim_s - (sim_s // DAY_S) * DAY_S


def hhmm(sim_s: float) -> str:
    """``HH:MM`` of the local time of day."""
    t = int(tod_s(sim_s))
    return f"{t // 3600:02d}:{(t % 3600) // 60:02d}"


def parse_hhmm(s: str) -> int:
    """``"HH:MM"`` to seconds since midnight."""
    h, m = s.split(":")
    return int(h) * 3600 + int(m) * 60


def _ymd(start_date: str) -> date:
    y, m, d = (int(x) for x in start_date.split("-"))
    return date(y, m, d)


def start_dt(start_date: str) -> datetime:
    d = _ymd(start_date)
    return datetime(d.year, d.month, d.day, tzinfo=IST)


def iso(sim_s: float, start_date: str) -> str:
    """ISO-8601 timestamp in Asia/Kolkata for ``sim_s`` given the day-0 date."""
    dt = start_dt(start_date) + timedelta(seconds=sim_s)
    return dt.isoformat(timespec="milliseconds")


def weekday_of(day: int, start_date: str) -> int:
    """0=Mon..6=Sun for the given day index."""
    return (_ymd(start_date) + timedelta(days=day)).weekday()


def date_of(day: int, start_date: str) -> date:
    return _ymd(start_date) + timedelta(days=day)


def epoch_ms(sim_s: float, start_date: str) -> int:
    return int((start_dt(start_date) + timedelta(seconds=sim_s)).timestamp() * 1000)
