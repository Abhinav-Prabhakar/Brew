"""Who is doing what: the kitchen crew (reducer + crew card + figures) and the lobby "now brewing" chalkboard.

Regression tests for the functional audit: the crew card picked a different task than the figure and the state did,
a snapshot taken mid-task showed the person as ready, a stale task could pin someone to a station, and the lobby
chalkboard named the baristas on shift as if every ticket were theirs.
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.frontend

NAMES = "Object.fromEntries(Object.values(s.staff).map((x) => [x.id, x.name.toLowerCase()]))"


@pytest.mark.parametrize("name", ["morning_rush", "lunch_delivery", "closing"])
def test_reducer_staff_state_follows_the_task_stream_for_everyone(harness, name):
    out = harness.evaluate(
        """async (n) => {
          const fx = await T.load(n);
          let s = BrewStore.hydrate(fx.snapshot);
          const ever = {}, bad = [], working = {};
          for (const ev of fx.events) {
            if (ev.type === 'staff.status') {  // the sim's own verdict, compared with what the stream derived so far
              for (const r of ev.data.staff) {
                const mine = Object.values(s.tasks).filter((t) => t.staff_id === r.staff_id);
                if (r.state === 'working' && !mine.length && s.staff[r.staff_id].state !== 'working') bad.push(['working?', r.staff_id, ev.sim_s]);
                if (r.state === 'idle' && mine.length) bad.push(['idle?', r.staff_id, ev.sim_s, mine.length]);
              }
            }
            s = BrewStore.reduce(s, ev);
            if (ev.type === 'task.started') {
              const d = ev.data, st = s.staff[d.staff_id];
              ever[d.staff_id] = (ever[d.staff_id] || 0) + 1;
              if (!st || st.state !== 'working' || !st.station || st.task == null) bad.push(['not working after task.started', d.staff_id, ev.sim_s]);
              else working[d.staff_id] = (working[d.staff_id] || 0) + 1;
            }
          }
          return { ever, working, bad: bad.slice(0, 8), n: fx.events.length };
        }""",
        name,
    )
    assert not out["bad"], out["bad"]
    assert len(out["ever"]) >= 3, "several different people work, not only one or two"
    assert out["working"] == out["ever"], "every person who starts a task is 'working' right then"


def test_idle_verdict_drops_a_stale_task_and_a_mid_task_snapshot_is_working(harness):
    out = harness.evaluate(
        """async () => {
          const fx = await T.load('morning_rush');
          const base = BrewStore.hydrate(fx.checkpoints[2].data);
          const id = Object.values(base.staff).find((x) => x.present && x.role === 'barista').id;
          let n = base.seq;
          const ev = (type, data, dt = 1) => ({ seq: ++n, sim_s: base.sim_s + dt, t: base.t, type, data });
          const row = (state, extra = {}) => ({ staff_id: id, fatigue: 0.1, station: null, task: null, state, break_due_s: null, break_end_s: null, ...extra });
          const out = {};
          // task.finished lost: the sim says idle on the next minute mark -> the task must not pin them to a station
          let s = BrewStore.reduceAll(base, [ev('task.started', { task_id: 999001, station: 'espresso', step: 'pull', staff_id: id, order_no: 5, est_s: 20 })]);
          out.before = [s.staff[id].state, s.staff[id].station, Object.keys(s.tasks).includes('999001')];
          s = BrewStore.reduce(s, ev('staff.status', { staff: [row('idle')] }, 5));
          out.after = [s.staff[id].state, s.staff[id].station, Object.keys(s.tasks).includes('999001')];
          // a snapshot taken mid-task: working with a station before any task event
          s = BrewStore.reduce(base, ev('staff.status', { staff: [row('working', { station: 'grinder', task: 'grind' })] }));
          out.mid = [s.staff[id].state, s.staff[id].station, s.staff[id].task];
          // with a task known, the stream wins over a (later-stamped) row that still shows the old station
          s = BrewStore.reduceAll(base, [ev('task.started', { task_id: 999002, station: 'bar', step: 'whisk', staff_id: id, order_no: 6, est_s: 20 }),
                                         ev('staff.status', { staff: [row('working', { station: 'grinder', task: 'grind' })] }, 2)]);
          out.known = [s.staff[id].state, s.staff[id].station, s.staff[id].task];
          // the sim says on break: the person is on break even if the stream never told us
          s = BrewStore.reduce(base, ev('staff.status', { staff: [row('break', { break_end_s: base.sim_s + 600 })] }));
          out.brk = [s.staff[id].state, s.staff[id].on_break];
          return out;
        }"""
    )
    assert out["before"] == ["working", "espresso", True]
    assert out["after"] == ["idle", None, False]
    assert out["mid"] == ["working", "grinder", "grind"]
    assert out["known"] == ["working", "bar", "whisk"]
    assert out["brk"] == ["break", True]


def _first_time_with(
    app, pred_js: str, start: str = "08:05", stop: str = "10:20", step_min: int = 3
) -> str | None:
    h, m = map(int, start.split(":"))
    end_h, end_m = map(int, stop.split(":"))
    t = h * 60 + m
    while t <= end_h * 60 + end_m:
        when = f"{t // 60:02d}:{t % 60:02d}"
        app.step_to(when, settle_ms=120)
        if app.state(pred_js):
            return when
        t += step_min
    return None


def test_crew_card_and_figures_show_the_task_each_person_is_really_on(open_app):
    app = open_app("morning_rush")
    when = _first_time_with(
        app, "Object.values(s.tasks).some((t) => t.order_no != null && s.staff[t.staff_id]?.present)"
    )
    assert when, "the fixture has people working on tickets in the morning"
    app.room("kitchen")
    for at in ("08:40", "09:10", "09:40"):
        app.step_to(at, settle_ms=500)
        info = app.ev(
            """() => {
              const s = BrewLive.state, by = {};
              for (const t of Object.values(s.tasks)) (by[t.staff_id] = by[t.staff_id] || []).push(t);
              const rows = [...document.querySelectorAll('#kitchen .crew .crow')].map((r) => ({
                id: r.dataset.staff, tag: r.querySelector('.tag').textContent.trim(), stn: r.querySelector('.stn').textContent.trim() }));
              const fig = Object.fromEntries([...document.querySelectorAll('#k-crew .staff')].map((g) => [g.dataset.staff, 1]));
              return { rows, by, fig, staff: s.staff };
            }"""
        )
        for r in info["rows"]:
            mine = sorted(info["by"].get(r["id"], []), key=lambda t: (-t["started_s"], -int(t["task_id"])))
            sf = info["staff"][r["id"]]
            if mine:
                newest = mine[0]
                if newest["order_no"] is not None:  # prep / cleaning tasks belong to no ticket
                    assert f"#{newest['order_no']}" in r["tag"], (r, newest)
                assert r["stn"], r
                assert sf["station"] == newest["station"] and sf["state"] == "working", (sf, newest)
                if len(mine) > 1:
                    assert f"×{len(mine)}" in r["tag"], r
            elif sf["state"] == "idle":
                assert r["tag"] == "ready", r


def test_lobby_now_brewing_names_who_is_on_each_ticket(open_app):
    app = open_app("morning_rush")
    pred = "Object.values(s.tasks).some((t) => t.order_no != null && s.orders[t.order_no] && ['queued','brewing','almost'].includes(s.orders[t.order_no].status))"
    when = _first_time_with(app, pred)
    assert when, "some ticket is being worked on in the morning rush"
    app.room("lobby")
    seen_named = seen_fallback = 0
    t = 8 * 60 + 5
    while t <= 10 * 60 + 20:
        app.step_to(f"{t // 60:02d}:{t % 60:02d}", settle_ms=200)
        t += 4
        info = app.ev(
            """() => {
              const s = BrewLive.state, names = Object.fromEntries(Object.values(s.staff).map((x) => [x.id, x.name.toLowerCase()]));
              const rows = [...document.querySelectorAll('#lobby .kds .row[data-kds]')].map((r) => {
                const nos = r.dataset.kds.split(',').map(Number);
                const truth = [...new Set(Object.values(s.tasks).filter((t) => nos.includes(t.order_no)).map((t) => names[t.staff_id]))].sort();
                return { nos, on: (r.dataset.on || '').split(',').filter(Boolean).map((x) => names[x] || x).sort(), text: r.textContent, truth };
              });
              const head = document.querySelector('#lobby .kds h4 small')?.textContent || '';
              const baristas = Object.values(s.staff).filter((x) => x.role === 'barista' && x.present).map((x) => x.name.toLowerCase());
              return { rows, head, baristas };
            }"""
        )
        for r in info["rows"]:
            assert r["on"] == r["truth"], r  # exactly the people whose tasks are for these tickets
            for n in r["truth"][:2]:
                assert n in r["text"], r
        if any(r["on"] for r in info["rows"]):
            seen_named += 1
            assert "on it" in info["head"], info  # the header no longer claims the whole on-shift list
        elif info["rows"]:
            seen_fallback += 1
            for b in info["baristas"]:
                assert b in info["head"], info  # nobody assigned yet: fall back to who is on shift
    assert seen_named >= 3, "tickets with a named worker were rendered"


def test_raw_stock_events_move_the_pantry_rows_and_nothing_else(harness):
    """stock.changed for a raw ingredient (now streamed by the sim) lowers state.inventory[key].on_hand / state.stock."""
    out = harness.evaluate(
        """async () => {
          const fx = await T.load('morning_rush');
          const base = BrewStore.hydrate(fx.checkpoints[2].data);
          const row = { key: 'milk', on_hand: 90000, par: 90000, low: false, uom: 'ml' };
          let s = BrewStore.reduce(base, { seq: null, sim_s: base.sim_s, t: base.t, type: 'rest.inventory', data: { items: [row] } });
          const ev = (n, qty, low) => ({ seq: base.seq + n, sim_s: base.sim_s + n * 60, t: base.t, type: 'stock.changed', data: { key: 'milk', qty, low } });
          const seen = [];
          for (const [n, q, low] of [[1, 89100, false], [2, 88400, false], [3, 8000, true]]) {
            s = BrewStore.reduce(s, ev(n, q, low));
            seen.push([s.inventory.milk.on_hand, s.inventory.milk.low, s.stock.milk.qty]);
          }
          return { seen, par: s.inventory.milk.par };
        }"""
    )
    assert out["seen"] == [[89100, False, 89100], [88400, False, 88400], [8000, True, 8000]]
    assert out["par"] == 90000
