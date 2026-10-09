"""The pure client state (design/live/store.js + reduce/*.js) over the golden streams, in headless Chromium.

Most of the frontend suite lives here: fast (the whole file runs in well under 30 s) and deterministic.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from .conftest import FIXTURE_NAMES, FIXTURES, ROOT

pytestmark = pytest.mark.frontend


def fx(name: str) -> list[dict[str, Any]]:
    return [json.loads(x) for x in (FIXTURES / f"{name}.jsonl").read_text().splitlines() if x]


def events(name: str, *types: str) -> list[dict[str, Any]]:
    return [e for e in fx(name) if e["kind"] == "event" and (not types or e["type"] in types)]


def known_gap_tags() -> set[str]:
    return set(json.loads((ROOT / "design" / "contract.json").read_text())["known_gaps"])


# ------------------------------------------------------------------------------------------- event sourcing == snapshot
@pytest.mark.parametrize("name", FIXTURE_NAMES)
def test_event_sourcing_equals_snapshot_at_every_checkpoint(harness, name):
    """reduceAll(hydrate(snapshot), events <= checkpoint.seq) == hydrate(checkpoint) on everything the rooms draw.

    Where the snapshot is genuinely richer than the stream (documented in design/contract.json `known_gaps`) the
    difference is reported under a tag instead of failing; a new, undocumented tag fails.
    """
    res = harness.evaluate("(n) => T.verifyCheckpoints(n)", name)
    assert len(res) >= 4
    bad = [f"@{r['hhmm']} seq {r['seq']}: {d}" for r in res for d in r["diffs"]]
    assert not bad, "event-sourced state differs from the snapshot:\n" + "\n".join(bad[:25])
    tags = {g["tag"] for r in res for g in r["gaps"]}
    allowed = known_gap_tags()
    assert tags <= allowed, f"undocumented gap(s) {sorted(tags - allowed)}: document them in scripts/build_contract.py KNOWN_GAPS"
    assert not harness.errors


def test_hydrate_maps_every_snapshot_key(harness):
    keys = harness.evaluate(
        """async () => {
          const fx = await T.load('morning_rush');
          const s = BrewStore.hydrate(fx.checkpoints[2].data);
          return Object.keys(s);
        }"""
    )
    expected = (
        "seq sim_s t world clock weather day kpis policy menu combos replate orders rail batches customers tables shelf "
        "receipts payments reviews staff tasks stations equipment prep stock fridge inventory lots pos decisions bottleneck "
        "disruptions investments rest"
    )
    for k in expected.split():
        assert k in keys, f"state.{k} missing (design/live/README.md state shape)"
    snap = fx("morning_rush")[1]["data"]
    s = harness.evaluate(
        "async () => { const fx = await T.load('morning_rush'); const s = BrewStore.hydrate(fx.snapshot); "
        "return {seq: s.seq, sim_s: s.sim_s, menu: Object.keys(s.menu).length, combos: Object.keys(s.combos).length, "
        "staff: Object.keys(s.staff).length, equipment: Object.keys(s.equipment).length, stations: Object.keys(s.stations).length, "
        "tables: Object.keys(s.tables).length, fridge: s.fridge.length, world: s.world, clock: s.clock, policy: s.policy}; }"
    )
    assert s["seq"] == snap["last_seq"] and s["sim_s"] == snap["clock"]["sim_s"]
    assert s["menu"] == len(snap["menu"]) and s["combos"] == len(snap["combos"]) and s["staff"] == len(snap["staff"])
    assert s["equipment"] == len(snap["equipment"]) == s["stations"] and s["tables"] == len(snap["tables"]["tables"])
    assert s["fridge"] == len(snap["fridge"])
    assert s["world"]["id"] == snap["world"]["id"] and s["world"]["policy"] == "D" and s["policy"]["throttles"] == snap["policy"]["throttles"]
    assert s["clock"]["hhmm"] == "07:55"


# --------------------------------------------------------------------------------------------------------- purity
@pytest.mark.parametrize("name", FIXTURE_NAMES)
def test_reduce_is_pure_over_a_deep_frozen_fixture(harness, name):
    out = harness.evaluate(
        """async (name) => {
          const fx = await T.load(name);
          const snap = JSON.parse(JSON.stringify(fx.snapshot));
          const evs = JSON.parse(JSON.stringify(fx.events));
          const before = JSON.stringify([snap, evs]);
          T.deepFreeze(snap); T.deepFreeze(evs);
          let s = BrewStore.hydrate(snap);
          T.deepFreeze(s);
          // freeze every intermediate state too: the next reduce must copy, never write into a previous state
          for (const e of evs) { s = BrewStore.reduce(s, e); if (e.seq % 7 === 0) T.deepFreeze(s); }
          const full = BrewStore.reduceAll(BrewStore.hydrate(snap), evs);
          return { same: JSON.stringify(full) === JSON.stringify(s), inputsUntouched: before === JSON.stringify([snap, evs]), seq: s.seq };
        }""",
        name,
    )
    assert out["same"] and out["inputsUntouched"]
    assert out["seq"] == events(name)[-1]["seq"]


def test_untouched_slices_keep_their_identity(harness):
    out = harness.evaluate(
        """async () => {
          const fx = await T.load('morning_rush');
          const s0 = BrewStore.hydrate(fx.snapshot);
          const ev = { seq: s0.seq + 1, sim_s: s0.sim_s + 1, t: s0.t, type: 'weather.changed', data: { state: 'rain', temp_c: 24, rain_mm_h: 4 } };
          const s1 = BrewStore.reduce(s0, ev);
          return { weatherNew: s1.weather !== s0.weather, menuSame: s1.menu === s0.menu, ordersSame: s1.orders === s0.orders,
                   customersSame: s1.customers === s0.customers, staffSame: s1.staff === s0.staff, s0Weather: s0.weather.state };
        }"""
    )
    assert out["s0Weather"] == "partly", "the previous state is untouched"
    assert out["weatherNew"] and out["menuSame"] and out["ordersSame"] and out["customersSame"] and out["staffSame"]


def test_unknown_event_types_only_advance_seq_and_time(harness):
    out = harness.evaluate(
        """async () => {
          const fx = await T.load('morning_rush');
          const s0 = BrewStore.hydrate(fx.snapshot);
          const s1 = BrewStore.reduce(s0, { seq: s0.seq + 1, sim_s: s0.sim_s + 5, t: 'x', type: 'future.event', data: {} });
          const { seq, sim_s, t, ...rest } = s1; const { seq: a, sim_s: b, t: c, clock: _c, ...rest0 } = s0;
          return { seq: s1.seq - s0.seq, sim: s1.sim_s - s0.sim_s, restSame: Object.keys(rest0).every((k) => k === 'clock' || s1[k] === s0[k]) };
        }"""
    )
    assert out == {"seq": 1, "sim": 5, "restSame": True}


# --------------------------------------------------------------------------------------------- dedupe / idempotence
@pytest.mark.parametrize("name", FIXTURE_NAMES)
def test_refeeding_applied_seqs_is_a_no_op(harness, name):
    out = harness.evaluate(
        """async (name) => {
          const fx = await T.load(name);
          const s0 = BrewStore.hydrate(fx.snapshot);
          const full = BrewStore.reduceAll(s0, fx.events);
          const again = BrewStore.reduceAll(full, fx.events);            // the whole stream a second time
          const half = fx.events.length >> 1;
          const a = BrewStore.reduceAll(s0, fx.events.slice(0, half + 50));
          const overlapped = BrewStore.reduceAll(a, fx.events.slice(half - 50));   // reconnect overlap
          const stale = BrewStore.reduce(full, fx.events[0]);
          return { identical: again === full, overlap: JSON.stringify(overlapped) === JSON.stringify(full), stale: stale === full };
        }""",
        name,
    )
    assert out == {"identical": True, "overlap": True, "stale": True}


def test_rest_pseudo_events_always_apply_and_never_move_seq(harness):
    out = harness.evaluate(
        """async () => {
          const fx = await T.load('morning_rush');
          const s0 = BrewStore.hydrate(fx.checkpoints[0].data);
          const ev = { seq: null, sim_s: s0.sim_s + 2, t: s0.t, type: 'rest.inventory', data: { items: [{ key: 'oat_milk', name: 'Oat milk', on_hand: 5000, lots: 2 }] } };
          const s1 = BrewStore.reduce(s0, ev);
          const s2 = BrewStore.reduce(s1, ev);        // again: applied again (no seq to dedupe on)
          const l = BrewStore.reduce(s2, { seq: null, sim_s: s0.sim_s, t: s0.t, type: 'rest.lots', data: { key: 'oat_milk', items: [{ lot_id: 'L1', qty: 3, expires_s: s0.sim_s + 3600, received_s: s0.sim_s - 3600, status: 'sealed' }] } });
          return { seq: s1.seq === s0.seq, inv: s1.inventory.oat_milk.on_hand, again: s2 !== s1, lots: l.lots.oat_milk.length, simMovedForward: s1.sim_s > s0.sim_s, simNotBack: l.sim_s === s1.sim_s };
        }"""
    )
    assert out == {"seq": True, "inv": 5000, "again": True, "lots": 1, "simMovedForward": True, "simNotBack": True}


# ------------------------------------------------------------------------------------------------------- pruning
@pytest.mark.parametrize("name", FIXTURE_NAMES)
def test_departed_things_are_pruned_90_sim_seconds_after_they_left(harness, name):
    out = harness.evaluate(
        """async (name) => {
          const fx = await T.load(name);
          let s = BrewStore.hydrate(fx.snapshot);
          let maxGone = 0, bad = [], seenGone = 0, ever = { orders: new Set(), customers: new Set() };
          for (const e of fx.events) {
            s = BrewStore.reduce(s, e);
            for (const o of Object.values(s.orders)) ever.orders.add(o.order_no);
            for (const c of Object.values(s.customers)) ever.customers.add(c.party_id);
            const maps = [s.orders, s.customers, s.replate.listings, s.shelf.bags, s.shelf.riders];
            for (const m of maps) for (const v of Object.values(m)) if (v.gone_s != null) {
              seenGone++;
              if (e.sim_s > v.gone_s + 90 + 1e-6 && s._next_prune_s != null && e.sim_s > s._next_prune_s) bad.push([e.seq, v.gone_s]);
            }
          }
          const lastSim = s.sim_s;
          const stale = [s.orders, s.customers, s.replate.listings, s.shelf.bags].flatMap((m) => Object.values(m)).filter((v) => v.gone_s != null && lastSim > v.gone_s + 90 + 1e-6 && lastSim > s._next_prune_s);
          return { bad: bad.length, stale: stale.length, seenGone, orders: Object.keys(s.orders).length, everOrders: ever.orders.size, customers: Object.keys(s.customers).length, everCustomers: ever.customers.size };
        }""",
        name,
    )
    assert out["bad"] == 0 and out["stale"] == 0
    assert out["seenGone"] > 0
    assert out["orders"] < out["everOrders"] and out["customers"] < out["everCustomers"], "something was pruned"


def test_pruning_keeps_departed_state_for_exit_animations(harness):
    out = harness.evaluate(
        """async () => {
          const fx = await T.load('morning_rush');
          const served = fx.events.find((e) => e.type === 'order.served');
          let s = BrewStore.reduceAll(BrewStore.hydrate(fx.snapshot), fx.events.filter((e) => e.seq <= served.seq));
          const o = s.orders[served.data.order_no];
          const keep = { status: o.status, gone: o.gone_s, onRail: s.rail.order_nos.includes(o.order_no) };
          const probe = (dt) => BrewStore.reduce(s, { seq: s.seq + 1, sim_s: served.sim_s + dt, t: s.t, type: 'clock.tick', data: { day: 0, hhmm: '09:00', weekday: 'tue', speed: 1 } });
          return { keep, at89: !!probe(89).orders[o.order_no], at91: !!probe(91).orders[o.order_no] };
        }"""
    )
    assert out["keep"]["status"] == "served" and out["keep"]["gone"] is not None and out["keep"]["onRail"] is False
    assert out["at89"] is True and out["at91"] is False


# ---------------------------------------------------------------------------------------- selectors on morning_rush
def meta() -> dict[str, Any]:
    return fx("morning_rush")[0]


def test_espresso_outage_shows_in_station_load_and_active_chaos(harness):
    m = meta()
    ch = m["chaos"][0]
    down = next(e for e in events("morning_rush", "equipment.down"))
    up = next(e for e in events("morning_rush", "equipment.up"))
    during = harness.evaluate(
        """async ([seq]) => {
          const s = await T.stateAt('morning_rush', seq);
          const esp = BrewStore.select.stationLoad(s).find((r) => r.station === 'espresso');
          return { esp, chaos: BrewStore.select.activeChaos(s), down: s.equipment.espresso_machine.status };
        }""",
        [ch["after_seq"]],
    )
    assert during["esp"]["status"] == "down" and during["esp"]["down_until_s"] == down["data"]["until_s"]
    assert during["esp"]["chaos"] == ch["disruption_id"]
    assert [c["id"] for c in during["chaos"]] == [ch["disruption_id"]]
    assert during["chaos"][0]["kind"] == "equipment_down" and during["chaos"][0]["target"] == "espresso_machine"
    assert during["down"] == "down"
    other = harness.evaluate(
        "async ([seq]) => { const s = await T.stateAt('morning_rush', seq); return BrewStore.select.stationLoad(s).filter((r) => r.status === 'down').map((r) => r.station); }",
        [ch["after_seq"]],
    )
    assert other == ["espresso"]
    after = harness.evaluate(
        """async ([seq]) => {
          const s = await T.stateAt('morning_rush', seq);
          const esp = BrewStore.select.stationLoad(s).find((r) => r.station === 'espresso');
          return { esp, chaos: BrewStore.select.activeChaos(s).length, resolved: Object.values(s.disruptions).map((d) => [d.id, d.active, d.resolved_s]) };
        }""",
        [up["seq"]],
    )
    # equipment.up lands first; the disruption itself stays active until chaos.resolved
    assert after["esp"]["status"] == "up" and after["chaos"] == 1
    chaos_resolved = next(e for e in events("morning_rush", "chaos.resolved"))
    assert chaos_resolved["seq"] >= up["seq"]
    done = harness.evaluate(
        "async ([seq]) => { const s = await T.stateAt('morning_rush', seq); return Object.values(s.disruptions).map((d) => [d.id, d.active, d.resolved_s]); }",
        [chaos_resolved["seq"]],
    )
    assert done == [[ch["disruption_id"], False, chaos_resolved["sim_s"]]]
    gone = harness.evaluate(
        "async ([seq]) => { const s = await T.stateAt('morning_rush', seq); return [BrewStore.select.activeChaos(s).length, BrewStore.select.stationLoad(s).every((r) => r.chaos === null)]; }",
        [chaos_resolved["seq"]],
    )
    assert gone == [0, True]


def test_owner_set_price_changes_the_menu(harness):
    act = meta()["actions"][0]
    assert act["kind"] == "set_price"
    sku, price = act["payload"]["sku"], act["payload"]["price"]
    out = harness.evaluate(
        """async ([sku, seq]) => {
          const fxm = await T.load('morning_rush');
          const before = (await T.stateAt('morning_rush', seq - 3)).menu[sku];
          const s = await T.stateAt('morning_rush', seq);
          return { before: before.price, after: s.menu[sku].price, dir: s.menu[sku].dir, note: s.menu[sku].note, base: s.menu[sku].base,
                   items: BrewStore.select.menuItems(s).find((m) => m.sku === sku).price };
        }""",
        [sku, act["after_seq"]],
    )
    assert out["after"] == price == out["items"] and out["before"] != price
    assert out["dir"] == ("down" if price < out["base"] else "up" if price > out["base"] else None)
    assert "owner override" in out["note"] or out["note"] == ""


def test_served_order_leaves_the_rail(harness):
    act = meta()["actions"][1]
    assert act["kind"] == "serve_order"
    no = act["payload"]["order_no"]
    out = harness.evaluate(
        """async ([no, seq]) => {
          const before = await T.stateAt('morning_rush', seq - 6);
          const s = await T.stateAt('morning_rush', seq);
          return { wasOpen: before.rail.order_nos.includes(no), wasReady: before.orders[no] && before.orders[no].status,
                   onRail: s.rail.order_nos.includes(no), status: s.orders[no].status, by: s.orders[no].served_by,
                   ticketsLeft: BrewStore.select.rail(s).some((t) => t.order_no === no) };
        }""",
        [no, act["after_seq"]],
    )
    assert out == {"wasOpen": True, "wasReady": "ready", "onRail": False, "status": "served", "by": "player", "ticketsLeft": False}


@pytest.mark.parametrize(("name", "min_groups"), [("morning_rush", 1), ("lunch_delivery", 5)])
def test_batch_groups_have_two_or_more_orders(harness, name, min_groups):
    out = harness.evaluate(
        """async (name) => {
          const fx = await T.load(name);
          let s = BrewStore.hydrate(fx.snapshot);
          let railGroups = 0, clipped = 0, formed = 0, bad = 0;
          for (const e of fx.events) {
            s = BrewStore.reduce(s, e);
            if (e.type === 'batch.formed' && e.data.order_nos.length >= 2) formed++;
            if (e.type === 'rail.reordered') {
              railGroups += s.rail.batches.length;
              const tickets = BrewStore.select.rail(s);
              for (const t of tickets) if (t.batch) {
                clipped++;
                const same = tickets.filter((x) => x.batch && x.batch.id === t.batch.id);
                if (t.batch.size < 2 || same.length !== t.batch.size || !t.batch.order_nos.includes(t.order_no)) bad++;
              }
              for (const b of s.rail.batches) if (b.order_nos.length < 2) bad++;
            }
          }
          return { railGroups, clipped, formed, bad };
        }""",
        name,
    )
    assert out["formed"] >= min_groups and out["railGroups"] >= min_groups and out["clipped"] >= 2 * min_groups
    assert out["bad"] == 0, "every paperclip joins 2+ tickets that are really on the rail"


def test_board_queue_crew_and_menu_selectors(harness):
    out = harness.evaluate(
        """async () => {
          const s = await T.stateAt('morning_rush', 1274);
          const board = BrewStore.select.board(s);
          const q = BrewStore.select.queue(s);
          const crew = BrewStore.select.crew(s);
          const rail = BrewStore.select.rail(s);
          return {
            boardTotal: board.brewing.length + board.almost.length + board.ready.length, open: s.rail.order_nos.length,
            railNos: rail.map((t) => t.order_no), orderNos: s.rail.order_nos,
            queue: q.map((c) => [c.state, c.queue_pos]), crew: crew.map((c) => [c.role, c.id]), menu: BrewStore.select.menuItems(s).length,
            seated: BrewStore.select.seated(s).map((c) => c.state), boardKeys: Object.keys(board),
          };
        }"""
    )
    assert out["boardTotal"] == out["open"] and out["railNos"] == out["orderNos"]
    assert out["boardKeys"] == ["brewing", "almost", "ready"]
    states = [x[0] for x in out["queue"]]
    assert states == sorted(states, key=lambda x: 0 if x == "ordering" else 1)
    positions = [x[1] for x in out["queue"] if x[0] == "queued"]
    assert positions == sorted(positions) and (not positions or positions[0] == 1)
    assert [c[0] for c in out["crew"]] == sorted((c[0] for c in out["crew"]), key=["barista", "cook", "cashier", "runner", "dishwasher"].index)
    assert out["menu"] >= 20 and set(out["seated"]) <= {"seated", "eating", "lingering", "paying"}


def test_freshness_classifies_lots(harness):
    out = harness.evaluate(
        """async () => {
          const s0 = await T.stateAt('morning_rush', 1274);
          const now = s0.sim_s;
          const lots = [
            { lot_id: 'A', qty: 3, received_s: now - 3600, expires_s: now + 10 * 86400, status: 'sealed' },
            { lot_id: 'B', qty: 3, received_s: now - 86400, expires_s: now + 5 * 3600, status: 'opened' },
            { lot_id: 'C', qty: 3, received_s: now - 86400, expires_s: now - 60, status: 'sealed' },
          ];
          const s = BrewStore.reduce(s0, { seq: null, sim_s: now, t: s0.t, type: 'rest.lots', data: { key: 'oat_milk', items: lots } });
          const f = BrewStore.select.freshness(s);
          return { by: Object.fromEntries(f.lots.map((l) => [l.lot_id, l.state])), counts: f.counts };
        }"""
    )
    assert out["by"] == {"A": "fresh", "B": "soon", "C": "bad"} and out["counts"] == {"fresh": 1, "soon": 1, "bad": 1}


def test_lunch_delivery_shelf_follows_the_rider(harness):
    out = harness.evaluate(
        """async () => {
          const fx = await T.load('lunch_delivery');
          let s = BrewStore.hydrate(fx.snapshot);
          const seen = { shelved: 0, pickedUp: 0, gap: 0, riderBefore: 0 };
          for (const e of fx.events) {
            const before = s;
            s = BrewStore.reduce(s, e);
            if (e.type === 'bag.shelved') { seen.shelved++; const b = s.shelf.bags[e.data.order_no]; if (!b || b.slot !== e.data.slot) seen.gap++; if (b.rider) seen.riderBefore++; }
            if (e.type === 'rider.picked_up') { seen.pickedUp++; const b = s.shelf.bags[e.data.order_no]; if (b && (b.rider !== 'picked_up' || b.gone_s == null)) seen.gap++; }
          }
          return { ...seen, left: Object.values(s.shelf.bags).filter((b) => b.gone_s == null).length };
        }"""
    )
    assert out["shelved"] > 10 and out["pickedUp"] > 10 and out["gap"] == 0 and out["riderBefore"] > 0


def test_closing_day_rollover(harness):
    out = harness.evaluate(
        """async () => {
          const fx = await T.load('closing');
          let s = BrewStore.hydrate(fx.snapshot);
          const snaps = {};
          for (const e of fx.events) {
            s = BrewStore.reduce(s, e);
            if (e.type === 'day.ended') snaps.ended = { open: s.clock.is_open, ended: s.day.ended && Object.keys(s.day.ended).length > 1 };
            if (e.type === 'day.started') snaps.started = { day: s.day.day, date: s.clock.date, weekday: s.clock.weekday, profit: s.kpis.profit_today, revenue: s.kpis.revenue_today, walk: s.kpis.walkouts_today, ended: s.day.ended };
          }
          return { ...snaps, last: { hhmm: s.clock.hhmm, is_open: s.clock.is_open } };
        }"""
    )
    assert out["ended"] == {"open": False, "ended": True}
    assert out["started"] == {"day": 1, "date": "2026-10-07", "weekday": "wed", "profit": 0, "revenue": 0, "walk": 0, "ended": None}
    assert out["last"] == {"hhmm": "07:10", "is_open": False}


# -------------------------------------------------------------------- event types the fixtures do not exercise
SYNTHETIC = """
(async () => {
  const fx = await T.load('morning_rush');
  const base = BrewStore.hydrate(fx.checkpoints[2].data);
  let n = base.seq;
  const ev = (type, data, dt = 1) => ({ seq: ++n, sim_s: base.sim_s + dt, t: base.t, type, data });
  const run = (...evs) => BrewStore.reduceAll(base, evs);
  const staffId = Object.keys(base.staff)[0];
  const out = {};

  let s = run(ev('investment.delivered', { catalog_key: 'table_2top', effect: { kind: 'add_table', seats: 2 } }));
  out.invest = s.investments;
  s = run(ev('policy.changed', { policy: 'B', previous: 'D' }), ev('strategy.changed', { strategy: 'rush_menu', previous: 'balanced' }), ev('throttle.changed', { channel: 'zomato', level: 'plus5' }));
  out.policy = { p: s.policy.policy, w: s.world.policy, st: s.policy.strategy, ws: s.world.strategy, th: s.policy.throttles };

  s = run(ev('staff.break_started', { staff_id: staffId, detail: '' }));
  out.breakStart = { on: s.staff[staffId].on_break, state: s.staff[staffId].state };
  s = run(ev('staff.break_started', { staff_id: staffId, detail: '' }), ev('staff.break_ended', { staff_id: staffId, detail: '' }, 2));
  out.breakEnd = { on: s.staff[staffId].on_break, state: s.staff[staffId].state, end: s.staff[staffId].break_end_s };
  s = run(ev('staff.absent', { staff_id: staffId, detail: 'absent' }), ev('staff.clocked_out', { staff_id: staffId, detail: 'absent' }));
  out.absent = { absent: s.staff[staffId].absent, present: s.staff[staffId].present, state: s.staff[staffId].state };
  s = run(ev('chaos.triggered', { disruption_id: 'dis-9', kind: 'staff_late', target: staffId, severity: 1, until_s: base.sim_s + 600, source: 'manual' }), ev('staff.late', { staff_id: staffId, detail: 'late' }), ev('staff.clocked_out', { staff_id: staffId, detail: 'absent' }));
  out.late = { late: s.staff[staffId].late, state: s.staff[staffId].state };
  s = BrewStore.reduce(s, ev('chaos.resolved', { disruption_id: 'dis-9', kind: 'staff_late', target: staffId }, 700));
  out.lateBack = { absent: s.staff[staffId].absent, late: s.staff[staffId].late, active: BrewStore.select.activeChaos(s).length };

  const lotKey = 'oat_milk';
  const lots = [{ lot_id: 'L1', qty: 3, received_s: base.sim_s - 100, expires_s: base.sim_s + 99999, status: 'sealed' }, { lot_id: 'L2', qty: 2, received_s: base.sim_s - 100, expires_s: base.sim_s + 99999, status: 'sealed' }];
  s = BrewStore.reduce(base, { seq: null, sim_s: base.sim_s, t: base.t, type: 'rest.lots', data: { key: lotKey, items: lots } });
  s = BrewStore.reduceAll(s, [ev('lot.donated', { key: lotKey, lot_id: 'L1', qty: 3 }), ev('lot.opened', { key: lotKey, lot_id: 'L2', expires_s: base.sim_s + 500 }, 2)]);
  out.lots = s.lots[lotKey].map((l) => [l.lot_id, l.status, l.expires_s - base.sim_s]);

  s = run(ev('po.created', { po_id: 'po-1', supplier: 'dairy', lines: [{ ingredient: 'oat_milk', qty: 10, packs: 2 }], eta_s: base.sim_s + 3600 }), ev('po.received', { po_id: 'po-1', supplier: 'dairy', lines: [{ ingredient: 'oat_milk', qty: 8 }], short: true }, 3));
  out.po = s.pos['po-1'];

  // station.load / staff.status / chaos.cost / saves_s
  s = run(ev('station.load', { stations: [{ station: 'espresso', util: 0.8, queue: 3, in_use: 2, slots: 2, status: 'up', down_until_s: null }, { station: 'oven', util: 0.1, queue: 0, in_use: 0, slots: 2, status: 'down', down_until_s: base.sim_s + 60 }] }));
  out.load = BrewStore.select.stationLoad(s).filter((r) => r.util != null).map((r) => [r.station, r.util, r.queue, r.in_use, r.status]);
  s = run(ev('staff.status', { staff: [{ staff_id: staffId, fatigue: 0.42, station: 'bar', task: 'pour', state: 'working', break_due_s: base.sim_s + 900, break_end_s: null }] }));
  out.fatigue = [s.staff[staffId].fatigue, s.staff[staffId].break_due_s, s.staff[staffId].state, s.staff[staffId].station];
  s = run(ev('chaos.triggered', { disruption_id: 'dis-7', kind: 'rider_shortage', target: null, severity: 1, until_s: base.sim_s + 99, source: 'manual' }), ev('chaos.cost', { disruption_id: 'dis-7', kind: 'rider_shortage', cost_inr: 1234.5, profit_actual: 100, profit_counterfactual: 1334.5 }, 5));
  out.cost = (({ id, cost_inr, profit_actual, profit_counterfactual, active }) => ({ id, cost_inr, profit_actual, profit_counterfactual, active }))(s.disruptions['dis-7']);
  s = run(ev('batch.formed', { batch_id: 'b99', station: 'espresso', step: 'steam', order_nos: [1, 2], size: 2, saves_s: 160 }), ev('batch.started', { batch_id: 'b99', station: 'espresso', step: 'steam', order_nos: [1, 2], size: 2, saves_s: 160 }));
  out.saves = [s.batches.b99.saves_s, s.batches.b99.started, s.batches.b99.size];
  s = run(ev('batch.formed', { batch_id: 'b98', station: 'espresso', step: 'steam', order_nos: [1, 2], size: 2 }));
  out.savesMissing = s.batches.b98.saves_s;

  // combos + replate sale accounting
  const combo = Object.values(base.combos)[0];
  s = run(ev('price.changed', { sku: 'combo:' + combo.id, old: combo.price, new: combo.price - 5, base: combo.base, dir: 'down', reason_text: 'x', by: 'policy D' }));
  out.combo = [s.combos[combo.id].price - combo.price, s.combos[combo.id].dir, s.menu[combo.skus[0]].price === base.menu[combo.skus[0]].price, s.combos[combo.id].saving - combo.saving];
  s = run(ev('replate.listed', { listing_id: 'L9', sku: 'croissant', lot_id: 'lot-9', units: 3, made_at_s: base.sim_s - 600, use_by_s: base.sim_s + 600, discount_pct: 30, price: 120 }),
          ev('replate.sold', { listing_id: 'L9', order_no: 1, units: 1, price: 120 }, 2), ev('replate.sold', { listing_id: 'L9', order_no: 2, units: 1, price: 120 }, 3));
  out.rescue = [s.replate.listings.L9.units, s.replate.units_sold_today - base.replate.units_sold_today, s.replate.sold_today - base.replate.sold_today, s.fridge.find((r) => r.sku === 'croissant').replate.units];
  s = BrewStore.reduce(s, ev('replate.retired', { listing_id: 'L9', units: 1, outcome: 'donated' }, 4));
  out.retired = [s.replate.listings.L9.outcome, s.replate.listings.L9.gone_s - base.sim_s, s.fridge.find((r) => r.sku === 'croissant').replate];
  s = BrewStore.reduce(s, ev('day.started', { day: 1, date: '2026-10-07', weekday: 'wed', weather: 'sunny', events: ['diwali'] }, 5));
  out.dayStart = [s.replate.units_sold_today, s.day.events, s.clock.date];

  s = run(ev('menu.hidden', { sku: combo.skus[0], reason: 'oat milk out' }));
  out.hidden = [s.menu[combo.skus[0]].hidden, s.combos[combo.id].available];
  s = BrewStore.reduce(s, ev('menu.restored', { sku: combo.skus[0], reason: 'restocked' }, 2));
  out.restored = [s.menu[combo.skus[0]].hidden, s.combos[combo.id].available];
  return out;
})()
"""


def test_event_types_missing_from_the_fixtures_reduce_sensibly(harness):
    o = harness.evaluate(SYNTHETIC)
    assert o["invest"][0]["catalog_key"] == "table_2top" and len(o["invest"]) == 1
    assert o["policy"] == {"p": "B", "w": "B", "st": "rush_menu", "ws": "rush_menu", "th": {"zomato": "plus5", "swiggy": "open"}}
    assert o["breakStart"] == {"on": True, "state": "break"}
    assert o["breakEnd"]["on"] is False and o["breakEnd"]["end"] is None and o["breakEnd"]["state"] in ("idle", "working")
    assert o["absent"] == {"absent": True, "present": False, "state": "absent"}
    assert o["late"] == {"late": True, "state": "absent"}
    assert o["lateBack"] == {"absent": False, "late": False, "active": 0}
    assert o["lots"] == [["L2", "opened", 500]]
    assert o["po"]["status"] == "received" and o["po"]["short"] is True and o["po"]["supplier"] == "dairy"
    assert o["load"] == [["espresso", 0.8, 3, 2, "up"], ["oven", 0.1, 0, 0, "down"]]
    assert o["fatigue"] == [0.42, o["fatigue"][1], "working", "bar"] and o["fatigue"][1] > 0
    assert o["cost"] == {"id": "dis-7", "cost_inr": 1234.5, "profit_actual": 100, "profit_counterfactual": 1334.5, "active": True}
    assert o["saves"] == [160, True, 2] and o["savesMissing"] is None
    assert o["combo"] == [-5, "down", True, 5]  # price -5, still derived from unchanged components, saving +5
    assert o["rescue"] == [1, 2, 240, 1]
    assert o["retired"] == ["donated", 4, None]
    assert o["dayStart"] == [0, ["diwali"], "2026-10-07"]
    assert o["hidden"] == [True, False] and o["restored"] == [False, True]


# ---------------------------------------------------------------------------------------- contract.json == the JS
def test_contract_json_matches_the_javascript(harness):
    d = harness.evaluate("() => BrewStore.describe()")
    c = json.loads((ROOT / "design" / "contract.json").read_text())
    handled = {t: r["handlers"] for t, r in c["events"].items() if "handlers" in r}
    ignored = {t: r["ignored"] for t, r in c["events"].items() if "ignored" in r}
    assert handled == d["events"], "design/contract.json is stale: uv run python scripts/build_contract.py"
    assert ignored == d["ignored"]
    assert {t: r["handlers"] for t, r in c["rest"].items()} == d["rest"]
    assert harness.evaluate("() => BrewStore.HANDLED") == sorted(handled)
    from brew.events.schema import EVENT_MODELS

    unaccounted = sorted(set(EVENT_MODELS) - set(handled) - set(ignored))
    assert not unaccounted, f"backend event types neither in BrewStore.HANDLED nor IGNORED: {unaccounted}"
    assert not set(d["ignored"]) & set(handled)


# ------------------------------------------------------------------ the backend now streams load / status / cost / saves, plus REST snapshots
def test_lunch_fixture_fills_load_fatigue_cost_saves_and_rest_models(harness):
    out = harness.evaluate(
        """async () => {
          const fx = await T.load('lunch_delivery');
          const s = BrewStore.reduceAll(BrewStore.hydrate(fx.snapshot), fx.all);
          const dis = Object.values(s.disruptions);
          return {
            kinds: dis.map((d) => d.kind), costs: dis.map((d) => typeof d.cost_inr), loads: Object.values(s.stations).filter((x) => x.util != null).length,
            fatigue: Object.values(s.staff).filter((x) => x.fatigue != null && x.present).length,
            saves: fx.events.filter((e) => e.type === 'batch.formed' && e.data.saves_s > 0).length,
            trig: s.decisions.filter((d) => d.trigger).map((d) => d.trigger.slice(0, 4)),
            rest: Object.fromEntries(['inventory', 'purchasing', 'impact', 'comparison', 'forecast', 'bottlenecks'].map((k) => [k, !!s.rest[k]])),
            lots: Object.keys(s.lots).length, usage: Object.keys(s.rest.usage || {}).length, inv: Object.keys(s.inventory).length, seq: s.seq, last: fx.events[fx.events.length - 1].seq,
          };
        }"""
    )
    assert out["kinds"] == ["rider_shortage", "rain_storm", "supplier_delay"] and out["costs"][:2] == ["number"] * 2  # (the 3rd is not tracked: MAX_SHADOWS = 2 are busy)
    assert out["loads"] >= 5 and out["fatigue"] >= 2 and out["saves"] >= 1
    assert out["rest"] == dict.fromkeys(out["rest"], True)
    assert out["lots"] >= 25 and out["usage"] >= 25 and out["inv"] > 20
    assert out["seq"] == out["last"], "rest.* pseudo-events never move state.seq"
