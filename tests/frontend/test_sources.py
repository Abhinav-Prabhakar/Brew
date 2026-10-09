"""Event sources, the REST client, the bus and the boot flow (design/live/{sources,api,boot,bus}.js) in headless Chromium.

WsSource is exercised against a fake in-page WebSocket (injected with add_init_script) and a mocked fetch; ReplaySource
plays the real golden streams.
"""

from __future__ import annotations

import json

import pytest

from .conftest import FIXTURES

pytestmark = pytest.mark.frontend

FAKE_WS = """
window.__ws = [];
window.WebSocket = class FakeWebSocket {
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; this.t = performance.now(); window.__ws.push(this);
    setTimeout(() => { if (this.readyState === 0) { this.readyState = 1; this.onopen && this.onopen({}); } }, 0); }
  send(d) { this.sent.push(JSON.parse(d)); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose && this.onclose({}); }
  _msg(o) { this.onmessage && this.onmessage({ data: JSON.stringify(o) }); }
};
window.__sleep = (ms) => new Promise((r) => setTimeout(r, ms));
window.__ev = (seq, type = 'clock.tick', sim_s = seq) => ({ seq, sim_s, t: 't', type, data: { day: 0, hhmm: '08:00', weekday: 'tue', speed: 1 } });
"""

# a WsSource wired to arrays, with short timers
MAKE_SOURCE = """() => {
window.__got = []; window.__snaps = []; window.__status = []; window.__lag = []; window.__hello = [];
window.__mk = (extra = {}) => new BrewSources.WsSource({
  base: 'http://127.0.0.1:8000', worldId: 'w1', sinceSeq: 100, backoffMin: 20, backoffMax: 80, pingMs: 60, laggingMs: 250, tickMs: 20,
  onEvents: (e) => window.__got.push(...e.map((x) => x.seq)), onSnapshot: (s) => window.__snaps.push(s.last_seq),
  onStatus: (s) => window.__status.push(s), onLagging: (l) => window.__lag.push(l), onHello: (h) => window.__hello.push(h), ...extra });
}
"""


@pytest.fixture
def ws_page(fresh_page):
    page = fresh_page.open(init_script=FAKE_WS)
    page.evaluate(MAKE_SOURCE)
    return page


def hello(last_seq=100):
    return {"hello": {"world": {"id": "w1"}, "last_seq": last_seq, "frame_interval_s": 0.075}}


# ------------------------------------------------------------------------------------------------------ WsSource
def test_ws_connects_with_since_seq_and_delivers_frames(ws_page):
    out = ws_page.evaluate(
        """async () => {
          const src = __mk(); src.start(); await __sleep(10);
          const ws = __ws[0];
          ws._msg(HELLO);
          ws._msg({ frame: 1, events: [__ev(101), __ev(102)] });
          ws._msg({ frame: 2, events: [__ev(103)] });
          await __sleep(10); src.stop();
          return { url: ws.url, got: __got, status: __status, hello: __hello.length };
        }""".replace("HELLO", json.dumps(hello()))
    )
    assert out["url"] == "ws://127.0.0.1:8000/api/v1/ws/worlds/w1?since_seq=100"
    assert out["got"] == [101, 102, 103]
    assert out["status"][:2] == ["connecting", "live"] and out["hello"] == 1


