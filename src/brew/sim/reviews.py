"""Satisfaction, reviews, Bayesian reputation, loyalty (docs/implementation-spec.md 7.8)."""

from __future__ import annotations

import math
from typing import TYPE_CHECKING

from brew.domain.enums import CAUSES, channel_group

if TYPE_CHECKING:
    from .state import Order, Party
    from .world import World

GROUPS = ("offline", "zomato", "swiggy")


class Reputation:
    """Per-channel-group Bayesian average of star ratings (prior mean 4.3, weight 50)."""

    def __init__(self, initial: dict[str, tuple[float, float]], prior_mean: float, prior_w: float) -> None:
        self.prior_mean = prior_mean
        self.prior_w = prior_w
        self.sum = {g: initial[g][0] * initial[g][1] for g in GROUPS}
        self.n = {g: float(initial[g][1]) for g in GROUPS}

    def add(self, group: str, stars: int) -> None:
        self.sum[group] += stars
        self.n[group] += 1

    def rating(self, group: str) -> float:
        """Bayesian average for one group: ``(w*m + sum) / (w + n)``."""
        return (self.prior_w * self.prior_mean + self.sum[group]) / (self.prior_w + self.n[group])

    def overall(self) -> float:
        """HUD rating: group ratings weighted by review counts."""
        tot = sum(self.n.values())
        return sum(self.rating(g) * self.n[g] for g in GROUPS) / tot if tot else self.prior_mean

    def count(self) -> int:
        return int(sum(self.n.values()))


def satisfaction(
    lateness_s: float,
    patience_s: float,
    quality: float,
    paid: float,
    ref_total: float,
    accuracy: float,
    ambience: float,
    unfairness: float,
) -> tuple[float, dict[str, float]]:
    """``S = .35(1-min(1,late/patience)) + .25 q + .2 vfm + .1 acc + .1 amb - .15 unfair`` in [0,1].

    Returns ``(S, components)``. Times in seconds, money in INR.
    """
    wait = 1.0 - min(1.0, max(0.0, lateness_s) / max(1.0, patience_s))
    vfm = min(1.0, max(0.0, 1.0 - (paid / max(1.0, ref_total) - 1.0) * 2.0))
    s = 0.35 * wait + 0.25 * quality + 0.2 * vfm + 0.1 * accuracy + 0.1 * ambience - 0.15 * unfairness
    return min(1.0, max(0.0, s)), {
        "wait": wait,
        "quality": quality,
        "value": vfm,
        "accuracy": accuracy,
        "ambience": ambience,
        "unfair": unfairness,
    }


def cause_weights(
    comp: dict[str, float], stars: int, channel: str, errors: int, pack_short: bool
) -> dict[str, float]:
    """Normalised cause vector. Negative reviews: deficits; positive: strengths."""
    agg = channel in ("zomato", "swiggy")
    if stars <= 3:
        raw = {
            "wait": 1 - comp["wait"],
            "cold_food": (1 - comp["quality"]) if agg else 0.0,
            "price": comp["unfair"],
            "quality": 0.0 if agg else (1 - comp["quality"]),
            "ambience": 1 - comp["ambience"],
            "staff": min(1.0, 0.5 * errors),
            "accuracy": 1 - comp["accuracy"],
            "packaging": 1.0 if pack_short else 0.0,
            "value": 1 - comp["value"],
        }
    else:
        raw = {
            "wait": comp["wait"] - 0.7,
            "cold_food": (comp["quality"] - 0.8) if agg else 0.0,
            "price": 0.0,
            "quality": comp["quality"] - 0.7,
            "ambience": comp["ambience"] - 0.6,
            "staff": 0.3 if errors == 0 else 0.0,
            "accuracy": comp["accuracy"] - 0.8,
            "packaging": 0.0 if pack_short else 0.2,
            "value": comp["value"] - 0.7,
        }
    raw = {k: max(0.0, v) for k, v in raw.items() if k in CAUSES}
    z = sum(raw.values())
    if z <= 1e-9:
        return {"quality": 1.0}
    return {k: round(v / z, 3) for k, v in raw.items() if v / z >= 0.02}


