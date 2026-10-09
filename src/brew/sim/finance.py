"""Ledger, receipts and GST (technical.md 7.9)."""

from __future__ import annotations

from collections import defaultdict
from typing import TYPE_CHECKING, Any

from brew.domain.money import round2, round_rupee

if TYPE_CHECKING:
    from .state import Order
    from .world import World

ACCOUNTS = (
    "revenue", "discount", "gst_collected", "cogs", "commission", "payment_fee", "packaging", "labour",
    "energy", "waste", "rent", "maintenance", "capex", "depreciation", "refund", "donation_writeoff",
)  # fmt: skip
# accounts that reduce profit (booked as positive costs)
COST_ACCOUNTS = (
    "discount", "cogs", "commission", "payment_fee", "packaging", "labour", "energy", "waste", "rent",
    "maintenance", "depreciation", "refund", "donation_writeoff",
)  # fmt: skip
UPI = 0.70
CARD = 0.15


def _zero_accounts() -> dict[str, float]:
    return dict.fromkeys(ACCOUNTS, 0.0)


class Ledger:
    """Per-day account totals (INR). ``capex`` and ``gst_collected`` never touch profit."""

    def __init__(self, keep_entries: bool = False) -> None:
        self.day: dict[int, dict[str, float]] = defaultdict(_zero_accounts)
        self.total: dict[str, float] = dict.fromkeys(ACCOUNTS, 0.0)
        self.keep_entries = keep_entries
        self.entries: list[tuple[float, int, str, float]] = []

    def post(self, now: float, day: int, account: str, amount: float) -> None:
        """Book ``amount`` (positive) to ``account``."""
        self.day[day][account] += amount
        self.total[account] += amount
        if self.keep_entries:
            self.entries.append((now, day, account, amount))

    @staticmethod
    def profit_of(acct: dict[str, float]) -> float:
        """Net profit = revenue - all cost accounts (GST and capex excluded)."""
        return round2(acct["revenue"] - sum(acct[a] for a in COST_ACCOUNTS))

    def profit(self, day: int) -> float:
        return self.profit_of(self.day[day])

    def revenue(self, day: int) -> float:
        return round2(self.day[day]["revenue"] - self.day[day]["refund"])


