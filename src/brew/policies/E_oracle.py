"""Policy E - perfect-information oracle (upper bound; never used live) - technical.md 8.4.

E is policy C with ``forecast = truth``: it reads the day's pre-sampled arrival plan (the CRN draws that
define who the customers are), thins it with the current multipliers, runs the choice model on every
future arrival and so knows the exact units each SKU will sell in every slot (at current prices and
availability).  The CP-SAT limit is 200 ms and pricing uses the true demand.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np

from brew.domain.timeutil import tod_s
from brew.policies.base import ManagerAction
from brew.policies.C_solver import PolicyC
from brew.sim.demandlog import fg_index

if TYPE_CHECKING:
    from brew.sim.observation import Observation
    from brew.sim.views import WorldView


class PolicyE(PolicyC):
    """Oracle: policy C driven by the true future demand."""

    code = "E"
    default_replate_mode = "custom"

    def __init__(self, models_dir: str | Path | None = None, **kw: Any) -> None:
        kw.setdefault("use_models", True)
        super().__init__(models_dir=models_dir, **kw)
        self._oracle_stamp: tuple[int, int] = (-1, -1)

    def reset(self, view: WorldView, seed: int) -> None:
        super().reset(view, seed)
        self.P["solver"]["time_limit_s"] = 0.2
        self.P["solver"]["max_solves_per_day"] = 40
        self._oracle_stamp = (-1, -1)
        assert self.demand is not None
        self.demand.dispersion = 1.15  # almost no uncertainty left
        self.demand.calibrate = False

    def on_manager_tick(self, obs: Observation, view: WorldView) -> ManagerAction:
        self._refresh_oracle(view)
        return super().on_manager_tick(obs, view)

    def _refresh_oracle(self, view: WorldView) -> None:
        w = view.oracle_world()
        slot = int(tod_s(w.now) // 900)
        stamp = (w.day, slot // 4)  # hourly refresh (prices / availability drift slowly)
        if stamp == self._oracle_stamp or w.plan is None:
            return
        self._oracle_stamp = stamp
        plan = w.plan
        d = self.demand
        assert d is not None
        arr = np.zeros((96, len(d.skus), 2), dtype=np.float32)
        idx = d.idx
        for i in range(plan.n):
            if plan.t[i] < w.now - 300:
                continue
            pkey = plan.personas[int(plan.pidx[i])]
            ch = ("dine_in", "takeaway", "zomato", "swiggy")[int(plan.chan[i])]
            s = int(tod_s(float(plan.t[i])) // 900)
            sl = min(95, s)
            static = float(plan.static_mult[pkey][sl])
            dyn = w.dynamic_mult(pkey, ch)
            if plan.u_thin[i] >= min(1.0, static * dyn / w.cfg.cafe.params.lambda_max_factor):
                continue
            basket = w.customers.build_basket(plan, i, pkey, apply_outside=True)
            if not basket:
                continue
            fg = fg_index(ch)
            # orders are placed a few minutes after arrival (queue + register)
            so = min(95, int((tod_s(float(plan.t[i])) + 180.0) // 900))
            for sku, _mods in basket:
                arr[so, idx[sku], fg] += 1.0
        d.oracle = arr
        d._stamp = (-1, -1)  # force the demand service to rebuild its horizon arrays
