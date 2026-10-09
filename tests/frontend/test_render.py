"""Rendering tests: the real ``design/brew.html`` replays a fixture (paused ReplaySource, ``?still``) and the DOM is
asserted against the store state at fixed fixture moments (see ``appkit.py``). Page errors, console errors and NaN /
undefined in any attribute fail the test (``App.check`` in the fixture teardown).

Moments (morning_rush: espresso machine down 08:30-09:00, set_price 09:00, serve_order 09:15; lunch_delivery: rider
shortage 12:30, rain storm 12:50, supplier delay 13:00; closing: shop closed at night).
"""

from __future__ import annotations

import json
import re
from typing import Any

import pytest

from .conftest import FIXTURES

pytestmark = pytest.mark.frontend

RAIL_MAX = 9  # lobby.js shows at most 9 tickets on the rail
OVERNIGHT = "+1 02:00"
INDIA = re.compile(r"[^\d−-]")


def meta(name: str) -> dict[str, Any]:
    return json.loads((FIXTURES / f"{name}.jsonl").open().readline())  # type: ignore[no-any-return]


def rupees(n: float) -> str:
    return f"₹{round(n):,}"


def amount(text: str) -> int:
    """'−₹1,234' / '₹369' -> int."""
    neg = text.strip().startswith(("−", "-"))
    v = int(INDIA.sub("", text.replace("−", "").replace("-", "")) or 0)
    return -v if neg else v


# ------------------------------------------------------------------------------------------------ lobby
@pytest.mark.parametrize(("fixture", "when"), [("morning_rush", "08:20"), ("morning_rush", "08:45"), ("lunch_delivery", "12:40"), ("lunch_delivery", "13:30")])
def test_rail_tickets_are_the_stores_rail(open_app, fixture, when):
    app = open_app(fixture)
    app.step_to(when)
    want = app.state("BrewStore.select.rail(s).map((o) => o.order_no)")
    assert len(want) >= 3, "a busy moment"
    # DOM tickets, left to right (each ticket is placed with translate(x, y))
    got = app.ev(
        """() => [...document.querySelectorAll('#lobby [data-ticket]')]
            .map((el) => ({ no: +el.dataset.ticket, x: parseFloat((/translate\\(([-\\d.]+)px/.exec(el.style.transform) || [0, 0])[1]),
                            text: el.textContent }))
            .sort((a, b) => a.x - b.x)"""
    )
    shown = want[:RAIL_MAX]
    assert [g["no"] for g in got] == shown
    for g in got:
        assert f"#{g['no']}" in g["text"], "the order number is printed on the ticket"
    # the first ticket's lines are the order's items
    first = app.state(f"s.orders[{shown[0]}].items.map((i) => i.sku)")
    assert first and all(app.ev("(n) => document.querySelector(`[data-ticket='${n}']`).textContent.length > 20", shown[0]) for _ in first)


def test_serving_an_order_removes_its_ticket(open_app):
    app = open_app("morning_rush")
    serve = next(a for a in meta("morning_rush")["actions"] if a["kind"] == "serve_order")
    no = serve["payload"]["order_no"]
    app.step_to(serve["served_at_s"] - 5)
    assert app.ev("(n) => !!document.querySelector(`[data-ticket='${n}']`)", no), "the ready order is on the rail before the serve"
    app.step_to(serve["served_at_s"] + 30)
    assert app.state(f"s.orders[{no}].status") == "served"
    assert not app.ev("(n) => !!document.querySelector(`[data-ticket='${n}']`)", no), "its ticket was torn off"


@pytest.mark.parametrize(("fixture", "when"), [("morning_rush", "08:20"), ("morning_rush", "09:30"), ("lunch_delivery", "12:40"), ("closing", "21:00"), ("closing", OVERNIGHT)])
def test_customers_in_the_venue_are_drawn_with_their_state(open_app, fixture, when):
    app = open_app(fixture)
    app.step_to(when)
    drawn = app.ev("() => Object.fromEntries([...document.querySelectorAll('#lobby [data-party]')].map((e) => [e.dataset.party, e.dataset.state]))")
    state = app.state("Object.fromEntries(Object.values(s.customers).map((c) => [c.party_id, c.state]))")
    inside = {k for k, v in state.items() if v in ("queued", "ordering", "waiting", "seated", "eating", "lingering", "paying", "seat_wait")}
    assert inside <= set(drawn), f"in-venue parties missing from the lobby: {sorted(inside - set(drawn))[:3]}"
    assert set(drawn) <= set(state), "no party is drawn that the store does not know"
    for pid, st in drawn.items():
        assert st == state[pid], f"{pid[-6:]}: drawn as {st}, store says {state[pid]}"
    if fixture == "closing" and when == OVERNIGHT:
        assert not inside, "nobody is in the café at 02:00"
        assert app.state("s.clock.is_open") is False
    else:
        assert inside, "somebody is in the café"


