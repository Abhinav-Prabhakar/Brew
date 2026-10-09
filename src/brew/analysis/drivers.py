"""Short, plain-word drivers for price reasons (kept free of sklearn so the sim can import it)."""

from __future__ import annotations

from typing import Any

# plain 1-3 word labels for the price reason chips (feature-name prefix -> label; longest prefix wins)
SHORT_LABELS = {
    "tod": "time of day", "dow": "weekday", "wx_rain": "rain", "wx_drizzle": "rain", "wx": "weather", "temp": "temperature",
    "cal": "calendar", "demand": "demand", "nowcast": "demand", "open": "open orders", "slack": "order slack",
    "low_patience": "waiting guests", "register": "till queue", "util": "kitchen load", "queue": "kitchen queue",
    "down": "equipment", "staff": "staffing", "fatigue": "staff fatigue", "tables": "tables", "cover": "stock cover",
    "expiring": "expiring stock", "prep": "prep stock", "price_index": "price level", "profit": "profit today",
    "cash": "cash", "rep": "rating", "price_changes": "recent changes", "dis": "disruption", "kappa": "service level",
    "strategy": "dispatch", "throttle": "throttle", "batch": "batching", "replate": "rescue shelf",
    "episode": "time of day", "is_weekend": "weekend",
}  # fmt: skip


def short_label(name: str) -> str:
    """Two-three plain words for an observation feature name (``util_espresso`` -> 'kitchen load')."""
    best = ""
    for k in SHORT_LABELS:
        if (name == k or name.startswith(k + "_") or name.startswith(k)) and len(k) > len(best):
            best = k
    if best:
        return SHORT_LABELS[best]
    return " ".join(name.split("_")[:2])


def short_drivers(factors: list[dict[str, Any]], dim_prefix: str | None = None, top: int = 3) -> list[dict[str, Any]]:
    """Up to ``top`` ``{name, label, value}`` drivers (value clipped to -1..1) from a decision's factors.

    ``dim_prefix`` (e.g. ``"price_"``) puts the factors of the matching action dimension first. Labels are unique.
    """
    ok = [f for f in factors if isinstance(f, dict) and "name" in f and "value" in f]
    ok = [f for f in ok if abs(float(f["value"])) >= 0.01] or ok  # a driver that reads 0 says nothing
    ordered = sorted(ok, key=lambda f: 0 if dim_prefix and str(f.get("dim", "")).startswith(dim_prefix) else 1)
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for f in ordered:
        label = short_label(str(f["name"]))
        if label in seen:
            continue
        seen.add(label)
        v = max(-1.0, min(1.0, float(f["value"])))
        out.append({"name": str(f["name"]), "label": label, "value": round(v, 2)})
        if len(out) >= top:
            break
    return out
