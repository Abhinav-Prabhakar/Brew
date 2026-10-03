"""Read-only facades handed to policies: WorldView, OrderView."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import numpy as np

from brew.domain.timeutil import tod_s

if TYPE_CHECKING:
    from .state import Task
    from .world import World


@dataclass(slots=True, frozen=True)
class OrderView:
    """Snapshot of an incoming order for the accept decision."""

    order_no: int
    channel: str
    persona: str
    n_items: int
    skus: tuple[str, ...]
    est_prep_s: float
    queue_delay_s: float
    promise_s: float  # default promised sim time
    open_agg_orders: int
    open_orders: int
    age_s: float
    throttle: str


class WorldView:
    """Read-only facade over a World. Methods return copies/immutables; no mutation is possible."""

    __slots__ = ("_w",)

    def __init__(self, w: World) -> None:
        self._w = w

    # ----- time & environment
    @property
    def now(self) -> float:
        return self._w.now

    @property
    def day(self) -> int:
        return self._w.day

    @property
    def tod_s(self) -> float:
        return tod_s(self._w.now)

    @property
    def hour(self) -> float:
        return tod_s(self._w.now) / 3600.0

    @property
    def is_weekend(self) -> bool:
        return self._w.is_weekend()

    @property
    def weather(self) -> str:
        return self._w.weather_state

    @property
    def temp_c(self) -> float:
        return self._w.temp_c

    @property
    def rain_mm_h(self) -> float:
        return self._w.rain_mm_h

    @property
    def policy_code(self) -> str:
        return self._w.policy.code

    @property
    def strategy(self) -> str:
        return self._w.manual_strategy

    @property
    def preset(self) -> str:
        return self._w.effective_preset()

    @property
    def channel_boost(self) -> dict[str, float]:
        return dict(self._w.channel_boost())

    def supplier_for(self, ingredient: str) -> str:
        return self._w.suppliers.supplier_for(ingredient)

    def config_prep(self, key: str) -> Any:
        return self._w.ix.prep[key]

    @property
    def batch_window_s(self) -> float:
        return self._w.batch_window_s

    @property
    def config(self) -> Any:
        return self._w.cfg

    @property
    def charter(self) -> Any:
        return self._w.pol_cfg.charter

    @property
    def strategies(self) -> Any:
        return self._w.pol_cfg.strategies

    @property
    def rng(self) -> np.random.Generator:
        """The policy RNG stream (``world.rng.policy``)."""
        return self._w.rng.policy

    # ----- menu
    def price(self, sku: str) -> float:
        return self._w.menu[sku].price

    def base_price(self, sku: str) -> float:
        return self._w.menu[sku].base

    def hidden(self, sku: str) -> str | None:
        return self._w.menu[sku].hidden

    def featured(self) -> tuple[str, ...]:
        return tuple(s for s, m in self._w.menu.items() if m.featured)

    def last_price_change_s(self, sku: str) -> float:
        return self._w.menu[sku].last_change_s

    def sold_today(self, sku: str) -> int:
        return self._w.menu[sku].sold_today

    # ----- operations
    def load_pct(self) -> float:
        return self._w.kitchen.load_pct()

    def open_orders(self) -> dict[str, int]:
        return self._w.orders.open_by_channel()

    def open_aggregator_orders(self) -> int:
        return self._w.delivery.open_aggregator_orders()

    def throttle(self, channel: str) -> str:
        return self._w.delivery.throttle.get(channel, "open")

    def queue_len(self, station: str) -> int:
        return self._w.kitchen.queue_len(station)

    def register_queue(self) -> int:
        return len(self._w.customers.queue)

    def staff_present(self) -> int:
        return len(self._w.kitchen.present_staff())

    def tables_free(self) -> int:
        return sum(1 for t in self._w.tables.values() if t.state == "free")

    def ready_tasks(self) -> list[Task]:
        return [t for t in self._w.kitchen.ready if t.state == 1]

    # ----- inventory
    def onhand(self, key: str) -> float:
        return self._w.inv.onhand[key]

    def usable(self, key: str) -> float:
        return self._w.inv.usable(key, self._w.now)

    def prep_inflight(self, key: str) -> float:
        return self._w.kitchen.prep_inflight.get(key, 0.0)

    def on_order(self, ingredient: str) -> float:
        return self._w.suppliers.open_for(ingredient)

    def usage_per_day(self, key: str) -> float:
        return self._w.ma.key_usage_per_day(key)

    def sku_usage_per_day(self, sku: str) -> float:
        return self._w.ma.sku_usage_per_day(sku)

    def expected_demand(self, cat: str, group: str, slot: int) -> tuple[float, float, float]:
        """(P10, P50, P90) items expected in the 15-min ``slot`` (moving-average estimator)."""
        return self._w.ma.band(cat, group, slot)

    def ingredient_keys(self) -> list[str]:
        return list(self._w.inv.onhand)

    # ----- finance & reputation
    @property
    def cash(self) -> float:
        return self._w.fin.cash

    def profit_today(self) -> float:
        return self._w.kpi.profit_today()

    def rating(self, group: str = "all") -> float:
        rep = self._w.reviews.rep
        return rep.overall() if group == "all" else rep.rating(group)

    # ----- demand history & replate (M2)
    def demand_log(self) -> Any:
        """The in-world per-slot demand history (read-only use)."""
        return self._w.dlog

    @property
    def replate_mode(self) -> str:
        return self._w.replate.mode

    @property
    def replate_override(self) -> bool:
        return self._w.replate.override

    def replate_lots(self) -> list[dict[str, Any]]:
        """Held make-ahead / finished-goods lots (listed or not) as plain dicts."""
        return self._w.replate.lots_view()

    def stock_units(self, sku: str) -> float:
        """Usable make-ahead / finished-goods units of ``sku`` on hand."""
        return self._w.replate.stock_units(sku)

    def premake_inflight(self, sku: str) -> float:
        return self._w.replate.inflight(sku)

    def replate_eligible(self) -> list[str]:
        return sorted(self._w.replate.sku_key)

    def unit_cost(self, sku: str) -> float:
        """Raw-material cost of one unit of ``sku`` (INR), made to order."""
        inv = self._w.inv
        return float(sum(q * inv.unit_cost[k] for k, q in inv.sku_keys[sku]))
