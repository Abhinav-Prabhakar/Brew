"""Decision explainer (technical.md 14.4): top factors + a natural-language note from the template bank.

Templates come from the LLM-generated ``explanations`` dataset (``data/synthetic/clean``) with built-in
fallbacks.  A template is only used when every ``{slot}`` it contains can be filled from the decision's
changes and context - an unfillable template is skipped, and :func:`render` raises ``KeyError`` for an
unknown slot so tests fail loudly.
"""

from __future__ import annotations

import re
from typing import Any

SLOT_RX = re.compile(r"\{(\w+)\}")
TYPE_MAP = {
    "price_change": "price_change", "prep_start": "prep_start", "throttle": "throttle", "hide_item": "hide_item",
    "feature_item": "feature_item", "strategy_switch": "strategy_switch", "reorder": "reorder",
    "replate_markdown": "price_change", "other": "price_change",
}  # fmt: skip
FALLBACK: dict[str, list[tuple[tuple[str, ...], str]]] = {
    "price_change": [
        (("load",), "Moved {item} from Rs{old} to Rs{new}: the kitchen is {load_pct}% busy at {hour}:00."),
        ((), "Moved {item} from Rs{old} to Rs{new} to match demand right now."),
    ],
    "replate": [
        (("stock",), "Put {item} on the Replate menu at {pct}% off: more is left than we expect to sell at full price."),
    ],
    "prep_start": [
        (("stock", "forecast_delta"), "Started {prep_item} (x{qty}): expected demand over the next hours outruns stock."),
    ],
    "throttle": [(("queue",), "Set {channel} to {level}: {orders} orders are open and the queue is {queue} long.")],
    "strategy_switch": [((), "Switched dispatch strategy to {strategy}.")],
    "hide_item": [(("stock",), "Hid {item}: not enough stock left to serve it reliably.")],
    "feature_item": [((), "Featured {item} to steer demand toward what the kitchen can make quickly.")],
    "reorder": [(("stock",), "Ordered {ingredient} from {supplier}: stock would run out before the next delivery.")],
}


class Explainer:
    """Turns a decision record (``world.decisions``) into factors + a sentence."""

    def __init__(self, bank: list[dict[str, Any]] | None = None) -> None:
        self.bank = bank or []
        self._by_type: dict[str, list[dict[str, Any]]] = {}
        for r in self.bank:
            self._by_type.setdefault(r["decision_type"], []).append(r)

    @classmethod
    def from_world(cls, world: Any) -> Explainer:
        return cls(list(getattr(world.corp, "explanations", [])))

    # ------------------------------------------------------------------ slots
    @staticmethod
    def slots_for(rec: dict[str, Any]) -> dict[str, Any]:
        """Slot values available for a decision record."""
        ctx = rec.get("context", {})
        s: dict[str, Any] = {
            "hour": f"{int(ctx.get('hour', 0)):02d}", "load_pct": int(round(ctx.get("load_pct", 0))),
            "load": int(round(ctx.get("load_pct", 0))), "queue": ctx.get("queue", 0), "orders": ctx.get("orders", 0),
            "temp": ctx.get("temp", 0), "rain": ctx.get("rain", 0), "strategy": ctx.get("strategy", ""),
            "wait_min": round(max(0.0, ctx.get("queue", 0) * 0.6), 1), "channel": "delivery",
        }  # fmt: skip
        for f in rec.get("top_factors", []):
            n = f.get("name", "")
            v = f.get("value")
            if n in ("kitchen_load_pct", "load_pct"):
                s["load_pct"] = s["load"] = int(round(v))
            elif n in ("stock", "stock_units", "have", "units"):
                s["stock"] = round(v, 1)
            elif n in ("forecast_delta", "expected_demand_units", "demand"):
                s["forecast_delta"] = round(v, 1)
            elif n == "hours_left":
                s["stock_days"] = round(v / 24.0, 2)
        for ch in rec.get("changes", []):
            for k, v in ch.items():
                if k == "kind":
                    continue
                s.setdefault(k, v)
            if ch.get("kind") == "price":
                s["delta"] = abs(round(ch["new"] - ch["old"]))
                s["old"], s["new"] = int(ch["old"]), int(ch["new"])
            if ch.get("kind") == "replate":
                s["pct"] = int(ch.get("pct", 0))
            if "qty" in ch:
                s["qty"] = int(round(ch["qty"]))
        s.setdefault("stock", "enough")
        s.setdefault("forecast_delta", "+0")
        s.setdefault("p90", "-")
        s.setdefault("reason", "demand")
        return s

    @staticmethod
    def render(template: str, slots: dict[str, Any]) -> str:
        """Fill ``{slots}``; raises ``KeyError`` for a slot that is not provided."""
        return SLOT_RX.sub(lambda m: str(slots[m.group(1)]), template)

    # ---------------------------------------------------------------- explain
    def explain(self, rec: dict[str, Any], tone: str | None = None) -> dict[str, Any]:
        """``{decision_id, summary, top_factors, text, template_id}`` for a decision record."""
        typ = rec["type"]
        key = TYPE_MAP.get(typ, "price_change")
        slots = self.slots_for(rec)
        direction = "down" if any(c.get("kind") == "price" and c["new"] < c["old"] for c in rec.get("changes", [])) else "up"
        factor_names = {f.get("name", "") for f in rec.get("top_factors", [])}
        best: tuple[int, dict[str, Any]] | None = None
        for r in self._by_type.get(key, []):
            need = set(SLOT_RX.findall(r["template"]))
            if not need <= set(slots):
                continue
            if typ == "replate_markdown" and r.get("direction") not in (None, "down"):
                continue
            if key == "price_change" and typ == "price_change" and r.get("direction") not in (None, direction):
                continue
            if tone and r.get("tone") != tone:
                continue
            overlap = len(set(r.get("factors", [])) & (factor_names | {"load", "hour", "queue", "stock", "orders"}))
            if best is None or overlap > best[0]:
                best = (overlap, r)
        if best is not None:
            text = self.render(best[1]["template"], slots)
            tid = best[1]["id"]
        else:
            fk = "replate" if typ == "replate_markdown" else key
            tmpl = FALLBACK.get(fk, FALLBACK["price_change"])
            text = ""
            for _needs, t in tmpl:
                if set(SLOT_RX.findall(t)) <= set(slots):
                    text = self.render(t, slots)
                    break
            tid = "fallback"
            if not text:
                text = rec.get("summary", "")
        return {
            "decision_id": rec["decision_id"], "type": typ, "policy": rec.get("policy", ""), "summary": rec.get("summary", ""),
            "top_factors": rec.get("top_factors", []), "clipped": rec.get("clipped", []), "text": text, "template_id": tid,
            "sim_s": rec.get("sim_s"), "changes": rec.get("changes", []),
        }  # fmt: skip
