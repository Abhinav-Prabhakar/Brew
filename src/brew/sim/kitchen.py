"""Kitchen: task DAGs, stations, equipment slots, staff attention/fatigue/breaks, dispatch, batching,
errors/remakes, dish pit, prep jobs (docs/implementation-spec.md 7.5)."""

from __future__ import annotations

import math
from typing import TYPE_CHECKING, Any

from brew.domain.timeutil import DAY_S, parse_hhmm

from .engine import P_DECIDE, P_DONE
from .rng import Buffered, lognormal_params
from .state import (
    T_CANCEL,
    T_DONE,
    T_READY,
    T_RUN,
    T_WAIT,
    EquipState,
    Order,
    StaffState,
    StationState,
    Task,
    Unit,
)

if TYPE_CHECKING:
    from .world import World

SPECIALIST = 0.8


def _fits(used: float, att: float) -> bool:
    """Attention capacity 1.0; an active (>=0.8) task may interrupt passive work (used <= 0.5)."""
    return used + att <= 1.0 + 1e-9 or (att >= 0.8 and used <= 0.5 + 1e-9)


MIN_SKILL = 0.3


class Kitchen:
    """Owns staff, equipment, stations and every task in flight."""

    def __init__(self, w: World) -> None:
        self.w = w
        cfg = w.cfg
        self.staff: dict[str, StaffState] = {}
        self._shift_cfg: dict[str, tuple] = {}
        self.staff_list: list[StaffState] = []
        for s in cfg.staff:
            self.add_staff(s)
        self.equip: list[EquipState] = w.equip
        self.stations: dict[str, StationState] = {}
        for st in cfg.stations:
            self.stations[st.key] = StationState(st.key, st.max_staff)
        for et in cfg.equipment:
            e = EquipState(
                len(self.equip), et.key, et.station, et.slots, et.kw_active, et.kw_idle,
                et.mtbf_h, et.mttr_h, et.maintenance_per_day, et.capex,
            )  # fmt: skip
            self.equip.append(e)
            self.stations[et.station].eq.append(e.idx)
        self.ready: list[Task] = []
        self.holds: dict[int, float] = {}  # order_no -> sim time its tasks may start (just-in-time delivery)
        self.tasks: dict[int, Task] = {}
        self.task_seq = 0
        self.batch_seq = 0
        self.work_open = 0.0
        self.dp_at = -1.0
        self.dp_wake: float | None = None
        self.dp_wake_handle: int | None = None
        self.load_ewma = 0.0
        self.norm = Buffered(w.rng.durations)
        self.err = Buffered(w.rng.errors, "uniform")
        self._ln: dict[tuple[float, float], tuple[float, float]] = {}
        self.dish_wash_pending = False
        self.prep_inflight: dict[str, float] = {}
        self.prep_jobs: dict[int, dict] = {}
        self.prep_seq = 0
        self.labour_accrued = 0.0
        self.tasks_started_today = 0
        self.batches_today = 0
        self.batched_tasks_today = 0
        self.rail_sig: tuple = ()
        self.live_batches: dict[int, set[int]] = {}
        self.wait_by_reason: dict[str, float] = {}
        self.wait_by_step: dict[str, list[float]] = {}

    # ------------------------------------------------------------------ staff
    def add_staff(self, s: Any) -> StaffState:
        st = StaffState(
            s.key, s.name, s.role, s.wage_per_h, dict(s.skills), s.speed, s.error_rate, s.fatigue_rate,
            s.recovery_rate, break_min=s.break_min,
        )  # fmt: skip
        st.exp_days = 30.0
        self.staff[s.key] = st
        self.staff_list.append(st)
        self._shift_cfg[s.key] = (s.shift, s.break_at)
        return st

    def init_day(self, day: int) -> None:
        """Schedule shift start/end and break events for ``day``."""
        w = self.w
        d0 = day * DAY_S
        for s in self.staff_list:
            (a, b), brk = self._shift_cfg[s.key]
            s.shift_start_s = d0 + parse_hhmm(a)
            s.shift_end_s = d0 + parse_hhmm(b)
            s.break_at_s = d0 + parse_hhmm(brk)
            s.break_done = s.break_min <= 0
            s.break_pending = False
            s.on_break = False
            s.present = False
            w.engine.schedule(s.shift_start_s, "SHIFT_START", s.key, 0)
            w.engine.schedule(s.shift_end_s, "SHIFT_END", s.key, 0)
            if s.break_min > 0:
                w.engine.schedule(s.break_at_s, "BREAK_DUE", s.key, 0)

    def clock_in(self, s: StaffState) -> None:
        w = self.w
        if s.present or s.absent:
            return
        if w.now >= s.shift_end_s:
            return
        s.present = True
        s.clock_in_s = w.now
        s.fatigue_mark = w.now
        w.emit("staff.clocked_in", staff_id=s.key, detail=s.role)
        self.request_dispatch()

    def clock_out(self, s: StaffState, reason: str = "") -> None:
        w = self.w
        if not s.present:
            return
        self.fatigue_update(s)
        s.present = False
        hrs = max(0.0, (w.now - s.clock_in_s) / 3600.0)
        self.labour_accrued += hrs * s.wage
        s.worked_s += w.now - s.clock_in_s
        w.emit("staff.clocked_out", staff_id=s.key, detail=reason or "shift_end")

    def on_shift_start(self, key: str) -> None:
        s = self.staff[key]
        if not s.absent:
            self.clock_in(s)

    def on_shift_end(self, key: str) -> None:
        s = self.staff[key]
        if s.on_break:
            s.on_break = False
        self.clock_out(s)

    def on_break_due(self, key: str) -> None:
        s = self.staff[key]
        if not s.present or s.break_done:
            return
        if s.attention_used < 1e-9:
            self.start_break(s)
        else:
            s.break_pending = True

    def start_break(self, s: StaffState) -> None:
        w = self.w
        s.break_pending = False
        s.break_done = True
        s.on_break = True
        s.break_end_s = w.now + s.break_min * 60.0
        w.emit("staff.break_started", staff_id=s.key, detail="")
        w.engine.schedule(w.now + s.break_min * 60.0, "BREAK_END", s.key, P_DONE)

    def on_break_end(self, key: str) -> None:
        s = self.staff[key]
        if s.on_break:
            s.on_break = False
            self.w.emit("staff.break_ended", staff_id=s.key, detail="")
            self.request_dispatch()

    def set_absent(self, key: str, absent: bool, kind: str = "absent") -> None:
        """Disruption hook: take a staff member out (or bring back) mid-day."""
        s = self.staff.get(key)
        if s is None:
            return
        w = self.w
        if absent and not s.absent:
            s.absent = True
            w.emit("staff.late" if kind == "late" else "staff.absent", staff_id=key, detail=kind)
            self.clock_out(s, "absent")
        elif not absent and s.absent:
            s.absent = False
            if s.shift_start_s <= w.now < s.shift_end_s:
                self.clock_in(s)

    def fatigue_update(self, s: StaffState) -> None:
        dt = self.w.now - s.fatigue_mark
        if dt <= 0:
            return
        if s.attention_used > 0.25:
            s.fatigue = min(1.0, s.fatigue + s.fatigue_rate * s.attention_used * dt / 60.0)
            s.busy_s += dt * s.attention_used
        else:
            s.fatigue = max(0.0, s.fatigue - s.recovery_rate * dt / 60.0)
        s.fatigue_mark = self.w.now

    def present_staff(self) -> list[StaffState]:
        return [s for s in self.staff_list if s.present and not s.on_break]

    def on_minute(self) -> None:
        """Called every sim minute: fatigue, load EWMA, overload minutes."""
        ps = [s for s in self.staff_list if s.present]
        for s in ps:
            self.fatigue_update(s)
        if ps:
            util = sum(min(1.0, s.attention_used) for s in ps if not s.on_break) / max(1, len(ps))
            self.load_ewma += (util - self.load_ewma) * (1 - math.exp(-60.0 / 600.0))
            for s in ps:
                if s.attention_used > 0.95:
                    s.overload_s += 60.0
                    self.w.kpi.cum_overload_s += 60.0
        else:
            self.load_ewma *= 0.9

    def load_pct(self) -> float:
        """Kitchen load 0-100: ``100*util_ewma(10 min) + 6*queued_tasks/stations``."""
        queued = sum(1 for t in self.ready if t.state == T_READY)
        return min(100.0, 100.0 * self.load_ewma + 6.0 * queued / max(1, len(self.stations)))

    # ------------------------------------------------------------- task build
    def _task(
        self, kind: str, name: str, station: str, order_no: int, mean: float, sd: float, att: float, **kw: Any
    ) -> Task:
        self.task_seq += 1
        t = Task(self.task_seq, kind, name, station, order_no, mean, sd, att, **kw)
        t.est_s = mean
        self.tasks[t.id] = t
        return t

    def build_unit(self, order: Order, unit: Unit) -> None:
        """Create the task DAG for one unit from its recipe."""
        w = self.w
        r = w.cfg.recipes.recipes[unit.sku]
        extra = sum(w.ix.mod[m].extra_prep_s for m in unit.mods if m[:1] != "~")
        if unit.premade:
            self._build_premade_unit(order, unit)
            return
        by_name: dict[str, Task] = {}
        steps = r.steps
        created: list[Task] = []
        for i, st in enumerate(steps):
            t = self._task(
                "step", st.name, st.station, order.order_no, st.duration[0], st.duration[1], st.attention,
                uses_slot=st.uses_slot, batchable=st.batchable, max_batch=st.max_batch,
                batch_factor=st.batch_factor, sku=unit.sku, unit=unit, channel=order.channel,
                persona=order.persona, due_s=order.promised_s, placed_s=order.placed_s, bumped=order.bumped,
            )  # fmt: skip
            if i == 0:
                t.extra_s = extra
            deps = st.depends_on if st.depends_on is not None else ((steps[i - 1].name,) if i > 0 else ())
            t.deps_left = len(deps)
            for d in deps:
                by_name[d].children.append(t)
            by_name[st.name] = t
            created.append(t)
        # remaining-path estimate (longest chain from each task to the end)
        for t in reversed(created):
            t.est_s = t.duration_mean + (max(c.est_s for c in t.children) if t.children else 0.0)
        unit.tasks = created
        unit.tasks_left = len(created)
        order.tasks_total += len(created)
        now = w.now
        for t in created:
            self.work_open += t.duration_mean * t.attention
            if t.deps_left == 0:
                t.state = T_READY
                t.ready_s = now
                self.ready.append(t)

    def _build_premade_unit(self, order: Order, unit: Unit) -> None:
        """A unit drawn from make-ahead stock needs only a short plating / hand-off step."""
        t = self._task(
            "step", "serve", "pass", order.order_no, 10.0, 2.0, 1.0, sku=unit.sku, unit=unit,
            channel=order.channel, persona=order.persona, due_s=order.promised_s, placed_s=order.placed_s,
            bumped=order.bumped,
        )  # fmt: skip
        unit.tasks = [t]
        unit.tasks_left = 1
        order.tasks_total += 1
        self.work_open += t.duration_mean * t.attention
        t.state = T_READY
        t.ready_s = self.w.now
        self.ready.append(t)

    def build_order_tasks(self, order: Order) -> None:
        w = self.w
        for u in order.units:
            self.build_unit(order, u)
        if order.channel != "dine_in":
            mean = w.cfg.cafe.bag_s
            t = self._task(
                "bag", "bag", "pass", order.order_no, mean, mean * 0.2, 1.0, channel=order.channel,
                persona=order.persona, due_s=order.promised_s, placed_s=order.placed_s, bumped=order.bumped,
            )  # fmt: skip
            t.deps_left = len(order.units)
            order.bag_task = t
            order.tasks_total += 1
            self.work_open += mean
        self.request_dispatch()

    def add_service_task(
        self, kind: str, name: str, station: str, mean: float, sd: float, att: float, ref: Any = None, **kw: Any
    ) -> Task:
        """Register / clean / wash / prep style tasks that are not part of an order DAG."""
        t = self._task(kind, name, station, 0, mean, sd, att, ref=ref, **kw)
        t.state = T_READY
        t.ready_s = self.w.now
        t.placed_s = self.w.now
        self.ready.append(t)
        self.work_open += mean * att
        self.request_dispatch()
        return t

    # ---------------------------------------------------------------- dispatch
    # ---------------------------------------------------------------- holds
    def hold_order(self, order_no: int, until: float) -> None:
        """Keep an order's tasks out of dispatch until ``until`` (just-in-time delivery cooking)."""
        self.holds[order_no] = until
        self.schedule_wake(until)

    def release_order(self, order_no: int) -> None:
        if self.holds.pop(order_no, None) is not None:
            self.request_dispatch()

    def request_dispatch(self) -> None:
        w = self.w
        if self.dp_at == w.now:
            return
        self.dp_at = w.now
        w.engine.schedule(w.now, "DISPATCH", None, P_DECIDE)

    def on_dispatch(self) -> None:
        w = self.w
        now = w.now
        self.dp_at = -1.0
        self.ready = [t for t in self.ready if t.state == T_READY]
        if not self.ready:
            return
        offer = list(self.ready)
        wake: float | None = None
        if self.holds:  # held delivery orders are not offered to the policy yet
            self.holds = {no: t for no, t in self.holds.items() if t > now}
            if self.holds:
                offer = [t for t in offer if t.order_no not in self.holds]
                wake = min(self.holds.values())
                if not offer:
                    self.schedule_wake(wake)
                    return
        view = w.view()
        choices = w.policy.dispatch(offer, view)
        started = False
        seen: set[int] = set()
        blocked: dict[str, tuple[float, bool]] = {}
        for ch in choices:
            tasks = [t for t in ch.tasks if t.state == T_READY and t.id not in seen]
            if not tasks:
                continue
            if ch.hold_until > now:
                wake = ch.hold_until if wake is None else min(wake, ch.hold_until)
                for t in tasks:
                    seen.add(t.id)
                continue
            t0 = tasks[0]
            bl = blocked.get(t0.station)
            if bl is not None and (t0.attention >= bl[0] or (t0.uses_slot and bl[1])):
                continue
            if self.try_start(tasks):
                started = True
                for t in tasks:
                    seen.add(t.id)
            elif t0.wait_reason == "staff":
                cur = blocked.get(t0.station, (9.0, False))
                blocked[t0.station] = (min(cur[0], t0.attention), cur[1])
            elif t0.wait_reason == "equipment":
                cur = blocked.get(t0.station, (9.0, False))
                blocked[t0.station] = (cur[0], True)
        if wake is not None:
            self.schedule_wake(wake)
        if started:
            self.ready = [t for t in self.ready if t.state == T_READY]
            w.after_dispatch()

    def schedule_wake(self, t: float) -> None:
        w = self.w
        if self.dp_wake is not None and self.dp_wake <= t and self.dp_wake > w.now:
            return
        w.engine.cancel(self.dp_wake_handle)
        self.dp_wake = t
        self.dp_wake_handle = w.engine.schedule(t, "DISPATCH_WAKE", None, P_DECIDE)

    def on_dispatch_wake(self) -> None:
        self.dp_wake = None
        self.dp_wake_handle = None
        self.request_dispatch()

    def _pick_staff(self, t: Task) -> StaffState | None:
        """Best available staff: specialists first; others (skill >= 0.5) help once a task has waited 20 s."""
        st = self.stations[t.station]
        helping = t.kind == "step" and self.w.now - t.ready_s >= 20.0
        best: StaffState | None = None
        best_key: tuple | None = None
        for s in self.staff_list:
            if not s.present or s.on_break:
                continue
            sk = s.skills.get(t.station, 0.0)
            if sk < SPECIALIST and not (helping and sk >= 0.5):
                continue
            if not _fits(s.attention_used, t.attention):
                continue
            at_station = st.staff_active.get(s.key, 0) > 0
            if not at_station and len(st.staff_active) >= st.max_staff:
                continue
            key = (0 if sk >= SPECIALIST else 1, -(1 if at_station else 0), -sk, s.fatigue, s.key)
            if best_key is None or key < best_key:
                best, best_key = s, key
        best_key2: tuple[float, float, str] | None = None
        if best is None and t.kind != "step":
            # till / cleaning / dish tasks: fall back to any staff with some skill if no specialist is present
            if not any(
                s.present and not s.on_break and s.skills.get(t.station, 0.0) >= SPECIALIST
                for s in self.staff_list
            ):
                for s in self.staff_list:
                    if not s.present or s.on_break or s.skills.get(t.station, 0.0) < MIN_SKILL:
                        continue
                    if not _fits(s.attention_used, t.attention):
                        continue
                    at_station = st.staff_active.get(s.key, 0) > 0
                    if not at_station and len(st.staff_active) >= st.max_staff:
                        continue
                    key2 = (-s.skills[t.station], s.fatigue, s.key)
                    if best_key2 is None or key2 < best_key2:
                        best, best_key2 = s, key2
        return best

    def _pick_slot(self, t: Task) -> int:
        st = self.stations[t.station]
        for ei in st.eq:
            e = self.equip[ei]
            if e.up and e.slots_used < e.slots:
                return ei
        return -1

    def try_start(self, tasks: list[Task]) -> bool:
        w = self.w
        now = w.now
        t0 = tasks[0]
        staff = self._pick_staff(t0)
        if staff is None:
            t0.wait_reason = "staff"
            return False
        slot = -1
        if t0.uses_slot:
            slot = self._pick_slot(t0)
            if slot < 0:
                t0.wait_reason = "equipment"
                return False
        # dish pit: first task of a dine-in unit reserves clean ware
        reserved: list[tuple[Unit, str]] = []
        for t in tasks:
            u = t.unit
            if u is not None and not u.started:
                ware = w.ware_for(u)
                if ware:
                    if not w.take_ware(ware):
                        for uu, ww in reserved:
                            w.return_ware(ww, clean=True)
                            uu.ware = ""
                        t0.wait_reason = "dishpit"
                        return False
                    u.ware = ware
                    reserved.append((u, ware))
        n = len(tasks)
        mu, sg = self._ln.get((t0.duration_mean, t0.duration_sd)) or self._ln.setdefault(
            (t0.duration_mean, t0.duration_sd), lognormal_params(t0.duration_mean, t0.duration_sd)
        )
        base = math.exp(mu + sg * self.norm.next()) if sg > 0 else t0.duration_mean
        self.fatigue_update(staff)
        k = w.cfg.cafe.params.fatigue_speed_k
        learn = 1.0 + 0.3 * math.exp(-staff.exp_days / 10.0)
        dur = base / staff.speed * (1.0 + k * staff.fatigue) * learn
        if n > 1:
            solo = dur  # what one task of this step takes this staff member right now
            dur *= 1.0 + t0.batch_factor * (n - 1)
            # n tasks one-by-one take n*solo; together solo*(1+bf*(n-1)) -> saves (n-1)*(1-bf)*solo
            saves_s = round((n - 1) * (1.0 - t0.batch_factor) * solo, 1)
            self.batch_seq += 1
            bid = self.batch_seq
            onos = sorted({t.order_no for t in tasks})
            w.emit(
                "batch.formed", batch_id=f"b{bid}", station=t0.station, step=t0.name, order_nos=onos, size=n,
                saves_s=saves_s,
            )
            w.emit(
                "batch.started", batch_id=f"b{bid}", station=t0.station, step=t0.name, order_nos=onos, size=n,
                saves_s=saves_s,
            )
            self.batches_today += 1
            self.live_batches[bid] = set(onos)
            self.batched_tasks_today += n
        else:
            bid = 0
        dur += max(t.extra_s for t in tasks) / staff.speed
        end = now + dur
        st = self.stations[t0.station]
        st.staff_active[staff.key] = st.staff_active.get(staff.key, 0) + 1
        staff.attention_used += t0.attention
        staff.active.extend(tasks)
        staff.task_name = t0.name
        staff.station = t0.station
        if slot >= 0:
            self.equip[slot].slots_used += 1
        for t in tasks:
            t.state = T_RUN
            t.start_s = now
            t.end_s = end
            t.staff = staff.key
            t.batch_id = bid
            t.batch_n = n
            t.slot_eq = slot
            st.queue_wait_s += now - t.ready_s
            ws = self.wait_by_step.setdefault(f"{t.station}.{t.name}", [0.0, 0.0])
            ws[0] += now - t.ready_s
            ws[1] += 1
            if t.wait_reason:
                self.wait_by_reason[t.wait_reason] = self.wait_by_reason.get(t.wait_reason, 0.0) + (
                    now - t.ready_s
                )
            if t.unit is not None:
                t.unit.started = True
            w.emit(
                "task.started", task_id=t.id, station=t.station, step=t.name, staff_id=staff.key,
                order_no=t.order_no or None, est_s=round(dur, 1),
            )  # fmt: skip
            if t.order_no:
                w.orders.on_task_started(t.order_no)
        self.tasks_started_today += n
        w.engine.schedule(end, "TASK_DONE", tuple(t.id for t in tasks), P_DONE)
        if t0.kind == "register":
            w.customers.on_register_start(t0.ref)
        return True

    # --------------------------------------------------------------- completion
    def on_task_done(self, ids: tuple[int, ...]) -> None:
        w = self.w
        tasks = [self.tasks[i] for i in ids if i in self.tasks and self.tasks[i].state == T_RUN]
        if not tasks:
            return
        t0 = tasks[0]
        staff = self.staff[t0.staff]
        st = self.stations[t0.station]
        self.fatigue_update(staff)
        staff.attention_used = max(0.0, staff.attention_used - t0.attention)
        if staff.attention_used < 1e-9:
            staff.attention_used = 0.0
        for t in tasks:
            if t in staff.active:
                staff.active.remove(t)
        n = st.staff_active.get(staff.key, 1) - 1
        if n <= 0:
            st.staff_active.pop(staff.key, None)
        else:
            st.staff_active[staff.key] = n
        if t0.batch_id:
            self.live_batches.pop(t0.batch_id, None)
        if t0.slot_eq >= 0:
            e = self.equip[t0.slot_eq]
            e.slots_used = max(0, e.slots_used - 1)
            e.active_s += t0.end_s - t0.start_s
        dur = t0.end_s - t0.start_s
        st.busy_s += dur * t0.attention
        st.tasks_done += len(tasks)
        staff.tasks_done += len(tasks)
        if not staff.active and staff.break_pending and staff.present:
            self.start_break(staff)
        for t in tasks:
            t.state = T_DONE
            self.work_open = max(0.0, self.work_open - t.duration_mean * t.attention)
            w.emit(
                "task.finished", task_id=t.id, station=t.station, step=t.name, staff_id=staff.key,
                order_no=t.order_no or None, actual_s=round(dur, 1), remake=t.remake,
            )  # fmt: skip
            if w.tele is not None:
                w.tele.task(w, t, staff, dur)
            self._complete(t, staff)
            self.tasks.pop(t.id, None)
        self.request_dispatch()

    def _complete(self, t: Task, staff: StaffState) -> None:
        w = self.w
        now = w.now
        for c in t.children:
            c.deps_left -= 1
            if c.deps_left == 0 and c.state == T_WAIT:
                c.state = T_READY
                c.ready_s = now
                self.ready.append(c)
        k = t.kind
        if k == "step":
            u = t.unit
            assert u is not None
            u.tasks_left -= 1
            order = w.orders.orders.get(t.order_no)
            if order is None or order.state == "voided":
                return
            order.tasks_done += 1
            if u.tasks_left == 0:
                if self._check_error(u, order, staff):
                    return
                u.done = True
                u.ready_s = now
                if order.bag_task is not None:
                    bt = order.bag_task
                    bt.deps_left -= 1
                    if bt.deps_left == 0:
                        bt.state = T_READY
                        bt.ready_s = now
                        self.ready.append(bt)
                w.orders.unit_done(order)
            w.orders.update_progress(order)
        elif k == "bag":
            order = w.orders.orders.get(t.order_no)
            if order is not None and order.state != "voided":
                order.tasks_done += 1
                w.orders.bag_done(order)
        elif k == "register":
            w.customers.on_register_done(t.ref, t)
        elif k == "clean":
            w.customers.on_table_cleaned(t.ref)
        elif k == "wash":
            w.on_wash_done(t.ref)
        elif k == "prep":
            self.on_prep_step_done(t)
        elif k == "premake":
            w.replate.on_premake_step_done(t)

    def _check_error(self, u: Unit, order: Order, staff: StaffState) -> bool:
        """Maybe force a remake of ``u``; returns True if it did."""
        w = self.w
        p = staff.error_rate * (1.0 + w.cfg.cafe.params.error_load_k * max(0.0, self.load_ewma - 0.85))
        if p <= 0 or u.remakes >= 2 or self.err.next() >= p:
            return False
        order.errors += 1
        # remake: consume again (partial ok), rebuild the DAG (a remade unit is no longer make-ahead stock)
        u.premade = False
        w.orders.consume_unit(order, u, remake=True)
        u.remakes += 1
        order.remakes += 1
        for t in u.tasks:
            t.remake = True
        self.build_unit(order, u)
        for t in u.tasks:
            t.remake = True
        return True

    # -------------------------------------------------------------------- prep
    def start_prep(self, key: str, qty: float) -> float:
        """Start prep batches for ``key`` to produce about ``qty`` base units. Returns qty started."""
        w = self.w
        p = w.ix.prep[key]
        started = 0.0
        batches = max(1, math.ceil(qty / p.batch_size - 1e-9))
        for _ in range(batches):
            if not w.inv.can_supply([(c.ingredient, c.qty) for c in p.components], w.now):
                break
            if not any(s.present for s in self.staff_list) and w.now > 0:
                pass
            for c in p.components:
                got, cost, _q = w.inv.consume(c.ingredient, c.qty, w.now, partial=True)
                w.book_consumption(c.ingredient, cost)
            self.prep_seq += 1
            jid = self.prep_seq
            job = {"id": jid, "key": key, "qty": p.batch_size, "start": w.now, "steps_left": len(p.steps)}
            self.prep_jobs[jid] = job
            self.prep_inflight[key] = self.prep_inflight.get(key, 0.0) + p.batch_size
            started += p.batch_size
            w.emit("prep.started", prep_key=key, qty=p.batch_size)
            prev: Task | None = None
            for ps in p.steps:
                t = self.add_service_task(
                    "prep", ps.name, ps.station, ps.duration[0], ps.duration[1], ps.attention,
                    ref=jid, uses_slot=ps.uses_slot,
                )  # fmt: skip
                t.sku = key
                t.state = T_WAIT if prev is not None else T_READY
                if prev is not None:
                    prev.children.append(t)
                    t.deps_left = 1
                    if t in self.ready:
                        self.ready.remove(t)
                prev = t
        w.recheck_availability(w.inv.stock_dirty)
        return started

    def on_prep_step_done(self, t: Task) -> None:
        w = self.w
        job = self.prep_jobs.get(t.ref)
        if job is None:
            return
        job["steps_left"] -= 1
        if job["steps_left"] <= 0:
            p = w.ix.prep[job["key"]]
            ready_at = max(w.now, job["start"] + p.lead_time_min * 60.0)
            w.engine.schedule(ready_at, "PREP_READY", job["id"], P_DONE)

    def on_prep_ready(self, jid: int) -> None:
        w = self.w
        job = self.prep_jobs.pop(jid, None)
        if job is None:
            return
        key = job["key"]
        p = w.ix.prep[key]
        self.prep_inflight[key] = max(0.0, self.prep_inflight.get(key, 0.0) - job["qty"])
        w.inv.add_lot(key, job["qty"], w.now, shelf_h=p.hold_time_min / 60.0)
        w.emit("prep.ready", prep_key=key, qty=job["qty"])
        w.recheck_availability(w.inv.stock_dirty)

    # --------------------------------------------------------------- utilities
    def station_util(self) -> dict[str, float]:
        """Instantaneous staff-attention utilisation per station (0..1+)."""
        out: dict[str, float] = {}
        att: dict[str, float] = {k: 0.0 for k in self.stations}
        for s in self.staff_list:
            for t in s.active:
                att[t.station] += t.attention / max(1, t.batch_n)
        for k, st in self.stations.items():
            out[k] = att[k] / max(1, st.max_staff)
        return out

    def queue_len(self, station: str) -> int:
        return sum(1 for t in self.ready if t.station == station and t.state == T_READY)

    def cancel_order_tasks(self, order: Order) -> None:
        """Cancel every not-yet-started task of an order (void)."""
        for u in order.units:
            for t in u.tasks:
                if t.state in (T_WAIT, T_READY):
                    t.state = T_CANCEL
                    self.work_open = max(0.0, self.work_open - t.duration_mean * t.attention)
                    self.tasks.pop(t.id, None)
        if order.bag_task is not None and order.bag_task.state in (T_WAIT, T_READY):
            order.bag_task.state = T_CANCEL
            self.tasks.pop(order.bag_task.id, None)
        self.holds.pop(order.order_no, None)
        self.ready = [t for t in self.ready if t.state == T_READY]

    def cancel_task(self, t: Task) -> None:
        if t.state in (T_WAIT, T_READY):
            t.state = T_CANCEL
            self.work_open = max(0.0, self.work_open - t.duration_mean * t.attention)
            self.tasks.pop(t.id, None)