def test_ws_reconnect_resumes_after_the_last_applied_seq_without_gaps_or_duplicates(ws_page):
    out = ws_page.evaluate(
        """async () => {
          const src = __mk(); src.start(); await __sleep(10);
          __ws[0]._msg(HELLO1);
          __ws[0]._msg({ frame: 1, events: [__ev(101), __ev(102), __ev(103)] });
          __ws[0].close();                                   // the network drops
          await __sleep(120);                                // backoff (20 ms) then reconnect
          const second = __ws[1];
          second._msg(HELLO2);
          second._msg({ frame: 1, events: [__ev(103), __ev(104), __ev(105)] });   // the server replays from the ring: 103 overlaps
          await __sleep(10); src.stop();
          return { urls: __ws.map((w) => w.url), got: __got, status: __status };
        }""".replace("HELLO1", json.dumps(hello())).replace("HELLO2", json.dumps(hello(103)))
    )
    assert out["urls"][0].endswith("since_seq=100")
    assert out["urls"][1].endswith("since_seq=103"), "reconnect resumes with the last applied seq"
    assert out["got"] == [101, 102, 103, 104, 105], "gap-free and duplicate-free"
    assert out["status"] == ["connecting", "live", "reconnecting", "live", "closed"]


def test_ws_backoff_grows_then_resets_after_hello(ws_page):
    out = ws_page.evaluate(
        """async () => {
          const src = __mk(); src.start(); await __sleep(5);
          for (let i = 0; i < 4; i++) { __ws[i].close(); await __sleep(i === 0 ? 40 : 130); }      // never says hello
          const gaps = __ws.slice(1).map((w, i) => w.t - __ws[i].t);
          __ws[__ws.length - 1]._msg(HELLO);
          const n = __ws.length;
          const closedAt = performance.now();
          __ws[n - 1].close(); await __sleep(60);
          const afterHello = __ws[n].t - closedAt;
          src.stop();
          return { gaps, afterHello, n };
        }""".replace("HELLO", json.dumps(hello()))
    )
    g = out["gaps"]
    assert g[0] >= 18 and g[1] >= 35 and g[2] >= 70 and max(g) < 400, "20 -> 40 -> 80 ms (capped at 80)"
    assert out["afterHello"] < 40, "a successful hello resets the backoff to its minimum"


def test_ws_resync_refetches_state_and_resumes_after_it(ws_page):
    out = ws_page.evaluate(
        """async () => {
          const calls = [];
          window.fetch = async (url) => { calls.push(url); await __sleep(40); return { ok: true, json: async () => ({ last_seq: 500, clock: { sim_s: 1 } }) }; };
          const src = __mk(); src.start(); await __sleep(10);
          __ws[0]._msg(HELLO);
          __ws[0]._msg({ resync: true, last_seq: 500 });
          // frames arriving while the snapshot is in flight are buffered; those the snapshot already covers are dropped
          __ws[0]._msg({ frame: 1, events: [__ev(498), __ev(499), __ev(500), __ev(501)] });
          __ws[0]._msg({ frame: 2, events: [__ev(502)] });
          await __sleep(120);
          __ws[0]._msg({ frame: 3, events: [__ev(503)] });
          await __sleep(10);
          const out = { calls, snaps: __snaps, got: __got, lastSeq: src.lastSeq, sockets: __ws.length };
          src.stop(); return out;
        }""".replace("HELLO", json.dumps(hello()))
    )
    assert out["calls"] == ["http://127.0.0.1:8000/api/v1/worlds/w1/state"]
    assert out["snaps"] == [500]
    assert out["got"] == [501, 502, 503] and out["lastSeq"] == 503 and out["sockets"] == 1


def test_ws_resync_when_the_server_cannot_replay_on_connect(ws_page):
    out = ws_page.evaluate(
        """async () => {
          window.fetch = async () => ({ ok: true, json: async () => ({ last_seq: 9000, clock: { sim_s: 1 } }) });
          const src = __mk({ sinceSeq: 3 }); src.start(); await __sleep(10);
          __ws[0]._msg(HELLO);
          __ws[0]._msg({ resync: true, last_seq: 9000 });      // hello, then resync (since_seq fell out of the ring buffer)
          await __sleep(30);
          __ws[0]._msg({ frame: 1, events: [__ev(9001), __ev(9002)] });
          await __sleep(10); src.stop();
          return { snaps: __snaps, got: __got };
        }""".replace("HELLO", json.dumps(hello(9000)))
    )
    assert out == {"snaps": [9000], "got": [9001, 9002]}


