"""Opening-hours override for live worlds (``BREW_HOURS="07:00-24:00"``): try the café at other hours.

The committed config (08:00-22:00) is what policy D was trained on and what the tests, fixtures and arena numbers
assume, so it never changes. This builds a copy of the config for live worlds only:

- ``cafe.open`` / ``cafe.close`` move to the new hours (``24:00`` means "until midnight": 23:59, so the day never
  closes on the next day's first second);
- the opening crew starts 15 min before the new opening, the closing crew stays until 15 min after the new close;
- each persona's demand curve is stretched to the new hours: the first listed level is held from the new opening,
  the last from the old close to the new close (otherwise the extra hours would be open but empty).

The learned policy has never seen these hours; it still runs, but treat its decisions there as out of distribution.
"""

from __future__ import annotations

from brew.config.schemas import CafeConfig
from brew.domain.timeutil import parse_hhmm

LAST = 23 * 3600 + 59 * 60  # 23:59


def _hm(s: int) -> str:
    s = max(0, min(LAST, s))
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}"


def parse_hours(spec: str) -> tuple[int, int]:
    """``"07:00-24:00"`` → (open_s, close_s), close clamped to 23:59; raises ValueError when malformed."""
    try:
        a, b = (x.strip() for x in spec.split("-"))
        o, c = parse_hhmm(a), min(LAST, parse_hhmm(b))
    except Exception as e:
        raise ValueError(f"BREW_HOURS must look like 07:00-24:00, got {spec!r}") from e
    if not 0 <= o < c:
        raise ValueError(f"BREW_HOURS: opening {a} must be before closing {b}")
    return o, c


def with_hours(cfg: CafeConfig, spec: str) -> CafeConfig:
    """A copy of ``cfg`` open ``spec`` (see the module docstring); ``cfg`` itself is untouched (frozen)."""
    o, c = parse_hours(spec)
    old_o, old_c = cfg.cafe.open_s, cfg.cafe.close_s
    staff = []
    for m in cfg.staff:
        s0, s1 = parse_hhmm(m.shift[0]), parse_hhmm(m.shift[1])
        if s0 <= old_o + 1800:  # opening crew
            s0 = min(s0, o - 900)
        if s1 >= old_c - 3600:  # closing crew
            s1 = max(s1, c + 900)
        staff.append(m.model_copy(update={"shift": (_hm(s0), _hm(s1))}))
    personas = {}
    for k, p in cfg.personas.items():
        arr: dict[str, dict[str, float]] = {}
        for daytype, pts in p.arrivals.items():
            pts2 = dict(pts)
            times = sorted(parse_hhmm(t) for t in pts)
            first, last = times[0], times[-1]
            if o + 1800 < first:
                pts2[_hm(o + 1800)] = pts[_hm(first)]
            if last >= old_c - 3 * 3600 and c - 1800 > last:  # an evening curve: carry its level to the new close
                pts2[_hm(c - 1800)] = pts[_hm(last)]
            arr[daytype] = pts2
        personas[k] = p.model_copy(update={"arrivals": arr})
    return cfg.model_copy(update={
        "cafe": cfg.cafe.model_copy(update={"open": _hm(o), "close": _hm(c)}),
        "staff": tuple(staff), "personas": personas,
    })  # fmt: skip
