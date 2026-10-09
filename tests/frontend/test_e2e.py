"""End to end: the real page (design/live harness) against a real `brew-api` subprocess.

The server runs dev-accelerated (BREW_LIVE_RATE=60: one sim-minute per wall-second, no database); design/ is served by a
static file server until the backend serves it itself. ~25 s.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Iterator
from typing import Any

import pytest

from .conftest import ROOT, serve

pytestmark = [pytest.mark.frontend, pytest.mark.integration]


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def call(base: str, method: str, path: str, body: dict[str, Any] | None = None) -> Any:
    req = urllib.request.Request(
        base + "/api/v1" + path, method=method, data=json.dumps(body).encode() if body is not None else None,
        headers={"content-type": "application/json"},
    )  # fmt: skip
    with urllib.request.urlopen(req, timeout=30) as r:
        text = r.read()
        return json.loads(text) if text else None


@pytest.fixture(scope="module")
def api() -> Iterator[str]:
    port = free_port()
    env = {**os.environ, "BREW_DB_ENABLED": "0", "BREW_LIVE_RATE": "60", "PYTHONUNBUFFERED": "1"}
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "brew.api.app:create_app", "--factory", "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )  # fmt: skip
    base = f"http://127.0.0.1:{port}"
    try:
        for _ in range(120):
            try:
                if call(base, "GET", "/health")["status"] == "ok":
                    break
            except (urllib.error.URLError, ConnectionError, OSError):
                time.sleep(0.25)
        else:
            raise RuntimeError("brew-api did not start")
        yield base
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


@pytest.fixture(scope="module")
def design_url() -> Iterator[str]:
    srv, url = serve(ROOT / "design")
    yield url
    srv.shutdown()


@pytest.fixture(scope="module")
def world(api: str) -> dict[str, Any]:
    """A paused 'open' world (policy A, so the test is quick) stepped to 08:15, where the morning rush starts."""
    w = call(api, "POST", "/worlds", {"policy": "A", "seed": 3, "clock": "open", "kind": "demo"})
    call(api, "POST", f"/worlds/{w['id']}/control", {"action": "step", "step_s": 4500})
    return w  # type: ignore[no-any-return]


@pytest.fixture(scope="module")
def page(browser, api: str, design_url: str, world: dict[str, Any]):  # type: ignore[no-untyped-def]
    ctx = browser.new_context()
    pg = ctx.new_page()
    errors: list[str] = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    # (the browser logs every 4xx response as a console error: the tests below provoke 409 / 422 on purpose)
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" and "Failed to load resource" not in m.text else None)
    pg.errors = errors  # type: ignore[attr-defined]
    pg.add_init_script("""window.__seen = []; window.__frames = 0;
      (function wait() { if (!window.BREW_LIVE) return setTimeout(wait, 0);
        BREW_LIVE.on('*', (type, data, ev) => { if (ev && ev.seq != null) window.__seen.push(ev.seq); });
        BREW_LIVE.on('frame', () => { window.__frames++; }); })();""")
    # no ?world=: boot reuses the live 'open'/A world that already exists (the discovery path of the boot flow)
    pg.goto(f"{design_url}/live/harness.html?source=ws&api={api}&clock=open&policy=A")
    yield pg
    ctx.close()


def wait(page, expr: str, timeout: int = 20000):  # type: ignore[no-untyped-def]
    page.wait_for_function(expr, timeout=timeout)


def test_ws_connects_hydrates_and_events_flow(page, world, api):
    wait(page, "window.BrewLive && BrewLive.state && BrewLive.status === 'live'")
    info = page.evaluate(
        "() => ({ id: BrewLive.state.world.id, policy: BrewLive.state.world.policy, seq0: BrewLive.state.seq, status: BrewLive.status, mode: BrewLive.mode, urls: BrewLive.source.urls, hhmm: BrewLive.state.clock.hhmm })"
    )
    assert info["id"] == world["id"], "boot reused the existing world instead of creating another"
    assert info["policy"] == "A" and info["mode"] == "ws" and info["urls"][0].startswith("ws://127.0.0.1:")
    assert "since_seq=" in info["urls"][0]
    assert len(call(api, "GET", "/worlds")["items"]) == 1
    wait(page, f"BrewLive.state.seq > {info['seq0']} + 150")  # the world runs at 60x: hundreds of events per second
    after = page.evaluate("() => ({ seq: BrewLive.state.seq, frames: window.__frames, orders: Object.keys(BrewLive.state.orders).length, customers: Object.keys(BrewLive.state.customers).length, hhmm: BrewLive.state.clock.hhmm })")
    assert after["frames"] > 5 and after["hhmm"] > info["hhmm"] and after["customers"] > 0
    assert not page.errors


def test_set_price_round_trips_into_the_menu(page):
    sku, price = page.evaluate(
        """() => { const m = Object.values(BrewLive.state.menu).find((x) => !x.staple && x.price - 5 >= x.min_price);
                   return [m.sku, m.price - 5]; }"""
    )
    page.evaluate("([sku, price]) => BrewApi.act('set_price', { sku, price })", [sku, price])
    wait(page, f"BrewLive.state.menu['{sku}'].price === {price}")
    assert page.evaluate("(s) => BrewLive.state.menu[s].dir", sku) in ("up", "down")
    # the charter says no: the backend envelope comes back as a BrewApiError
    err = page.evaluate(
        """async ([sku]) => { try { await BrewApi.act('set_price', { sku, price: 99999 }); return null; }
                              catch (e) { return { ok: e instanceof BrewApi.BrewApiError, status: e.status, code: e.code }; } }""",
        [sku],
    )
    assert err == {"ok": True, "status": 422, "code": "charter_violation"}


def test_serve_order_removes_the_ticket(page, world, api):
    wid = world["id"]
    served = None
    for _ in range(40):  # runners auto-serve a ready order after 20 sim-s (a third of a second here): pause to catch one
        wait(page, "Object.values(BrewLive.state.orders).some((o) => o.status === 'ready' && o.channel !== 'zomato' && o.channel !== 'swiggy')")
        call(api, "POST", f"/worlds/{wid}/control", {"action": "pause"})
        ready = [o for o in call(api, "GET", f"/worlds/{wid}/orders?status=ready")["items"] if o["channel"] in ("dine_in", "takeaway")]
        if ready:
            served = ready[0]["order_no"]
            break
        call(api, "POST", f"/worlds/{wid}/control", {"action": "play"})
    assert served is not None
    wait(page, f"BrewLive.state.orders[{served}] && BrewLive.state.orders[{served}].status === 'ready'")
    page.evaluate("(no) => BrewApi.act('serve_order', { order_no: no })", served)
    wait(page, f"BrewLive.state.orders[{served}].status === 'served' && !BrewLive.state.rail.order_nos.includes({served})")
    assert page.evaluate("(no) => BrewLive.state.orders[no].served_by", served) == "player"
    # a second serve of the same ticket is a 409 envelope
    err = page.evaluate("async (no) => { try { await BrewApi.act('serve_order', { order_no: no }); } catch (e) { return [e.status, e.code]; } }", served)
    assert err == [409, "invalid_action"]
    call(api, "POST", f"/worlds/{wid}/control", {"action": "play"})


def test_chaos_equipment_down_shows_in_the_stations(page):
    page.evaluate("() => BrewApi.chaos('equipment_down', { target: 'espresso_machine', duration_min: 30 })")
    wait(page, "BrewLive.state.stations.espresso.status === 'down'")
    res = page.evaluate(
        "() => ({ chaos: BrewStore.select.activeChaos(BrewLive.state).map((d) => [d.kind, d.target]), load: BrewStore.select.stationLoad(BrewLive.state).filter((r) => r.status === 'down').map((r) => r.station), eq: BrewLive.state.equipment.espresso_machine.status })"
    )
    assert res == {"chaos": [["equipment_down", "espresso_machine"]], "load": ["espresso"], "eq": "down"}


def test_forced_socket_close_reconnects_with_since_seq_and_the_stream_stays_gapless(page, world, api):
    wid = world["id"]
    wait(page, "BrewLive.status === 'live'")
    before = page.evaluate("() => { const s = BrewLive.source; return { last: s.lastSeq, n: s.urls.length }; }")
    page.evaluate("() => BrewLive.source.ws.close()")  # the connection dies mid-stream
    wait(page, f"BrewLive.source.urls.length === {before['n'] + 1} && BrewLive.status === 'live'", 15000)
    wait(page, "BrewLive.state.seq > BrewLive.source.lastSeq - 1 && window.__seen.length > 0")
    time.sleep(1.5)  # more events after the reconnect
    call(api, "POST", f"/worlds/{wid}/control", {"action": "pause"})
    time.sleep(1.0)  # let the last frames land
    server_last = call(api, "GET", f"/worlds/{wid}/state")["last_seq"]
    wait(page, f"BrewLive.state.seq === {server_last}")
    res = page.evaluate("() => ({ urls: BrewLive.source.urls, seen: window.__seen, seq: BrewLive.state.seq })")
    since = int(res["urls"][-1].split("since_seq=")[1])
    assert since >= before["last"], "resumed from the last applied seq, not from the start"
    seen = res["seen"]
    assert seen == sorted(set(seen)), "no duplicate and no out-of-order events reached the store"
    assert seen == list(range(seen[0], seen[-1] + 1)), "gap-free across the reconnect"
    assert seen[0] <= before["last"] + 1 and seen[-1] == server_last == res["seq"]
    assert since <= seen[-1]
    assert not page.errors


def test_boot_creates_a_world_when_none_matches(api, design_url, browser):
    ctx = browser.new_context()
    pg = ctx.new_page()
    try:
        pg.goto(f"{design_url}/live/harness.html?source=ws&api={api}&clock=open&policy=B&play=0")
        pg.wait_for_function("window.BrewLive && BrewLive.state && BrewLive.status === 'live'", timeout=20000)
        wid = pg.evaluate("() => BrewLive.state.world.id")
        worlds = {w["id"]: w for w in call(api, "GET", "/worlds")["items"]}
        assert worlds[wid]["policy"] == "B" and worlds[wid]["kind"] == "demo" and worlds[wid]["clock_mode"] == "open"
        assert len(worlds) == 2
        assert pg.evaluate("() => BrewLive.state.clock.hhmm") == "07:00"
    finally:
        ctx.close()


def test_store_matches_the_servers_snapshot_once_the_world_is_paused(page, world, api):
    wid = world["id"]
    call(api, "POST", f"/worlds/{wid}/control", {"action": "pause"})
    time.sleep(1.0)
    snap = call(api, "GET", f"/worlds/{wid}/state")
    wait(page, f"BrewLive.state.seq === {snap['last_seq']}")
    mine = page.evaluate(
        """() => { const s = BrewLive.state;
          return { rail: s.rail.order_nos, menu: Object.fromEntries(Object.values(s.menu).map((m) => [m.sku, m.price])),
                   combos: Object.fromEntries(Object.values(s.combos).map((c) => [c.id, c.price])),
                   venue: Object.fromEntries(Object.values(s.customers).filter((c) => !['left', 'balked', 'reneged'].includes(c.state)).map((c) => [c.party_id, c.state])),
                   equipment: Object.fromEntries(Object.values(s.equipment).map((e) => [e.key, e.status])), hhmm: s.clock.hhmm,
                   disruptions: Object.values(s.disruptions).filter((d) => d.active).map((d) => d.id).sort() }; }"""
    )
    assert mine["rail"] == snap["rail"]["order_nos"]
    assert mine["menu"] == {m["sku"]: m["price"] for m in snap["menu"]}
    assert mine["combos"] == {c["id"]: c["price"] for c in snap["combos"]}
    norm = {"queueing": "queued", "arriving": "arrived"}
    assert mine["venue"] == {c["party_id"]: norm.get(c["state"], c["state"]) for c in snap["customers"]}
    assert mine["equipment"] == {e["key"]: e["status"] for e in snap["equipment"]}
    assert mine["hhmm"] == snap["clock"]["hhmm"]
    assert mine["disruptions"] == sorted(d["id"] for d in snap["disruptions"])