def test_ws_failed_state_fetch_is_retried(ws_page):
    out = ws_page.evaluate(
        """async () => {
          let n = 0;
          window.fetch = async () => { n++; if (n < 3) return { ok: false, status: 500 }; return { ok: true, json: async () => ({ last_seq: 7, clock: { sim_s: 1 } }) }; };
          const src = __mk(); src.start(); await __sleep(10);
          __ws[0]._msg({ resync: true, last_seq: 7 });
          await __sleep(300); src.stop();
          return { n, snaps: __snaps };
        }"""
    )
    assert out["n"] == 3 and out["snaps"] == [7]


def test_ws_a_gap_in_the_sequence_triggers_a_resync(ws_page):
    out = ws_page.evaluate(
        """async () => {
          window.fetch = async () => ({ ok: true, json: async () => ({ last_seq: 120, clock: { sim_s: 1 } }) });
          const src = __mk(); src.start(); await __sleep(10);
          __ws[0]._msg(HELLO);
          __ws[0]._msg({ frame: 1, events: [__ev(101)] });
          __ws[0]._msg({ frame: 2, events: [__ev(110), __ev(111)] });     // 102..109 never arrived
          await __sleep(40);
          __ws[0]._msg({ frame: 3, events: [__ev(121)] });
          await __sleep(10); src.stop();
          return { snaps: __snaps, got: __got };
        }""".replace("HELLO", json.dumps(hello()))
    )
    assert out == {"snaps": [120], "got": [101, 121]}


def test_ws_duplicate_and_overlapping_frames_are_deduped(ws_page):
    out = ws_page.evaluate(
        """async () => {
          const src = __mk(); src.start(); await __sleep(10);
          __ws[0]._msg(HELLO);
          __ws[0]._msg({ frame: 1, events: [__ev(101), __ev(102), __ev(103)] });
          __ws[0]._msg({ frame: 1, events: [__ev(101), __ev(102), __ev(103)] });   // the very same frame again
          __ws[0]._msg({ frame: 2, events: [__ev(102), __ev(103), __ev(104)] });   // overlapping
          __ws[0]._msg({ frame: 3, events: [__ev(50), __ev(104)] });               // stale
          await __sleep(10); src.stop();
          return __got;
        }""".replace("HELLO", json.dumps(hello()))
    )
    assert out == [101, 102, 103, 104]


def test_ws_silence_marks_lagging_and_a_heartbeat_clears_it(ws_page):
    out = ws_page.evaluate(
        """async () => {
          const src = __mk(); src.start(); await __sleep(10);
          __ws[0]._msg(HELLO);
          await __sleep(400);                               // > laggingMs (250) without any frame or heartbeat
          const lagging = src.lagging;
          __ws[0]._msg({ hb: { sim_s: 1, last_seq: 100 } });
          const after = src.lagging;
          await __sleep(150);
          const stillOk = src.lagging;
          src.stop();
          return { lagging, after, stillOk, seq: __lag };
        }""".replace("HELLO", json.dumps(hello()))
    )
    assert out["lagging"] is True and out["after"] is False and out["stillOk"] is False
    assert out["seq"] == [True, False]


def test_ws_pings_while_connected(ws_page):
    out = ws_page.evaluate(
        """async () => {
          const src = __mk(); src.start(); await __sleep(10);
          __ws[0]._msg(HELLO);
          await __sleep(220);
          src.stop();
          return __ws[0].sent;
        }""".replace("HELLO", json.dumps(hello()))
    )
    assert len(out) >= 2 and all(m == {"op": "ping"} for m in out)


def test_ws_stop_closes_and_does_not_reconnect(ws_page):
    out = ws_page.evaluate(
        """async () => {
          const src = __mk(); src.start(); await __sleep(10);
          __ws[0]._msg(HELLO);
          src.stop(); await __sleep(150);
          return { sockets: __ws.length, state: __ws[0].readyState, status: src.status };
        }""".replace("HELLO", json.dumps(hello()))
    )
    assert out == {"sockets": 1, "state": 3, "status": "closed"}