class Reviews:
    """Turns finished orders into satisfaction, star ratings, review text and reputation."""

    def __init__(self, w: World) -> None:
        self.w = w
        c = w.cfg.cafe
        self.rep = Reputation(
            {g: (c.initial_reputation[g].rating, c.initial_reputation[g].n) for g in GROUPS},
            c.reputation_prior["mean"],
            c.reputation_prior["weight"],
        )
        self.neg_today = 0
        self.stars_today: list[int] = []
        self.log: list[dict] = []  # recent reviews for the API (bounded)
        self.satisfaction_sum = 0.0
        self.sat_n = 0

    def rate_order(self, o: Order, party: Party | None, ambience: float) -> dict | None:
        """Compute satisfaction for a completed order and maybe post a review. Returns the review row."""
        w = self.w
        per = w.cfg.personas[o.persona]
        params = w.cfg.cafe.params
        lateness = max(0.0, (o.delivered_s or o.served_s) - o.promised_s)
        # fairness: average live-vs-reference price gap over lines
        unfair = 0.0
        n = 0
        for ln in o.lines:
            m = w.menu[ln["sku"]]
            ref = max(1.0, m.ref_price)
            unfair += (
                max(0.0, math.log(max(1.0, ln["unit_price"] - w.mod_delta(ln["mods"])) / ref)) * ln["qty"]
            )
            n += ln["qty"]
        unfair = unfair / n if n else 0.0
        paid = o.subtotal or sum(ln["unit_price"] * ln["qty"] for ln in o.lines)
        ref_total = o.ref_total or paid
        acc = 1.0 - 0.4 * min(1, o.remakes) - (0.3 if o.errors else 0.0)
        s, comp = satisfaction(
            lateness, per.patience_s[0], o.quality, paid, ref_total, max(0.0, acc), ambience, unfair
        )
        unhappy = bool(party and party.unhappy) or o.unhappy
        if unhappy:
            s = max(0.0, s - 0.2)
        self.satisfaction_sum += s
        self.sat_n += 1
        if party is not None and party.reg_idx >= 0:
            w.update_regular(party.reg_idx, s)
        grp = channel_group(o.channel)
        agg = grp != "offline"
        p_rev = per.review_prob * (1 + 3 * abs(s - 0.6)) * (1.5 if agg else 1.0)
        rng = w.rng.reviews
        if rng.random() >= min(0.95, p_rev):
            return None
        wait_dom = comp["wait"] < 0.5
        s_adj = s - (0.1 * (per.negativity_bias - 1.0) if wait_dom else 0.0)
        stars = int(min(5, max(1, 1 + round(4 * s_adj + rng.normal(0, params.review_noise)))))
        pack_short = o.order_no in w.orders.pack_short
        causes = cause_weights(comp, stars, o.channel, o.errors + o.remakes, pack_short)
        top = max(causes, key=lambda k: causes[k])
        text = w.corp.reviews.sample(stars, top, grp, float(rng.random()))
        self.rep.add(grp, stars)
        self.stars_today.append(stars)
        if stars <= 2:
            self.neg_today += 1
        rid = w.new_id()
        row = {
            "review_id": rid,
            "party_id": party.id if party else None,
            "order_no": o.order_no,
            "stars": stars,
            "text": text,
            "causes": causes,
            "channel": o.channel,
            "persona": o.persona,
            "sim_s": w.now,
            "satisfaction": round(s, 3),
        }
        self.log.append(row)
        if len(self.log) > 500:
            del self.log[:100]
        o.reviewed = True
        w.emit(
            "review.posted",
            review_id=rid,
            party_id=row["party_id"],
            order_no=o.order_no,
            stars=stars,
            text=text,
            causes=causes,
            channel=o.channel,
            persona=o.persona,
        )
        return row

    def reputation_mult(self, channel: str) -> float:
        """Demand multiplier ``clip((rating/4.3)^2, 0.6, 1.25)`` for the channel's group."""
        r = self.rep.rating(channel_group(channel))
        return min(1.25, max(0.6, (r / 4.3) ** 2.0))
