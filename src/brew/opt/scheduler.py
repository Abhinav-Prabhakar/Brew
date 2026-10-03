"""Rolling-plan scheduler: OR-Tools CP-SAT with a tight time limit plus a greedy fallback (12.4).

Tasks (<= ~40 ready tasks, batches pre-merged by the caller) are assigned to staff members who are
cumulative resources of attention capacity 100 (a task occupies ``attention x 100``); equipment slots are
cumulative resources; precedence between tasks of the same unit is respected.  Objective: weighted
tardiness ``sum w_i * max(0, end_i - due_i)`` plus a tiny tie-break on completion times.  The result is a
*priority order* (planned start times) that the dispatcher follows greedily.
"""

from __future__ import annotations

import itertools
import time
from dataclasses import dataclass, field

CAP = 100  # attention capacity per staff member (x100)


@dataclass
class SchedTask:
    id: int
    dur: float  # seconds (estimated, batch factor already applied)
    att: float  # attention share (0, 1]
    due: float  # sim seconds
    weight: float = 1.0
    ready: float = 0.0
    eligible: tuple[str, ...] = ()  # staff keys that can do it
    slot: str | None = None  # equipment key whose slot it occupies
    preds: tuple[int, ...] = ()  # task ids that must finish first (inside the plan)


@dataclass
class SchedStaff:
    key: str
    avail_at: float = 0.0  # when the person becomes free of work in progress (sim seconds)


@dataclass
class SchedResult:
    status: str  # optimal | feasible | greedy
    order: list[int]
    start: dict[int, float]
    staff: dict[int, str]
    cost: float
    wall_s: float = 0.0
    details: dict[str, float] = field(default_factory=dict)


def tardiness_cost(tasks: list[SchedTask], end: dict[int, float]) -> float:
    return float(sum(t.weight * max(0.0, end[t.id] - t.due) for t in tasks))


def greedy_schedule(
    tasks: list[SchedTask], staff: list[SchedStaff], now: float, slots: dict[str, int] | None = None
) -> SchedResult:
    """Priority list scheduling (weighted EDF, shortest first on ties) respecting attention and slots."""
    t0 = time.perf_counter()
    by_id = {t.id: t for t in tasks}
    ivs: dict[str, list[tuple[float, float, float]]] = {
        s.key: ([(now, s.avail_at, 1.0)] if s.avail_at > now else []) for s in staff
    }
    slot_ivs: dict[str, list[tuple[float, float]]] = {}
    prio = sorted(tasks, key=lambda t: ((t.due - t.dur) / max(t.weight, 1e-6), t.dur, t.id))
    start: dict[int, float] = {}
    end: dict[int, float] = {}
    who: dict[int, str] = {}
    done: set[int] = set()
    pending = list(prio)
    guard = 0
    while pending and guard < 10 * len(tasks) + 10:
        guard += 1
        progressed = False
        for t in list(pending):
            if any(p in by_id and p not in done for p in t.preds):
                continue
            lb = max(t.ready, now, *(end[p] for p in t.preds if p in end)) if t.preds else max(t.ready, now)
            best: tuple[float, str] | None = None
            for sk in t.eligible or tuple(ivs):
                s0 = _earliest(ivs[sk], lb, t.dur, t.att, 1.0)
                if t.slot and slots and t.slot in slots:
                    s0 = _earliest_slot(slot_ivs.setdefault(t.slot, []), s0, t.dur, slots[t.slot], ivs[sk], t.att)
                if best is None or s0 < best[0] - 1e-9:
                    best = (s0, sk)
            if best is None:
                continue
            s0, sk = best
            start[t.id], end[t.id], who[t.id] = s0, s0 + t.dur, sk
            ivs[sk].append((s0, s0 + t.dur, t.att))
            if t.slot:
                slot_ivs.setdefault(t.slot, []).append((s0, s0 + t.dur))
            done.add(t.id)
            pending.remove(t)
            progressed = True
        if not progressed:
            break
    for t in pending:  # unschedulable leftovers (no eligible staff): park at the end
        start[t.id] = max(end.values(), default=now)
        end[t.id] = start[t.id] + t.dur
        who[t.id] = ""
    order = sorted(start, key=lambda i: (start[i], by_id[i].due, i))
    return SchedResult("greedy", order, start, who, tardiness_cost(tasks, end), time.perf_counter() - t0)


