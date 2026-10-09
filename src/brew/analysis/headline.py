"""Plain-English one-line headlines for ``decision.made`` (<= 60 chars, built from structured content)."""

from __future__ import annotations

from typing import Any

MAX_LEN = 60
RUPEE = "₹"

DIS_LABEL = {
    "equipment_down": "{t} down", "staff_absent": "{t} out", "staff_late": "{t} late",
    "supplier_delay": "{t} delivery late", "supplier_short": "{t} short-shipping", "rain_storm": "rain storm",
    "rider_shortage": "riders short", "power_cut": "power cut", "platform_outage": "delivery apps down",
    "demand_spike": "demand spike", "price_shock": "costs spiking",
}  # fmt: skip


def clean(s: str) -> str:
    return s.replace("_", " ").strip().lower()


def disruption_label(kind: str, target: str | None, w: Any = None) -> str:
    """Short phrase for a disruption, e.g. 'espresso down', 'barista 1 out'."""
    t = clean(target or "")
    if w is not None and target and kind in ("staff_absent", "staff_late"):
        st = w.kitchen.staff.get(target)
        t = clean(getattr(st, "name", "") or target)
    tmpl = DIS_LABEL.get(kind, clean(kind))
    return tmpl.format(t=t or "equipment") if "{t}" in tmpl else tmpl


def qty_text(qty: float, uom: str) -> str:
    if uom == "g" and qty >= 1000:
        return f"{qty / 1000:.3g} kg"
    if uom == "ml" and qty >= 1000:
        return f"{qty / 1000:.3g} L"
    if uom == "pc":
        return f"{qty:.0f} pcs"
    return f"{qty:.0f} {uom}"


def thr_phrase(channel: str, level: str) -> str:
    ch = clean(channel)
    if level == "pause":
        return f"pause {ch} orders"
    if level == "open":
        return f"reopen {ch} orders"
    return f"{ch} quotes +{level.removeprefix('plus')} min"


def money_delta(d: float) -> str:
    return f"{'+' if d >= 0 else '-'}{RUPEE}{abs(round(d)):d}"


def fit(text: str, limit: int = MAX_LEN) -> str:
    if len(text) <= limit:
        return text
    cut = text[: limit - 1]
    sp = cut.rfind(" ")
    if sp >= limit // 2:
        cut = cut[:sp]
    return cut.rstrip(" ,;:→-") + "…"


def compose(
    phrases: list[tuple[int, str]],
    label: str | None = None,
    load_pct: float = 0.0,
    clipped: bool = False,
) -> str:
    """Join the highest-priority phrases so the result fits 60 chars; prefix the disruption label if reacting."""
    ps = list(dict.fromkeys(p for _, p in sorted(phrases, key=lambda x: x[0])))
    if not ps:
        body = "charter limits blocked the change" if clipped else "no change needed"
        return fit(f"{label}: {body}" if label else body)
    pre = f"{label} → " if label else ""
    for n in (3, 2, 1):
        s = pre + ", ".join(ps[:n])
        if len(s) <= MAX_LEN:
            if len(ps) == 1 and not label and ps[0].startswith("nudge") and load_pct >= 70:
                extra = f": kitchen at {load_pct:.0f}%"
                if len(s + extra) <= MAX_LEN:
                    s += extra
            return s
    return fit(pre + ps[0])