# ------------------------------------------------------------------------------------------------------ ReplaySource
@pytest.mark.parametrize("name", ["morning_rush", "lunch_delivery", "closing"])
def test_replay_infinite_speed_is_deterministic_and_reaches_the_final_state(harness, name):
    out = harness.evaluate(
        """async (name) => {
          const run = async () => {
            let state = null, batches = 0, status = [];
            const src = new BrewSources.ReplaySource({ url: '/tests/fixtures/streams/' + name + '.jsonl', speed: Infinity, batch: 400,
              onSnapshot: (s) => { state = BrewStore.hydrate(s); }, onEvents: (evs) => { batches++; state = BrewStore.reduceAll(state, evs); }, onStatus: (s) => status.push(s) });
            await src.start(); await src.done;
            return { json: JSON.stringify(state), batches, status, lastSeq: src.lastSeq };
          };
          const a = await run(); const b = await run();
          const fx = await T.load(name);
          const direct = BrewStore.reduceAll(BrewStore.hydrate(fx.snapshot), fx.events);
          return { same: a.json === b.json, equalsDirect: a.json === JSON.stringify(direct), batches: a.batches, status: a.status, lastSeq: a.lastSeq, last: fx.events[fx.events.length - 1].seq };
        }""",
        name,
    )
    assert out["same"] and out["equalsDirect"]
    assert out["batches"] >= 2 and out["status"][-1] == "done" and out["lastSeq"] == out["last"]


def test_paced_replay_through_boot_emits_frames_and_hydrate(fresh_page, static_url):
    page = fresh_page.open()
    out = page.evaluate(
        """async () => {
          const bus = window.BREW_LIVE; const log = { hydrate: 0, frames: 0, types: {}, status: [] };
          bus.on('hydrate', () => log.hydrate++); bus.on('frame', () => log.frames++); bus.on('status', (s) => log.status.push(s.status));
          bus.on('*', (type) => { log.types[type] = (log.types[type] || 0) + 1; });
          await BrewLive.boot({ source: 'replay', fixture: 'morning_rush', speed: 9000 });
          await BrewLive.ready;
          await BrewLive.source.done;
          await new Promise((r) => setTimeout(r, 150));
          const fx = await T.load('morning_rush');
          const direct = BrewStore.reduceAll(BrewStore.hydrate(fx.snapshot), fx.events);
          return { ...log, final: JSON.stringify(BrewLive.state) === JSON.stringify(direct), status0: BrewLive.status, nTypes: Object.keys(log.types).length, seq: BrewLive.state.seq };
        }"""
    )
    assert out["hydrate"] == 1 and out["frames"] >= 3, "paced replay renders in several frames"
    assert out["final"] is True and out["status0"] == "replay"
    assert out["types"]["clock.tick"] > 100 and out["nTypes"] > 25, "every backend event type is re-emitted on the bus"
    assert not page.errors


def test_replay_loop_rehydrates_and_plays_again(fresh_page):
    page = fresh_page.open()
    out = page.evaluate(
        """async () => {
          let hydrates = 0, events = 0;
          const src = new BrewSources.ReplaySource({ url: '/tests/fixtures/streams/closing.jsonl', speed: 400000, loop: true, tickMs: 10,
            onSnapshot: () => { hydrates++; }, onEvents: (e) => { events += e.length; } });
          await src.start();
          await new Promise((r) => setTimeout(r, 2500));
          src.stop();
          return { hydrates, events };
        }"""
    )
    assert out["hydrates"] >= 2 and out["events"] >= 2 * 500