def test_menu_book_prices_are_the_stores_menu(open_app):
    app = open_app("morning_rush")
    app.step_to("09:30")  # after the owner's set_price at 09:00
    changed = next(a for a in meta("morning_rush")["actions"] if a["kind"] == "set_price")["payload"]
    app.ev("() => BREW_MENUBOOK.open()")
    app.page.wait_for_timeout(300)
    seen: dict[str, str] = {}
    for _ in range(3):  # spreads: coffee + not coffee | bakes + plates | combos + rescue
        seen.update(app.ev("() => Object.fromEntries([...document.querySelectorAll('#mb .row[data-sku]')].map((e) => [e.dataset.sku, e.querySelector('.now').textContent]))"))
        combos = app.ev("() => Object.fromEntries([...document.querySelectorAll('#mb [data-combo]')].map((e) => [e.dataset.combo, e.querySelector('.now').textContent]))")
        for cid, txt in combos.items():
            assert amount(txt) == round(app.state(f"s.combos['{cid}'].price")), cid
        app.ev("() => BREW_MENUBOOK.turn(1)")
        app.page.wait_for_timeout(200)
    menu = app.state("Object.fromEntries(Object.values(s.menu).map((m) => [m.sku, m.price]))")
    assert set(seen) == set(menu), "every dish of the book was read"
    for sku, txt in seen.items():
        assert txt == rupees(menu[sku]), f"{sku}: book says {txt}, store says {menu[sku]}"
    assert seen[changed["sku"]] == rupees(changed["price"]), "the owner's set_price shows in the book"
    lectern = app.ev("() => Object.fromEntries([...document.querySelectorAll('#lobby-scene [data-lsku]')].map((e) => [e.dataset.lsku, e.textContent]))")
    assert lectern and all(amount(v) == round(menu[k]) for k, v in lectern.items() if k in menu), "the lectern prices follow the same store"


# ------------------------------------------------------------------------------------------------ HUD
@pytest.mark.parametrize(("fixture", "when"), [("morning_rush", "08:20"), ("morning_rush", "10:15"), ("lunch_delivery", "13:30"), ("closing", OVERNIGHT)])
def test_hud_profit_clock_and_rating(open_app, fixture, when):
    app = open_app(fixture)
    app.step_to(when)
    s = app.state("({ profit: s.kpis.profit_today, rating: s.kpis.rating, n: s.kpis.rating_n, hhmm: s.clock.hhmm, weekday: s.clock.weekday, sim: s.sim_s })")
    hud = app.ev("""() => ({ amt: document.querySelector('#hud .money .amt').textContent, v: document.querySelector('#hud .money .amt')._v,
                             time: document.querySelector('#hud .clock .time').textContent, stars: document.querySelector('#hud .money .stars').textContent,
                             live: document.querySelector('#hud [data-live]').dataset.status })""")
    assert hud["v"] == s["profit"] and amount(hud["amt"]) == round(s["profit"])
    h, m = (int(x) for x in s["hhmm"].split(":"))
    assert hud["time"] == f"{s['weekday']} · {h % 12 or 12:02d}:{m:02d} {'am' if h < 12 else 'pm'}", "the HUD clock follows the sim clock"
    if s["rating"] is not None:
        assert f"{s['rating']:.1f}" in hud["stars"] and f"{s['n']} reviews" in hud["stars"]
    assert hud["live"] == "replay"
    assert hud["time"] != "tue · 08:42 am" or s["hhmm"] == "08:42"


