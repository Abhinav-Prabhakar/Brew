"""Dense per-slot demand history kept inside the world (forecast features + training data).

For every day: counts per ``(slot, sku, channel group)`` plus the context that was live at the start of
each 15-min slot (prices, featured/hidden flags, weather, rating).  The forecaster reads it at inference
time; ``dense_frame`` turns it into the Parquet training table, so both paths use identical numbers.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any

import numpy as np

from brew.domain.enums import WEATHER_STATES
from brew.domain.timeutil import tod_s

if TYPE_CHECKING:
    from .world import World

SLOTS = 96
OPEN_SLOTS = range(32, 88)  # 08:00-22:00
FG = ("offline", "delivery")
FLAGS = ("holiday", "cricket", "exam", "payday")


def fg_index(channel: str) -> int:
    return 1 if channel in ("zomato", "swiggy") else 0


class DayRec:
    """One day of demand counts and slot context."""

    __slots__ = (
        "counts", "day", "featured", "flags", "hidden", "price_ratio", "rain", "rating", "rp", "seen", "temp",
        "weekday", "wx",
    )  # fmt: skip

    def __init__(self, day: int, weekday: int, flags: tuple[bool, ...], n_sku: int) -> None:
        self.day = day
        self.weekday = weekday
        self.flags = flags
        self.counts = np.zeros((SLOTS, n_sku, 2), dtype=np.float32)
        self.rp = np.zeros((SLOTS, n_sku), dtype=np.float32)
        self.price_ratio = np.ones((SLOTS, n_sku), dtype=np.float32)
        self.featured = np.zeros((SLOTS, n_sku), dtype=np.int8)
        self.hidden = np.zeros((SLOTS, n_sku), dtype=np.int8)
        self.wx = np.full(SLOTS, 1, dtype=np.int8)
        self.temp = np.full(SLOTS, 26.0, dtype=np.float32)
        self.rain = np.zeros(SLOTS, dtype=np.float32)
        self.rating = np.full(SLOTS, 4.4, dtype=np.float32)
        self.seen = np.zeros(SLOTS, dtype=bool)

    def fill_forward(self) -> None:
        """Slots without a snapshot take the previous snapshot's context."""
        last = -1
        for s in range(SLOTS):
            if self.seen[s]:
                last = s
            elif last >= 0:
                self.price_ratio[s] = self.price_ratio[last]
                self.featured[s] = self.featured[last]
                self.hidden[s] = self.hidden[last]
                self.wx[s] = self.wx[last]
                self.temp[s] = self.temp[last]
                self.rain[s] = self.rain[last]
                self.rating[s] = self.rating[last]