def _earliest(ivs: list[tuple[float, float, float]], lb: float, dur: float, att: float, cap: float) -> float:
    """Earliest start >= lb where the attention sum stays <= cap over [s, s+dur)."""
    cands = sorted({lb, *(e for _s, e, _a in ivs if e > lb)})
    for s in cands:
        if _fits(ivs, s, s + dur, att, cap):
            return s
    return cands[-1] if cands else lb


def _fits(ivs: list[tuple[float, float, float]], s: float, e: float, att: float, cap: float) -> bool:
    pts = sorted({s, *(a for a, _b, _c in ivs if s < a < e), *(b for _a, b, _c in ivs if s < b < e)})
    for p in pts:
        load = sum(a2 for a0, b0, a2 in ivs if a0 <= p < b0)
        if load + att > cap + 1e-9:
            return False
    return True


def _earliest_slot(
    sivs: list[tuple[float, float]], lb: float, dur: float, n_slots: int, _staff_ivs: object, _att: float
) -> float:
    cands = sorted({lb, *(e for _s, e in sivs if e > lb)})
    for s in cands:
        pts = sorted({s, *(a for a, _b in sivs if s < a < s + dur)})
        if all(sum(1 for a, b in sivs if a <= p < b) < n_slots for p in pts):
            return s
    return cands[-1] if cands else lb


def cpsat_schedule(
    tasks: list[SchedTask],
    staff: list[SchedStaff],
    now: float,
    slots: dict[str, int] | None = None,
    time_limit_s: float = 0.02,
    seed: int = 0,
    hint: SchedResult | None = None,
) -> SchedResult | None:
    """Solve the plan with CP-SAT. Returns ``None`` when no solution was found within the limit."""
    from ortools.sat.python import cp_model

    t0 = time.perf_counter()
    if not tasks:
        return SchedResult("optimal", [], {}, {}, 0.0)
    m = cp_model.CpModel()
    sc = 1  # seconds
    H = int(now + sum(t.dur for t in tasks) * sc + max((s.avail_at for s in staff), default=now) - now + 60)
    lo = int(now)
    start, end = {}, {}
    pres: dict[tuple[int, str], cp_model.IntVar] = {}
    per_staff: dict[str, list[tuple[cp_model.IntervalVar, int]]] = {s.key: [] for s in staff}
    per_slot: dict[str, list[cp_model.IntervalVar]] = {}
    tard = {}
    for t in tasks:
        d = max(1, int(round(t.dur * sc)))
        r = max(lo, int(t.ready))
        s_var = m.NewIntVar(r, H, f"s{t.id}")
        e_var = m.NewIntVar(r + d, H + d, f"e{t.id}")
        m.Add(e_var == s_var + d)
        start[t.id], end[t.id] = s_var, e_var
        elig = [k for k in (t.eligible or tuple(per_staff)) if k in per_staff]
        if not elig:
            elig = list(per_staff)
        lits = []
        for k in elig:
            p = m.NewBoolVar(f"p{t.id}_{k}")
            pres[(t.id, k)] = p
            iv = m.NewOptionalIntervalVar(s_var, d, e_var, p, f"i{t.id}_{k}")
            per_staff[k].append((iv, max(1, int(round(t.att * CAP)))))
            lits.append(p)
        m.AddExactlyOne(lits)
        if t.slot:
            iv2 = m.NewIntervalVar(s_var, d, e_var, f"q{t.id}")
            per_slot.setdefault(t.slot, []).append(iv2)
        tv = m.NewIntVar(0, H, f"t{t.id}")
        m.Add(tv >= e_var - int(t.due))
        tard[t.id] = tv
    for s in staff:
        ivs = per_staff[s.key]
        if s.avail_at > now:
            blk = m.NewIntervalVar(lo, int(s.avail_at) - lo, int(s.avail_at), f"blk_{s.key}")
            ivs = [*ivs, (blk, CAP)]
        if ivs:
            m.AddCumulative([iv for iv, _ in ivs], [dm for _, dm in ivs], CAP)
    for key, ivs in per_slot.items():
        cap = (slots or {}).get(key, 0)
        if cap > 0 and len(ivs) > cap:
            m.AddCumulative(ivs, [1] * len(ivs), cap)
    by_id = {t.id: t for t in tasks}
    for t in tasks:
        for p in t.preds:
            if p in by_id:
                m.Add(start[t.id] >= end[p])
    wsum = {t.id: max(1, int(round(t.weight * 10))) for t in tasks}
    m.Minimize(sum(wsum[i] * 1000 * tard[i] for i in tard) + sum(end[i] for i in end))
    if hint is not None:
        for i, v in hint.start.items():
            if i in start:
                m.AddHint(start[i], int(min(H, max(lo, v))))
        for i, k in hint.staff.items():
            for (ti, sk), p in pres.items():
                if ti == i:
                    m.AddHint(p, 1 if sk == k else 0)
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max(0.001, time_limit_s)
    solver.parameters.num_workers = 1
    solver.parameters.random_seed = int(seed) % (2**31 - 1)
    solver.parameters.cp_model_presolve = True
    solver.parameters.log_search_progress = False
    st = solver.Solve(m)
    if st not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None
    st_map = {i: float(solver.Value(v)) for i, v in start.items()}
    who = {}
    for (ti, k), p in pres.items():
        if solver.BooleanValue(p):
            who[ti] = k
    ends = {i: float(solver.Value(v)) for i, v in end.items()}
    order = sorted(st_map, key=lambda i: (st_map[i], by_id[i].due, i))
    return SchedResult(
        "optimal" if st == cp_model.OPTIMAL else "feasible", order, st_map, who, tardiness_cost(tasks, ends),
        time.perf_counter() - t0,
    )


