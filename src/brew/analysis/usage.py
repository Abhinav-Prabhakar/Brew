"""Today's ingredient usage forecast: the SKU demand forecast pushed through the bill of materials.

Same demand path as ``GET /forecast`` (``DemandService`` over the LightGBM forecaster, moving-average fallback).
For every inventory key we report the usage still to come today plus what was already used:

* ``p50`` = ``used_so_far`` + sum over remaining slots and SKUs of ``BOM[sku][key] * p50[slot, sku]``
* ``p90`` = ``p50`` + 1.2816 * sqrt(sum over remaining slots/SKUs of (BOM * (p90 - p50) / 1.2816)^2): the per-slot
  spreads of the quantile forecast are combined in quadrature (independent slots and SKUs), so the day's P90 is not
  the (far too high) sum of slot P90s.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from brew.policies.demand import CLOSE_SLOT, DemandService

Z90 = 1.2816


def usage_forecast(w: Any, forecaster: Any = None) -> dict[str, dict[str, float]]:
    """``{key: {p50, p90, used_so_far, remaining_p50}}`` for every non-virtual inventory key (base units)."""
    cfg = w.cfg
    skus = [m.sku for m in cfg.menu]
    cats = [str(m.cat) for m in cfg.menu]
    svc = DemandService(skus, cats, forecaster)
    view = w.view()
    slot = int(view.tod_s // 900)
    day_over = slot >= CLOSE_SLOT or int(w.now // 86400) > w.day  # closed, or past midnight before the next day starts
    n = 0
    if not day_over:
        fa = svc.refresh(view, max(1, CLOSE_SLOT - max(slot, 28)))
        n = len(fa.slots)
    carry = view.carry_share()
    rem: dict[str, float] = {}
    var: dict[str, float] = {}
    if n:
        p50 = fa.p50.sum(axis=(0, 2))  # (n_sku,) units over the remaining day
        spread2 = (np.maximum(fa.p90 - fa.p50, 0.0) ** 2).sum(axis=(0, 2))
        for j, sku in enumerate(skus):
            if p50[j] <= 0 and spread2[j] <= 0:
                continue
            coef = svc.key_usage(view, {sku: 1.0}, carry)
            for key, q in coef.items():
                rem[key] = rem.get(key, 0.0) + q * float(p50[j])
                var[key] = var.get(key, 0.0) + (q * q) * float(spread2[j]) / (Z90 * Z90)
    out: dict[str, dict[str, float]] = {}
    for key in w.inv.onhand:
        if key in w.inv.virtual:
            continue
        used = max(0.0, w.inv.mov[key]["consume"] - w.inv.day_mark.get(key, 0.0))
        r = rem.get(key, 0.0)
        out[key] = {
            "used_so_far": used,
            "remaining_p50": r,
            "p50": used + r,
            "p90": used + r + Z90 * float(np.sqrt(var.get(key, 0.0))),
        }
    return out
