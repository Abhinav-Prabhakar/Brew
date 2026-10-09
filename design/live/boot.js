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
      return anchor.sim + Math.min(dt * anchor.rate, 5); // never run far ahead of the last event
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
    return state && state.clock && state.clock.speed ? state.clock.speed : 1; // live: 1 sim-s per second unless dev-accelerated
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
    state = Store.reduce(state, ev);
    if (state.sim_s !== before) setAnchor();
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
      const w = (list.items || []).find((x) => x.kind !== 'counterfactual' && x.clock_mode === p.clock && x.policy === p.policy && x.status !== 'deleted');
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
      onStatus: (s) => setStatus(s === 'live' ? 'live' : s === 'closed' ? 'closed' : 'reconnecting'),
      onLagging: (l) => setStatus(undefined, l),
    });
    live.source = src;
    src.start();
    setStatus('live', false);
    return src;
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
    }
    return live;
  }

  window.BrewLive = live;
  if (window.BREW_LIVE_AUTOBOOT !== false) boot(params(location.search)).catch((e) => console.error('[brew] boot failed', e));
})();
