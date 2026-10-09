/* brew live — the pure state store (window.BrewStore).
   hydrate(snapshot) -> state        reduce(state, envelope) -> state        reduceAll(state, envelopes) -> state
   Load order: store.js first, then reduce/{hud,lobby,kitchen,pantry}.js, each of which calls BrewStore.register().

   Rules (tests deep-freeze the inputs):
   - reduce NEVER mutates its arguments: handlers return a patch of top-level keys and copy every slice they touch
     (copy-on-write), so untouched slices keep their identity and renderers can diff by reference.
   - no Date.now(), no randomness, no DOM. Time is always the envelope's sim_s.
   - events with seq <= state.seq are ignored (replay / reconnect dedupe). REST pseudo-events ('rest.<name>',
     seq: null) are always applied and never move state.seq.
   - event types without a handler only advance seq / sim_s / t (they are listed in IGNORED or are "pending backend").
   - handlers are registered per type as [slice, fn]; one type may have several handlers (e.g. order.served touches
     both the order and the waiting customer). BrewStore.describe() exports type -> ["reduce/lobby.js:orders", ...]
     which design/contract.json must match. */
(() => {
  const DAY_S = 86400;
  const PRUNE_AFTER_S = 90; // departed customers / orders / listings / bags stay this long for exit animations

  /* ------------------------------------------------------------------ helpers shared by the reducers */
  const U = {
    DAY_S,
    PRUNE_AFTER_S,
    /** {...o, [k]: v} */
    set(o, k, v) { return { ...o, [k]: v }; },
    /** merge `patch` (object or fn(old) -> patch) into o[k]; no-op when o[k] does not exist and !create */
    upd(o, k, patch, create = false) {
      const old = o[k];
      if (old === undefined && !create) return o;
      const p = typeof patch === 'function' ? patch(old) : patch;
      return { ...o, [k]: { ...(old || {}), ...p } };
    },
    del(o, k) {
      if (!(k in o)) return o;
      const { [k]: _gone, ...rest } = o;
      return rest;
    },
    /** append item and keep the last n */
    tail(arr, item, n) {
      const a = arr.concat([item]);
      return a.length > n ? a.slice(a.length - n) : a;
    },
    /** python's format(x, 'g') for the chip text ("₹5 · reason") */
    fmtG(x) { return String(parseFloat(Number(x).toPrecision(6))); },
    round(x, n = 1) { const f = 10 ** n; return Math.round(x * f) / f; },
    todS(sim_s) { return sim_s - Math.floor(sim_s / DAY_S) * DAY_S; },
    addDays(dateStr, n) {
      const [y, m, d] = dateStr.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
    },
    /** schedule the next prune pass for something that went away at ev.sim_s */
    gone(state, ev) {
      const at = ev.sim_s + PRUNE_AFTER_S;
      return state._next_prune_s == null ? at : Math.min(state._next_prune_s, at);
    },
    byOrderNo(a, b) { return a.order_no - b.order_no; },
  };

  /* ------------------------------------------------------------------ registry */
  const handlers = Object.create(null); // type -> [{file, slice, fn}]
  const hydraters = []; // {file, fn(snapshot, state) -> patch}
  const IGNORED = {
    'action.applied': 'acknowledgement only: the resulting state arrives as its own events (price.changed, order.served, ...) and the REST call already resolved with ok/error',
  };
  const PENDING_BACKEND = ['station.load', 'staff.status', 'chaos.cost']; // reducers exist; the backend emits them from the next fixture regeneration on

  function register(file, spec) {
    const path = 'reduce/' + file + '.js';
    if (spec.hydrate) hydraters.push({ file: path, fn: spec.hydrate });
    for (const [type, v] of Object.entries(spec.on || {})) {
      const list = typeof v[0] === 'string' ? [v] : v; // [slice, fn] or [[slice, fn], ...]
      for (const [slice, fn] of list) (handlers[type] = handlers[type] || []).push({ file: path, slice, fn });
    }
  }

  /* ------------------------------------------------------------------ hydrate */
  function hydrate(snap) {
    let s = {
      seq: snap.last_seq,
      sim_s: snap.clock.sim_s,
      t: snap.clock.t,
      _next_prune_s: null,
    };
    for (const h of hydraters) s = { ...s, ...h.fn(snap, s) };
    return s;
  }

  /* ------------------------------------------------------------------ prune */
  function pruneMap(map, now) {
    let out = map;
    let next = Infinity;
    for (const [k, v] of Object.entries(map)) {
      if (v.gone_s == null) continue;
      if (now > v.gone_s + PRUNE_AFTER_S) { if (out === map) out = { ...map }; delete out[k]; }
      else next = Math.min(next, v.gone_s + PRUNE_AFTER_S);
    }
    return [out, next];
  }

  function prune(s, now) {
    if (s._next_prune_s == null || now <= s._next_prune_s) return s;
    let next = Infinity;
    const patch = {};
    const run = (key, map) => { const [m, n] = pruneMap(map, now); next = Math.min(next, n); return m; };
    const customers = run('customers', s.customers);
    if (customers !== s.customers) patch.customers = customers;
    const orders = run('orders', s.orders);
    if (orders !== s.orders) patch.orders = orders;
    const listings = run('listings', s.replate.listings);
    if (listings !== s.replate.listings) patch.replate = { ...s.replate, listings };
    const bags = run('bags', s.shelf.bags);
    const riders = run('riders', s.shelf.riders);
    if (bags !== s.shelf.bags || riders !== s.shelf.riders) patch.shelf = { ...s.shelf, bags, riders };
    patch._next_prune_s = next === Infinity ? null : next;
    return { ...s, ...patch };
  }

  /* ------------------------------------------------------------------ reduce */
  function reduce(state, ev) {
    if (!ev || !ev.type) return state;
    const pseudo = ev.seq == null;
    if (!pseudo && ev.seq <= state.seq) return state; // already applied (replay, reconnect overlap)
    let s = state;
    const hs = handlers[ev.type];
    if (hs) {
      for (const h of hs) {
        const patch = h.fn(s, ev);
        if (patch) s = { ...s, ...patch };
      }
    }
    if (!pseudo && handlers['*']) { // handlers that look at every stream event (the clock follows sim_s)
      for (const h of handlers['*']) {
        const patch = h.fn(s, ev);
        if (patch) s = { ...s, ...patch };
      }
    }
    const meta = {};
    if (!pseudo) meta.seq = ev.seq;
    if (ev.sim_s != null && (!pseudo || ev.sim_s > s.sim_s)) { meta.sim_s = ev.sim_s; meta.t = ev.t != null ? ev.t : s.t; }
    s = { ...s, ...meta };
    return pseudo ? s : prune(s, ev.sim_s);
  }

  function reduceAll(state, events) {
    let s = state;
    for (let i = 0; i < events.length; i++) s = reduce(s, events[i]);
    return s;
  }

  /* ------------------------------------------------------------------ selectors */
  const ROLE_ORDER = ['barista', 'cook', 'cashier', 'runner', 'dishwasher'];
  const select = {
    /** open tickets in rail order; each gets `.batch` = {id, order_nos, size, index} when 2+ of the group's tickets
     *  are still on the rail (a batch also lists orders that were already served), else null */
    rail(s) {
      const onRail = new Set(s.rail.order_nos);
      const by = {};
      for (const b of s.rail.batches) {
        // an order can sit in two live batches (two stations): the first group wins, one paperclip per ticket
        const members = b.order_nos.filter((no) => onRail.has(no) && s.orders[no] && !by[no]);
        if (members.length >= 2) for (const no of members) by[no] = { id: b.id, order_nos: members };
      }
      const out = [];
      for (const no of s.rail.order_nos) {
        const o = s.orders[no];
        if (!o) continue;
        const b = by[no];
        out.push({ ...o, batch: b ? { id: b.id, order_nos: b.order_nos, size: b.order_nos.length, index: b.order_nos.indexOf(no) } : null });
      }
      return out;
    },
    /** "now brewing" board columns (delivery orders that are ready wait for their rider: not shown) */
    board(s) {
      const cols = { brewing: [], almost: [], ready: [] };
      for (const o of Object.values(s.orders).sort(U.byOrderNo)) {
        if (!s.rail.order_nos.includes(o.order_no)) continue;
        if ((o.channel === 'zomato' || o.channel === 'swiggy') && o.status === 'ready') continue;
        const key = o.status === 'queued' ? 'brewing' : o.status;
        if (cols[key]) cols[key].push({ order_no: o.order_no, name: o.name, short: String(o.name || '').toUpperCase().slice(0, 5), channel: o.channel });
      }
      return cols;
    },
    /** parties at the register first, then the queue in order */
    queue(s) {
      const cs = Object.values(s.customers);
      const at = cs.filter((c) => c.state === 'ordering').sort((a, b) => a.state_s - b.state_s);
      const q = cs.filter((c) => c.state === 'queued').sort((a, b) => (a.queue_pos || 0) - (b.queue_pos || 0));
      return at.concat(q);
    },
    seated(s) {
      return Object.values(s.customers).filter((c) => ['seated', 'eating', 'lingering', 'paying'].includes(c.state));
    },
    /** staff sorted by role then id */
    crew(s) {
      const rank = (r) => { const i = ROLE_ORDER.indexOf(r); return i < 0 ? ROLE_ORDER.length : i; };
      return Object.values(s.staff).sort((a, b) => rank(a.role) - rank(b.role) || (a.id < b.id ? -1 : 1));
    },
    /** one row per station with its up/down state and whether an active disruption targets it */
    stationLoad(s) {
      const hit = {};
      for (const d of Object.values(s.disruptions)) {
        if (!d.active || !d.target) continue;
        hit[d.target] = d.id;
        const eq = s.equipment[d.target];
        if (eq) hit[eq.station] = d.id;
      }
      return Object.values(s.stations)
        .map((st) => ({ ...st, chaos: hit[st.station] || null }))
        .sort((a, b) => (a.station < b.station ? -1 : 1));
    },
    /** lots classified for the pantry: fresh / soon (< 25 % of its life or < 12 h left) / bad (expired) */
    freshness(s) {
      const lots = [];
      const counts = { fresh: 0, soon: 0, bad: 0 };
      for (const [key, rows] of Object.entries(s.lots)) {
        for (const l of rows) {
          const left = l.expires_s - s.sim_s;
          const life = Math.max(1, l.expires_s - (l.received_s != null ? l.received_s : s.sim_s));
          const state = left <= 0 ? 'bad' : left < 12 * 3600 || left / life < 0.25 ? 'soon' : 'fresh';
          counts[state] += 1;
          lots.push({ ...l, key, state, hours_left: U.round(left / 3600, 1) });
        }
      }
      return { lots, counts };
    },
    /** disruptions that are active now, oldest first */
    activeChaos(s) {
      return Object.values(s.disruptions).filter((d) => d.active).sort((a, b) => a.started_s - b.started_s);
    },
    menuItems(s) { return Object.values(s.menu); },
  };

  window.BrewStore = {
    hydrate,
    reduce,
    reduceAll,
    select,
    register,
    U,
    IGNORED,
    PENDING_BACKEND,
    /** every event type with a reducer (REST pseudo-events excluded) */
    get HANDLED() { return Object.keys(handlers).filter((t) => t !== '*' && !t.startsWith('rest.') && !t.startsWith('client.')).sort(); },
    get REST_HANDLED() { return Object.keys(handlers).filter((t) => t.startsWith('rest.')).sort(); },
    /** type -> ["reduce/lobby.js:orders", ...] (the source of truth for design/contract.json) */
    describe() {
      const events = {};
      const rest = {};
      let all = [];
      for (const [type, hs] of Object.entries(handlers)) {
        const list = hs.map((h) => h.file + ':' + h.slice);
        if (type === '*') all = list;
        else (type.startsWith('rest.') || type.startsWith('client.') ? rest : events)[type] = list;
      }
      return { events, rest, all_events: all, ignored: { ...IGNORED }, pending_backend: PENDING_BACKEND.slice() };
    },
    DAY_S,
  };
})();
