"""Meal combos: two-item bundles priced to lift the average ticket (backend.md 3.12).

A combo's price is derived from its components' *live* prices: ``round_to(sum(prices) x (1 - discount))``, so it
moves whenever a component is repriced (a ``price.changed`` event with ``sku = "combo:<id>"`` is emitted).

Basket rules (applied after the MNL picks, before the Replate add-on):

* **pairing**: a basket that already holds both halves of a combo gets the combo price;
* **up-sell**: a basket holding exactly one half may add the other half at the combo price with probability
  ``min(upsell_max, upsell_base + upsell_per_pct x saving%) x persona_factor`` (one draw per customer from the
  ``combos`` RNG stream, pre-sampled per day, so it is identical across policies: CRN-safe).

Combo units carry a ``~cb:<id>`` marker in their mods tuple (like Replate's ``~rp``); markers start with ``~`` and
are stripped before modifier lookups.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .world import World

CB = "~cb:"  # marker prefix in a unit's mods tuple: this unit is priced as part of combo <id>


def combo_of(mods: tuple[str, ...] | list[str]) -> str | None:
    for m in mods:
        if m.startswith(CB):
            return m[len(CB) :]
    return None


def real_mods(mods: tuple[str, ...] | list[str]) -> tuple[str, ...]:
    """Modifier ids without internal markers (``~rp``, ``~cb:<id>``)."""
    return tuple(m for m in mods if m[:1] != "~")


class Combos:
    def __init__(self, w: World) -> None:
        self.w = w
        self.cfg = w.cfg.combos
        skus = {m.sku for m in w.cfg.menu}
        self.items = {c.id: c for c in self.cfg.combos if all(s in skus for s in c.skus)}
        self.enabled = bool(self.cfg.enabled and self.items)
        self.prices: dict[str, float] = {}
        self.reset_day()

    # ---------------------------------------------------------------- prices
    def _round(self, x: float) -> float:
        r = float(self.cfg.round_to) or 1.0
        return float(round(x / r) * r)

    def list_sum(self, cid: str, base: bool = False) -> float:
        c = self.items[cid]
        return float(sum(self.w.menu[s].base if base else self.w.menu[s].price for s in c.skus))

    def price(self, cid: str) -> float:
        p = self.prices.get(cid)
        return self.compute(cid) if p is None else p

    def compute(self, cid: str, base: bool = False) -> float:
        full = self.list_sum(cid, base)
        return min(full - 1.0, self._round(full * (1.0 - self.items[cid].discount_pct / 100.0)))

    def factor(self, cid: str) -> float:
        """Share of the list price paid for each component of the combo."""
        full = self.list_sum(cid)
        return self.price(cid) / full if full > 0 else 1.0

    def available(self, cid: str, delivery: bool = False) -> bool:
        w = self.w
        for s in self.items[cid].skus:
            ms = w.menu[s]
            if ms.hidden is not None:
                return False
            if delivery and not w.ix.menu[s].deliverable:
                return False
        return True

    def refresh(self, reason: str = "", by: str = "system", announce: bool = True) -> None:
        """Re-derive every combo price from the live component prices; emit ``price.changed`` on a change."""
        for cid in self.items:
            new = self.compute(cid)
            old = self.prices.get(cid)
            self.prices[cid] = new
            if announce and old is not None and abs(new - old) > 1e-9:
                self.w.emit(
                    "price.changed", sku=f"combo:{cid}", old=old, new=new, base=self.compute(cid, base=True),
                    dir="up" if new > old else "down", reason_text=reason or "combo repriced", by=by,
                )  # fmt: skip

    # ---------------------------------------------------------------- baskets
    def mark_basket(
        self, items: list[tuple[str, tuple[str, ...]]], persona: str, u: float, delivery: bool
    ) -> list[tuple[str, tuple[str, ...]]]:
        """Pair complete combos and maybe up-sell the missing half (see module docstring)."""
        if not self.enabled or not items:
            return items
        free = [i for i, (_, mods) in enumerate(items) if not any(m[:1] == "~" for m in mods)]
        # 1) pairing: both halves already in the basket
        for cid, c in self.items.items():
            a, b = c.skus
            ia = next((i for i in free if items[i][0] == a), None)
            ib = next((i for i in free if items[i][0] == b), None)
            if ia is not None and ib is not None and self.available(cid, delivery):
                for i in (ia, ib):
                    items[i] = (items[i][0], (*items[i][1], CB + cid))
                    free.remove(i)
                self.paired_today += 1
                return items  # one combo per basket keeps the ticket readable
        # 2) up-sell: exactly one half present -> offer the other half at the combo price
        best: tuple[float, str, int, str] | None = None
        for cid, c in self.items.items():
            if not self.available(cid, delivery):
                continue
            for k, s in enumerate(c.skus):
                hit = next((x for x in free if items[x][0] == s), None)
                if hit is None:
                    continue
                other = c.skus[1 - k]
                saving = 1.0 - self.factor(cid)
                if best is None or saving > best[0]:
                    best = (saving, cid, hit, other)
        if best is None:
            return items
        saving, cid, i, other = best
        p = min(self.cfg.upsell_max, self.cfg.upsell_base + self.cfg.upsell_per_pct * saving * 100.0)
        p *= float(self.cfg.persona_factor.get(persona, 1.0))
        if u < p:
            items[i] = (items[i][0], (*items[i][1], CB + cid))
            items.append((other, (CB + cid,)))
            self.upsold_today += 1
            self.upsell_units_today += 1
            self.upsell_sku_list.append(other)
        return items

    def record_order(self, o: Any) -> None:
        """KPIs for a committed order (combo revenue = what was paid for combo-marked lines)."""
        seen = False
        for ln in o.lines:
            if ln.get("combo"):
                self.combo_revenue_today += ln["unit_price"] * ln["qty"]
                seen = True
        if seen:
            self.combo_orders_today += 1

    # ---------------------------------------------------------------- day / read side
    def reset_day(self) -> None:
        self.paired_today = 0
        self.upsold_today = 0
        self.upsell_units_today = 0
        self.upsell_sku_list: list[str] = []
        self.combo_orders_today = 0
        self.combo_revenue_today = 0.0
        if self.enabled:
            self.refresh(announce=False)

    def kpis(self) -> dict[str, Any]:
        return {
            "combo_orders": self.combo_orders_today,
            "combo_revenue": round(self.combo_revenue_today, 2),
            "combo_upsells": self.upsold_today,
            "combo_paired": self.paired_today,
        }

    def menu_json(self) -> list[dict[str, Any]]:
        out = []
        for cid, c in self.items.items():
            full = self.list_sum(cid)
            price = self.price(cid)
            out.append(
                {
                    "id": cid, "sku": f"combo:{cid}", "name": c.name, "tagline": c.tagline, "skus": list(c.skus),
                    "price": price, "base": self.compute(cid, base=True), "list_price": full,
                    "saving": round(full - price, 2), "discount_pct": c.discount_pct,
                    "available": self.available(cid),
                }
            )  # fmt: skip
        return out