class Finance:
    """Cash, ledger postings, receipts."""

    def __init__(self, w: World, keep_entries: bool = False) -> None:
        self.w = w
        self.ledger = Ledger(keep_entries)
        self.cash = w.cfg.cafe.cash_start
        self.orders_paid = 0
        self.gst_total = 0.0
        self.revenue_by_channel: dict[str, float] = defaultdict(float)
        self.today_orders_rev = 0.0  # independent revenue counter (cross-check)
        self.daily_orders_rev: dict[int, float] = defaultdict(float)

    def post(self, account: str, amount: float) -> None:
        if amount:
            self.ledger.post(self.w.now, self.w.day, account, amount)

    # --------------------------------------------------------------- receipts
    def build_receipt(self, o: Order) -> dict[str, Any]:
        """Itemised receipt: GST 5% on (subtotal - discount) split CGST/SGST, rupee round-off."""
        cfg = self.w.cfg
        lines = []
        subtotal = 0.0
        for ln in o.lines:
            amt = round2(ln["unit_price"] * ln["qty"])
            subtotal += amt
            lines.append(
                {
                    "sku": ln["sku"],
                    "name": self.w.ix.menu[ln["sku"]].name,
                    "qty": ln["qty"],
                    "mods": list(ln["mods"]),
                    "unit_price": ln["unit_price"],
                    "amount": amt,
                    "replate": bool(ln.get("replate")),
                }
            )
        subtotal = round2(subtotal)
        discount = round2(o.discount)
        base = subtotal - discount
        cgst = round2(base * cfg.cafe.cgst_rate)
        sgst = round2(base * cfg.cafe.sgst_rate)
        raw = base + cgst + sgst
        total = float(round_rupee(raw))
        round_off = round2(total - raw)
        return {
            "order_no": o.order_no,
            "lines": lines,
            "subtotal": subtotal,
            "discount": discount,
            "cgst": cgst,
            "sgst": sgst,
            "round_off": round_off,
            "total": total,
        }

    def pay_method(self, channel: str, u: float) -> str:
        if channel in ("zomato", "swiggy"):
            return "platform"
        if self.w.dis.power_cut:
            return "cash"
        return "upi" if u < UPI else ("card" if u < UPI + CARD else "cash")

    def collect(self, o: Order, u: float) -> None:
        """Take payment for ``o``: receipt, ledger, cash, events. Idempotent per order."""
        if o.paid:
            return
        w = self.w
        ch = w.ix.channel[o.channel]
        rc = self.build_receipt(o)
        method = self.pay_method(o.channel, u)
        o.paid = True
        o.pay_method = method
        o.subtotal = rc["subtotal"]
        o.total = rc["total"]
        o.receipt = {**rc, "payment": method}
        # revenue (ex-GST) incl. rupee round-off; GST is a liability
        self.post("revenue", rc["subtotal"])
        self.post("discount", rc["discount"])
        self.post("gst_collected", rc["cgst"] + rc["sgst"])
        if rc["round_off"] >= 0:
            self.post("revenue", rc["round_off"])
        else:
            self.post("discount", -rc["round_off"])
        fee = round2(rc["total"] * ch.gateway_fee) if method in ("upi", "card") else 0.0
        comm = round2(rc["subtotal"] * ch.commission)
        pack = ch.packaging_cost * max(1, o.items_n) if ch.kind == "aggregator" else 0.0
        self.post("payment_fee", fee)
        self.post("commission", comm)
        self.post("packaging", pack)
        self.cash += rc["total"] - fee - comm
        self.orders_paid += 1
        self.gst_total += rc["cgst"] + rc["sgst"]
        net = rc["subtotal"] - rc["discount"] + max(0.0, rc["round_off"])
        self.revenue_by_channel[o.channel] += net
        self.daily_orders_rev[w.day] += rc["subtotal"] - rc["discount"] + rc["round_off"]
        qr = f"upi://pay?pa=brew@upi&pn=brew&am={rc['total']:.2f}&tn=order{o.order_no}"
        o.receipt["qr"] = qr
        w.emit(
            "receipt.printed",
            order_no=o.order_no,
            lines=rc["lines"],
            subtotal=rc["subtotal"],
            discount=rc["discount"],
            cgst=rc["cgst"],
            sgst=rc["sgst"],
            round_off=rc["round_off"],
            total=rc["total"],
            payment=method,
            qr=qr,
        )
        w.emit("payment.received", order_no=o.order_no, amount=rc["total"], method=method)

    def refund(self, o: Order) -> None:
        """Reverse a paid order (void / walkout)."""
        if not o.paid or o.receipt is None or o.receipt.get("refunded"):
            return
        rc = o.receipt
        self.post("refund", rc["subtotal"] - rc["discount"])
        self.post("gst_collected", -(rc["cgst"] + rc["sgst"]))
        self.cash -= rc["total"]
        o.receipt["refunded"] = True
        self.daily_orders_rev[self.w.day] -= rc["subtotal"] - rc["discount"] + rc["round_off"]

    # ------------------------------------------------------------- day close
    def close_day(self, day: int, staff_cost: float) -> None:
        """Book labour already accrued plus rent, energy, maintenance, depreciation; pay cash costs."""
        w = self.w
        cfg = w.cfg.cafe
        if staff_cost:
            self.post("labour", staff_cost)
        self.post("rent", cfg.rent_per_day)
        open_h = (cfg.close_s - cfg.open_s) / 3600.0
        kwh = 0.0
        maint = 0.0
        dep = 0.0
        for e in w.equip:
            active_h = e.active_s / 3600.0
            kwh += e.kw_active * active_h + e.kw_idle * max(0.0, open_h - active_h)
            maint += e.maintenance_per_day
            dep += e.capex / cfg.depreciation_life_days
            e.active_s = 0.0
        w.kpi.energy_kwh_today = kwh
        self.post("energy", round2(kwh * cfg.energy_rate_per_kwh))
        self.post("maintenance", maint)
        self.post("depreciation", round2(dep))
        extra_opex = sum(c["opex"] for c in w.invest_log if c["delivered"])
        self.post("maintenance", extra_opex)
        self.cash -= staff_cost + cfg.rent_per_day + kwh * cfg.energy_rate_per_kwh + maint + extra_opex
