"""Action masks (docs/implementation-spec.md 13.3): charter-invalid price steps, unaffordable prep, blocked 86s, ...

``compute_masks(world)`` returns a flat boolean vector of ``sum(NVEC) = 96`` entries (one block per action
dimension).  It is never all-false in any block: the 'no change' index (price 0 %, prep off, open, show,
none) is always valid.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np

from brew.domain.enums import CATEGORIES
from brew.sim.observation import KAPPA_CLASSES

from .actions import (
    D_FEATURED,
    D_HIDE,
    D_KAPPA,
    D_PRICE,
    D_THROTTLE,
    HIDE_SKUS,
    N_LOGITS,
    NVEC,
    OFFSETS,
    PRICE_STEPS,
)

if TYPE_CHECKING:
    from brew.sim.world import World


def compute_masks(w: World) -> np.ndarray:
    """Flat validity mask for ``MaskablePPO`` (True = allowed)."""
    m = np.ones(N_LOGITS, dtype=bool)
    now = w.now
    # --- price steps: valid iff the charter lets at least one SKU of the category move
    by_cat: dict[str, list[str]] = {c: [] for c in CATEGORIES}
    for it in w.cfg.menu:
        by_cat[it.cat].append(it.sku)
    for ci, cat in enumerate(CATEGORIES):
        o = OFFSETS[D_PRICE + ci]
        for si, step in enumerate(PRICE_STEPS):
            if step == 0.0:
                continue
            ok = False
            for sku in by_cat[cat]:
                item = w.ix.menu[sku]
                if item.staple and step > 0:
                    continue
                ms = w.menu[sku]
                chk = w.charter.check_price(item, ms.price, ms.price * (1.0 + step), now, ms.last_change_s)
                if chk.ok and chk.price != ms.price:
                    ok = True
                    break
            m[o + si] = ok
    # --- kappa > off needs the components of one batch
    for ki, key in enumerate(KAPPA_CLASSES):
        p = w.ix.prep[key]
        enough = all(w.inv.usable(c.ingredient, now) >= c.qty for c in p.components)
        if not enough:
            o = OFFSETS[D_KAPPA + ki]
            m[o + 1 : o + NVEC[D_KAPPA + ki]] = False
    # --- throttle: no more than 2 paused hours per day
    for i, ch in enumerate(("zomato", "swiggy")):
        if w.delivery.paused_hours_today.get(ch, 0) >= 2:
            m[OFFSETS[D_THROTTLE + i] + 3] = False
    # --- featured: only visible items
    o = OFFSETS[D_FEATURED]
    for j, it in enumerate(w.cfg.menu):
        if w.menu[it.sku].hidden is not None:
            m[o + 1 + j] = False
    # --- 86 toggles: hiding blocked while open orders still need the item
    for i, sku in enumerate(HIDE_SKUS):
        if w.menu[sku].hidden is None and w.has_unstarted_tasks(sku):
            m[OFFSETS[D_HIDE + i] + 1] = False
    return m


def assert_valid(mask: np.ndarray) -> bool:
    """True when every dimension has at least one valid index."""
    return all(bool(mask[o : o + n].any()) for o, n in zip(OFFSETS, NVEC, strict=True))