# ------------------------------------------------------------------------------------------------------ BrewApi
API_MOCK = """
window.__calls = [];
window.__reply = (status, body) => { window.fetch = async (url, init) => { __calls.push({ url, method: init && init.method, body: init && init.body ? JSON.parse(init.body) : null });
  return { ok: status < 400, status, statusText: 'x', text: async () => (body === undefined ? '' : JSON.stringify(body)) }; }; };
BrewApi.configure({ base: 'http://api.test', worldId: 'w9', fetch: (u, i) => window.fetch(u, i) });
"""


def test_api_actions_chaos_and_invest_shapes(fresh_page):
    out = fresh_page.open().evaluate(
        "async () => {" + API_MOCK
        + """
          __reply(200, { ok: true });
          await BrewApi.act('set_price', { sku: 'latte', price: 205 });
          await BrewApi.act('serve_order', { order_no: 12 });
          await BrewApi.chaos('equipment_down', { target: 'espresso_machine', severity: 2, duration_min: 30 });
          await BrewApi.chaos('rider_shortage');
          await BrewApi.invest('table_2top');
          await BrewApi.get('/menu');
          await BrewApi.get('/api/v1/policies/comparison');
          await BrewApi.control('play');
          return __calls;
        }"""
    )
    assert [(c["method"], c["url"].replace("http://api.test/api/v1", ""), c["body"]) for c in out] == [
        ("POST", "/worlds/w9/actions", {"kind": "set_price", "sku": "latte", "price": 205}),
        ("POST", "/worlds/w9/actions", {"kind": "serve_order", "order_no": 12}),
        ("POST", "/worlds/w9/chaos", {"kind": "equipment_down", "target": "espresso_machine", "severity": 2, "duration_min": 30}),
        ("POST", "/worlds/w9/chaos", {"kind": "rider_shortage"}),
        ("POST", "/worlds/w9/invest", {"catalog_key": "table_2top"}),
        ("GET", "/worlds/w9/menu", None),
        ("GET", "/policies/comparison", None),
        ("POST", "/worlds/w9/control", {"action": "play"}),
    ]


def test_api_errors_surface_the_backend_envelope(fresh_page):
    out = fresh_page.open().evaluate(
        "async () => {" + API_MOCK
        + """
          const res = [];
          const grab = async (p) => { try { await p; res.push(null); } catch (e) { res.push({ isErr: e instanceof BrewApi.BrewApiError, name: e.name, status: e.status, code: e.code, message: e.message, details: e.details }); } };
          __reply(422, { error: { code: 'charter_violation', message: 'latte: step exceeds 10% of base', details: { sku: 'latte' } } });
          await grab(BrewApi.act('set_price', { sku: 'latte', price: 999 }));
          __reply(409, { error: { code: 'invalid_action', message: 'order 5 is brewing, not ready', details: null } });
          await grab(BrewApi.act('serve_order', { order_no: 5 }));
          __reply(500, undefined);
          await grab(BrewApi.get('/menu'));
          window.fetch = async () => { throw new TypeError('Failed to fetch'); };
          await grab(BrewApi.get('/menu'));
          return res;
        }"""
    )
    assert out[0] == {"isErr": True, "name": "BrewApiError", "status": 422, "code": "charter_violation", "message": "latte: step exceeds 10% of base", "details": {"sku": "latte"}}
    assert out[1]["status"] == 409 and out[1]["code"] == "invalid_action" and out[1]["details"] is None
    assert out[2]["status"] == 500 and out[2]["code"] == "http_500"
    assert out[3]["status"] == 0 and out[3]["code"] == "network_error"