def test_profit_card_opens_the_policy_comparison(open_app):
    app = open_app("morning_rush")
    app.step_to("09:30")
    assert app.ev("() => document.querySelector('#cmp').hidden") is True
    app.ev("() => document.querySelector('#hud .money').click()")
    app.page.wait_for_timeout(250)
    assert app.ev("() => document.querySelector('#cmp').hidden") is False
    rows = app.ev("() => [...document.querySelectorAll('#cmp svg text')].map((t) => t.textContent).filter((t) => /^[ABCD] ·/.test(t))")
    assert [r[0] for r in rows] == ["A", "B", "C", "D"]
    vs = app.ev("() => document.querySelector('#hud .money [data-vs]').textContent")
    assert re.fullmatch(r"[▲▼] \d+% vs naive", vs), vs
    app.ev("() => document.querySelector('#hud .money').click()")  # closes again
    app.page.wait_for_timeout(150)
    assert app.ev("() => document.querySelector('#cmp').hidden") is True


# ------------------------------------------------------------------------------------------------ kitchen
def led_class(row: dict) -> str:
    """kitchen.js: down -> r; otherwise util >= 0.7 -> a, else g."""
    if row["status"] == "down":
        return "r"
    return "a" if (row["util"] or 0) >= 0.7 else "g"


@pytest.mark.parametrize(("when", "down"), [("08:20", False), ("08:45", True), ("09:20", False)])
def test_station_leds_follow_the_espresso_outage(open_app, when, down):
    app = open_app("morning_rush")
    app.step_to(when)
    app.room("kitchen")
    leds = app.ev("""() => Object.fromEntries([...document.querySelectorAll('#kitchen .board .cell[data-station]')]
        .map((c) => [c.dataset.station, [...c.querySelector('.led').classList].filter((x) => x !== 'led')[0]]))""")
    assert set(leds) == {"prep", "oven", "fryer", "press", "espresso", "grinder", "blender", "cold", "dishpit"}
    assert (leds["espresso"] == "r") is down, f"espresso LED {leds['espresso']} at {when}"
    st = app.state("Object.fromEntries(Object.values(s.stations).map((x) => [x.station, { status: x.status, util: x.util }]))")
    for k, led in leds.items():
        row = st.get(k)
        if row and row["util"] is not None:
            assert led == led_class(row), f"{k}: {led} vs {row}"
    assert sum(1 for v in leds.values() if v == "r") == (1 if down else 0)
    if down:  # the chaos card lists it
        card = app.ev("() => document.querySelector('#kitchen .chaos').textContent")
        assert "espresso" in card and "down" in card


def test_crew_rows_and_fatigue(open_app):
    app = open_app("morning_rush")
    app.step_to("09:30")
    app.room("kitchen")
    staff = app.state("Object.values(s.staff).map((x) => ({ id: x.id, name: x.name, present: x.present, fatigue: x.fatigue, state: x.state }))")
    rows = app.ev("""() => [...document.querySelectorAll('#kitchen .crew [data-staff]')].map((e) => ({ id: e.dataset.staff, text: e.textContent,
        bar: e.querySelector('.bar2 i').style.width }))""")
    assert 1 <= len(rows) <= 5
    by_id = {x["id"]: x for x in staff}
    for r in rows:
        x = by_id[r["id"]]
        assert x["name"].lower() in r["text"]
        assert x["fatigue"] is not None, "staff.status streams fatigue"
        assert r["bar"] == f"{round(x['fatigue'] * 100)}%"
    assert {r["id"] for r in rows} >= {x["id"] for x in staff if x["present"]} - {x["id"] for x in staff[5:]}


def test_chaos_buttons_exist_for_the_six_kinds(open_app):
    app = open_app("morning_rush")
    app.step_to("08:20")
    app.room("kitchen")
    kinds = app.ev("() => [...document.querySelectorAll('#kitchen .chaos [data-chaos]')].map((b) => [b.dataset.chaos, b.dataset.target])")
    assert sorted(kinds) == sorted([["staff_absent", ""], ["equipment_down", "oven"], ["supplier_delay", "dairy"], ["rain_storm", ""], ["rider_shortage", ""], ["power_cut", ""]])
    assert not app.ev("() => document.querySelector('#kitchen .chaos [data-chaos=rain_storm]').disabled")


