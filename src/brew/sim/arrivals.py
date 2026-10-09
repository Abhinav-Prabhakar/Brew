"""NHPP arrivals via thinning with common random numbers (docs/implementation-spec.md 7.2)."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from brew.config.schemas import CafeConfig, Persona
from brew.domain.enums import CHANNELS
from brew.domain.timeutil import DAY_S, parse_hhmm

from .rng import RngStreams

SLOT_S = 900
SLOTS = 96
CH_INDEX = {c: i for i, c in enumerate(CHANNELS)}


def slot_rates(p: Persona, daytype: str) -> np.ndarray:
    """Expected parties per 15-min slot (96 values, evaluated at slot midpoints).

    Piecewise-linear between listed times, tapering to 0 over 30 min outside the listed range,
    times ``arrivals_scale``.
    """
    pts = sorted((parse_hhmm(k), float(v)) for k, v in p.arrivals[daytype].items())
    mids = (np.arange(SLOTS) + 0.5) * SLOT_S
    # points more than 3 h apart start a new cluster (separate peaks, e.g. morning vs evening)
    clusters: list[list[tuple[int, float]]] = [[pts[0]]]
    for a in pts[1:]:
        if a[0] - clusters[-1][-1][0] > 10800:
            clusters.append([a])
        else:
            clusters[-1].append(a)
    out = np.zeros(SLOTS)
    for cl in clusters:
        xs = [cl[0][0] - 1800] + [a for a, _ in cl] + [cl[-1][0] + 1800]
        ys = [0.0] + [b for _, b in cl] + [0.0]
        out += np.interp(mids, xs, ys, left=0.0, right=0.0)
    return out * p.arrivals_scale * (p.weekend_scale if daytype == "weekend" else 1.0)


@dataclass
class DayPlan:
    """Pre-sampled, policy-independent description of a day's candidate arrivals (CRN)."""

    day: int
    personas: list[str]
    n: int
    t: np.ndarray
    pidx: np.ndarray
    u_thin: np.ndarray
    chan: np.ndarray
    size: np.ndarray
    patience_z: np.ndarray
    dwell_z: np.ndarray
    note_u: np.ndarray
    name_u: np.ndarray
    refill_u: np.ndarray
    seeds: np.ndarray
    reg_u: np.ndarray
    ids: np.ndarray
    n_drink: np.ndarray
    n_food: np.ndarray
    bulk: np.ndarray
    off: np.ndarray
    gumbel: np.ndarray
    mod_u: np.ndarray
    take_u: np.ndarray
    laptop_u: np.ndarray
    gumbel_rp: np.ndarray
    gumbel_addon: np.ndarray
    combo_u: np.ndarray
    day_noise: float
    static_mult: dict[str, np.ndarray]

    def fingerprint(self) -> tuple:
        """Cheap hashable summary used by CRN tests."""
        return (
            self.n,
            float(self.t.sum()),
            int(self.pidx.sum()),
            float(self.patience_z.sum()),
            float(self.gumbel.sum()),
            float(self.mod_u.sum()),
            int(self.seeds.sum(dtype=np.int64)),
        )


def _cdf_pick(u: np.ndarray, probs: list[float]) -> np.ndarray:
    cdf = np.cumsum(np.array(probs, dtype=float))
    cdf /= cdf[-1]
    return np.searchsorted(cdf, u, side="right").clip(0, len(probs) - 1)