# ------------------------------------------------------------------------------------------------- boot + bus
def test_boot_falls_back_to_the_offline_demo_when_the_backend_is_down(fresh_page):
    page = fresh_page.open()
    out = page.evaluate(
        """async () => {
          const log = { hydrate: 0, status: [] };
          BREW_LIVE.on('hydrate', () => log.hydrate++); BREW_LIVE.on('status', (s) => log.status.push(s.status));
          await BrewLive.boot({ source: 'ws', api: 'http://127.0.0.1:1', speed: 5000 });
          const st = await BrewLive.ready;
          await new Promise((r) => setTimeout(r, 400));
          return { ...log, status: BrewLive.status, mode: BrewLive.mode, hhmm: BrewLive.state.clock.hhmm, seq: BrewLive.state.seq, first: st.seq, policy: BrewLive.state.world.policy };
        }"""
    )
    assert out["status"] == "offline-demo" and out["mode"] == "replay" and out["hydrate"] >= 1
    assert out["seq"] > out["first"] and out["policy"] == "D"


def test_demo_stream_served_next_to_the_page_is_the_fixture(static_url):
    import urllib.request

    body = urllib.request.urlopen(static_url + "/design/data/demo-stream.jsonl").read()
    assert body == (FIXTURES / "morning_rush.jsonl").read_bytes()


def test_boot_without_room_renderers_does_not_throw_and_coalesces_frames(fresh_page):
    page = fresh_page.open()
    out = page.evaluate(
        """async () => {
          const fx = await T.load('morning_rush');
          BrewLive.hydrate(fx.snapshot);
          await BrewLive.ready;
          let frames = 0, ticks = 0;
          BREW_LIVE.on('frame', () => frames++);
          BREW_LIVE.on('clock.tick', () => ticks++);
          BREW_LIVE.on('order.placed', () => { throw new Error('a renderer blew up'); });     // must not stop the stream
          const n = BrewLive.ingestMany(fx.events.slice(0, 1500));                           // one synchronous batch
          const framesInBatch = frames;
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          await new Promise((r) => setTimeout(r, 150));
          const dupes = BrewLive.ingestMany(fx.events.slice(0, 1500));
          return { n, framesInBatch, framesAfter: frames, ticks, dupes, seq: BrewLive.state.seq, expect: fx.events[1499].seq, now: BrewLive.now() - BrewLive.state.sim_s };
        }"""
    )
    assert out["n"] == 1500 and out["framesInBatch"] == 0, "no render inside the batch"
    assert out["framesAfter"] == 1, "one frame event per animation frame, however many events were ingested"
    assert out["ticks"] > 20 and out["dupes"] == 0 and out["seq"] == out["expect"]
    assert 0 <= out["now"] <= 5


def test_bus_keeps_the_menu_js_contract_and_a_prior_bus_alive(fresh_page):
    page = fresh_page.open(init_script="""
      (() => { const subs = {}; window.BREW_LIVE = window.__legacy = { on(t, f) { (subs[t] = subs[t] || []).push(f); }, emit(t, d) { (subs[t] || []).forEach((f) => f(d)); (subs['*'] || []).forEach((f) => f(t, d)); } };
               window.__early = []; window.BREW_LIVE.on('price.changed', (d) => window.__early.push(d.sku)); })();
    """)
    out = page.evaluate(
        """() => {
          const got = [], star = [];
          const un = BREW_LIVE.on('price.changed', (data, ev) => got.push([data.sku, ev && ev.seq]));
          BREW_LIVE.on('*', (type, data, ev) => star.push([type, ev && ev.seq]));
          BREW_LIVE.emit('price.changed', { sku: 'latte' }, { seq: 3 });       // menu.js style: emit(type, data)
          BREW_LIVE.emit('price.changed', { sku: 'mocha' });
          un(); BREW_LIVE.emit('price.changed', { sku: 'x' });
          BREW_LIVE.off('nothing', () => {});
          return { got, star, early: window.__early, same: BREW_LIVE === window.__legacy };
        }"""
    )
    assert out["got"] == [["latte", 3], ["mocha", None]]
    assert out["star"] == [["price.changed", 3], ["price.changed", None], ["price.changed", None]]
    assert out["early"] == ["latte", "mocha", "x"], "subscribers of the bus that existed before bus.js loaded keep working"
    assert out["same"] is True
