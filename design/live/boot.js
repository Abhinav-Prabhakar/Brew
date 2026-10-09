/* brew live — boot flow and the one global the rooms talk to (window.BrewLive).

     BrewLive.state      current store state (a getter; replaced on every event, never mutated)
     BrewLive.now()      interpolated sim seconds (for countdowns / patience rings between frames)
     BrewLive.ingest(ev) feed one envelope: reduce, emit on the bus, schedule a frame
     BrewLive.ready      Promise, resolves once the first state is hydrated
     BrewLive.source     the active WsSource / ReplaySource      BrewLive.status  'booting' | 'live' | 'reconnecting'
                                                                                  | 'replay' | 'offline-demo' | 'closed'
     BrewLive.bus        window.BREW_LIVE                        BrewLive.refresh(name, arg) REST read model -> store

   Bus events (besides every backend event type): 'hydrate' (state), 'frame' (state; once per animation frame after
   a batch of events), 'status' ({status, lagging}). Query string: ?source=ws|replay &api=<origin> &world=<id>
   &clock=wall|open &policy=D &play=0 &fixture=<name> &replay=<url> &speed=<n> &loop=1. Set
   window.BREW_LIVE_AUTOBOOT = false before this script to boot by hand (BrewLive.boot(params)). */
(() => {
  const Store = window.BrewStore;
  const Api = window.BrewApi;
  const Sources = window.BrewSources;
  const bus = window.BREW_LIVE;
  const scriptUrl = document.currentScript && document.currentScript.src ? document.currentScript.src : location.href;
  const rel = (path) => new URL(path, scriptUrl).toString();
  const DEMO_URL = () => rel('../data/demo-stream.jsonl');

  let state = null;
  let anchor = { sim: 0, wall: 0, rate: 1 };
  let framePending = false;
  let resolveReady;

  const live = {
    bus,
    source: null,
    status: 'booting',
    lagging: false,
    mode: null,
    ready: new Promise((r) => { resolveReady = r; }),
    get state() { return state; },
    now() {
      if (!state) return 0;
      const dt = Math.max(0, (performance.now() - anchor.wall) / 1000);
      // interpolate at the world's current rate (fast-forward runs the HUD clock fast); never more than ~2 wall-seconds
      // (at least 5 sim-seconds) ahead of the last event
      return anchor.sim + Math.min(dt * anchor.rate, Math.max(5, anchor.rate * 2));
    },
    ingest, ingestMany, boot, refresh, hydrate: applySnapshot, api: Api,
  };

  /* ------------------------------------------------------------------ state plumbing */
  function setAnchor() {
    anchor = { sim: state.sim_s, wall: performance.now(), rate: rate() };
  }

  function rate() {
    const s = live.source;
    if (s && s.speed !== undefined) return Number.isFinite(s.speed) ? s.speed : 0; // replay
    if (state && state.world && state.world.rate) return state.world.rate; // live: the world's fast-forward rate (1, 5, 20, 60)
    return state && state.clock && state.clock.speed ? state.clock.speed : 1;
  }

  function scheduleFrame() {
    if (framePending) return;
    framePending = true;
    const fire = () => {
      if (!framePending) return;
      framePending = false;
      bus.emit('frame', state);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fire);
    setTimeout(fire, 100); // hidden tabs pause rAF: still deliver
  }

  function applySnapshot(snap) {
    state = Store.hydrate(snap);
    setAnchor();
    bus.emit('hydrate', state);
    scheduleFrame();
    if (resolveReady) { resolveReady(state); resolveReady = null; }
    return state;
  }

  function ingest(ev) {
    if (!state) return false;
    if (ev.seq != null && ev.seq <= state.seq) return false; // duplicate / replayed
    const before = state.sim_s;
    const rateBefore = anchor.rate;
    state = Store.reduce(state, ev);
    if (state.sim_s !== before || rate() !== rateBefore) setAnchor();
    bus.emit(ev.type, ev.data, ev);
    scheduleFrame();
    return true;
  }

  function ingestMany(events) {
    let n = 0;
    for (const ev of events) if (ingest(ev)) n += 1;
    return n;
  }

  function setStatus(status, lagging) {
    if (status !== undefined) live.status = status;
    if (lagging !== undefined) live.lagging = lagging;
    if (state) state = Store.reduce(state, { seq: null, sim_s: state.sim_s, t: state.t, type: 'client.status', data: { lagging: live.lagging } });
    bus.emit('status', { status: live.status, lagging: live.lagging });
    scheduleFrame();
  }

  /* ------------------------------------------------------------------ REST read models -> pseudo-events */
  const REST = {
    inventory: () => '/inventory',
    lots: (key) => '/inventory/' + encodeURIComponent(key) + '/lots',
    forecast: () => '/forecast',
    bottlenecks: () => '/bottlenecks',
    advisor: () => '/advisor',
    impact: () => '/impact',
    staff: () => '/staff',
    purchasing: () => '/purchasing/proposal',
    usage: (key) => '/inventory/' + encodeURIComponent(key) + '/forecast',
    comparison: () => '/api/v1/policies/comparison',
    decision_explain: (id) => '/api/v1/decisions/' + encodeURIComponent(id) + '/explain?world_id=' + encodeURIComponent(Api.config.worldId),
  };

  async function refresh(name, arg) {
    if (!REST[name]) throw new Error('unknown read model ' + name);
    if (live.mode !== 'ws') return null; // replays carry no REST
    let data = await Api.get(REST[name](arg));
    if (name === 'lots') data = { key: arg, items: data.items };
    if (name === 'usage') data = { ...data, key: arg };
    if (name === 'decision_explain' && data && !data.decision_id) data = { ...data, decision_id: arg };
    ingest({ seq: null, sim_s: state.sim_s, t: state.t, type: 'rest.' + name, data });
    return data;
  }

  /* ------------------------------------------------------------------ boot */
  function params(search) {
    const q = new URLSearchParams(search);
    const get = (k, d) => (q.has(k) ? q.get(k) : d);
    return {
      source: get('source', 'ws'), api: get('api', null), world: get('world', null), clock: get('clock', 'wall'), policy: get('policy', 'D'),
      play: get('play', '1') !== '0', fixture: get('fixture', null), replay: get('replay', null),
      speed: get('speed', null) != null ? Number(get('speed')) : null, loop: get('loop', '0') === '1',
    };
  }

  function defaultBase() {
    return /^https?:$/.test(location.protocol) ? location.origin : 'http://127.0.0.1:8000';
  }

  async function startReplay(url, speed, loop, status) {
    live.mode = 'replay';
    const src = new Sources.ReplaySource({
      url, speed, loop,
      onSnapshot: applySnapshot,
      onEvents: ingestMany,
      onStatus: (s) => { if (s === 'live') setStatus(status); },
    });
    live.source = src;
    await src.start();
    return src;
  }

  async function bootWs(p) {
    live.mode = 'ws';
    const base = p.api || defaultBase();
    Api.configure({ base });
    let id = p.world;
    if (!id) {
      const list = await Api.listWorlds();
      // a fast-forwarded wall-clock world has detached (clock_mode 'open', detached true): still our café, keep it
      const w = (list.items || []).find((x) => x.kind !== 'counterfactual' && x.status !== 'deleted' && x.policy === p.policy
        && (x.clock_mode === p.clock || (p.clock === 'wall' && x.detached)));
      id = w ? w.id : (await Api.createWorld({ policy: p.policy, clock: p.clock, kind: 'demo' })).id;
    }
    Api.configure({ worldId: id });
    if (p.play) await Api.control('play');
    const snap = await Api.state();
    applySnapshot(snap);
    const src = new Sources.WsSource({
      base, worldId: id, sinceSeq: snap.last_seq,
      onSnapshot: applySnapshot,
      onEvents: ingestMany,
      onStatus: (s) => { setStatus(s === 'live' ? 'live' : s === 'closed' ? 'closed' : 'reconnecting'); watch(s); },
      onLagging: (l) => setStatus(undefined, l),
      onGone: () => rejoin(p),
    });
    // While reconnecting, ask REST whether our world still exists: the server refuses an unknown world before the
    // WebSocket handshake (browsers only see 1006), so a 404 here is how we learn it restarted → rejoin.
    let wd = 0;
    function watch(s) {
      clearInterval(wd);
      if (s !== 'reconnecting') return;
      wd = setInterval(async () => {
        if (live.source !== src) return clearInterval(wd);
        try { await Api.state(); } catch (e) { if (e && e.status === 404) { clearInterval(wd); src.stop(); rejoin(p); } }
      }, 4000);
    }
    live.source = src;
    src.start();
    setStatus('live', false);
    return src;
  }

  /** the server lost our world (restart): find or create the live world again, re-hydrate, stream. Retries until the
      server answers. A fresh snapshot replaces the store, so nothing can be duplicated. */
  let rejoinT = 0;
  function rejoin(p) {
    clearTimeout(rejoinT);
    setStatus('reconnecting');
    bootWs({ ...p, world: null, play: true }).catch(() => { rejoinT = setTimeout(() => rejoin(p), 3000); });
  }

  /** offline demo: keep asking the backend whether it's up; switch to live the moment it is */
  function probeBackend(p) {
    const base = p.api || defaultBase();
    const t = setInterval(async () => {
      if (live.status !== 'offline-demo') return clearInterval(t);
      try { Api.configure({ base }); await Api.listWorlds(); } catch (e) { return; }
      clearInterval(t);
      if (live.source && live.source.stop) live.source.stop();
      try { await bootWs(p); } catch (e) { await startReplay(DEMO_URL(), p.speed != null ? p.speed : 1, true, 'offline-demo'); probeBackend(p); }
    }, 10000);
  }

  async function boot(p) {
    p = { ...params(''), ...p };
    live.status = 'booting';
    try {
      if (p.source === 'replay') {
        const url = p.replay || (p.fixture && p.fixture !== 'demo' ? '/tests/fixtures/streams/' + p.fixture + '.jsonl' : DEMO_URL());
        await startReplay(url, p.speed != null ? p.speed : 1, p.loop, 'replay');
      } else {
        await bootWs(p);
      }
    } catch (e) {
      if (p.source === 'replay') throw e;
      console.warn('[brew] backend unreachable, playing the offline demo', e);
      if (live.source && live.source.stop) live.source.stop();
      await startReplay(DEMO_URL(), p.speed != null ? p.speed : 1, true, 'offline-demo');
      probeBackend(p);
    }
    return live;
  }

  window.BrewLive = live;
  if (window.BREW_LIVE_AUTOBOOT !== false) boot(params(location.search)).catch((e) => console.error('[brew] boot failed', e));
})();