def test_chaos_card_shows_the_replan_and_the_cost(open_app):
    app = open_app("lunch_delivery")
    app.step_to("12:55")  # rain_storm 12:50 (+ rider shortage still on)
    app.room("kitchen")
    card = app.ev("() => document.querySelector('#kitchen .chaos').textContent")
    assert "rain storm" in card and "RL:" in card, "the immediate re-plan decision is shown as the RL reaction"
    trig = app.state("s.decisions.filter((d) => d.trigger).map((d) => d.headline)")
    assert trig and any(t[:20] in card for t in trig)
    app.step_to("13:20")
    cost = app.state("Object.values(s.disruptions).reduce((a, d) => a + (d.cost_inr || 0), 0)")
    card = app.ev("() => document.querySelector('#kitchen .chaos').textContent")
    if cost > 0:
        assert "chaos has cost" in card and rupees(cost) in card
    else:
        assert "chaos has cost" not in card


# ------------------------------------------------------------------------------------------------ pantry
def backend_freshness(lot: dict, now: float) -> str:
    """readmodels.freshness_of: expiring (<= 24 h, or <= 10 % of life and <= 7 d) | soon (<= 72 h, or <= 30 % and <= 14 d)."""
    left_h = (lot["expires_s"] - now) / 3600.0
    frac = (lot["expires_s"] - now) / max(1.0, lot["expires_s"] - lot["received_s"])
    if left_h <= 24 or (frac <= 0.10 and left_h <= 7 * 24):
        return "expiring"
    if left_h <= 72 or (frac <= 0.30 and left_h <= 14 * 24):
        return "soon"
    return "fresh"


@pytest.mark.parametrize(("fixture", "when"), [("morning_rush", "09:30"), ("lunch_delivery", "13:30")])
def test_pantry_lot_tags_agree_with_the_backend_freshness_rule(open_app, fixture, when):
    app = open_app(fixture)
    app.step_to(when)
    app.room("pantry")
    sim = app.state("s.sim_s")
    lots = app.state("Object.fromEntries(Object.values(s.lots).flat().map((l) => [l.lot_id, l]))")
    tags = app.ev("() => [...document.querySelectorAll('#pantry [data-lot]')].map((e) => [e.dataset.lot, [...e.classList]])")
    assert len(tags) >= 20, "lots are drawn on the shelves"
    classes = {"fresh": "fresh", "soon": "soon", "expiring": "bad"}
    n = {"fresh": 0, "soon": 0, "bad": 0}
    for lot_id, cls in tags:
        want = classes[backend_freshness(lots[lot_id], sim)]
        assert want in cls, f"{lot_id}: classes {cls}, backend rule says {want}"
        n[want] += 1
    assert n["fresh"] > 0
    items = app.ev("() => [...document.querySelectorAll('#pantry [data-item]')].map((e) => e.dataset.item)")
    assert len(items) >= 25


def test_pantry_shows_the_purchasing_proposal(open_app):
    app = open_app("lunch_delivery")
    app.step_to("13:30")
    app.room("pantry")
    lines = app.state("(s.rest.purchasing ? (s.rest.purchasing.orders || (s.rest.purchasing.lines ? [s.rest.purchasing] : [])) : []).reduce((a, o) => a + (o.lines || []).length, 0)")
    btn = app.ev("() => { const b = document.querySelector('#pantry [data-action=place_po]'); return b ? { disabled: b.disabled, text: b.textContent } : null; }")
    assert btn is not None, "the approve-order button is drawn"
    if lines:
        assert btn["disabled"] is False and "approve" in btn["text"]
    else:
        assert btn["disabled"] is True


# ------------------------------------------------------------------------------------------------ whole-page sanity
@pytest.mark.parametrize("fixture", ["morning_rush", "lunch_delivery", "closing"])
def test_every_room_renders_through_the_whole_fixture_without_errors(open_app, fixture):
    app = open_app(fixture)
    t0 = app.state("s.sim_s")
    t1 = app.ev("() => BrewLive.source.stream.events[BrewLive.source.stream.events.length - 1].sim_s")
    rooms = ["lobby", "kitchen", "pantry"]
    for i in range(1, 13):  # a dozen slices of the whole stream, the camera moving between the rooms
        app.room(rooms[i % 3], 80)
        app.step_to(t0 + (t1 - t0) * i / 12, 200)
    assert app.state("s.seq") == app.ev("() => BrewLive.source.lastSeq")
