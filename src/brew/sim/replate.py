"""Replate (rescue menu): make-ahead stock, markdown ladder, listings (technical.md 7.11, backend.md 3.11).

Food that was made ahead of demand and nears the end of its safe hold window is listed at a heavy,
monotone markdown instead of being thrown away.  Two kinds of lots are tracked:

* **stock-backed** lots - inventory lots of finished goods (``croissant_baked``, bought-in muffins, ...);
* **make-ahead** lots - plates / bottled cold brew produced by ``premake`` and held under a virtual
  inventory key ``pm_<sku>`` so FEFO, expiry and conservation come for free.

Per-lot unit invariant: ``units0 == sold_full + sold_replate + remade + donated + wasted + remaining``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from brew.domain.timeutil import tod_s
from brew.policies.charter import CharterViolation

from .state import Lot

if TYPE_CHECKING:
    from .world import World

RP = "~rp"  # marker in a unit's mods tuple: this unit is priced via a replate listing
PM_PREFIX = "pm_"
MODES = ("off", "gentle", "standard", "aggressive")
CUSTOM = "custom"  # policy-driven per-lot markdown (no automatic ladder)
EPS = 1e-6


def strip_rp(mods: tuple[str, ...]) -> tuple[str, ...]:
    """Modifiers without the replate marker."""
    return tuple(m for m in mods if m != RP)


class ReplateError(Exception):
    """Base for replate action failures."""


class ReplateInvalid(ReplateError):
    """Nothing to act on in the current state (HTTP 409)."""


class ReplateBadPayload(ReplateError):
    """Malformed / ineligible request (HTTP 422)."""


@dataclass(slots=True, eq=False)
class PreLot:
    """Unit accounting for one make-ahead / finished-goods lot."""

    lot_id: str
    sku: str
    key: str
    units0: float
    made_s: float
    unit_cost: float
    lot: Lot
    sell_by: float = 0.0  # last time the lot can be sold (closing time / donation point), <= lot expiry
    sold_full: float = 0.0
    sold_replate: float = 0.0
    cap_until: float = 1e18  # the listing closes once sold_replate reaches this (a "rescue bag" of N units)
    remade: float = 0.0
    donated: float = 0.0
    wasted: float = 0.0
    discount_pct: float = 0.0
    price: float = 0.0  # current listing price (0 = not listed)
    listed: bool = False
    retired: bool = False
    marks: int = 0
    revenue: float = 0.0
    mark_by: str = ""
    per_unit: float = 1.0  # backing-lot quantity per dish unit (prep-backed lots; 1 for finished goods)
    backed: bool = False  # prep-backed listing: the lot is a prepped intermediate / perishable, not the dish
    window_s: float = 0.0  # hold window the markdown ladder runs over (backed lots)
    _snap: float = 0.0  # replate units sold at the previous telemetry tick

    @property
    def use_by_s(self) -> float:
        return self.sell_by

    @property
    def remaining(self) -> float:
        return 0.0 if self.retired else max(0.0, self.lot.qty) / self.per_unit

    @property
    def hold_s(self) -> float:
        return max(1.0, self.sell_by - self.made_s)

    def frac_left(self, now: float) -> float:
        return max(0.0, min(1.0, (self.sell_by - now) / self.hold_s))

    @property
    def listing_id(self) -> str:
        return f"replate:{self.sku}:{self.lot_id}"


def shelf_quality(frac_left: float) -> float:
    """Quality proxy of a held unit: 1.0 fresh -> 0.6 at the end of its hold window."""
    return 1.0 - 0.4 * (1.0 - max(0.0, min(1.0, frac_left)))


def round_to(x: float, step: float) -> float:
    return round(x / step) * step if step > 0 else x


class Replate:
    """Replate state and operations of one world (pickled with the world on fork)."""

    def __init__(self, w: World) -> None:
        self.w = w
        cfg = w.cfg
        self.rc = cfg.replate
        self.mode = "off"
        self.override = False  # owner (or experiment) override: policy decisions are ignored
        self.ctx = "full"  # accounting context of the consume in progress: full | replate | remake
        self.last_lot_id = ""
        self.sku_key: dict[str, str] = {}
        self.key_sku: dict[str, str] = {}
        self.backed: dict[str, str] = {}  # backing key -> dish sku (prep-backed listings)
        self.backed_use: dict[str, float] = {}  # backing key -> qty of the key per dish unit
        self.premake_skus: list[str] = []
        for m in cfg.menu:
            rp = m.replate
            if not rp.eligible:
                continue
            if rp.stock_key:
                self.sku_key[m.sku] = rp.stock_key
            else:
                self.sku_key[m.sku] = PM_PREFIX + m.sku
                self.premake_skus.append(m.sku)
            self.key_sku[self.sku_key[m.sku]] = m.sku
        for key, bsku in self.rc.prep_backed.items():
            use = dict(w.inv.sku_keys.get(bsku, ())).get(key, 0.0)
            if use > 0 and key in w.inv.lots:
                self.backed[key] = bsku
                self.backed_use[key] = use
        self.prefer = ""  # lot id a replate sale draws first (FEFO override for prep-backed listings)
        self.lots: dict[str, PreLot] = {}
        self.active: dict[str, list[PreLot]] = {s: [] for s in (*self.sku_key, *self.backed.values())}
        self.jobs: dict[int, dict[str, Any]] = {}
        self.job_seq = 0
        self.dirty = True
        # KPIs (reset daily by Kpis via reset_day)
        self.units_sold = 0
        self.revenue = 0.0
        self.avoided_kg = 0.0
        self.avoided_co2e_kg = 0.0
        self.discount_given = 0.0
        self.premade_units = 0.0
        self.sold_today: dict[str, float] = {}
        self.history: list[PreLot] = []  # retired lots (bounded) for read models / tests
        self.obs_rows: list[tuple] = []  # sell-through telemetry (filled when tele is on)
        self._pending_obs: dict[str, list] = {}
        self.last_tick_s = -1.0
        self._prof: dict[str, Any] = {}

    def rescuable_keys(self) -> set[str]:
        """Inventory keys whose leftovers Replate can list (make-ahead, finished goods, prep-backed)."""
        return set(self.sku_key.values()) | set(self.rc.prep_backed)

    # ------------------------------------------------------------------ queries
    def eligible(self, sku: str) -> bool:
        return sku in self.active

    def tracks(self, key: str) -> bool:
        return key in self.key_sku

    def pm_key(self, sku: str) -> str | None:
        k = self.sku_key.get(sku)
        return k if k is not None and k.startswith(PM_PREFIX) else None

    def head(self, sku: str) -> PreLot | None:
        """Oldest lot with units left (the one FEFO draws from)."""
        for pl in self.active.get(sku, ()):
            if not pl.retired and not pl.backed and pl.remaining >= 1 - EPS:
                return pl
        return None

    def _offerable(self, pl: PreLot) -> bool:
        """Listed, food-safe, inside its window, units left under the rescue-bag cap."""
        if not pl.listed or pl.retired or pl.sell_by <= self.w.now or pl.remaining < 1 - EPS:
            return False
        if shelf_quality(pl.frac_left(self.w.now)) < self.w.ix.menu[pl.sku].replate.min_quality - EPS:
            return False
        return pl.sold_replate < pl.cap_until - EPS

    def listing(self, sku: str) -> PreLot | None:
        """The replate listing a customer sees for ``sku``: the head make-ahead / finished-goods lot when it
        is listed, else the cheapest listed prep-backed lot."""
        pl = self.head(sku)
        best = pl if pl is not None and self._offerable(pl) else None
        if self.backed:
            for b in self.active.get(sku, ()):
                if b.backed and self._offerable(b) and (best is None or b.price < best.price - EPS):
                    best = b
        return best

    def price(self, sku: str) -> float:
        pl = self.listing(sku)
        return pl.price if pl is not None else self.w.menu[sku].price

    def listed_units(self, sku: str) -> float:
        pl = self.listing(sku)
        return math.floor(min(pl.remaining, pl.cap_until - pl.sold_replate) + EPS) if pl is not None else 0.0

    def premade_units_avail(self, sku: str) -> float:
        k = self.pm_key(sku)
        return self.w.inv.usable(k, self.w.now) if k else 0.0

    def stock_units(self, sku: str) -> float:
        """Make-ahead / finished-goods units on hand (usable) for ``sku``."""
        k = self.sku_key.get(sku)
        return self.w.inv.usable(k, self.w.now) if k else 0.0

    def floor_price(self, pl: PreLot) -> float:
        rc = self.rc
        return max(rc.round_to, math.ceil(rc.floor_cost_factor * pl.unit_cost / rc.round_to) * rc.round_to)

    def price_for_pct(self, pl: PreLot, pct: float) -> float:
        """Grid price for a discount percentage off the live menu price, clamped to the floor."""
        base = self.w.menu[pl.sku].price
        p = round_to(base * (1.0 - pct / 100.0), self.rc.round_to)
        return min(base, max(self.floor_price(pl), p))

    def ladder_pct(self, mode: str, frac: float, left_s: float) -> float:
        lad = self.rc.ladders.get(mode)
        if lad is None:
            return 0.0
        pct = 0.0
        for thr, p in lad.rungs:
            if frac <= thr + EPS:
                pct = max(pct, p)
        if left_s <= lad.last_s:
            pct = max(pct, lad.last_pct)
        return pct

    def lot_view(self, pl: PreLot) -> dict[str, Any]:
        now = self.w.now
        return {
            "listing_id": pl.listing_id, "sku": pl.sku, "lot_id": pl.lot_id, "units": round(pl.remaining, 2),
            "offered": round(min(pl.remaining, pl.cap_until - pl.sold_replate), 2) if pl.listed else 0.0,
            "units0": pl.units0, "made_at_s": round(pl.made_s, 1), "use_by_s": round(pl.use_by_s, 1),
            "frac_left": round(pl.frac_left(now), 3), "discount_pct": round(pl.discount_pct, 1),
            "price": pl.price if pl.listed else self.w.menu[pl.sku].price, "listed": pl.listed,
            "base_price": self.w.menu[pl.sku].price, "floor": self.floor_price(pl),
            "unit_cost": round(pl.unit_cost, 2), "sold_full": pl.sold_full, "sold_replate": pl.sold_replate,
            "donated": pl.donated, "wasted": pl.wasted, "quality": round(shelf_quality(pl.frac_left(now)), 3),
            "kind": "backed" if pl.backed else ("premade" if pl.key.startswith(PM_PREFIX) else "stock"),
            "key": pl.key, "per_unit": pl.per_unit, "expires_s": round(pl.lot.expires_s, 1), "cap": None if pl.cap_until > 1e17 else round(pl.cap_until, 2),
        }  # fmt: skip

    def lots_view(self, listed_only: bool = False) -> list[dict[str, Any]]:
        out = []
        for sku in self.active:
            for pl in self.active[sku]:
                if pl.retired or pl.remaining < EPS:
                    continue
                if listed_only and not pl.listed:
                    continue
                out.append(self.lot_view(pl))
        return out

    # --------------------------------------------------------- inventory hooks
    def on_lot_added(self, key: str, lot: Lot) -> None:
        if key not in self.key_sku:  # prep-backed keys are tracked only once they near their use-by
            return
        sku = self.key_sku[key]
        cost = lot.unit_cost
        pl = PreLot(lot.lot_id, sku, key, lot.qty0, lot.received_s, cost, lot)
        pl.sell_by = self._sell_by(sku, lot)
        self.lots[lot.lot_id] = pl
        al = self.active[sku]
        al.append(pl)
        al.sort(key=lambda p: (p.lot.expires_s, p.made_s, p.lot_id))
        self.dirty = True
        self.w.ctx_dirty = True

    def _sell_by(self, sku: str, lot: Lot) -> float:
        """Last sellable moment: the closing time of the last day the lot is still kept.

        Day-end donation retires sealed bakery with < 24 h of shelf life left, so a bought-in muffin's
        selling window ends at the close of that day; make-ahead plates end at their hold or closing time.
        """
        from brew.domain.timeutil import DAY_S

        w = self.w
        close = w.cfg.cafe.close_s
        exp = lot.expires_s
        d = int(lot.received_s // DAY_S)
        if w.ix.menu[sku].replate.donate:
            d0 = d
            while exp - w.day_end_t(d) >= DAY_S and d < d0 + 14:
                d += 1
        return min(exp, d * DAY_S + close)

    def on_take(self, lot: Lot, take: float) -> None:
        """Called by Inventory.consume for tracked keys with the lot and units taken."""
        pl = self.lots.get(lot.lot_id)
        if pl is None:
            return
        self.last_lot_id = lot.lot_id
        c = self.ctx
        units = take / pl.per_unit
        if c == "replate":
            pl.sold_replate += units
        elif c == "remake":
            pl.remade += units
        else:
            pl.sold_full += units
        if lot.qty <= EPS and not pl.retired:
            self.on_depleted(lot)
        elif pl.listed and (pl.remaining < 1 - EPS or pl.backed or pl.sold_replate >= pl.cap_until - EPS):
            self.w.ctx_dirty = True

    def lot_is_listed(self, lot: Lot) -> bool:
        pl = self.lots.get(lot.lot_id)
        return bool(pl is not None and pl.listed)

    def on_retire(self, lot: Lot, units: float, outcome: str) -> None:
        """A lot's remaining units left the building as ``donated`` or ``wasted``."""
        pl = self.lots.get(lot.lot_id)
        if pl is None or pl.retired:
            return
        units /= pl.per_unit
        if outcome == "donated":
            pl.donated += units
        else:
            pl.wasted += units
        pl.retired = True
        self._close(pl, outcome, units)

    def _close(self, pl: PreLot, outcome: str, units: float) -> None:
        w = self.w
        al = self.active[pl.sku]
        if pl in al:
            al.remove(pl)
        if pl.listed:
            w.emit("replate.retired", listing_id=pl.listing_id, units=round(units, 2), outcome=outcome)
        self.history.append(pl)
        if len(self.history) > 400:
            for old in self.history[:100]:
                self.lots.pop(old.lot_id, None)
            del self.history[:100]
        w.ctx_dirty = True

    def on_depleted(self, lot: Lot) -> None:
        """All units sold: retire the (empty) listing."""
        pl = self.lots.get(lot.lot_id)
        if pl is None or pl.retired:
            return
        pl.retired = True
        self._close(pl, "sold_out", 0.0)

    # ------------------------------------------------------------ listing tick
    # ------------------------------------------------- prep-backed lots / surplus
    def _scan_backed(self) -> None:
        """Start tracking lots of mapped prepped intermediates / perishables that are nearing their use-by.

        A prep item qualifies once its remaining hold fraction is <= ``backed_frac``; a raw perishable once it
        has < ``backed_raw_s`` left.  Lots that survive the night into the next service are not at risk yet.
        """
        from brew.domain.timeutil import DAY_S

        w = self.w
        now = w.now
        cafe = w.cfg.cafe
        d = int(now // DAY_S)
        close = float(d * DAY_S + cafe.close_s)
        nxt_open = float((d + 1) * DAY_S + cafe.open_s)
        inv = w.inv
        for key, sku in self.backed.items():
            use = self.backed_use[key]
            prep = key in w.ix.prep
            for lot in inv.lots[key]:
                if lot.lot_id in self.lots or lot.qty < use - EPS or lot.expires_s <= now:
                    continue
                exp = lot.expires_s
                if exp > close:
                    if exp > nxt_open + 3600.0:
                        continue
                    sell_by = close
                else:
                    sell_by = exp
                if sell_by <= now + 300.0:
                    continue
                window = max(900.0, exp - lot.received_s) if prep else self.rc.backed_raw_s
                left = sell_by - now
                if (left / window > self.rc.backed_frac + EPS) if prep else (left > window + EPS):
                    continue
                cost = float(sum(q * inv.unit_cost[k] for k, q in inv.sku_keys[sku]))
                pl = PreLot(lot.lot_id, sku, key, lot.qty / use, sell_by - window, cost, lot)
                pl.sell_by = sell_by
                pl.per_unit = use
                pl.backed = True
                pl.window_s = window
                self.lots[lot.lot_id] = pl
                al = self.active[sku]
                al.append(pl)
                al.sort(key=lambda p: (p.backed, p.lot.expires_s, p.made_s, p.lot_id))
                self.dirty = True
                w.ctx_dirty = True

    def _profile(self, sku: str) -> Any:
        """Mean full-price units per 15-min slot of ``sku`` over the recent days (None without history)."""
        import numpy as np

        log = self.w.dlog
        days = log.days[-14:]
        if not days:
            return None
        j = log.skus.index(sku)
        hit = self._prof.get(sku)
        if hit is not None and hit[0] == (len(log.days), days[-1].day):
            return hit[1]
        prof = np.mean([d.counts[:, j, :].sum(axis=1) for d in days], axis=0)
        self._prof[sku] = ((len(log.days), days[-1].day), prof)
        return prof

    def expected_units(self, sku: str, until_s: float) -> float:
        """Units of ``sku`` the café expects to sell at full price between now and ``until_s``."""
        w = self.w
        now = w.now
        span = until_s - now
        if span <= 0:
            return 0.0
        s0 = tod_s(now) / 900.0
        s1 = min(96.0, s0 + span / 900.0)
        prof = self._profile(sku)
        log = w.dlog
        if prof is not None:
            tot = 0.0
            k = int(s0)
            while k < s1:
                lo, hi = max(s0, float(k)), min(s1, float(k + 1))
                tot += float(prof[k]) * (hi - lo)
                k += 1
            cur = log.cur
            if cur is not None and s0 > 8:
                j = log.skus.index(sku)
                hist_sofar = float(prof[: int(s0)].sum())
                got = float(cur.counts[: int(s0), j, :].sum())
                tot *= max(0.6, min(1.6, (got + 2.0) / (hist_sofar + 2.0)))
            return tot
        cur = log.cur
        if cur is None:
            return 0.0
        j = log.skus.index(sku)
        got = float(cur.counts[: int(s0), j, :].sum())
        open_slots = max(8.0, s0 - w.cfg.cafe.open_s / 900.0)
        return got / open_slots * (s1 - s0)

    def _surplus_room(self, pl: PreLot) -> float:
        """Units of ``pl`` beyond the full-price demand expected to reach it before its sell-by."""
        if pl.backed:  # key-level: every dish that draws on the key competes for the lot
            inv = self.w.inv
            use = 0.0
            for s2 in inv.key_skus.get(pl.key, ()):
                q = dict(inv.sku_keys[s2]).get(pl.key, 0.0)
                use += q * self.expected_units(s2, pl.sell_by)
            ahead_q = sum(lt.qty for lt in inv.lots[pl.key] if lt.expires_s < pl.lot.expires_s - EPS)
            reach_q = max(0.0, use - ahead_q)
            reach_q += self.rc.surplus_z * math.sqrt(reach_q * pl.per_unit)
            return float(math.floor((pl.lot.qty - reach_q) / pl.per_unit + EPS))
        mu = self.expected_units(pl.sku, pl.sell_by)
        ahead = 0.0
        for o in self.active[pl.sku]:
            if o is pl:
                break
            if not o.retired:
                ahead += o.remaining
        reach = max(0.0, mu - ahead)
        reach += self.rc.surplus_z * math.sqrt(reach)
        return float(math.floor(pl.remaining - reach + EPS))

    def set_mode(self, mode: str, by: str, owner: bool = False) -> bool:
        """Change the ladder mode. Owner changes set an override that blocks policy changes."""
        if mode not in (*MODES, CUSTOM):
            raise ReplateBadPayload(f"unknown replate mode {mode!r}")
        if owner:
            self.override = True
        elif self.override:
            return False
        if mode == self.mode:
            return False
        prev = self.mode
        self.mode = mode
        self.w.emit("replate.mode", mode=mode, previous=prev, by=by)
        self.tick()
        return True

    def release_override(self, mode: str) -> None:
        self.override = False
        self.mode = mode

    def tick(self) -> None:
        """Apply the markdown ladder to every held lot (manager tick, lot creation, 5-min clock)."""
        w = self.w
        now = w.now
        self.last_tick_s = now
        mode = self.mode
        if self.backed:
            self._scan_backed()
        ladder = mode in MODES and mode != "off"
        for sku in self.active:
            for pl in list(self.active[sku]):
                if pl.retired or pl.remaining < 1 - EPS:
                    continue
                if ladder:
                    f = pl.frac_left(now)
                    pct = self.ladder_pct(mode, f, pl.sell_by - now if pl.backed else pl.lot.expires_s - now)
                    if self.rc.surplus_only and pct > 0:
                        room = self._surplus_room(pl)
                        if room < 1.0 - EPS and not pl.listed:
                            continue
                        pl.cap_until = pl.sold_replate + max(0.0, room)
                        w.ctx_dirty = True
                    if pct > pl.discount_pct + 1e-9 or (pct > 0 and not pl.listed):
                        self._apply(pl, pct, "ladder")
        if w.tele is not None:
            self._telemetry()

    def _apply(self, pl: PreLot, pct: float, by: str) -> bool:
        """Raise ``pl`` to at least ``pct`` off (monotone, floor-clamped). Returns True if it changed."""
        new_price = self.price_for_pct(pl, pct)
        base = self.w.menu[pl.sku].price
        if new_price >= base - EPS:
            return False  # no real discount at this rung
        if pl.listed and new_price >= pl.price - EPS:
            return False  # price must strictly fall
        eff = round((1.0 - new_price / base) * 100.0, 1)
        first = not pl.listed
        pl.price = new_price
        pl.discount_pct = max(pl.discount_pct, eff)
        pl.listed = True
        pl.marks += 1
        pl.mark_by = by
        w = self.w
        w.emit(
            "replate.listed" if first else "replate.marked_down",
            listing_id=pl.listing_id, sku=pl.sku, lot_id=pl.lot_id, units=round(pl.remaining, 2),
            made_at_s=round(pl.made_s, 1), use_by_s=round(pl.use_by_s, 1), discount_pct=pl.discount_pct,
            price=new_price,
        )  # fmt: skip
        w.ctx_dirty = True
        self.dirty = True
        return True

    def set_discount(self, lot_id: str, pct: float, by: str, strict: bool = True, cap: float | None = None) -> bool:
        """List / deepen a lot to ``pct`` percent off. Monotone and floor-checked (strict raises).

        ``cap`` limits the listing to that many more units (a rescue bag); omitted = the whole lot."""
        pl = self.lots.get(lot_id)
        if pl is None or pl.retired or pl.remaining < EPS:
            raise ReplateInvalid(f"lot {lot_id} not found or empty")
        base = self.w.menu[pl.sku].price
        want = round_to(base * (1.0 - pct / 100.0), self.rc.round_to)
        if want < self.floor_price(pl) - EPS:
            if strict:
                raise CharterViolation(f"{pl.sku}: price {want:g} below floor {self.floor_price(pl):g}")
            want = self.floor_price(pl)
        if pl.listed and want > pl.price + EPS:
            if strict:
                raise CharterViolation(f"{pl.sku}: markdown must not decrease ({want:g} > {pl.price:g})")
            return False
        if want >= base - EPS:
            if strict:
                raise CharterViolation(f"{pl.sku}: discount must be positive")
            return False
        cap_changed = False
        if cap is not None and abs(pl.cap_until - (pl.sold_replate + cap)) > EPS:
            pl.cap_until = pl.sold_replate + cap
            cap_changed = True
            self.w.ctx_dirty = True
        if pl.listed and abs(want - pl.price) < EPS:
            return cap_changed
        eff = (1.0 - want / base) * 100.0
        return self._apply(pl, eff, by) or cap_changed

    def list_sku(self, sku: str, pct: float | None, by: str) -> dict[str, Any]:
        """Owner / policy: list or deepen the head lot of ``sku`` (``pct`` None = current ladder rung)."""
        if sku not in self.active:
            raise ReplateBadPayload(f"{sku!r} is not replate-eligible")
        pl = self.head(sku)
        if pl is None:
            pl = next((b for b in self.active[sku] if b.backed and not b.retired and b.remaining >= 1 - EPS), None)
        if pl is None:
            raise ReplateInvalid(f"no make-ahead stock of {sku} to list")
        if pct is None:
            mode = self.mode if self.mode in MODES and self.mode != "off" else "gentle"
            pct = max(self.ladder_pct(mode, pl.frac_left(self.w.now), pl.use_by_s - self.w.now), 10.0)
            if pl.listed:
                pct = max(pct, pl.discount_pct + 5.0)
        if not 0 < pct < 100:
            raise ReplateBadPayload("discount_pct must be in (0, 100)")
        self.set_discount(pl.lot_id, float(pct), by, strict=True)
        return self.lot_view(pl)

    # ------------------------------------------------------------- choice ctx
    def choice_arrays(self) -> tuple[Any, Any, Any]:
        """(mask[J], price[J], quality[J]) of replate alternatives aligned with the menu order."""
        import numpy as np

        menu = self.w.cfg.menu
        J = len(menu)
        mask = np.zeros(J, dtype=bool)
        price = np.zeros(J)
        qual = np.ones(J)
        now = self.w.now
        for j, m in enumerate(menu):
            if m.sku not in self.active:
                continue
            pl = self.listing(m.sku)
            if pl is not None and self.listed_units(m.sku) >= 1 - EPS:
                mask[j] = True
                price[j] = pl.price
                qual[j] = shelf_quality(pl.frac_left(now))
        return mask, price, qual

    # ------------------------------------------------------------------ sales
    def record_sale(self, o: Any, u: Any) -> None:
        """A replate-priced unit was consumed for order ``o``."""
        w = self.w
        sku = u.sku
        pl = self.lots.get(getattr(u, "lot_id", ""))
        price = u.rp_price
        base = w.menu[sku].price
        self.units_sold += 1
        self.revenue += price
        self.discount_given += max(0.0, base - price)
        m = w.ix.menu[sku]
        wt_kg = w.inv.kg_of(pl.key, pl.per_unit) if pl is not None and pl.backed else self._unit_kg(sku)
        self.avoided_kg += wt_kg
        self.avoided_co2e_kg += m.co2e_g / 1000.0
        self.sold_today[sku] = self.sold_today.get(sku, 0.0) + 1
        if pl is not None:
            pl.revenue += price
        w.emit(
            "replate.sold", listing_id=pl.listing_id if pl else f"replate:{sku}", order_no=o.order_no,
            units=1, price=price,
        )  # fmt: skip

    def _unit_kg(self, sku: str) -> float:
        inv = self.w.inv
        k = self.sku_key.get(sku)
        return inv.weight_g.get(k, 100.0) / 1000.0 if k else 0.1

    def reset_day(self) -> None:
        self.units_sold = 0
        self.revenue = 0.0
        self.avoided_kg = 0.0
        self.avoided_co2e_kg = 0.0
        self.discount_given = 0.0
        self.sold_today = {}

    def kpis(self) -> dict[str, Any]:
        return {
            "replate_units_sold": self.units_sold,
            "replate_revenue": round(self.revenue, 2),
            "replate_waste_avoided_kg": round(self.avoided_kg, 3),
            "replate_co2e_avoided_kg": round(self.avoided_co2e_kg, 3),
            "replate_discount_given": round(self.discount_given, 2),
        }

    # ------------------------------------------------------------- pre-make
    def premake(self, sku: str, units: int, by: str) -> dict[str, Any]:
        """Make ``units`` ahead of demand. Bakes go through the oven prep item; plates via kitchen tasks."""
        w = self.w
        if sku not in self.sku_key:
            raise ReplateBadPayload(f"{sku!r} is not replate-eligible")
        if units <= 0:
            raise ReplateBadPayload("units must be positive")
        key = self.sku_key[sku]
        if not key.startswith(PM_PREFIX):
            # stock-backed: only the in-house baked item can actually be produced ahead
            if key in w.ix.prep:
                p = w.ix.prep[key]
                started = w.kitchen.start_prep(key, units)
                if started <= 0:
                    raise ReplateInvalid(f"cannot start {key}: ingredients short")
                return {"sku": sku, "units": started, "kind": "prep", "key": key, "batch": p.batch_size}
            raise ReplateBadPayload(f"{sku} is bought in and cannot be pre-made")
        cap = self.rc.max_premake_job
        done = 0
        left = int(units)
        while left > 0:
            n = min(cap, left)
            n_ok = self._premake_job(sku, n)
            if n_ok <= 0:
                break
            done += n_ok
            left -= n
        if done <= 0:
            raise ReplateInvalid(f"cannot pre-make {sku}: ingredients short")
        return {"sku": sku, "units": done, "kind": "premake", "key": key}

    def _premake_job(self, sku: str, n: int) -> int:
        """Start one job of up to ``n`` units; returns units started (0 if impossible)."""
        w = self.w
        inv = w.inv
        bom = [(k, q) for k, q, pack in inv.bom(sku, (), False) if not pack]
        n_ok = n
        while n_ok > 0 and not inv.can_supply([(k, q * n_ok) for k, q in bom], w.now):
            n_ok -= 1
        if n_ok <= 0:
            return 0
        cost = 0.0
        for k, q in bom:
            got, c, _ql = inv.consume(k, q * n_ok, w.now, partial=True)
            cost += c
        self.job_seq += 1
        jid = self.job_seq
        steps = [s for s in w.cfg.recipes.recipes[sku].steps if s.station != "pass"]
        if not steps:
            steps = list(w.cfg.recipes.recipes[sku].steps[:1])
        job: dict[str, Any] = {"id": jid, "sku": sku, "n": n_ok, "cost": cost, "left": 0, "start": w.now}
        self.jobs[jid] = job
        kit = w.kitchen
        from .state import T_READY, T_WAIT

        names = {s.name for s in steps}
        horizon = 3600.0
        for _u in range(n_ok):
            by_name: dict[str, Any] = {}
            for i, st in enumerate(steps):
                deps_cfg = (
                    st.depends_on if st.depends_on is not None else ((steps[i - 1].name,) if i > 0 else ())
                )
                deps = [d for d in deps_cfg if d in names]
                t = kit._task(
                    "premake", st.name, st.station, 0, st.duration[0], st.duration[1], st.attention,
                    uses_slot=st.uses_slot, batchable=st.batchable, max_batch=st.max_batch,
                    batch_factor=st.batch_factor, sku=sku, ref=jid,
                )  # fmt: skip
                t.due_s = w.now + horizon
                t.placed_s = w.now
                t.deps_left = len(deps)
                for d in deps:
                    by_name[d].children.append(t)
                by_name[st.name] = t
                job["left"] += 1
                kit.work_open += t.duration_mean * t.attention
                if t.deps_left == 0:
                    t.state = T_READY
                    t.ready_s = w.now
                    kit.ready.append(t)
                else:
                    t.state = T_WAIT
        w.emit("prep.started", prep_key=PM_PREFIX + sku, qty=float(n_ok))
        kit.request_dispatch()
        self.premade_units += n_ok
        return n_ok

    def on_premake_step_done(self, t: Any) -> None:
        job = self.jobs.get(t.ref)
        if job is None:
            return
        job["left"] -= 1
        if job["left"] > 0:
            return
        self.jobs.pop(t.ref, None)
        w = self.w
        sku = job["sku"]
        key = self.sku_key[sku]
        hold_h = w.ix.menu[sku].replate.premake_hold_s / 3600.0
        n = job["n"]
        w.inv.add_lot(key, float(n), w.now, unit_cost=job["cost"] / n, kind="receive", shelf_h=hold_h)
        w.emit("prep.ready", prep_key=key, qty=float(n))
        w.recheck_availability(w.inv.stock_dirty)
        self.tick()

    def inflight(self, sku: str) -> float:
        return float(sum(j["n"] for j in self.jobs.values() if j["sku"] == sku))

    def on_day_end(self) -> None:
        """Unfinished premake jobs are lost when the kitchen closes: book their ingredients as waste."""
        w = self.w
        for j in list(self.jobs.values()):
            w.fin.post("waste", j["cost"])
            w.kpi.waste_inr += j["cost"]
            kg = self._unit_kg(j["sku"]) * j["n"]
            w.kpi.waste_kg += kg
            k2 = self.sku_key[j["sku"]]
            w.waste_by_key[k2] = w.waste_by_key.get(k2, 0.0) + kg
        self.jobs.clear()

    # --------------------------------------------------------------- telemetry
    def _telemetry(self) -> None:
        w = self.w
        now = w.now
        hour = tod_s(now) / 3600.0
        for sku in self.active:
            for pl in self.active[sku]:
                if pl.retired:
                    continue
                prev = self._pending_obs.pop(pl.lot_id, None)
                if prev is not None:
                    prev[-1] = pl.sold_replate - pl._snap
                    self.obs_rows.append(tuple(prev))
                if not pl.listed or pl.remaining < 1:
                    continue
                pl._snap = pl.sold_replate
                ncomp = sum(1 for s2 in self.active if s2 != sku and self.listing(s2) is not None)
                self._pending_obs[pl.lot_id] = [
                    now, sku, pl.lot_id, pl.frac_left(now), pl.discount_pct, pl.price / max(1.0, w.menu[sku].price),
                    hour, w.weather_state, float(w.customers.arrived_today), ncomp, pl.remaining, 0.0,
                ]  # fmt: skip


def observation_features(w: World) -> tuple[float, float, float, float]:
    """4 replate observation features: listed units, value expiring < 2 h, sell-through today, mode index."""
    rp = w.replate
    listed_units = 0.0
    expiring = 0.0
    now = w.now
    stock_units = 0.0
    for sku in rp.active:
        for pl in rp.active[sku]:
            if pl.retired or pl.remaining < 1:
                continue
            stock_units += pl.remaining
            if pl.listed:
                listed_units += pl.remaining
            if pl.use_by_s - now <= 7200.0:
                expiring += pl.remaining * pl.unit_cost
    sold = float(sum(rp.sold_today.values()))
    sell_through = sold / max(1.0, sold + stock_units)
    modes = (*MODES, CUSTOM)
    mode_idx = (modes.index(rp.mode) if rp.mode in modes else 0) / 3.0
    return (min(1.0, listed_units / 20.0), min(1.0, expiring / 1500.0), sell_through, min(1.0, mode_idx))
