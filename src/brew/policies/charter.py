"""Fair pricing charter - the hard shield applied to every price change (technical.md 8.3)."""

from __future__ import annotations

from dataclasses import dataclass

from brew.config.schemas import CharterConfig, MenuItem
from brew.domain.money import to_grid


class CharterViolation(Exception):
    """A requested change breaks a charter rule and cannot be clipped into compliance."""


@dataclass(slots=True)
class PriceCheck:
    ok: bool
    price: float  # the (possibly clipped) price that may be applied
    clipped: bool = False
    reason: str = ""


class Charter:
    """Pure rule engine. State (last change time, current price) comes from the caller."""

    def __init__(self, cfg: CharterConfig) -> None:
        self.cfg = cfg

    def check_price(
        self,
        item: MenuItem,
        current: float,
        proposed: float,
        now: float,
        last_change_s: float,
        promotion: bool = False,
        restore: bool = False,
        strict: bool = False,
    ) -> PriceCheck:
        """Validate/clip a price change.

        Rules: snap to the Rs5 grid; ``min <= p <= max``; ``|p - current| <= 10% of base`` unless a
        promotion (decreases only, never below min); at most one change per cooldown window;
        staples never increase (restoring a promo back to <= base is allowed).
        With ``strict`` a violation raises :class:`CharterViolation` instead of clipping.
        """
        c = self.cfg
        grid = c.price_grid
        p = to_grid(proposed, grid)
        reasons: list[str] = []
        base = item.base_price

        def fail(msg: str) -> PriceCheck:
            if strict:
                raise CharterViolation(f"{item.sku}: {msg}")
            return PriceCheck(False, current, False, msg)

        if p == current:
            return PriceCheck(True, current)
        if item.staple and p > current and not (restore and p <= base):
            return fail("staple items cannot increase in price")
        if promotion:
            if p > current and c.promotion_decrease_only:
                return fail("promotions may only decrease prices")
            if p < item.min_price:
                if strict:
                    raise CharterViolation(f"{item.sku}: promotion below minimum price")
                p = item.min_price
                reasons.append("clipped to min price")
        else:
            if not restore and now - last_change_s < c.cooldown_s:
                return fail("price changed less than 2 sim-hours ago")
            step_cap = c.max_step_frac * base
            if abs(p - current) > step_cap + 1e-9 and not restore:
                if strict:
                    raise CharterViolation(f"{item.sku}: step exceeds {c.max_step_frac:.0%} of base")
                sign = 1 if p > current else -1
                p = to_grid(current + sign * step_cap, grid)
                if abs(p - current) > step_cap + 1e-9:
                    p -= sign * grid
                reasons.append("clipped to 10% step")
            if p > item.max_price or p < item.min_price:
                if strict:
                    raise CharterViolation(f"{item.sku}: price outside [{item.min_price}, {item.max_price}]")
                p = min(item.max_price, max(item.min_price, p))
                reasons.append("clipped to bounds")
            if item.staple and p > current and not restore:
                return fail("staple items cannot increase in price")
        if p == current:
            return PriceCheck(False, current, True, "; ".join(reasons) or "no change after clipping")
        return PriceCheck(True, p, bool(reasons), "; ".join(reasons))
