"""Customers in the venue: arrival, balk, queue, order, patience, seating, dwell, pay, leave
(technical.md 7.3). Aggregator customers are order-only (no party)."""

from __future__ import annotations

import math
from typing import TYPE_CHECKING, Any

from brew.domain.ids import uuid7
from brew.domain.timeutil import epoch_ms
from brew.sim.rng import lognormal_params

from .engine import P_DONE, P_TIMEOUT
from .replate import RP
from .state import T_CANCEL, T_READY, Order, Party, Table, Task

if TYPE_CHECKING:
    from .arrivals import DayPlan
    from .world import World

FRACS = (0.6, 0.3, 0.1)
AGG = ("zomato", "swiggy")


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x)) if x > -50 else 0.0


class Customers:
    """Party lifecycle. All draws come from the pre-sampled DayPlan (CRN) except patience-free dynamics."""

    def __init__(self, w: World) -> None:
        self.w = w
        self.parties: dict[str, Party] = {}
        self.queue: list[str] = []  # parties waiting at the register (state 'queueing')
        self.seat_wait: list[str] = []
        self._elig: dict[str, list[int]] = {}
        self.walkouts_today = 0
        self.balks_today = 0
        self.reneges_today = 0
        self.arrived_today = 0
        self.table_turns_today = 0
        self.dwell_cache: dict[str, tuple[float, float]] = {}
        self.pat_cache: dict[str, tuple[float, float]] = {}
        self.ended: list[Party] = []

    # ---------------------------------------------------------------- helpers
    def _ln(self, cache: dict, key: str, mean: float, sd: float) -> tuple[float, float]:
        v = cache.get(key)
        if v is None:
            v = lognormal_params(mean, sd)
            cache[key] = v
        return v

    def eligible_mods(self, sku: str) -> list[int]:
        """Indices into cfg.modifiers that may attach to ``sku``."""
        hit = self._elig.get(sku)
        if hit is None:
            item = self.w.ix.menu[sku]
            hit = []
            for mi, m in enumerate(self.w.cfg.modifiers):
                if sku in m.applies_to or (m.applies_to_tags and set(m.applies_to_tags) & set(item.tags)):
                    hit.append(mi)
            self._elig[sku] = hit
        return hit

    def pick_mods(self, persona: str, sku: str, u: list[float] | tuple[float, ...]) -> tuple[str, ...]:
        """Choose 0-2 modifiers using the four pre-drawn uniforms of this slot."""
        w = self.w
        el = self.eligible_mods(sku)
        if not el:
            return ()
        mods = w.cfg.modifiers
        probs = [mods[i].pick_prob.get(persona, mods[i].pick_prob.get("default", 0.0)) for i in el]
        tot = sum(probs)
        if tot <= 0 or u[0] >= min(0.7, tot):
            return ()
        x = u[1] * tot
        acc = 0.0
        first = el[-1]
        for i, p in zip(el, probs, strict=True):
            acc += p
            if x < acc:
                first = i
                break
        out = [mods[first].id]
        if u[2] < 0.2:
            rest = [
                (i, p)
                for i, p in zip(el, probs, strict=True)
                if i != first and frozenset((mods[i].id, mods[first].id)) not in w.ix.incompatible
            ]
            t2 = sum(p for _, p in rest)
            if t2 > 0:
                x = u[3] * t2
                acc = 0.0
                for i, p in rest:
                    acc += p
                    if x < acc:
                        out.append(mods[i].id)
                        break
        return tuple(out)

    # ----------------------------------------------------------------- basket
    def build_basket(
        self, plan: DayPlan, i: int, persona: str, apply_outside: bool
    ) -> list[tuple[str, tuple[str, ...]]] | None:
        """Pick items for candidate ``i`` via MNL. ``None`` = the customer leaves (outside option won)."""
        w = self.w
        ch = w.choice
        w.ensure_choice_ctx()
        per = w.cfg.personas[persona]
        off = int(plan.off[i])
        nd = int(plan.n_drink[i])
        nf = int(plan.n_food[i])
        bulk = int(plan.bulk[i]) > 0
        food_prob = float(per.basket.get("food_prob", 0.4))
        skus = ch.skus
        J = ch.J
        rp = w.replate
        agg = int(plan.chan[i]) >= 2
        allowed = ch.rp_deliv if agg else None
        claimed: dict[str, int] = {}
        items: list[tuple[str, tuple[str, ...]]] = []
        for k in range(nd):
            j = ch.choose(
                persona,
                "drink",
                plan.gumbel[off + k],
                with_outside=(k == 0 and apply_outside and not bulk),
                gumbel_rp_row=plan.gumbel_rp[off + k],
                rp_allowed=allowed,
            )
            if j < 0:
                if k == 0 and apply_outside and not bulk:
                    return None
                continue
            sku = skus[j % J]
            mods = self.pick_mods(persona, sku, plan.mod_u[off + k])
            items.append((sku, self._rp_mark(rp, sku, mods, j >= J, claimed)))
        for k in range(nf):
            r = off + nd + k
            if not bulk and plan.take_u[r] >= food_prob:
                continue
            j = ch.choose(
                persona, "food", plan.gumbel[r], with_outside=False, gumbel_rp_row=plan.gumbel_rp[r],
                rp_allowed=allowed,
            )  # fmt: skip
            if j < 0:
                continue
            sku = skus[j % J]
            mods = self.pick_mods(persona, sku, plan.mod_u[r])
            items.append((sku, self._rp_mark(rp, sku, mods, j >= J, claimed)))
        if not items and nd + nf > 0:
            return None
        if items and not bulk and w.combos.enabled:
            items = w.combos.mark_basket(items, persona, float(plan.combo_u[i]), agg)
        if items and not bulk and w.cfg.replate.addon_enabled and ch.rp_mask is not None:
            ja = ch.addon_choice(persona, plan.gumbel_rp[off], float(plan.gumbel_addon[off]), allowed)
            if ja >= 0:
                sku = skus[ja]
                if claimed.get(sku, 0) + 1 <= rp.listed_units(sku):
                    claimed[sku] = claimed.get(sku, 0) + 1
                    items.append((sku, (RP,)))
        return items

    @staticmethod
    def _rp_mark(
        rp: Any, sku: str, mods: tuple[str, ...], chose_rp: bool, claimed: dict[str, int]
    ) -> tuple[str, ...]:
        """Tag ``mods`` with the replate marker when the customer picked the replate alternative and the
        listing still has units for this basket (otherwise they pay the regular price)."""
        if not chose_rp:
            return mods
        n = claimed.get(sku, 0) + 1
        if n > rp.listed_units(sku):
            return mods
        claimed[sku] = n
        return (*mods, RP)

    def attach_note(
        self, plan: DayPlan, i: int, items: list[tuple[str, tuple[str, ...]]]
    ) -> tuple[str | None, list[str], list[tuple[str, tuple[str, ...]]]]:
        """With prob ``note_prob`` attach a ticket note; its modifier hints may add mods."""
        w = self.w
        if plan.note_u[i, 0] >= w.cfg.cafe.params.note_prob or not items:
            return None, [], items
        notes = w.corp.notes
        text, intents, mods, _urg = notes[min(len(notes) - 1, int(plan.note_u[i, 1] * len(notes)))]
        out = list(items)
        for mid in mods:
            for idx, (sku, ms) in enumerate(out):
                el = {w.cfg.modifiers[j].id for j in self.eligible_mods(sku)}
                if mid in el and mid not in ms and len(ms) < 3:
                    bad = any(frozenset((mid, m)) in w.ix.incompatible for m in ms)
                    if not bad:
                        out[idx] = (sku, (*ms, mid))
                        break
        return text, list(intents), out

    # ----------------------------------------------------------------- arrival
    def on_arrival(self, plan: DayPlan, i: int) -> None:
        persona = plan.personas[int(plan.pidx[i])]
        ch = ("dine_in", "takeaway", "zomato", "swiggy")[int(plan.chan[i])]
        if ch in AGG:
            self.spawn_delivery(plan, i, persona, ch)
        else:
            self.spawn_party(plan, i, persona, ch)

    def _name(self, plan: DayPlan, i: int) -> str:
        names = self.w.corp.names
        return names[min(len(names) - 1, int(plan.name_u[i] * len(names)))]

    def spawn_delivery(self, plan: DayPlan, i: int, persona: str, ch: str) -> None:
        w = self.w
        if w.dis.platform_outage:
            return
        items = self.build_basket(plan, i, persona, apply_outside=True)
        if not items:
            return
        note, flags, items = self.attach_note(plan, i, items)
        o = w.orders.make_order(ch, persona, self._name(plan, i), None, items, note, flags)
        w.kpi.arrived_agg += 1
        w.delivery.new_order(o)

    def spawn_party(self, plan: DayPlan, i: int, persona: str, ch: str) -> None:
        w = self.w
        per = w.cfg.personas[persona]
        size = int(plan.size[i])
        reg_idx = -1
        name = self._name(plan, i)
        seeds = [int(x) for x in plan.seeds[i, :size]]
        if persona == "regular" and w.regulars:
            k = int(plan.reg_u[i] * len(w.regulars))
            reg = w.regulars[k]
            if reg.churned:
                return
            reg_idx = k
            name = reg.name
            seeds[0] = reg.seed
        r1, r2 = int(plan.ids[i, 0]), int(plan.ids[i, 1])
        ts = epoch_ms(w.now, w.start_date)
        pid = uuid7(ts, r1, r2)
        cid = uuid7(ts, r2, r1)
        laptop = bool(plan.laptop_u[i] < per.laptop_prob)
        p = Party(pid, cid, i, persona, size, ch, name, w.now, seeds, laptop)
        p.reg_idx = reg_idx
        p.refill_u = [float(x) for x in plan.refill_u[i]]
        mu, sg = self._ln(self.pat_cache, persona, per.patience_s[0], per.patience_s[1])
        p.patience_total = p.patience_left = math.exp(mu + sg * float(plan.patience_z[i]))
        dm, ds = per.dwell_min
        if dm > 0:
            mu, sg = self._ln(self.dwell_cache, persona, dm * 60.0, ds * 60.0)
            p.dwell_s = max(240.0, math.exp(mu + sg * float(plan.dwell_z[i])))
        self.parties[pid] = p
        self.arrived_today += 1
        w.emit(
            "customer.arrived", customer_id=cid, party_id=pid, persona=persona, party_size=size, channel=ch,
            appearance_seeds=seeds, name=name, laptop=laptop,
        )  # fmt: skip
        # balk: sigmoid(a (queue - q0) + b [no table & dine in])
        prm = w.cfg.cafe.params
        qlen = len(self.queue) + sum(1 for q in self.parties.values() if q.state == "ordering")
        no_table = ch == "dine_in" and not self.any_table_possible(size)
        x = prm.balk_a * (qlen - per.balk_q0) + prm.balk_b * (1 if no_table else 0)
        if w.dis.power_cut:
            x += 0.8
        if per.balk_q0 < 90 and p.refill_u[3] < _sigmoid(x):
            reason = "no_table" if no_table and qlen < per.balk_q0 else "queue"
            self.balk(p, reason)
            return
        p.state = "queueing"
        p.queued_s = w.now
        self.queue.append(pid)
        w.emit("customer.queued", party_id=pid, position=len(self.queue))
        self.pat_arm(p, prm.queue_patience_rate)
        p.reg_task = w.kitchen.add_service_task(
            "register", "order", "register", w.cfg.cafe.register_s[0], w.cfg.cafe.register_s[1], 1.0, ref=pid
        )
        p.reg_task.persona = persona
        p.reg_task.channel = ch
        p.reg_task.due_s = w.now + p.patience_total
        p.reg_task.est_s = w.cfg.cafe.register_s[0]

    def balk(self, p: Party, reason: str) -> None:
        p.state = "balked"
        p.left = True
        self.walkouts_today += 1
        self.balks_today += 1
        self.w.kpi.cum_walkouts[p.persona] += 1
        self.w.kpi.balks += 1
        self.w.emit("customer.balked", party_id=p.id, reason=reason)
        self._retire(p)

    def _retire(self, p: Party) -> None:
        self.parties.pop(p.id, None)
        self.ended.append(p)
        if len(self.ended) > 200:
            del self.ended[:100]

    # ---------------------------------------------------------------- patience
    def pat_arm(self, p: Party, rate: float) -> None:
        w = self.w
        now = w.now
        if p.patience_rate > 0:
            p.patience_left -= p.patience_rate * (now - p.patience_mark)
        p.patience_mark = now
        p.patience_rate = rate
        w.engine.cancel(p.patience_handle)
        p.patience_handle = None
        if rate <= 0:
            return
        tot = p.patience_total
        if p.thresholds < 3:
            target = FRACS[p.thresholds] * tot
            t = now + max(0.0, (p.patience_left - target) / rate)
        else:
            t = now + max(0.0, p.patience_left / rate)
        p.patience_handle = w.engine.schedule(t, "PAT", p.id, P_TIMEOUT)

    def pat_stop(self, p: Party) -> None:
        w = self.w
        if p.patience_rate > 0:
            p.patience_left -= p.patience_rate * (w.now - p.patience_mark)
        p.patience_rate = 0.0
        w.engine.cancel(p.patience_handle)
        p.patience_handle = None

    def on_pat(self, pid: str) -> None:
        p = self.parties.get(pid)
        w = self.w
        if p is None or p.left or p.patience_rate <= 0:
            return
        p.patience_left -= p.patience_rate * (w.now - p.patience_mark)
        p.patience_mark = w.now
        tot = p.patience_total
        if p.patience_left <= 1e-6:
            p.patience_handle = None
            self.expire(p)
            return
        while p.thresholds < 3 and p.patience_left <= FRACS[p.thresholds] * tot + 1e-6:
            w.emit("customer.patience", party_id=p.id, frac=FRACS[p.thresholds])
            p.thresholds += 1
        self.pat_arm(p, p.patience_rate)

    def expire(self, p: Party) -> None:
        """Patience ran out: renege with prob 0.55, otherwise stay and be unhappy."""
        w = self.w
        p.patience_rate = 0.0
        if p.state not in ("queueing", "ordering", "waiting"):
            return
        renege = p.refill_u[4] < w.cfg.cafe.params.renege_prob
        if p.state == "ordering":
            renege = False  # already at the till: stays, grumbling
        if not renege:
            p.unhappy = True
            return
        order_no: int | None = None
        if p.state == "queueing":
            if p.id in self.queue:
                self.queue.remove(p.id)
            if p.reg_task is not None:
                w.kitchen.cancel_task(p.reg_task)
        else:
            for no in p.order_nos:
                o = w.orders.orders.get(no)
                if o is not None and o.state not in ("served", "voided"):
                    order_no = no
                    w.orders.void(o, "customer_left")
        p.state = "reneged"
        p.left = True
        self.walkouts_today += 1
        self.reneges_today += 1
        w.kpi.cum_walkouts[p.persona] += 1
        w.kpi.reneges += 1
        w.emit("customer.reneged", party_id=p.id, order_no=order_no)
        w.emit("customer.left", party_id=p.id, happy=False)
        self._retire(p)

    # --------------------------------------------------------------- register
    def on_register_start(self, pid: str) -> None:
        p = self.parties.get(pid)
        if p is None or p.left:
            return
        if pid in self.queue:
            self.queue.remove(pid)
        p.state = "ordering"
        self.w.emit("customer.ordering", party_id=pid)

    def on_register_done(self, pid: str, task: Task) -> None:
        w = self.w
        p = self.parties.get(pid)
        if p is None or p.left:
            return
        plan = w.plan
        # plan may have rolled over at midnight; parties are served within the same day
        assert plan is not None
        items = self.build_basket(plan, p.idx, p.persona, apply_outside=True)
        if not items:
            self.pat_stop(p)
            self.balk(p, "menu")
            return
        note, flags, items = self.attach_note(plan, p.idx, items)
        o = w.orders.make_order(p.channel, p.persona, p.name, p.id, items, note, flags)
        if not w.orders.commit(o):
            self.pat_stop(p)
            self.balk(p, "sold_out")
            return
        p.order_nos.append(o.order_no)
        p.ordered_s = w.now
        p.state = "waiting"
        if p.channel == "takeaway":
            w.fin.collect(o, p.refill_u[5])
        # customers expect slow items to take time: stretch patience by the quoted wait
        bonus = min(600.0, 0.7 * max(0.0, o.promised_s - w.now))
        if p.patience_rate > 0:
            p.patience_left -= p.patience_rate * (w.now - p.patience_mark)
            p.patience_mark = w.now
        p.patience_left += bonus
        p.patience_total += bonus
        self.pat_arm(p, 1.0)
        deadline = w.now + max(0.0, p.patience_left)
        w.emit(
            "customer.waiting",
            party_id=p.id,
            order_no=o.order_no,
            patience_s=round(p.patience_total, 1),
            patience_deadline_s=round(deadline, 1),
        )

    # ----------------------------------------------------------------- served
    def on_served(self, o: Order) -> None:
        w = self.w
        p = self.parties.get(o.party_id) if o.party_id else None
        if p is None or p.left:
            return
        if o.is_refill:
            return
        self.pat_stop(p)
        if p.channel == "takeaway":
            self.leave(p, happy=not p.unhappy)
            return
        # dine-in: claim a table now
        p.state = "seat_wait"
        p.wait_start_s = w.now
        if not self.try_seat(p):
            self.seat_wait.append(p.id)
            p.seat_handle = w.engine.schedule(
                w.now + w.cfg.cafe.seat_wait_max_s, "SEAT_TIMEOUT", p.id, P_TIMEOUT
            )

    # ----------------------------------------------------------------- seating
    def any_table_possible(self, size: int) -> bool:
        return self.find_seats(size, peek=True) is not None

    def find_seats(self, size: int, peek: bool = False) -> tuple[list[str], list[int], bool] | None:
        w = self.w
        tabs = w.tables
        cands = [t for t in w.table_order if tabs[t].state == "free" and tabs[t].seats >= size]
        comb = {x for pair in w.cfg.tables.combinable for x in pair}
        if cands:
            cands.sort(key=lambda t: (t in comb, tabs[t].seats, t))
            t = cands[0]
            return [t], list(range(size)), False
        if size >= 2:
            for a, b in w.cfg.tables.combinable:
                if (
                    tabs[a].state == "free"
                    and tabs[b].state == "free"
                    and tabs[a].seats + tabs[b].seats >= size
                ):
                    return [a, b], list(range(size)), True
        if size == 1:
            for t in w.table_order:
                tb = tabs[t]
                if (
                    tb.state == "occupied"
                    and sum(1 for x in tb.occ if x is not None) == 1
                    and len(tb.occ) == tb.seats == 2
                ):
                    return [t], [tb.occ.index(None)], False
        return None

    def try_seat(self, p: Party) -> bool:
        w = self.w
        found = self.find_seats(p.size)
        if found is None:
            return False
        tids, seats, merged = found
        w.engine.cancel(p.seat_handle)
        p.seat_handle = None
        tabs = w.tables
        for k, tid in enumerate(tids):
            tb = tabs[tid]
            if tb.state == "free":
                tb.occ = [None] * tb.seats
                tb.since_s = w.now
            tb.state = "occupied"
            tb.party_ids.append(p.id)
            if merged:
                tb.merged = "+".join(tids)
        # assign seats
        if merged:
            n = 0
            for tid in tids:
                tb = tabs[tid]
                for si in range(tb.seats):
                    if n < p.size:
                        tb.occ[si] = p.id
                        n += 1
        else:
            tb = tabs[tids[0]]
            for si in seats:
                tb.occ[si] = p.id
        p.table_ids = tids
        p.state = "seated"
        p.seated_s = w.now
        if p.id in self.seat_wait:
            self.seat_wait.remove(p.id)
        w.emit("customer.seated", party_id=p.id, table_ids=tids, seats=seats, merged=merged)
        w.engine.schedule(w.now + w.cfg.cafe.seat_walk_s, "EAT", p.id, P_DONE)
        return True

    def seat_waiting_check(self) -> None:
        for pid in list(self.seat_wait):
            p = self.parties.get(pid)
            if p is None or p.left:
                if pid in self.seat_wait:
                    self.seat_wait.remove(pid)
                continue
            self.try_seat(p)

    def on_seat_timeout(self, pid: str) -> None:
        p = self.parties.get(pid)
        w = self.w
        if p is None or p.left or p.state != "seat_wait":
            return
        if pid in self.seat_wait:
            self.seat_wait.remove(pid)
        for no in p.order_nos:
            o = w.orders.orders.get(no)
            if o is not None:
                o.no_table = True
                w.fin.collect(o, p.refill_u[5])
        self.leave(p, happy=not p.unhappy)

    def on_eat(self, pid: str) -> None:
        p = self.parties.get(pid)
        w = self.w
        if p is None or p.left:
            return
        p.state = "eating"
        w.emit("customer.eating", party_id=pid)
        eat = min(1500.0, max(180.0, 0.5 * p.dwell_s))
        p.eat_end_s = w.now + eat
        w.engine.schedule(w.now + eat, "LINGER", pid, P_DONE)
        # remote-worker refills
        if p.persona == "remote_worker":
            prm = w.cfg.cafe.params
            for k in range(3):
                t = w.now + (k + 1) * prm.refill_period_s
                if p.refill_u[k] < prm.refill_prob and t < w.now + p.dwell_s:
                    w.engine.schedule(t, "REFILL", pid, P_DONE)

    def on_linger(self, pid: str) -> None:
        p = self.parties.get(pid)
        w = self.w
        if p is None or p.left:
            return
        p.state = "lingering"
        w.emit("customer.lingering", party_id=pid, laptop=p.laptop)
        rest = max(60.0, p.dwell_s - (p.eat_end_s - p.seated_s))
        w.engine.schedule(w.now + rest, "PAY_START", pid, P_DONE)

    def on_refill(self, pid: str) -> None:
        p = self.parties.get(pid)
        w = self.w
        if p is None or p.left or p.state not in ("eating", "lingering") or not p.order_nos:
            return
        first = w.orders.orders.get(p.order_nos[0])
        if first is None or not first.units:
            return
        drink = next(
            (u for u in first.units if w.ix.menu[u.sku].cat in ("coffee", "notcoffee")), first.units[0]
        )
        o = w.orders.make_order(
            p.channel, p.persona, p.name, p.id, [(drink.sku, tuple(m for m in drink.mods if m[:1] != "~"))], None, [],
            refill=True,
        )  # fmt: skip
        if w.orders.commit(o):
            p.order_nos.append(o.order_no)
            w.emit("customer.ordering", party_id=pid)

    def on_pay_start(self, pid: str) -> None:
        p = self.parties.get(pid)
        w = self.w
        if p is None or p.left:
            return
        p.state = "paying"
        method = w.fin.pay_method("dine_in", p.refill_u[5])
        w.emit("customer.paying", party_id=pid, method=method)
        w.engine.schedule(w.now + w.cfg.cafe.payment_s, "PAY_DONE", pid, P_DONE)

    def on_pay_done(self, pid: str) -> None:
        p = self.parties.get(pid)
        w = self.w
        if p is None or p.left:
            return
        for no in p.order_nos:
            o = w.orders.orders.get(no)
            if o is not None and o.state != "voided":
                w.fin.collect(o, p.refill_u[5])
        self.leave(p, happy=not p.unhappy)

    # ------------------------------------------------------------------- leave
    def ambience(self, p: Party) -> float:
        w = self.w
        if p.channel == "takeaway":
            return 0.7
        occ = sum(1 for t in w.tables.values() if t.state != "free") / max(1, len(w.tables))
        penalty = (
            0.3
            if any((w.orders.orders.get(n) is not None and w.orders.orders[n].no_table) for n in p.order_nos)
            else 0.0
        )
        return max(0.0, 0.95 - 0.4 * occ - penalty)

    def leave(self, p: Party, happy: bool) -> None:
        w = self.w
        if p.left:
            return
        p.left = True
        self.pat_stop(p)
        p.state = "left"
        w.emit("customer.left", party_id=p.id, happy=happy)
        amb = self.ambience(p)
        # table -> dirty -> cleaning task
        if p.table_ids:
            ware: dict[str, int] = {}
            for no in p.order_nos:
                o = w.orders.orders.get(no)
                if o is None:
                    continue
                for u in o.units:
                    if u.ware:
                        ware[u.ware] = ware.get(u.ware, 0) + 1
                        u.ware = ""
            for tid in p.table_ids:
                tb = w.tables[tid]
                for k, x in enumerate(tb.occ):
                    if x == p.id:
                        tb.occ[k] = None
                if p.id in tb.party_ids:
                    tb.party_ids.remove(p.id)
            main = p.table_ids[0]
            for kk, v in ware.items():
                w.tables[main].dirty_ware[kk] = w.tables[main].dirty_ware.get(kk, 0) + v
            self.table_turns_today += 1
            freed = [tid for tid in p.table_ids if all(x is None for x in w.tables[tid].occ)]
            for tid in freed:
                tb = w.tables[tid]
                tb.state = "dirty"
                tb.merged = None
                tb.turns += 1
                tb.occupied_s += w.now - tb.since_s
            if freed:
                cs = w.cfg.cafe.cleaning_s
                w.kitchen.add_service_task("clean", "clean", "pass", cs, cs * 0.2, 0.6, ref=freed)
        else:
            # party that never sat: return reserved ware (served takeaway uses paper)
            for no in p.order_nos:
                o = w.orders.orders.get(no)
                if o is not None:
                    for u in o.units:
                        if u.ware:
                            w.return_ware(u.ware, clean=False)
                            u.ware = ""
        # reviews per (non-refill) order
        for no in p.order_nos:
            o = w.orders.orders.get(no)
            if o is not None and not o.is_refill and o.state == "served":
                w.reviews.rate_order(o, p, amb)
        self._retire(p)

    def on_table_cleaned(self, tids: list[str]) -> None:
        w = self.w
        for tid in tids:
            tb = w.tables[tid]
            for kk, v in tb.dirty_ware.items():
                w.return_ware(kk, clean=False, n=v)
            tb.dirty_ware = {}
            tb.state = "free"
            tb.occ = []
        w.maybe_wash()
        self.seat_waiting_check()

    # ------------------------------------------------------------------ misc
    def in_venue(self) -> list[Party]:
        return [p for p in self.parties.values() if not p.left]

    def low_patience_waiting(self) -> int:
        return sum(
            1
            for p in self.parties.values()
            if p.state in ("queueing", "waiting") and p.patience_left < 0.3 * p.patience_total
        )


__all__ = ["T_CANCEL", "T_READY", "Customers", "Table"]