def schedule(
    tasks: list[SchedTask],
    staff: list[SchedStaff],
    now: float,
    slots: dict[str, int] | None = None,
    time_limit_s: float = 0.02,
    seed: int = 0,
) -> SchedResult:
    """CP-SAT warm-started from the greedy plan; falls back to the greedy plan when CP-SAT finds nothing
    better within ``time_limit_s``."""
    g = greedy_schedule(tasks, staff, now, slots)
    try:
        c = cpsat_schedule(tasks, staff, now, slots, time_limit_s, seed, hint=g)
    except Exception:  # pragma: no cover - defensive: never let the solver break the dispatcher
        c = None
    if c is not None and c.cost <= g.cost + 1e-6:
        return c
    return g


def brute_force_optimal(tasks: list[SchedTask], staff: list[SchedStaff], now: float) -> float:
    """Optimal weighted tardiness by enumerating job permutations (tiny instances, attention = 1, no slots).

    Every semi-active schedule is a permutation list-schedule on the earliest-free machine, so the minimum
    over permutations is the optimum.
    """
    by_id = {t.id: t for t in tasks}
    best = float("inf")
    for perm in itertools.permutations([t.id for t in tasks]):
        free = {s.key: max(now, s.avail_at) for s in staff}
        end: dict[int, float] = {}
        ok = True
        for i in perm:
            t = by_id[i]
            if any(p in by_id and p not in end for p in t.preds):
                ok = False
                break
            lb = max([t.ready, now, *(end[p] for p in t.preds if p in end)])
            k = min((k for k in (t.eligible or tuple(free))), key=lambda k: max(free[k], lb))
            s0 = max(free[k], lb)
            end[i] = s0 + t.dur
            free[k] = end[i]
        if ok:
            best = min(best, tardiness_cost(tasks, end))
    return best