def build_day_plan(
    cfg: CafeConfig,
    rng: RngStreams,
    day: int,
    daytype: str,
    static_mult: dict[str, np.ndarray],
    day_noise: float,
    n_sku: int,
) -> DayPlan:
    """Sample candidate arrivals for ``day`` and every latent customer draw.

    ``static_mult[persona]`` is a 96-vector of policy-independent multipliers (scenario, calendar,
    weather, day noise). Dynamic, policy-dependent multipliers are applied at thinning time.
    """
    P = list(cfg.personas)
    factor = cfg.cafe.params.lambda_max_factor
    ts: list[np.ndarray] = []
    ps: list[np.ndarray] = []
    for pi, key in enumerate(P):
        rates = slot_rates(cfg.personas[key], daytype)
        lam = rates * factor
        counts = rng.arrivals.poisson(lam)
        tot = int(counts.sum())
        slot_idx = np.repeat(np.arange(SLOTS), counts)
        t = day * DAY_S + (slot_idx + rng.arrivals.random(tot)) * SLOT_S
        ts.append(t)
        ps.append(np.full(tot, pi, dtype=np.int64))
    t_all = np.concatenate(ts) if ts else np.zeros(0)
    p_all = np.concatenate(ps) if ps else np.zeros(0, dtype=np.int64)
    order = np.argsort(t_all, kind="stable")
    t_all = t_all[order]
    p_all = p_all[order]
    n = len(t_all)
    u_thin = rng.arrivals.random(n)

    cu = rng.customers.random((n, 4))  # channel, size, laptop, bulk
    chan = np.zeros(n, dtype=np.int64)
    size = np.ones(n, dtype=np.int64)
    bulk = np.zeros(n, dtype=np.int64)
    n_drink = np.zeros(n, dtype=np.int64)
    n_food = np.zeros(n, dtype=np.int64)
    for pi, key in enumerate(P):
        sel = np.nonzero(p_all == pi)[0]
        if len(sel) == 0:
            continue
        per = cfg.personas[key]
        chs = list(per.channels)
        pick = _cdf_pick(cu[sel, 0], [per.channels[c] for c in chs])
        chan[sel] = [CH_INDEX[chs[j]] for j in pick]
        sizes = sorted(per.party_size)
        spick = _cdf_pick(cu[sel, 1], [per.party_size[s] for s in sizes])
        size[sel] = np.array(sizes)[spick]
        bi = per.basket.get("bulk_items")
        if bi:
            lo, hi = int(bi[0]), int(bi[1])
            k = lo + np.floor(cu[sel, 3] * (hi - lo + 1)).astype(np.int64)
            bulk[sel] = k
            n_drink[sel] = np.round(k * 0.6).astype(np.int64)
            n_food[sel] = k - n_drink[sel]
        else:
            n_drink[sel] = size[sel]
            n_food[sel] = (size[sel] + 1) // 2
    total = int((n_drink + n_food).sum())
    off = np.zeros(n + 1, dtype=np.int64)
    off[1:] = np.cumsum(n_drink + n_food)
    patience_z = rng.customers.standard_normal(n)
    dwell_z = rng.customers.standard_normal(n)
    name_u = rng.customers.random(n)
    refill_u = rng.customers.random((n, 8))
    seeds = rng.customers.integers(0, 2**32, size=(n, 5), dtype=np.uint64).astype(np.uint32)
    reg_u = rng.customers.random(n)
    ids = rng.customers.integers(0, 2**62, size=(n, 2), dtype=np.int64)
    note_u = rng.notes.random((n, 2))
    gumbel = rng.choice.gumbel(size=(total, n_sku + 1))
    take_u = rng.choice.random(total)
    mod_u = rng.modifiers.random((total, 4))
    gumbel_rp = rng.replate.gumbel(size=(total, n_sku))
    gumbel_addon = rng.replate.gumbel(size=total)
    combo_u = rng.combos.random(n)  # meal-combo up-sell draws (own stream: CRN-safe)
    return DayPlan(
        day=day,
        personas=P,
        n=n,
        t=t_all,
        pidx=p_all,
        u_thin=u_thin,
        chan=chan,
        size=size,
        patience_z=patience_z,
        dwell_z=dwell_z,
        note_u=note_u,
        name_u=name_u,
        refill_u=refill_u,
        seeds=seeds,
        reg_u=reg_u,
        ids=ids,
        n_drink=n_drink,
        n_food=n_food,
        bulk=bulk,
        off=off,
        gumbel=gumbel,
        mod_u=mod_u,
        take_u=take_u,
        laptop_u=cu[:, 2],
        gumbel_rp=gumbel_rp,
        gumbel_addon=gumbel_addon,
        combo_u=combo_u,
        day_noise=day_noise,
        static_mult=static_mult,
    )


def expected_daily_parties(cfg: CafeConfig, daytype: str) -> dict[str, float]:
    """Expected parties per day per persona at neutral multipliers (for calibration/tests)."""
    return {k: float(slot_rates(p, daytype).sum()) for k, p in cfg.personas.items()}
