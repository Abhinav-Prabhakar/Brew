"""RL action space (docs/implementation-spec.md 13.3): ``MultiDiscrete([5,5,5,5, 5,5,5,5, 6, 4,4, 4, 24, 2,2,2, 4, 4])``.

``decode_action`` turns a vector into the RL-controlled part of a :class:`ManagerAction`; the make-ahead level
and the prep quantiles are carried out by the executor (``policies/D_rl.py``) with Policy C's machinery.
``encode_teacher`` goes the other way: it maps what Policy C just decided to the nearest action vector
(behaviour-cloning labels).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np

from brew.domain.enums import CATEGORIES, STRATEGY_PRESETS, THROTTLE_LEVELS
from brew.policies.base import ManagerAction
from brew.sim.observation import KAPPA_CLASSES

if TYPE_CHECKING:
    from brew.sim.world import World

PRICE_STEPS = (-0.10, -0.05, 0.0, 0.05, 0.10)  # fraction of the current price, per category
KAPPA_LEVELS = (0.0, 0.50, 0.65, 0.80, 0.90)  # off, P50, P65, P80, P90 service level of a prep class
STRATEGIES = STRATEGY_PRESETS  # fcfs, edf, dine_first, delivery_jit, batch_max, throughput
THROTTLES = THROTTLE_LEVELS  # open, plus5, plus10, pause
BATCH_WINDOWS = (0.0, 30.0, 60.0, 120.0)  # s
HIDE_SKUS = ("pasta", "sandwich", "avotoast")  # 86 toggles
REPLATE_MODES = ("off", "gentle", "standard", "aggressive")
PREMAKE_LEVELS = (0.0, 0.50, 0.70, 0.85)  # none, P50, P70, P85 of the next-2 h forecast for make-ahead plates
NVEC: list[int] = [5, 5, 5, 5, 5, 5, 5, 5, 6, 4, 4, 4, 24, 2, 2, 2, 4, 4]
N_DIMS = len(NVEC)
N_LOGITS = int(sum(NVEC))
OFFSETS: list[int] = [int(x) for x in np.concatenate([[0], np.cumsum(NVEC)[:-1]])]

# dimension indices
D_PRICE = 0  # 0..3
D_KAPPA = 4  # 4..7
D_STRATEGY = 8
D_THROTTLE = 9  # 9..10
D_BATCH = 11
D_FEATURED = 12
D_HIDE = 13  # 13..15
D_REPLATE = 16
D_PREMAKE = 17

DIM_NAMES: list[str] = (
    [f"price_{c}" for c in CATEGORIES]
    + [f"kappa_{k}" for k in KAPPA_CLASSES]
    + ["strategy", "throttle_zomato", "throttle_swiggy", "batch_window", "featured"]
    + [f"hide_{s}" for s in HIDE_SKUS]
    + ["replate_mode", "premake_level"]
)
assert len(DIM_NAMES) == N_DIMS
NOOP = np.array([2, 2, 2, 2, 0, 0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 0, 2, 2], dtype=np.int64)


def default_vector() -> np.ndarray:
    """A conservative action (no price change, standard prep levels, EDF, standard Replate)."""
    v = NOOP.copy()
    v[D_KAPPA : D_KAPPA + 4] = 3  # P80
    v[D_PREMAKE] = 2  # P70
    return v


def split_mask(mask: np.ndarray) -> list[np.ndarray]:
    """Per-dimension slices of the flat 96-wide mask."""
    return [mask[o : o + n] for o, n in zip(OFFSETS, NVEC, strict=True)]


def sanitize(vec: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Shield: replace any dimension the mask forbids by the safest valid index (the 'no change' one)."""
    out = np.asarray(vec, dtype=np.int64).copy()
    safe = NOOP
    for d, (o, n) in enumerate(zip(OFFSETS, NVEC, strict=True)):
        m = mask[o : o + n]
        i = int(out[d])
        if 0 <= i < n and m[i]:
            continue
        if m[min(int(safe[d]), n - 1)]:
            out[d] = safe[d]
        else:
            out[d] = int(np.argmax(m))
    return out


def decode_action(vec: np.ndarray, w: World) -> ManagerAction:
    """RL-controlled fields of the manager action.  Everything passes the charter shield in ``World``."""
    v = [int(x) for x in vec]
    a = ManagerAction()
    for i, cat in enumerate(CATEGORIES):
        step = PRICE_STEPS[v[D_PRICE + i]]
        if step != 0.0:
            a.price_steps[cat] = step
    for i, key in enumerate(KAPPA_CLASSES):
        a.kappa[key] = KAPPA_LEVELS[v[D_KAPPA + i]]
    a.strategy = STRATEGIES[v[D_STRATEGY]]
    a.throttles = {"zomato": THROTTLES[v[D_THROTTLE]], "swiggy": THROTTLES[v[D_THROTTLE + 1]]}
    a.batch_window_s = BATCH_WINDOWS[v[D_BATCH]]
    f = v[D_FEATURED]
    a.featured = "" if f == 0 else w.cfg.menu[f - 1].sku
    a.featured_exclusive = True
    for i, sku in enumerate(HIDE_SKUS):
        m = w.menu[sku]
        want = bool(v[D_HIDE + i])
        if want and m.hidden is None:
            a.hide[sku] = True
        elif not want and m.hidden is not None and m.hidden_kind == "owner":
            a.hide[sku] = False
    a.replate_mode = REPLATE_MODES[v[D_REPLATE]]
    return a


def nearest(values: tuple[float, ...], x: float, lo: int = 0) -> int:
    """Index (>= ``lo``) of the entry of ``values`` closest to ``x``."""
    best, bd = lo, 1e18
    for i in range(lo, len(values)):
        d = abs(values[i] - x)
        if d < bd - 1e-12:
            best, bd = i, d
    return best


def encode_teacher(
    kappa_ratio: dict[str, float], premake_ratio: list[float], price_steps: dict[str, float],
    batch_window_s: float, replate_idx: int = 1,
) -> np.ndarray:  # fmt: skip
    """Nearest action vector for what Policy C decided this tick (behaviour-cloning label).

    ``kappa_ratio`` are C's newsvendor critical ratios per prep class, ``premake_ratio`` the critical ratios
    of the make-ahead plates it evaluated (empty = it did not consider making ahead), ``price_steps`` the
    category steps of the hourly pricing ladder.
    """
    v = NOOP.copy()
    for i, cat in enumerate(CATEGORIES):
        v[D_PRICE + i] = nearest(PRICE_STEPS, price_steps.get(cat, 0.0))
    for i, key in enumerate(KAPPA_CLASSES):
        r = kappa_ratio.get(key)
        v[D_KAPPA + i] = 3 if r is None else nearest(KAPPA_LEVELS, r, lo=1)
    v[D_STRATEGY] = STRATEGIES.index("edf")
    v[D_BATCH] = nearest(BATCH_WINDOWS, batch_window_s)
    v[D_REPLATE] = replate_idx
    if premake_ratio:
        v[D_PREMAKE] = nearest(PREMAKE_LEVELS, float(np.mean(premake_ratio)), lo=1)
    else:
        v[D_PREMAKE] = 0
    return v
