"""Named observation vector for policies / RL (docs/implementation-spec.md 13.2): 183 floats."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import TYPE_CHECKING

import numpy as np

from brew.domain.enums import CATEGORIES, CHANNEL_GROUPS, DISRUPTION_KINDS, STRATEGY_PRESETS, WEATHER_STATES
from brew.domain.timeutil import tod_s

if TYPE_CHECKING:
    from .world import World

KEY_COVER = [
    "coffee_beans", "milk", "oat_milk", "ice", "matcha_powder", "avocado", "paneer", "sandwich_bread", "potato",
    "cup_paper_m",
]  # fmt: skip
PREP_KEYS = ["coldbrew_concentrate", "chai_base", "croissant_baked", "paneer_marinade", "fries_cut"]
KAPPA_CLASSES = ["coldbrew_concentrate", "chai_base", "croissant_baked", "paneer_marinade"]
STATIONS13 = [
    "espresso", "grinder", "bar", "blender", "cold", "oven", "press", "fryer", "stove", "griddle", "display", "pass",
    "dishpit",
]  # fmt: skip
THROTTLE_IDX = {"open": 0.0, "plus5": 1 / 3, "plus10": 2 / 3, "pause": 1.0}


def _names() -> list[str]:
    n: list[str] = ["tod_sin", "tod_cos"] + [f"dow_{i}" for i in range(7)] + ["episode_frac", "is_weekend"]
    n += [f"wx_{s}" for s in WEATHER_STATES] + ["temp_norm"]
    n += ["cal_holiday", "cal_cricket", "cal_exam", "cal_payday"]
    for c in CATEGORIES:
        for g in CHANNEL_GROUPS:
            n += [f"demand_{c}_{g}_p50_s{k}" for k in range(4)]
    n += [f"demand_spread_{c}" for c in CATEGORIES]
    n += ["nowcast_level"]
    n += [f"open_{c}" for c in ("dine_in", "takeaway", "zomato", "swiggy")]
    n += [f"slack_h{i}" for i in range(5)] + ["low_patience_waiting", "register_queue"]
    n += (
        [f"util_{s}" for s in STATIONS13]
        + [f"queue_{s}" for s in STATIONS13]
        + [f"down_{s}" for s in STATIONS13]
    )
    n += ["staff_present", "fatigue_mean", "fatigue_max", "tables_free", "tables_occupied", "tables_dirty"]
    n += [f"cover_{k}" for k in KEY_COVER] + ["expiring_value_4h"] + [f"prep_{k}" for k in PREP_KEYS]
    n += [f"price_index_{c}" for c in CATEGORIES] + ["profit_today", "cash"]
    n += ["rep_offline", "rep_zomato", "rep_swiggy", "price_changes_2h"]
    n += [f"dis_{k}" for k in DISRUPTION_KINDS]
    n += [f"kappa_{k}" for k in KAPPA_CLASSES] + [f"strategy_{s}" for s in STRATEGY_PRESETS]
    n += ["throttle_zomato", "throttle_swiggy", "batch_window"]
    n += ["replate_listed_units", "replate_expiring_value_2h", "replate_sell_through", "replate_mode"]
    return n


NAMES = _names()
assert len(NAMES) == 183, len(NAMES)
INDEX = {n: i for i, n in enumerate(NAMES)}


@dataclass(slots=True)
class Observation:
    """183-float named vector. ``get(name)`` reads one feature."""

    vec: np.ndarray
    names: list[str]

    def get(self, name: str) -> float:
        return float(self.vec[INDEX[name]])

    def as_dict(self) -> dict[str, float]:
        return {n: float(v) for n, v in zip(self.names, self.vec, strict=True)}


class ObservationBuilder:
    """Builds the observation from a World (read-only)."""

    names = NAMES

    def __init__(self, w: World) -> None:
        self.w = w

    def build(self) -> Observation:
        w = self.w
        v = np.zeros(183, dtype=np.float32)
        i = 0
        now = w.now
        tod = tod_s(now)
        # time (11)
        v[0] = math.sin(2 * math.pi * tod / 86400)
        v[1] = math.cos(2 * math.pi * tod / 86400)
        v[2 + w.weekday()] = 1.0
        v[9] = w.day / max(1, w.max_days) if w.max_days else 0.0
        v[10] = 1.0 if w.is_weekend() else 0.0
        i = 11
        # weather (6)
        v[i + WEATHER_STATES.index(w.weather_state)] = 1.0
        v[i + 5] = (w.temp_c - 26.0) / 10.0
        i += 6
        # calendar (4)
        fl = w.cal_flags
        for k, name in enumerate(("holiday", "cricket", "exam", "payday")):
            v[i + k] = 1.0 if fl.get(name) else 0.0
        i += 4
        # demand (52)
        slot = int(tod // 900)
        ma = w.ma
        for c in CATEGORIES:
            for g in CHANNEL_GROUPS:
                for k in range(4):
                    v[i] = min(1.0, ma.p50(c, g, slot + k) / 6.0)
                    i += 1
        for c in CATEGORIES:
            spread = 0.0
            for g in CHANNEL_GROUPS:
                lo, _m, hi = ma.band(c, g, slot)
                spread += hi - lo
            v[i] = min(1.0, spread / 10.0)
            i += 1
        # nowcast (1): Gamma-Poisson level multiplier (prior Gamma(20,20))
        exp_so_far = sum(float(ma.ema[k][: slot + 1].sum()) for k in ma.ema)
        obs_so_far = sum(float(a[: slot + 1].sum()) for a in ma.today.values())
        v[i] = min(2.0, (20.0 + obs_so_far) / (20.0 + max(exp_so_far, 0.0))) - 1.0
        i += 1
        # queues (11)
        ob = w.orders.open_by_channel()
        for ch in ("dine_in", "takeaway", "zomato", "swiggy"):
            v[i] = min(1.0, ob[ch] / 12.0)
            i += 1
        for h in w.orders.slack_hist():
            v[i] = min(1.0, h / 8.0)
            i += 1
        v[i] = min(1.0, w.customers.low_patience_waiting() / 6.0)
        v[i + 1] = min(1.0, len(w.customers.queue) / 8.0)
        i += 2
        # resources (45)
        util = w.kitchen.station_util()
        for s in STATIONS13:
            v[i] = min(1.5, util.get(s, 0.0))
            i += 1
        for s in STATIONS13:
            v[i] = min(1.0, w.kitchen.queue_len(s) / 8.0)
            i += 1
        for s in STATIONS13:
            eqs = [w.equip[j] for j in w.kitchen.stations[s].eq]
            v[i] = 1.0 if eqs and any(not e.up for e in eqs) else 0.0
            i += 1
        present = w.kitchen.present_staff()
        v[i] = len(present) / 5.0
        fat = [s.fatigue for s in present] or [0.0]
        v[i + 1] = sum(fat) / len(fat)
        v[i + 2] = max(fat)
        tabs = list(w.tables.values())
        n_t = max(1, len(tabs))
        v[i + 3] = sum(1 for t in tabs if t.state == "free") / n_t
        v[i + 4] = sum(1 for t in tabs if t.state == "occupied") / n_t
        v[i + 5] = sum(1 for t in tabs if t.state in ("dirty", "cleaning")) / n_t
        i += 6
        # inventory (16)
        for key in KEY_COVER:
            use = ma.key_usage_per_day(key)
            cover = w.inv.onhand[key] / use if use > 0 else 5.0
            v[i] = min(1.0, cover / 5.0)
            i += 1
        v[i] = min(1.0, w.inv.value_expiring(now, 4 * 3600) / 2000.0)
        i += 1
        for key in PREP_KEYS:
            par = w.ix.prep[key].par
            v[i] = min(1.5, w.inv.onhand[key] / par) if par else 0.0
            i += 1
        # economics (10)
        for c in CATEGORIES:
            v[i] = w.price_index(c) - 1.0
            i += 1
        v[i] = max(-1.0, min(1.0, w.kpi.profit_today() / 5000.0))
        v[i + 1] = max(-1.0, min(1.0, w.fin.cash / 50000.0))
        rep = w.reviews.rep
        v[i + 2] = rep.rating("offline") - 4.3
        v[i + 3] = rep.rating("zomato") - 4.3
        v[i + 4] = rep.rating("swiggy") - 4.3
        v[i + 5] = min(1.0, w.price_changes_last(7200.0) / 10.0)
        i += 6
        # disruptions (10)
        active = {d.kind for d in w.dis.active_list()}
        for key in DISRUPTION_KINDS:
            v[i] = 1.0 if key in active else 0.0
            i += 1
        # controls (13)
        for key in KAPPA_CLASSES:
            v[i] = w.kappa.get(key, 0.0)
            i += 1
        for s in STRATEGY_PRESETS:
            v[i] = 1.0 if w.preset == s else 0.0
            i += 1
        v[i] = THROTTLE_IDX[w.delivery.throttle["zomato"]]
        v[i + 1] = THROTTLE_IDX[w.delivery.throttle["swiggy"]]
        v[i + 2] = w.batch_window_s / 120.0
        i += 3
        # replate (4)
        from .replate import observation_features

        v[i : i + 4] = observation_features(w)
        i += 4
        assert i == 183, i
        return Observation(v, NAMES)
