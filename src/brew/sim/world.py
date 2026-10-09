"""The World: owns every subsystem and state; run / advance / fork (technical.md 6)."""

from __future__ import annotations

import io
import math
import pickle
from collections import deque
from datetime import timedelta
from typing import Any

import numpy as np

from brew.config.loader import default_cafe, default_policies, load_scenario, weather_profiles
from brew.config.schemas import CafeConfig, ConfigIndex, PoliciesConfig, ScenarioConfig
from brew.domain.enums import CATEGORIES, DISRUPTION_KINDS
from brew.domain.ids import uuid7
from brew.domain.timeutil import DAY_S, date_of, epoch_ms, hhmm, parse_hhmm, tod_s, weekday_of
from brew.events.bus import EventRecord, EventSink
from brew.policies.base import DayEndAction, ManagerAction, Policy
from brew.policies.charter import Charter, CharterViolation
from brew.synth.loaders import Corpora, load_corpora

from . import weather as wx
from .actions import InvalidAction
from .actions import UnknownTarget as NotFound
from .arrivals import SLOTS, DayPlan, build_day_plan
from .calendar import Calendar
from .choice import ChoiceModel, weather_fit
from .customers import Customers
from .delivery import Delivery
from .demandlog import DemandLog
from .disruptions import Disruptions
from .engine import P_CLOCK, P_DECIDE, P_TELEMETRY, Engine
from .finance import Finance
from .forecast_ma import MaForecast
from .inventory import Inventory
from .kitchen import Kitchen
from .kpis import Kpis
from .observation import KAPPA_CLASSES, ObservationBuilder
from .orders import Orders
from .replate import Replate, ReplateError
from .reviews import Reviews
from .rng import RngStreams
from .state import EquipState, MenuState, Regular, Table, Task
from .suppliers import Suppliers
from .telemetry import TeleBuf
from .views import OrderView, WorldView

WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
MANAGER_START_S = 8 * 3600
DAY_START_S = 7 * 3600
RAIN_CH = {
    "rain": {"dine_in": 0.75, "takeaway": 0.9, "zomato": 1.5, "swiggy": 1.5},
    "drizzle": {"dine_in": 0.9, "takeaway": 0.95, "zomato": 1.25, "swiggy": 1.25},
}


