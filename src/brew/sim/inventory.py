"""Perishable inventory: lots, FEFO, open/expiry, BOM resolution, auto-86 support."""

from __future__ import annotations

from typing import TYPE_CHECKING

from brew.config.schemas import CafeConfig, ConfigIndex

from .state import Lot

if TYPE_CHECKING:
    from .world import World

EPS = 1e-9


class InsufficientStock(Exception):
    """Raised by :meth:`Inventory.consume` when ``partial`` is False and stock is short."""


class Inventory:
    """Lots per key (ingredients and prep items share one key space), FEFO consumption.

    Conservation invariant per key (base units):
    ``initial + receive - consume - waste - donate == on_hand``.
    """

    def __init__(self, w: World | None, cfg: CafeConfig) -> None:
        self.w = w
        self.cfg = cfg
        ix = ConfigIndex.of(cfg)
        self.lots: dict[str, list[Lot]] = {}
        self.onhand: dict[str, float] = {}
        self.mov: dict[str, dict[str, float]] = {}
        self.cost_consumed: dict[str, float] = {}
        self.shelf_sealed: dict[str, float] = {}
        self.shelf_opened: dict[str, float] = {}
        self.unit_cost: dict[str, float] = {}
        self.is_pack: dict[str, bool] = {}
        self.weight_g: dict[str, float] = {}
        self.finished: set[str] = set()
        self.pc: dict[str, bool] = {}
        self.lot_seq = 0
        self.cost_mult = 1.0  # price_shock disruption
        self.stock_dirty: set[str] = set()
        for i in cfg.ingredients:
            self._register(
                i.key,
                i.shelf_life_sealed_h,
                i.shelf_life_opened_h,
                i.unit_cost,
                i.is_packaging,
                i.unit_weight_g,
            )
            self.pc[i.key] = i.base_uom == "pc"
            if i.finished_good:
                self.finished.add(i.key)
        for p in cfg.prep_items:
            hold_h = p.hold_time_min / 60.0
            cost = 0.0
            for c in p.components:
                cost += c.qty * ix.ingredient[c.ingredient].unit_cost
            self._register(p.key, hold_h, hold_h, cost / max(1.0, p.batch_size), False, p.unit_weight_g)
            self.pc[p.key] = p.base_uom == "pc"
            if p.finished_good:
                self.finished.add(p.key)
        # sku -> keys used by its base bom (for availability checks), and reverse
        self.sku_keys: dict[str, tuple[tuple[str, float], ...]] = {}
        self.key_skus: dict[str, list[str]] = {}
        self._bom_cache: dict[tuple[str, tuple[str, ...], bool], tuple[tuple[str, float, bool], ...]] = {}
        for m in cfg.menu:
            comps = tuple((k, q) for k, q, pack in self.bom(m.sku, (), False) if not pack and k in self.mov)
            self.sku_keys[m.sku] = comps
            for k, _q in comps:
                self.key_skus.setdefault(k, []).append(m.sku)
        # --- Replate: virtual keys for make-ahead plates and the set of tracked (replate-able) keys
        self.virtual: set[str] = set()
        self.tracked: set[str] = set()
        self.premade_key: dict[str, str] = {}  # sku -> virtual make-ahead key
        for m in cfg.menu:
            rp = m.replate
            if not rp.eligible:
                continue
            if rp.stock_key:
                self.tracked.add(rp.stock_key)
                continue
            key = "pm_" + m.sku
            food = [(k, q) for k, q, pack in self.bom(m.sku, (), False) if not pack]
            cost = sum(q * self.unit_cost[k] for k, q in food)
            grams = sum(q * self.weight_g[k] for k, q in food)
            hold_h = rp.premake_hold_s / 3600.0
            self._register(key, hold_h, hold_h, cost, False, max(20.0, min(600.0, grams)))
            self.finished.add(key)
            self.pc[key] = True
            self.virtual.add(key)
            self.tracked.add(key)
            self.premade_key[m.sku] = key
            self.key_skus.setdefault(key, []).append(m.sku)

    def _register(
        self, key: str, sealed_h: float, opened_h: float, cost: float, pack: bool, wt: float
    ) -> None:
        self.lots[key] = []
        self.onhand[key] = 0.0
        self.mov[key] = {
            "initial": 0.0, "receive": 0.0, "consume": 0.0, "waste": 0.0, "donate": 0.0, "waste_replate": 0.0,
        }  # fmt: skip
        self.cost_consumed[key] = 0.0
        self.shelf_sealed[key] = sealed_h
        self.shelf_opened[key] = opened_h
        self.unit_cost[key] = cost
        self.is_pack[key] = pack
        self.weight_g[key] = wt

    # ------------------------------------------------------------------ bom
    def bom(self, sku: str, mods: tuple[str, ...], carry: bool) -> tuple[tuple[str, float, bool], ...]:
        """Resolved bill of materials: ``(key, qty, is_packaging_or_ware)`` for one unit.

        Returnable ware (ceramic cups, plates) is *not* included (handled by the dish pool);
        ``carry`` selects paper packaging, otherwise dine-in ware.
        """
        ck = (sku, mods, carry)
        hit = self._bom_cache.get(ck)
        if hit is not None:
            return hit
        r = self.cfg.recipes.recipes[sku]
        comps: dict[str, float] = {}
        packs: set[str] = set()
        want = "carry" if carry else "dine_in"

        def add(c_ing: str, qty: float, when: str, returnable: bool, pack: bool) -> None:
            if returnable or when not in ("always", want):
                return
            comps[c_ing] = comps.get(c_ing, 0.0) + qty
            if pack:
                packs.add(c_ing)

        for c in r.components:
            add(c.ingredient, c.qty, c.when, c.returnable, False)
        if r.pack:
            for c in self.cfg.recipes.packaging[r.pack]:
                add(c.ingredient, c.qty, c.when, c.returnable, True)
        mods_by_id = ConfigIndex.of(self.cfg).mod
        for mid in mods:
            for d in mods_by_id[mid].recipe_delta:
                if d.replace:
                    a, b = d.replace["from"], d.replace["to"]
                    if a in comps:
                        comps[b] = comps.get(b, 0.0) + comps.pop(a)
                elif d.add:
                    k = d.add["ingredient"]
                    comps[k] = comps.get(k, 0.0) + float(d.add["qty"])
                elif d.remove:
                    comps.pop(d.remove, None)
                elif d.scale:
                    k = d.scale["ingredient"]
                    if k in comps:
                        comps[k] *= float(d.scale["factor"])
        out = tuple((k, q, k in packs or self.is_pack.get(k, False)) for k, q in comps.items())
        self._bom_cache[ck] = out
        return out

    # ------------------------------------------------------------------ lots
    def _new_lot_id(self) -> str:
        self.lot_seq += 1
        return f"lot-{self.lot_seq:06d}"

    def add_lot(
        self,
        key: str,
        qty: float,
        now: float,
        unit_cost: float | None = None,
        kind: str = "receive",
        shelf_h: float | None = None,
    ) -> Lot:
        """Add stock. ``kind`` is ``initial`` or ``receive`` (PO, prep yield, top-up)."""
        if qty <= 0:
            raise ValueError("qty must be positive")
        cost = self.unit_cost[key] if unit_cost is None else unit_cost
        sh = self.shelf_sealed[key] if shelf_h is None else shelf_h
        lot = Lot(self._new_lot_id(), key, qty, qty, cost, now, now + sh * 3600.0)
        lots = self.lots[key]
        lots.append(lot)
        lots.sort(key=lambda lt: (lt.expires_s, lt.received_s, lt.lot_id))
        self.onhand[key] += qty
        self.mov[key]["initial" if kind == "initial" else "receive"] += qty
        self.stock_dirty.add(key)
        if key in self.tracked and self.w is not None:
            rp = getattr(self.w, "replate", None)
            if rp is not None:
                rp.on_lot_added(key, lot)
        return lot

    def usable(self, key: str, now: float) -> float:
        """On-hand quantity in lots that have not expired at ``now``."""
        return sum(lt.qty for lt in self.lots[key] if lt.expires_s > now)

    def consume(self, key: str, qty: float, now: float, partial: bool = False) -> tuple[float, float, float]:
        """Consume ``qty`` FEFO. Returns ``(consumed, cost_inr, mean_quality)``.

        Opening a lot recalculates its expiry to ``min(expires, opened + opened_shelf_life)``.
        Raises :class:`InsufficientStock` if short and ``partial`` is False (nothing consumed).
        """
        if qty <= 0:
            return 0.0, 0.0, 1.0
        lots = self.lots[key]
        avail = 0.0
        for lt in lots:
            if lt.expires_s > now:
                avail += lt.qty
        if avail + EPS < qty and not partial:
            raise InsufficientStock(key)
        need = min(qty, avail)
        got = 0.0
        cost = 0.0
        qsum = 0.0
        reorder = False
        rp = getattr(self.w, "replate", None) if key in self.tracked and self.w is not None else None
        for lt in list(lots):
            if need <= EPS:
                break
            if lt.expires_s <= now or lt.qty <= 0:
                continue
            take = min(lt.qty, need)
            if lt.opened_s is None:
                lt.opened_s = now
                exp2 = min(lt.expires_s, now + self.shelf_opened[key] * 3600.0)
                if exp2 != lt.expires_s:
                    lt.expires_s = exp2
                    reorder = True
                if self.w is not None:
                    self.w.on_lot_opened(key, lt)
            span = max(1.0, lt.expires_s - lt.received_s)
            q = max(0.5, 1.0 - 0.5 * ((now - lt.received_s) / span))
            lt.qty -= take
            need -= take
            got += take
            cost += take * lt.unit_cost
            qsum += q * take
            if rp is not None:
                rp.on_take(lt, take)
        if reorder:
            lots.sort(key=lambda lt: (lt.expires_s, lt.received_s, lt.lot_id))
        self.lots[key] = [lt for lt in lots if lt.qty > EPS]
        self.onhand[key] -= got
        self.mov[key]["consume"] += got
        self.cost_consumed[key] += cost
        self.stock_dirty.add(key)
        return got, cost, (qsum / got if got > 0 else 1.0)

    def can_supply(self, items: list[tuple[str, float]], now: float) -> bool:
        """True if every ``(key, qty)`` can be consumed right now (aggregating duplicates)."""
        need: dict[str, float] = {}
        for k, q in items:
            need[k] = need.get(k, 0.0) + q
        return all(self.usable(k, now) + EPS >= q for k, q in need.items())

    def sweep_expired(self, now: float) -> list[tuple[str, Lot, float]]:
        """Remove expired lots (booked as waste). Returns ``(key, lot, cost)`` tuples."""
        out: list[tuple[str, Lot, float]] = []
        for key, lots in self.lots.items():
            if not lots or lots[0].expires_s > now:
                continue
            keep = []
            rp = getattr(self.w, "replate", None) if key in self.tracked and self.w is not None else None
            for lt in lots:
                if lt.expires_s <= now and lt.qty > EPS:
                    self.onhand[key] -= lt.qty
                    listed = rp is not None and rp.lot_is_listed(lt)
                    self.mov[key]["waste_replate" if listed else "waste"] += lt.qty
                    out.append((key, lt, lt.qty * lt.unit_cost))
                    self.stock_dirty.add(key)
                    if rp is not None:
                        rp.on_retire(lt, lt.qty, "wasted")
                else:
                    keep.append(lt)
            self.lots[key] = keep
        return out

    def remove(self, key: str, qty: float, kind: str, now: float) -> float:
        """Write off ``qty`` FEFO as ``waste`` or ``donate``; returns cost INR."""
        lots = self.lots[key]
        need = min(qty, self.onhand[key])
        cost = 0.0
        for lt in list(lots):
            if need <= EPS:
                break
            take = min(lt.qty, need)
            lt.qty -= take
            need -= take
            cost += take * lt.unit_cost
            self.mov[key][kind] += take
            self.onhand[key] -= take
            if key in self.tracked and self.w is not None and getattr(self.w, "replate", None) is not None:
                self.w.replate.on_retire(lt, take, "donated" if kind == "donate" else "wasted")
        self.lots[key] = [lt for lt in lots if lt.qty > EPS]
        self.stock_dirty.add(key)
        return cost

    def donatable(self, now: float, horizon_h: float = 24.0) -> list[tuple[str, Lot]]:
        """Sealed finished-goods lots with < ``horizon_h`` of shelf life left."""
        out = []
        for key in sorted(self.finished):
            if key in self.virtual:
                continue
            for lt in self.lots[key]:
                if lt.opened_s is None and 0 < lt.expires_s - now < horizon_h * 3600.0 and lt.qty > EPS:
                    out.append((key, lt))
        return out

    def donate_lot(self, key: str, lot: Lot) -> float:
        """Donate the remaining quantity of ``lot``; returns the cost written off."""
        qty = lot.qty
        cost = qty * lot.unit_cost
        lot.qty = 0.0
        self.mov[key]["donate"] += qty
        if key in self.tracked and self.w is not None:
            rp = getattr(self.w, "replate", None)
            if rp is not None:
                rp.on_retire(lot, qty, "donated")
        self.onhand[key] -= qty
        self.lots[key] = [lt for lt in self.lots[key] if lt.qty > EPS]
        self.stock_dirty.add(key)
        return cost

    def kg_of(self, key: str, qty: float) -> float:
        """Weight in kg of ``qty`` base units of ``key``."""
        return qty * self.weight_g[key] / 1000.0 if self.pc.get(key) else qty / 1000.0

    def bom_premade(self, sku: str, carry: bool) -> tuple[tuple[str, float, bool], ...]:
        """BOM of a unit served from make-ahead stock: the pm key plus serving packaging."""
        ck = (sku, ("~pm",), carry)
        hit = self._bom_cache.get(ck)
        if hit is not None:
            return hit
        out = [(self.premade_key[sku], 1.0, False)]
        out += [(k, q, p) for k, q, p in self.bom(sku, (), carry) if p]
        res = tuple(out)
        self._bom_cache[ck] = res
        return res

    # ------------------------------------------------------------ analytics
    def check_conservation(self, tol: float = 1e-6) -> dict[str, float]:
        """Return keys violating the conservation invariant (empty dict = OK)."""
        bad = {}
        for k, m in self.mov.items():
            calc = m["initial"] + m["receive"] - m["consume"] - m["waste"] - m["donate"] - m["waste_replate"]
            lots_sum = sum(lt.qty for lt in self.lots[k])
            if (
                abs(calc - self.onhand[k]) > tol
                or abs(lots_sum - self.onhand[k]) > tol
                or self.onhand[k] < -tol
            ):
                bad[k] = calc - self.onhand[k]
        return bad

    def sku_available(self, sku: str, now: float) -> bool:
        """Can one unit of ``sku`` (base recipe, no mods) be made from non-expired stock?"""
        if all(self.usable(k, now) + EPS >= q for k, q in self.sku_keys[sku]):
            return True
        pk = self.premade_key.get(sku)
        return pk is not None and self.usable(pk, now) >= 1.0 - EPS

    def value_expiring(self, now: float, within_s: float) -> float:
        """INR value of stock expiring within ``within_s`` seconds."""
        v = 0.0
        for lots in self.lots.values():
            for lt in lots:
                if lt.expires_s - now <= within_s:
                    v += lt.qty * lt.unit_cost
        return v

    def days_of_cover(self, key: str, daily_use: float) -> float:
        return self.onhand[key] / daily_use if daily_use > 0 else 99.0