class DemandLog:
    """Rolling window of :class:`DayRec` (``keep`` days) + the day in progress."""

    def __init__(self, skus: list[str], keep: int = 120) -> None:
        self.skus = list(skus)
        self.n = len(skus)
        self.keep = keep
        self.days: list[DayRec] = []
        self.cur: DayRec | None = None

    # ---------------------------------------------------------------- writing
    def new_day(self, day: int, weekday: int, flags: dict[str, bool]) -> None:
        if self.cur is not None:
            self.cur.fill_forward()
            self.days.append(self.cur)
            if len(self.days) > self.keep:
                del self.days[: len(self.days) - self.keep]
        self.cur = DayRec(day, weekday, tuple(bool(flags.get(f)) for f in FLAGS), self.n)

    def add(self, sku_idx: int, channel: str, slot: int, qty: float, replate: bool = False) -> None:
        cur = self.cur
        if cur is None:
            return
        cur.counts[slot, sku_idx, fg_index(channel)] += qty
        if replate:
            cur.rp[slot, sku_idx] += qty

    def snapshot(self, w: World) -> None:
        """Record the live context at the start of the current 15-min slot."""
        cur = self.cur
        if cur is None:
            return
        s = int(tod_s(w.now) // 900)
        for j, sku in enumerate(self.skus):
            ms = w.menu[sku]
            cur.price_ratio[s, j] = ms.price / ms.base
            cur.featured[s, j] = 1 if ms.featured else 0
            cur.hidden[s, j] = 1 if ms.hidden else 0
        cur.wx[s] = WEATHER_STATES.index(w.weather_state)
        cur.temp[s] = w.temp_c
        cur.rain[s] = w.rain_mm_h
        cur.rating[s] = w.reviews.rep.overall()
        cur.seen[s] = True

    # ---------------------------------------------------------------- reading
    def all_days(self, include_current: bool = True) -> list[DayRec]:
        out = list(self.days)
        if include_current and self.cur is not None:
            self.cur.fill_forward()
            out.append(self.cur)
        return out

    def total_so_far(self, upto_slot: int) -> float:
        cur = self.cur
        return float(cur.counts[:upto_slot].sum()) if cur is not None else 0.0

    def dense_frame(self, cats: Mapping[str, str], include_current: bool = True) -> Any:
        """Polars frame: one row per (day, open slot, sku, channel group)."""
        import polars as pl

        recs = self.all_days(include_current)
        if not recs:
            return pl.DataFrame()
        slots = np.array(list(OPEN_SLOTS))
        S, J = len(slots), self.n
        cols: dict[str, list[np.ndarray]] = {k: [] for k in (
            "day", "weekday", "slot", "sku_i", "fg", "qty", "rp_qty", "price_ratio", "featured", "hidden",
            "wx", "temp_c", "rain_mm_h", "rating", "holiday", "cricket", "exam", "payday",
        )}  # fmt: skip
        for r in recs:
            r.fill_forward()
            slot_g = np.repeat(slots, J * 2)
            sku_g = np.tile(np.repeat(np.arange(J), 2), S)
            fg_g = np.tile(np.array([0, 1]), S * J)
            n = len(slot_g)
            cols["day"].append(np.full(n, r.day))
            cols["weekday"].append(np.full(n, r.weekday))
            cols["slot"].append(slot_g)
            cols["sku_i"].append(sku_g)
            cols["fg"].append(fg_g)
            cols["qty"].append(r.counts[slot_g, sku_g, fg_g])
            cols["rp_qty"].append(r.rp[slot_g, sku_g] * (fg_g == 0))
            cols["price_ratio"].append(r.price_ratio[slot_g, sku_g])
            cols["featured"].append(r.featured[slot_g, sku_g])
            cols["hidden"].append(r.hidden[slot_g, sku_g])
            cols["wx"].append(r.wx[slot_g])
            cols["temp_c"].append(r.temp[slot_g])
            cols["rain_mm_h"].append(r.rain[slot_g])
            cols["rating"].append(r.rating[slot_g])
            for fi, f in enumerate(FLAGS):
                cols[f].append(np.full(n, int(r.flags[fi])))
        data = {k: np.concatenate(v) for k, v in cols.items()}
        skus = np.array(self.skus)
        df = pl.DataFrame(
            {
                **{k: v for k, v in data.items() if k != "sku_i"},
                "sku": skus[data["sku_i"]],
                "channel_group": np.array(FG)[data["fg"]],
            }
        )
        cat_map = {s: cats[s] for s in self.skus}
        return df.with_columns(
            pl.col("sku").replace_strict(cat_map).alias("cat"),
            pl.col("wx").replace_strict({i: s for i, s in enumerate(WEATHER_STATES)}).alias("weather"),
        ).drop("fg")

    @classmethod
    def from_frame(cls, df: Any, skus: list[str]) -> DemandLog:
        """Rebuild a log (history only) from a dense frame written by :meth:`dense_frame`."""
        log = cls(skus, keep=10**6)
        idx = {s: i for i, s in enumerate(skus)}
        for (day,), g in df.group_by(["day"], maintain_order=True):
            first = g.row(0, named=True)
            rec = DayRec(
                int(day), int(first["weekday"]),
                tuple(bool(first[f]) for f in FLAGS), len(skus),
            )  # fmt: skip
            slot = g["slot"].to_numpy()
            j = np.array([idx[s] for s in g["sku"].to_list()])
            fg = (g["channel_group"].to_numpy() == "delivery").astype(int)
            rec.counts[slot, j, fg] = g["qty"].to_numpy()
            off = fg == 0
            rec.rp[slot[off], j[off]] = g["rp_qty"].to_numpy()[off]
            rec.price_ratio[slot, j] = g["price_ratio"].to_numpy()
            rec.featured[slot, j] = g["featured"].to_numpy()
            rec.hidden[slot, j] = g["hidden"].to_numpy()
            rec.wx[slot] = g["wx"].to_numpy()
            rec.temp[slot] = g["temp_c"].to_numpy()
            rec.rain[slot] = g["rain_mm_h"].to_numpy()
            rec.rating[slot] = g["rating"].to_numpy()
            rec.seen[np.unique(slot)] = True
            log.days.append(rec)
        return log