class World:
    """A digital-twin cafe. No I/O: sinks are injected and may be None."""

    def __init__(
        self,
        cfg: CafeConfig | None = None,
        scenario: ScenarioConfig | str = "weekday_normal",
        policy: Policy | str = "A",
        seed: int = 7,
        *,
        days: int = 1,
        continuous: bool = False,
        start_date: str | None = None,
        sink: EventSink | None = None,
        telemetry: bool = False,
        keep_ledger_entries: bool = False,
        world_id: str | None = None,
        corpora: Corpora | None = None,
        pol_cfg: PoliciesConfig | None = None,
        cash_start: float | None = None,
        replate: str | None = None,
    ) -> None:
        self.cfg = cfg or default_cafe()
        self.ix = ConfigIndex.of(self.cfg)
        self.pol_cfg = pol_cfg or default_policies()
        self.scenario = load_scenario(scenario) if isinstance(scenario, str) else scenario
        self.seed = seed
        self.start_date = start_date or self.scenario.start_date
        self.corp = corpora or load_corpora()
        self.world_id = world_id or f"w-{seed}"
        self.sink = sink
        self.seq = 0
        self.rng = RngStreams(seed)
        self.engine = Engine()
        self.max_days = days
        self.continuous = continuous
        self.day = 0
        self.done = False
        self.speed = 1.0
        self.charter = Charter(self.pol_cfg.charter)
        self.profiles = weather_profiles()
        evs = list(self.cfg.calendar_fallback)
        if self.corp.source.get("calendar_bengaluru") == "clean" and self.corp.calendar:
            evs = list(self.corp.calendar)
        self.calendar = Calendar(evs)
        self.cal_flags: dict[str, bool] = {}
        self.cal_arrays: dict[str, dict[str, list[float]]] = {"persona": {}, "channel": {}, "category": {}}
        self.weather_state = self.scenario.weather.initial
        self.temp_c = wx.temperature(7, self.weather_state, self.scenario.weather.temp_offset)
        self.rain_mm_h = wx.RAIN_MM_H[self.weather_state]
        self.weather_plan: dict[int, str] = {}
        self.plan: DayPlan | None = None
        self.day_noise = 1.0
        self.pending_hides: list[str] = []
        # --- state
        self.menu: dict[str, MenuState] = {
            m.sku: MenuState(m.sku, m.base_price, m.base_price, m.base_price) for m in self.cfg.menu
        }
        self.price_change_times: deque[float] = deque(maxlen=200)
        self.tables: dict[str, Table] = {t.id: Table(t.id, t.seats) for t in self.cfg.tables.tables}
        self.table_order: list[str] = [t.id for t in self.cfg.tables.tables]
        self.equip: list[EquipState] = []
        self.dish: dict[str, dict[str, int]] = {
            k: {"clean": v, "dirty": 0, "washing": 0} for k, v in self.cfg.cafe.dish_pool.items()
        }
        self.dish_speed = 1.0
        self.kappa: dict[str, float] = dict.fromkeys(KAPPA_CLASSES, 0.0)
        self.preset = "fcfs"
        self.manual_strategy = "balanced"
        self.batch_window_s = 0.0
        self.trend_mult = 1.0
        self.trend_until_day = -1
        self.reg_rate_mult = 1.0
        self.price_mult: dict[str, float] = dict.fromkeys(self.cfg.personas, 1.0)
        self.price_mult_dirty = True
        self.ctx_dirty = True
        self.ctx_slot = -1
        self.low_flag: dict[str, bool] = {}
        self.invest_log: list[dict[str, Any]] = []
        self.daily_kpis: list[dict[str, Any]] = []
        self.decisions: list[dict[str, Any]] = []
        self.decision_seq = 0
        self.id_rng_buf: list[int] = []
        self.stock_init_done = False
        self.tele: TeleBuf | None = TeleBuf() if telemetry else None
        self.last_manager_s = -1.0
        # --- subsystems
        self.inv = Inventory(self, self.cfg)
        self.choice = ChoiceModel(self.cfg)
        self.kitchen = Kitchen(self)
        self.orders = Orders(self)
        self.customers = Customers(self)
        self.delivery = Delivery(self)
        self.suppliers = Suppliers(self)
        self.reviews = Reviews(self)
        self.fin = Finance(self, keep_ledger_entries)
        self.replate = Replate(self)
        self.dlog = DemandLog([m.sku for m in self.cfg.menu])
        if cash_start is not None:
            self.fin.cash = cash_start
        self.kpi = Kpis(self)
        self.dis = Disruptions(self)
        self.ma = MaForecast(self)
        self.obs_builder = ObservationBuilder(self)
        self._view = WorldView(self)
        self.regulars: list[Regular] = []
        self._init_regulars()
        self.policy: Policy = None  # type: ignore[assignment]
        self.set_policy(policy, announce=False)
        if replate is not None:  # experiment / owner override of the replate ladder
            self.replate.mode = replate
            self.replate.override = True
        self._h: dict[str, Any] = {}
        self._build_handlers()
        self.engine.schedule(self.day_start_t(0), "DAY_START", 0, P_CLOCK)

    # ------------------------------------------------------------------ basics
    @property
    def now(self) -> float:
        return self.engine.now

    def view(self) -> WorldView:
        return self._view

    def emit(self, type_: str, **data: Any) -> None:
        """Append an event to the stream (seq strictly increasing from 1)."""
        self.seq += 1
        s = self.sink
        if s is not None:
            s.emit(EventRecord(self.seq, self.engine.now, type_, data))

    def new_id(self) -> str:
        if not self.id_rng_buf:
            self.id_rng_buf = self.rng.ids.integers(0, 2**62, size=512, dtype=np.int64).tolist()
        r1 = self.id_rng_buf.pop()
        r2 = self.id_rng_buf.pop()
        return uuid7(epoch_ms(self.now, self.start_date), r1, r2)

    def date_str(self, day: int | None = None) -> str:
        return date_of(self.day if day is None else day, self.start_date).isoformat()

    def weekday(self, day: int | None = None) -> int:
        return weekday_of(self.day if day is None else day, self.start_date)

    def is_weekend(self) -> bool:
        return self.weekday() >= 5

    def day_start_t(self, day: int) -> float:
        return day * DAY_S + DAY_START_S

    def day_end_t(self, day: int) -> float:
        return day * DAY_S + self.cfg.cafe.close_s + 1800

    def iso(self, t: float | None = None) -> str:
        from brew.domain.timeutil import iso

        return iso(self.now if t is None else t, self.start_date)

    def mod_delta(self, mods: Any) -> float:
        return sum(self.ix.mod[m].price_delta for m in mods)

    # ------------------------------------------------------------------ handlers
    def _build_handlers(self) -> None:
        k, o, c, d, de = self.kitchen, self.orders, self.customers, self.delivery, self.dis
        self._h = {
            "DAY_START": self.on_day_start,
            "DAY_END": self.on_day_end,
            "CLOCK": self.on_clock,
            "WEATHER": self.on_weather,
            "KPI_TICK": self.on_kpi_tick,
            "MANAGER": self.on_manager,
            "ARR": self.on_arr,
            "PAT": c.on_pat,
            "SEAT_TIMEOUT": c.on_seat_timeout,
            "EAT": c.on_eat,
            "LINGER": c.on_linger,
            "REFILL": c.on_refill,
            "PAY_START": c.on_pay_start,
            "PAY_DONE": c.on_pay_done,
            "DISPATCH": lambda _p: k.on_dispatch(),
            "DISPATCH_WAKE": lambda _p: k.on_dispatch_wake(),
            "TASK_DONE": k.on_task_done,
            "PREP_READY": k.on_prep_ready,
            "SHIFT_START": k.on_shift_start,
            "SHIFT_END": k.on_shift_end,
            "BREAK_DUE": k.on_break_due,
            "BREAK_END": k.on_break_end,
            "AUTO_SERVE": self.on_auto_serve,
            "ACCEPT_RETRY": d.on_accept_retry,
            "RIDER_DISPATCH": d.on_rider_dispatch,
            "RIDER_ARRIVE": d.on_rider_arrive,
            "DELIVERED": d.on_delivered,
            "PO_ARRIVE": self.suppliers.on_arrive,
            "DIS_START": de.on_start,
            "DIS_END": de.on_end,
        }
        self._o = o

    def _dispatch(self, kind: str, payload: Any) -> None:
        self._h[kind](payload)

    # --------------------------------------------------------------------- run
    def run(self, days: int | None = None) -> None:
        """Headless: process events until the queue is empty (``days`` overrides ``max_days``)."""
        if days is not None:
            if self.done and days > self.max_days:
                self.done = False
                self.engine.schedule(self.day_start_t(self.max_days), "DAY_START", self.max_days, P_CLOCK)
            self.max_days = days
        eng = self.engine
        d = self._dispatch
        while not self.done and eng.step(d):
            pass

    def advance_to(self, t: float, should_stop: Any = None) -> bool:
        """Live: process events with ``ev.t <= t``. Returns False if interrupted by ``should_stop``."""
        return self.engine.run_until(t, self._dispatch, should_stop)

    def run_until(self, t: float) -> None:
        self.engine.run_until(t, self._dispatch)

    def next_event_time(self) -> float | None:
        return self.engine.peek()

    def at_night(self) -> bool:
        """True when the next event is more than 3 h away (between close-out and next day start)."""
        nxt = self.engine.peek()
        return nxt is not None and nxt - self.now > 3 * 3600

    # --------------------------------------------------------------- day start
    def init_stock(self) -> None:
        for i in self.cfg.ingredients:
            if i.initial_qty > 0:
                self.inv.add_lot(i.key, i.initial_qty, self.now, kind="initial")
        for p in self.cfg.prep_items:
            if p.initial_qty > 0:
                self.inv.add_lot(
                    p.key, p.initial_qty, self.now, kind="initial", shelf_h=p.hold_time_min / 60.0
                )
        self.stock_init_done = True
        self.inv.stock_dirty.clear()
        self.recheck_availability(set(self.inv.onhand))

    def _init_regulars(self) -> None:
        n = self.cfg.cafe.regulars_pool
        r = self.rng.customers.integers(0, 2**32, size=(n, 2), dtype=np.uint64)
        names = self.corp.names
        for i in range(n):
            self.regulars.append(Regular(i, names[int(r[i, 0]) % len(names)], int(r[i, 1])))

    def on_day_start(self, day: int) -> None:
        cfg = self.cfg
        self.day = day
        d0 = day * DAY_S
        if not self.stock_init_done:
            self.init_stock()
        self.kpi.reset()
        self.replate.reset_day()
        self.customers.walkouts_today = self.customers.balks_today = self.customers.reneges_today = 0
        self.customers.arrived_today = self.customers.table_turns_today = 0
        self.reviews.neg_today = 0
        self.reviews.stars_today = []
        self.kitchen.tasks_started_today = self.kitchen.batches_today = self.kitchen.batched_tasks_today = 0
        for s in self.kitchen.staff_list:
            s.overload_s = 0.0
            s.worked_s = 0.0
            s.exp_days += 1
        for m in self.menu.values():
            m.sold_today = 0
        self.delivery.deliveries_today = 0
        self.delivery.paused_hours_today = {"zomato": 0, "swiggy": 0}
        self.ma.switch_daytype(self.is_weekend())
        self.inv.stock_dirty.update(self.inv.onhand)
        self.sweep_expired()
        # weather (fixed draw count -> CRN safe)
        wspec = self.scenario.weather
        draws = self.rng.weather.random(len(wx.HOURS))
        prof = self.profiles[wspec.profile]
        self.weather_plan = wx.plan_day(
            self.weather_state if day else wspec.initial, prof, draws, wspec.forced
        )
        for h in wx.HOURS:
            self.engine.schedule(d0 + h * 3600, "WEATHER", h, P_CLOCK)
        # calendar
        dt = date_of(day, self.start_date)
        self.cal_arrays = self.calendar.day_arrays(dt)
        self.cal_flags = self.calendar.flags(dt)
        self.dlog.new_day(day, self.weekday(day), self.cal_flags)
        # arrival plan
        self.day_noise = float(self.rng.arrivals.lognormal(0.0, cfg.cafe.params.day_noise_sigma))
        static = self._static_mult(day)
        self.plan = build_day_plan(
            cfg,
            self.rng,
            day,
            "weekend" if self.is_weekend() else "weekday",
            static,
            self.day_noise,
            len(cfg.menu),
        )
        self._schedule_first_arrival(0)
        self.kitchen.init_day(day)
        self.dis.day_setup(day, self.scenario)
        # chains
        self.engine.schedule(self.now, "CLOCK", None, P_CLOCK)
        self.engine.schedule(d0 + MANAGER_START_S, "MANAGER", 0, P_DECIDE)
        self.engine.schedule(d0 + MANAGER_START_S + 300, "KPI_TICK", None, P_TELEMETRY)
        self.engine.schedule(self.day_end_t(day), "DAY_END", day, P_CLOCK)
        self.price_mult_dirty = True
        self.ctx_dirty = True
        names = self.calendar.names(dt)
        self.emit(
            "day.started",
            day=day,
            date=dt.isoformat(),
            weekday=WEEKDAYS[dt.weekday()],
            weather=self.weather_plan[7],
            events=names,
        )
        self.reapply_strategy_menu()
        self.run_manager("day_start")

    def _static_mult(self, day: int) -> dict[str, np.ndarray]:
        """Policy-independent per-persona slot multipliers (scenario, calendar, weather, noise)."""
        cfg = self.cfg
        dem = self.scenario.demand
        out: dict[str, np.ndarray] = {}
        hours = (np.arange(SLOTS) // 4).astype(int)
        ws = [self.weather_plan.get(int(h), "partly") for h in hours]
        cal = self.cal_arrays
        for pkey, per in cfg.personas.items():
            m = np.full(SLOTS, self.day_noise * dem.global_mult * dem.persona_mult.get(pkey, 1.0))
            if pkey in cal["persona"]:
                m = m * np.array(cal["persona"][pkey])
            chm = np.zeros(SLOTS)
            for ch, share in per.channels.items():
                base = np.full(SLOTS, dem.channel_mult.get(ch, 1.0))
                if ch in cal["channel"]:
                    base = base * np.array(cal["channel"][ch])
                for win in dem.windows:
                    s0, s1 = parse_hhmm(win["from"]) // 900, parse_hhmm(win["to"]) // 900
                    cm = win.get("channel_mult", {}).get(ch)
                    if cm:
                        base[s0:s1] *= cm
                wm = np.array([RAIN_CH.get(s, {}).get(ch, 1.0) for s in ws])
                chm += share * base * wm
            out[pkey] = m * chm
        return out

    def _schedule_first_arrival(self, start_idx: int) -> None:
        plan = self.plan
        assert plan is not None
        close = plan.day * DAY_S + self.cfg.cafe.close_s
        i = start_idx
        while i < plan.n and (
            plan.t[i] < self.now or plan.t[i] < plan.day * DAY_S + self.cfg.cafe.open_s - 1800
        ):
            i += 1
        if i < plan.n and plan.t[i] < close:
            self.engine.schedule(float(plan.t[i]), "ARR", i, 3)

    def on_arr(self, i: int) -> None:
        plan = self.plan
        assert plan is not None
        nxt = i + 1
        close = plan.day * DAY_S + self.cfg.cafe.close_s
        if nxt < plan.n and plan.t[nxt] < close:
            self.engine.schedule(float(plan.t[nxt]), "ARR", nxt, 3)
        pkey = plan.personas[int(plan.pidx[i])]
        ch = ("dine_in", "takeaway", "zomato", "swiggy")[int(plan.chan[i])]
        slot = int(tod_s(self.now) // 900)
        static = float(plan.static_mult[pkey][slot])
        dyn = self.dynamic_mult(pkey, ch)
        p_accept = min(1.0, static * dyn / self.cfg.cafe.params.lambda_max_factor)
        if plan.u_thin[i] >= p_accept:
            return
        self.customers.on_arrival(plan, i)

    def dynamic_mult(self, persona: str, channel: str) -> float:
        """Policy/state-dependent arrival multipliers: reputation, price index, trend, strategy, chaos."""
        if self.price_mult_dirty:
            self._refresh_price_mult()
        m = self.reviews.reputation_mult(channel) * self.price_mult[persona] * self.trend_mult
        m *= self.dis.demand_mult(persona, channel)
        if channel in ("zomato", "swiggy"):
            m *= self.delivery.rank[channel]
        if persona == "regular":
            m *= self.reg_rate_mult
        ms = self.pol_cfg.strategies.manual[self.manual_strategy]
        return m * ms.arrival_mult

    def _refresh_price_mult(self) -> None:
        for pkey, per in self.cfg.personas.items():
            skus = [k for k in per.affinity if k in self.menu] or list(self.menu)
            idx = sum(self.menu[s].price / self.menu[s].base for s in skus) / len(skus)
            self.price_mult[pkey] = float(idx**-0.6)
        self.price_mult_dirty = False

    def price_index(self, cat: str) -> float:
        items = [m for m in self.cfg.menu if m.cat == cat]
        return sum(self.menu[m.sku].price / m.base_price for m in items) / len(items)

    def price_changes_last(self, window_s: float) -> int:
        return sum(1 for t in self.price_change_times if t >= self.now - window_s)

    # ------------------------------------------------------------------ clocks
    def on_clock(self, _p: Any) -> None:
        d0 = self.day * DAY_S
        self.emit(
            "clock.tick",
            day=self.day,
            hhmm=hhmm(self.now),
            weekday=WEEKDAYS[self.weekday()],
            speed=self.speed,
        )
        self.kitchen.on_minute()
        if int(self.now) % 300 == 0:
            self.replate.tick()
        if self.pending_hides:
            self.retry_pending_hides()
        if self.kitchen.dish_wash_pending is False and any(v["dirty"] >= 4 for v in self.dish.values()):
            self.maybe_wash()
        if tod_s(self.now) % 3600 < 1:
            self.delivery.hourly()
        if self.now + 60 <= self.day_end_t(self.day) and self.now < d0 + 23 * 3600:
            self.engine.schedule(self.now + 60, "CLOCK", None, P_CLOCK)

    def on_weather(self, h: int) -> None:
        st = self.weather_plan[h]
        T = wx.temperature(h, st, self.scenario.weather.temp_offset)
        if st != self.weather_state or h == 7:
            self.weather_state = st
            self.temp_c = T
            self.rain_mm_h = wx.RAIN_MM_H[st]
            self.emit("weather.changed", state=st, temp_c=T, rain_mm_h=self.rain_mm_h)
        else:
            self.temp_c = T
        self.ctx_dirty = True

    def on_kpi_tick(self, _p: Any) -> None:
        self.emit("kpi.tick", **self.kpi.tick_payload())
        if self.now + 300 <= self.day * DAY_S + self.cfg.cafe.close_s + 1800:
            self.engine.schedule(self.now + 300, "KPI_TICK", None, P_TELEMETRY)

    def on_manager(self, k: int) -> None:
        self.run_manager("tick")
        nxt = self.day * DAY_S + MANAGER_START_S + (k + 1) * self.cfg.cafe.manager_tick_s
        if nxt < self.day * DAY_S + self.cfg.cafe.close_s:
            self.engine.schedule(nxt, "MANAGER", k + 1, P_DECIDE)

    def on_auto_serve(self, order_no: int) -> None:
        self.orders.serve_handles.pop(order_no, None)
        self.orders.serve(order_no, "runner")

    def after_dispatch(self) -> None:
        self.orders.update_rail()

    # ------------------------------------------------------------- manager tick
    def run_manager(self, phase: str) -> None:
        """Expiry sweep, observation, policy decision, shield + apply."""
        self.last_manager_s = self.now
        self.dlog.snapshot(self)
        self.sweep_expired()
        self.price_mult_dirty = True
        self.replate.tick()
        obs = self.obs_builder.build()
        action = self.policy.on_manager_tick(obs, self._view)
        if action is not None and not action.is_noop():
            self.apply_manager_action(action, by=self.policy.code)
        self.ctx_dirty = True

    def make_decision(
        self, typ: str, summary: str, by: str, factors: list | None = None, clipped: list | None = None
    ) -> str:
        self.decision_seq += 1
        did = f"dec-{self.decision_seq:06d}"
        rec = {
            "decision_id": did, "sim_s": self.now, "type": typ, "summary": summary, "policy": by,
            "top_factors": factors or [], "clipped": clipped or [],
        }  # fmt: skip
        self.decisions.append(rec)
        if len(self.decisions) > 2000:
            del self.decisions[:500]
        if self.tele is not None:
            self.tele.decision(self, did, typ, by, summary)
        self.emit(
            "decision.made",
            decision_id=did,
            type=typ,
            summary=summary,
            policy=by,
            top_factors=factors or [],
            clipped=clipped or [],
        )
        return did

    # -------------------------------------------------------- manager action
    def apply_manager_action(self, a: ManagerAction, by: str) -> dict[str, Any]:
        """Pass a ManagerAction through the charter shield and apply what survives."""
        applied: list[str] = []
        clipped: list[str] = []
        reason = a.reason
        if a.strategy and a.strategy != self.preset and self.manual_strategy == "balanced":
            if a.strategy in self.pol_cfg.strategies.presets:
                self.preset = a.strategy
                applied.append(f"dispatch strategy -> {a.strategy}")
        if a.batch_window_s is not None and a.batch_window_s != self.batch_window_s:
            self.batch_window_s = float(a.batch_window_s)
            applied.append(f"batch window {a.batch_window_s:.0f}s")
        for ch, lvl in a.throttles.items():
            if self.delivery.set_throttle(ch, lvl):
                applied.append(f"{ch} throttle -> {lvl}")
        for k, v in a.kappa.items():
            self.kappa[k] = v
        # prices
        price_targets: dict[str, float] = {}
        for cat, step in a.price_steps.items():
            if step == 0:
                continue
            for m in self.cfg.menu:
                if m.cat == cat and not (m.staple and step > 0):
                    price_targets[m.sku] = self.menu[m.sku].price * (1 + step)
        price_targets.update(a.sku_prices)
        for sku, newp in price_targets.items():
            ok, why = self.set_price(
                sku, newp, by, reason or "policy", promotion=a.promotion, restore=a.restore
            )
            if ok:
                applied.append(f"{sku} -> {self.menu[sku].price:g}")
            elif why:
                clipped.append(f"{sku}: {why}")
        # featured
        if a.featured is not None:
            if a.featured == "":
                for sku, mst in self.menu.items():
                    if mst.featured:
                        self.set_featured(sku, False, by, "")
            elif a.featured in self.menu:
                self.set_featured(a.featured, True, by, reason)
                applied.append(f"feature {a.featured}")
        for sku, on in a.hide.items():
            try:
                if self.set_hidden(sku, on, "owner", by, reason or "policy"):
                    applied.append(f"{'hide' if on else 'restore'} {sku}")
            except CharterViolation as e:
                clipped.append(str(e))
        for key, qty in a.prep_now.items():
            if qty > 0 and key in self.ix.prep:
                started = self.kitchen.start_prep(key, qty)
                if started > 0:
                    applied.append(f"prep {key} x{started:g}")
        rp = self.replate
        if a.replate_mode is not None and rp.set_mode(a.replate_mode, by):
            applied.append(f"replate mode -> {a.replate_mode}")
        for sku, units in a.premake.items():
            if units > 0:
                try:
                    res = rp.premake(sku, int(units), by)
                    applied.append(f"premake {sku} x{res['units']:g}")
                except ReplateError as e:
                    clipped.append(f"premake {sku}: {e}")
        for po in a.pos:
            lines = {ln.ingredient: ln.qty for ln in po.lines if ln.qty > 0}
            if lines:
                placed = self.suppliers.place(po.supplier, lines, source=by, arrive_tod_s=po.arrive_tod_s)
                if placed is not None:
                    applied.append(f"PO {po.supplier} ({len(placed['lines'])} lines)")
        for lot_id, pct in a.replate_discounts.items():
            try:
                if rp.set_discount(lot_id, pct, by, strict=False):
                    applied.append(f"replate {lot_id} -{pct:.0f}%")
            except ReplateError as e:
                clipped.append(f"replate {lot_id}: {e}")
        result = {"applied": applied, "clipped": clipped}
        if applied or clipped:
            summary = reason or "; ".join(applied[:3]) or "adjustments clipped by charter"
            if applied and reason:
                summary = f"{reason}: " + "; ".join(applied[:3])
            self.make_decision(self._decision_type(a), summary, by, a.factors, clipped)
        return result

    @staticmethod
    def _decision_type(a: ManagerAction) -> str:
        if a.price_steps or a.sku_prices:
            return "price_change"
        if a.prep_now or a.premake:
            return "prep_start"
        if a.pos:
            return "reorder"
        if a.replate_mode is not None or a.replate_discounts:
            return "replate_markdown"
        if a.throttles:
            return "throttle"
        if a.hide:
            return "hide_item"
        if a.featured:
            return "feature_item"
        if a.strategy:
            return "strategy_switch"
        return "other"

    # ------------------------------------------------------------------ menu ops
    def set_price(
        self,
        sku: str,
        price: float,
        by: str,
        reason: str = "",
        promotion: bool = False,
        restore: bool = False,
        strict: bool = False,
    ) -> tuple[bool, str]:
        """Apply a price change through the charter. Returns ``(applied, why_not)``."""
        m = self.menu[sku]
        item = self.ix.menu[sku]
        chk = self.charter.check_price(
            item, m.price, price, self.now, m.last_change_s, promotion, restore, strict
        )
        if not chk.ok:
            return False, chk.reason
        old = m.price
        m.price = chk.price
        if promotion:
            if not m.promo:
                m.pre_promo_price = old
            m.promo = True
        else:
            m.promo = False
            m.last_change_s = self.now
        d = "up" if m.price > old else "down"
        m.chip_dir = d
        m.chip_text = f"₹{abs(m.price - m.base):g} · {reason}" if reason else ""
        self.kpi.price_changes += 1
        self.price_change_times.append(self.now)
        self.price_mult_dirty = True
        self.ctx_dirty = True
        self.emit(
            "price.changed", sku=sku, old=old, new=m.price, base=m.base, dir=d, reason_text=reason, by=by
        )
        return True, chk.reason

    def set_featured(self, sku: str, on: bool, by: str, reason: str = "") -> bool:
        m = self.menu[sku]
        if m.featured == on:
            return False
        if on:
            if sum(1 for x in self.menu.values() if x.featured) >= self.pol_cfg.charter.max_featured:
                raise CharterViolation("at most 2 featured items at once")
            if m.hidden:
                raise CharterViolation(f"{sku} is hidden")
        m.featured = on
        self.ctx_dirty = True
        self.emit("menu.featured", sku=sku, on=on, reason=reason)
        return True

    def has_unstarted_tasks(self, sku: str) -> bool:
        for o in self.orders.open.values():
            for u in o.units:
                if u.sku == sku and not u.started:
                    return True
        return False

    def set_hidden(self, sku: str, hide: bool, kind: str, by: str, reason: str = "") -> bool:
        """Hide (86) or restore a SKU. Charter: no hiding while open orders still need it (unless stock)."""
        m = self.menu[sku]
        if hide:
            if m.hidden:
                return False
            if kind != "stock" and self.has_unstarted_tasks(sku):
                raise CharterViolation(f"{sku} has open orders with unstarted tasks")
            m.hidden = "Sold out for now" if kind in ("stock", "strategy") else (reason or "Sold out for now")
            m.hidden_kind = kind
            if m.featured:
                m.featured = False
                self.emit("menu.featured", sku=sku, on=False, reason="hidden")
            self.ctx_dirty = True
            self.emit("menu.hidden", sku=sku, reason=m.hidden)
            return True
        if not m.hidden:
            return False
        if kind == "stock" and m.hidden_kind != "stock":
            return False
        m.hidden = None
        m.hidden_kind = ""
        self.ctx_dirty = True
        self.emit("menu.restored", sku=sku, reason=reason)
        return True

    def retry_pending_hides(self) -> None:
        keep = []
        for sku in self.pending_hides:
            if self.manual_strategy != "rush_menu":
                continue
            try:
                if (
                    not self.set_hidden(sku, True, "strategy", "manual", "rush menu")
                    and not self.menu[sku].hidden
                ):
                    keep.append(sku)
            except CharterViolation:
                keep.append(sku)
        self.pending_hides = keep

    # ---------------------------------------------------------- strategy / policy
    def set_strategy(self, name: str) -> None:
        strategies = self.pol_cfg.strategies
        if name not in strategies.manual:
            raise ValueError(f"unknown strategy {name!r}")
        prev = self.manual_strategy
        if prev == name:
            return
        self.manual_strategy = name
        self.emit("strategy.changed", strategy=name, previous=prev)
        self.reapply_strategy_menu()
        self.kitchen.request_dispatch()
        self.make_decision("strategy_switch", f"Strategy {prev} -> {name}", "owner")

    def reapply_strategy_menu(self) -> None:
        ms = self.pol_cfg.strategies.manual[self.manual_strategy]
        # hide list
        self.pending_hides = []
        for sku, m in self.menu.items():
            if m.hidden_kind == "strategy" and sku not in ms.hide:
                self.set_hidden(sku, False, "strategy", "manual", "strategy ended")
        for sku in ms.hide:
            try:
                self.set_hidden(sku, True, "strategy", "manual", "rush menu")
            except CharterViolation:
                self.pending_hides.append(sku)
        # promotion
        for m_item in self.cfg.menu:
            ms_ = self.menu[m_item.sku]
            if m_item.cat in ("coffee", "notcoffee") and ms.drink_discount_pct:
                target = ms_.base * (1 - ms.drink_discount_pct / 100.0)
                self.set_price(m_item.sku, target, "owner", "happy hour", promotion=True)
            elif ms_.promo and ms.drink_discount_pct == 0 and self.manual_strategy != "balanced_keep":
                self.set_price(
                    m_item.sku, ms_.pre_promo_price or ms_.base, "owner", "promotion ended", restore=True
                )

    def effective_preset(self) -> str:
        ms = self.pol_cfg.strategies.manual[self.manual_strategy]
        return ms.preset or self.preset

    def channel_boost(self) -> dict[str, float]:
        return self.pol_cfg.strategies.manual[self.manual_strategy].channel_boost

    def set_policy(self, policy: Policy | str, announce: bool = True) -> None:
        from brew.policies.registry import make_policy

        prev = self.policy.code if self.policy is not None else ""
        self.policy = make_policy(policy) if isinstance(policy, str) else policy
        self.policy.reset(self._view, self.seed)
        self.preset = getattr(self.policy, "default_preset", "fcfs")
        self.batch_window_s = float(getattr(self.policy, "default_batch_window_s", 0.0))
        if not self.replate.override:
            self.replate.mode = str(getattr(self.policy, "default_replate_mode", "off"))
        if announce:
            self.emit("policy.changed", policy=self.policy.code, previous=prev)

    # ------------------------------------------------------------ choice context
    def ensure_choice_ctx(self) -> None:
        slot = int(tod_s(self.now) // 900)
        if not self.ctx_dirty and slot == self.ctx_slot:
            return
        cfg = self.cfg
        J = len(cfg.menu)
        lnr = np.zeros(J)
        feat = np.zeros(J)
        vis = np.ones(J, dtype=bool)
        cal = np.zeros(J)
        catm = self.cal_arrays["category"]
        scn_cat = self.scenario.demand.category_mult
        for j, m in enumerate(cfg.menu):
            ms = self.menu[m.sku]
            lnr[j] = math.log(max(1.0, ms.price) / max(1.0, ms.ref_price))
            feat[j] = 1.0 if ms.featured else 0.0
            vis[j] = ms.hidden is None
            cm = scn_cat.get(m.cat, 1.0)
            if m.cat in catm:
                cm *= catm[m.cat][slot]
            cal[j] = math.log(cm)
        p = cfg.cafe.params
        wf = weather_fit(cfg, self.temp_c, self.weather_state, p.choice_delta_weather, 0.3)
        rp_mask, rp_price, rp_q = self.replate.choice_arrays()
        if rp_mask.any():
            refs = np.array([max(1.0, self.menu[m.sku].ref_price) for m in cfg.menu])
            rp_lnr = np.log(np.maximum(1.0, rp_price) / refs)
            self.choice.set_context(lnr, feat, vis, wf, cal, rp_mask, rp_lnr, rp_q)
        else:
            self.choice.set_context(lnr, feat, vis, wf, cal)
        self.ctx_dirty = False
        self.ctx_slot = slot

    # ----------------------------------------------------------------- inventory
    def book_consumption(self, key: str, cost: float) -> None:
        if cost:
            self.fin.post("packaging" if self.inv.is_pack[key] else "cogs", cost)

    def book_waste(self, key: str, qty: float, cost: float) -> None:
        self.fin.post("waste", cost)
        self.kpi.waste_kg += self.inv.kg_of(key, qty)
        self.kpi.waste_inr += cost

    def on_lot_opened(self, key: str, lot: Any) -> None:
        if not self.inv.is_pack[key]:
            self.emit("lot.opened", key=key, lot_id=lot.lot_id, expires_s=round(lot.expires_s, 1))

    def sweep_expired(self) -> None:
        for key, lot, cost in self.inv.sweep_expired(self.now):
            self.book_waste(key, lot.qty, cost)
            if key in self.ix.prep:
                self.emit("prep.expired", prep_key=key, qty=round(lot.qty, 3))
            else:
                self.emit("lot.expired", key=key, lot_id=lot.lot_id, qty=round(lot.qty, 3))
        self.recheck_availability(self.inv.stock_dirty)

    def recheck_availability(self, keys: Any) -> None:
        """Auto-86 SKUs that cannot be made from stock and restore them when stock returns."""
        inv = self.inv
        if not keys:
            return
        keys = list(keys)
        inv.stock_dirty.clear()
        seen: set[str] = set()
        for k in keys:
            for sku in inv.key_skus.get(k, ()):
                if sku in seen:
                    continue
                seen.add(sku)
                m = self.menu[sku]
                avail = inv.sku_available(sku, self.now)
                if not avail and not m.hidden:
                    self.set_hidden(sku, True, "stock", "inventory")
                elif avail and m.hidden and m.hidden_kind == "stock":
                    self.set_hidden(sku, False, "stock", "inventory", "restocked")
            qty = inv.onhand[k]
            ing = self.ix.ingredient.get(k)
            if ing is not None:
                reorder = ing.reorder_point
            else:
                reorder = self.ix.prep[k].reorder_point if k in self.ix.prep else 0.0
            low = qty < reorder
            if k in inv.finished:
                self.emit("stock.changed", key=k, qty=round(qty, 2), low=low)
                self.low_flag[k] = low
            elif self.low_flag.get(k, False) != low:
                self.low_flag[k] = low
                self.emit("stock.changed", key=k, qty=round(qty, 2), low=low)

    # ------------------------------------------------------------------ dish pit
    def ware_for(self, unit: Any) -> str:
        o = self.orders.orders.get(unit.order_no)
        if o is None or o.channel != "dine_in":
            return ""
        pack = self.cfg.recipes.recipes[unit.sku].pack
        if pack in ("hot_drink", "cold_drink"):
            return "cup_ceramic_m"
        if pack == "food":
            return "plate"
        return ""

    def take_ware(self, ware: str) -> bool:
        d = self.dish.get(ware)
        if d is None or d["clean"] <= 0:
            return False
        d["clean"] -= 1
        return True

    def return_ware(self, ware: str, clean: bool, n: int = 1) -> None:
        d = self.dish.get(ware)
        if d is None:
            return
        if clean:
            d["clean"] += n
        else:
            d["dirty"] += n
            self.maybe_wash()

    def maybe_wash(self) -> None:
        k = self.kitchen
        if k.dish_wash_pending:
            return
        tot = sum(v["dirty"] for v in self.dish.values())
        low = any(v["clean"] < 6 and v["dirty"] > 0 for v in self.dish.values())
        if tot < 10 and not low:
            return
        rack = int(self.cfg.cafe.dishwasher["rack"])
        amounts: dict[str, int] = {}
        left = rack
        for ware in sorted(self.dish, key=lambda x: -self.dish[x]["dirty"]):
            take = min(left, self.dish[ware]["dirty"])
            if take > 0:
                amounts[ware] = take
                self.dish[ware]["dirty"] -= take
                self.dish[ware]["washing"] += take
                left -= take
        if not amounts:
            return
        k.dish_wash_pending = True
        mean = self.cfg.cafe.dishwasher["wash_s"] * self.dish_speed
        k.add_service_task("wash", "wash", "dishpit", mean, mean * 0.1, 0.8, ref=amounts, uses_slot=True)

    def on_wash_done(self, amounts: dict[str, int]) -> None:
        for ware, n in amounts.items():
            self.dish[ware]["washing"] -= n
            self.dish[ware]["clean"] += n
        self.kitchen.dish_wash_pending = False
        self.maybe_wash()
        self.kitchen.request_dispatch()

    # ---------------------------------------------------------------- loyalty
    def update_regular(self, idx: int, s: float) -> None:
        r = self.regulars[idx]
        r.sat_ema = 0.7 * r.sat_ema + 0.3 * s
        r.visits += 1
        r.bad_streak = r.bad_streak + 1 if s < 0.4 else 0
        if r.bad_streak >= 2 and not r.churned:
            r.churned = True
            self.reg_rate_mult = max(0.7, self.reg_rate_mult * 0.99)

    def order_view(self, o: Any) -> OrderView:
        carry = o.channel != "dine_in"
        items = [(u.sku, u.mods) for u in o.units]
        est = self.orders.estimate_prep_s(items, carry)
        q = self.orders.queue_delay_s()
        return OrderView(
            o.order_no, o.channel, o.persona, len(o.units), tuple(u.sku for u in o.units), est, q,
            self.now + est + q + 300.0, self.delivery.open_aggregator_orders(), len(self.orders.open),
            self.now - o.placed_s, self.delivery.throttle.get(o.channel, "open"),
        )  # fmt: skip

    # --------------------------------------------------------------------- day end
    def on_day_end(self, day: int) -> None:
        w = self
        cfg = self.cfg
        # close out the venue
        for p in list(self.customers.parties.values()):
            if not p.left:
                self.customers.pat_stop(p)
                for no in list(p.order_nos):
                    o = self.orders.orders.get(no)
                    if o is not None and o.state not in ("served", "voided"):
                        self.orders.void(o, "closing")
                if p.state in ("seated", "eating", "lingering", "paying", "seat_wait"):
                    for no in p.order_nos:
                        o = self.orders.orders.get(no)
                        if o is not None and o.state == "served":
                            self.fin.collect(o, p.refill_u[5])
                self.customers.leave(p, happy=not p.unhappy)
        for o in list(self.orders.open.values()):
            self.orders.void(o, "closing")
        self.customers.queue.clear()
        self.customers.seat_wait.clear()
        k = self.kitchen
        for t in list(k.tasks.values()):
            if t.state == 2:
                t.state = 4
        for s in k.staff_list:
            s.attention_used = 0.0
            s.active = []
            s.on_break = False
            k.clock_out(s, "day_end")
        for st in k.stations.values():
            st.staff_active = {}
        for e in self.equip:
            e.slots_used = 0
        k.ready = []
        k.tasks = {}
        k.live_batches = {}
        k.work_open = 0.0
        k.dish_wash_pending = False
        k.prep_jobs = {}
        k.prep_inflight = {}
        self.replate.on_day_end()
        for tb in self.tables.values():
            if tb.state != "free" or tb.occ:
                for kk, v in tb.dirty_ware.items():
                    self.dish[kk]["dirty"] += v
                tb.dirty_ware = {}
                tb.state = "free"
                tb.occ = []
                tb.party_ids = []
        for ware, d in self.dish.items():
            d["clean"] += d["dirty"] + d["washing"]
            d["dirty"] = d["washing"] = 0
        # money
        staff_cost = k.labour_accrued
        k.labour_accrued = 0.0
        self.sweep_expired()
        self.fin.close_day(day, staff_cost)
        # policy: purchasing + donation
        view = self._view
        act: DayEndAction = self.policy.on_day_end(view)
        if act is not None:
            for po in act.pos:
                lines = {ln.ingredient: ln.qty for ln in po.lines if ln.qty > 0}
                if lines:
                    self.suppliers.place(
                        po.supplier, lines, source=self.policy.code, arrive_tod_s=po.arrive_tod_s
                    )
            if act.donate:
                for key, lot in self.inv.donatable(self.now):
                    qty = lot.qty
                    cost = self.inv.donate_lot(key, lot)
                    self.fin.post("donation_writeoff", cost)
                    self.kpi.donated_kg += self.inv.kg_of(key, qty)
                    self.emit("lot.donated", key=key, lot_id=lot.lot_id, qty=qty)
        self.recheck_availability(self.inv.stock_dirty)
        # reference price EMA (fairness memory)
        a = 1.0 / cfg.cafe.params.ref_price_ema_days
        for m in self.menu.values():
            avg = m.price
            m.ref_price = m.ref_price + a * (avg - m.ref_price)
        if self.trend_until_day <= day:
            self.trend_mult = 1.0
        summary = self.kpi.daily(day)
        self.daily_kpis.append(summary)
        if self.tele is not None:
            self.tele.kpis.append(summary)
        self.ma.end_day(self.is_weekend())
        self.emit("day.ended", day=day, summary=summary)
        self.kpi.energy_kwh_today = 0.0
        del w
        if self.continuous or day + 1 < self.max_days:
            self.engine.schedule(self.day_start_t(day + 1), "DAY_START", day + 1, P_CLOCK)
        else:
            self.done = True

    # ------------------------------------------------------------------ chaos
    def trigger_chaos(
        self,
        kind: str,
        target: str | None = None,
        severity: float = 1.0,
        duration_min: float = 60.0,
        source: str = "manual",
    ) -> Any:
        if kind not in DISRUPTION_KINDS:
            raise ValueError(f"unknown disruption kind {kind!r}")
        return self.dis.trigger(kind, target, severity, duration_min=duration_min, source=source)

    # -------------------------------------------------------------------- fork
    def fork(
        self, reseed: int | None = None, world_id: str | None = None, sink: EventSink | None = None
    ) -> World:
        """Independent copy (no sinks); identical RNG streams unless ``reseed`` is given."""
        shared = [self.cfg, self.ix, self.pol_cfg, self.scenario, self.corp, self.calendar, self.profiles]
        sink0, h0, view0, tele_sink = self.sink, self._h, self._view, None
        self.sink = None
        self._h = {}
        buf = io.BytesIO()
        try:
            _Pickler(buf, shared).dump(self)
        finally:
            self.sink, self._h = sink0, h0
            del tele_sink, view0
        buf.seek(0)
        child: World = _Unpickler(buf, shared).load()
        child._build_handlers()
        child.sink = sink
        child.world_id = world_id or f"{self.world_id}-fork"
        if reseed is not None:
            child.rng.reseed(reseed)
            child.kitchen.norm.gen = child.rng.durations
            child.kitchen.err.gen = child.rng.errors
        return child

    # --------------------------------------------------------------------- misc
    def snapshot_time(self) -> dict[str, Any]:
        return {"sim_s": self.now, "t": self.iso(), "day": self.day, "hhmm": hhmm(self.now)}

    def td(self) -> timedelta:
        return timedelta(seconds=self.now)


class _Pickler(pickle.Pickler):
    def __init__(self, f: io.BytesIO, shared: list[Any]) -> None:
        super().__init__(f, protocol=pickle.HIGHEST_PROTOCOL)
        self._ids = {id(o): i for i, o in enumerate(shared)}

    def persistent_id(self, obj: Any) -> int | None:
        return self._ids.get(id(obj))


class _Unpickler(pickle.Unpickler):
    def __init__(self, f: io.BytesIO, shared: list[Any]) -> None:
        super().__init__(f)
        self._shared = shared

    def persistent_load(self, pid: int) -> Any:
        return self._shared[pid]


__all__ = ["CATEGORIES", "InvalidAction", "NotFound", "Task", "World"]
