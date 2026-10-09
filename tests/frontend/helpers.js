/* Test-side helpers, injected into the harness page (page.add_init_script). Everything the Python tests evaluate
   goes through window.T so the heavy loops (reducing a whole fixture, diffing states) run in the browser and only
   small JSON results cross the wire. */
(() => {
  const cache = {};
  const FINAL = ['served', 'voided', 'rejected'];
  const GONE = ['left', 'balked', 'reneged'];

  function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      for (const k of Object.keys(o)) deepFreeze(o[k]);
    }
    return o;
  }

  async function load(name) {
    if (!cache[name]) {
      const text = await (await fetch('/tests/fixtures/streams/' + name + '.jsonl')).text();
      cache[name] = BrewSources.parseStream(text);
    }
    return cache[name];
  }

  /** events with seq in (from, to] */
  const slice = (fx, from, to) => fx.events.filter((e) => e.seq > from && e.seq <= to);

  /* ---------------------------------------------------------------- diffing a reduced state against hydrate(checkpoint) */
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const near = (a, b, tol) => a != null && b != null && Math.abs(a - b) <= tol;

  /** KNOWN gaps: the snapshot is richer than the event stream. Each is reported (not failed) under its tag. */
  function compare(E, H, ctx) {
    const diffs = [];
    const gaps = [];
    const d = (what, a, b) => diffs.push(what + ': events=' + JSON.stringify(a) + ' snapshot=' + JSON.stringify(b));
    const gap = (tag, what, a, b) => gaps.push({ tag, what: what + ': events=' + JSON.stringify(a) + ' snapshot=' + JSON.stringify(b) });

    if (E.seq !== H.seq) d('seq', E.seq, H.seq);

    // ---- rail + open orders
    if (!eq(E.rail.order_nos, H.rail.order_nos)) d('rail.order_nos', E.rail.order_nos, H.rail.order_nos);
    if (!eq(E.rail.batches, H.rail.batches)) d('rail.batches', E.rail.batches, H.rail.batches);
    const openE = Object.values(E.orders).filter((o) => !FINAL.includes(o.status)).map((o) => o.order_no).sort((a, b) => a - b);
    const openH = Object.keys(H.orders).map(Number).sort((a, b) => a - b);
    if (!eq(openE, openH)) d('open orders', openE, openH);
    for (const no of openH) {
      const e = E.orders[no];
      const h = H.orders[no];
      if (!e) continue;
      if (e.status !== h.status) d('order ' + no + ' status', e.status, h.status);
      if (!near(e.progress, h.progress, 0.101)) d('order ' + no + ' progress', e.progress, h.progress);
      if (!eq(e.items, h.items)) d('order ' + no + ' items', e.items, h.items);
      if (e.batch_id !== h.batch_id) d('order ' + no + ' batch_id', e.batch_id, h.batch_id);
      if (e.promised_s !== h.promised_s) d('order ' + no + ' promised_s', e.promised_s, h.promised_s);
      if (e.channel !== h.channel || e.persona !== h.persona || e.name !== h.name) d('order ' + no + ' who', [e.channel, e.persona, e.name], [h.channel, h.persona, h.name]);
      if (e.bumped !== h.bumped) gap('bump', 'order ' + no + ' bumped (no event for priority bumps)', e.bumped, h.bumped);
    }

    // ---- customers in the venue
    const vE = Object.values(E.customers).filter((c) => !GONE.includes(c.state));
    const idsE = vE.map((c) => c.party_id).sort();
    const idsH = Object.keys(H.customers).sort();
    if (!eq(idsE, idsH)) d('customers in venue', idsE, idsH);
    for (const id of idsH) {
      const e = E.customers[id];
      const h = H.customers[id];
      if (!e) continue;
      if (e.state !== h.state) d('customer ' + id.slice(-6) + ' state', e.state, h.state);
      if (!eq(e.tables.slice().sort(), h.tables.slice().sort())) d('customer ' + id.slice(-6) + ' tables', e.tables, h.tables);
      if (e.party_size !== h.party_size || e.persona !== h.persona || e.laptop !== h.laptop || !eq(e.appearance_seeds, h.appearance_seeds)) d('customer ' + id.slice(-6) + ' identity', e, h);
      if (!eq(e.order_nos, h.order_nos)) d('customer ' + id.slice(-6) + ' order_nos', e.order_nos, h.order_nos);
      if (e.state === 'queued' && e.queue_pos !== h.queue_pos) d('customer ' + id.slice(-6) + ' queue_pos', e.queue_pos, h.queue_pos);
      if (!near(e.patience_frac, h.patience_frac, 0.4)) gap('patience', 'customer ' + id.slice(-6) + ' patience_frac too far apart', e.patience_frac, h.patience_frac);
      else if (!near(e.patience_frac, h.patience_frac, 0.0005)) gaps.push({ tag: 'patience-coarse', what: 'patience_frac is only streamed at the 60/30/10 % thresholds' });
    }

    // ---- tables
    for (const id of Object.keys(H.tables)) {
      const e = E.tables[id];
      const h = H.tables[id];
      const eo = e.occupants.slice().sort();
      const ho = h.occupants.slice().sort();
      if (!eq(eo, ho)) d('table ' + id + ' occupants', eo, ho);
      if ((e.state === 'occupied') !== (h.state === 'occupied')) d('table ' + id + ' occupied', e.state, h.state);
      else if (e.state !== h.state) gap('table-clean', 'table ' + id + ' free vs dirty (no "table cleaned" event; inferred from the clean task)', e.state, h.state);
      if (e.merged !== h.merged) d('table ' + id + ' merged', e.merged, h.merged);
    }

    // ---- menu, combos
    for (const sku of Object.keys(H.menu)) {
      const e = E.menu[sku];
      const h = H.menu[sku];
      for (const k of ['price', 'base', 'featured', 'hidden', 'dir', 'note']) if (e[k] !== h[k]) d('menu ' + sku + '.' + k, e[k], h[k]);
    }
    for (const id of Object.keys(H.combos)) {
      const e = E.combos[id];
      const h = H.combos[id];
      for (const k of ['price', 'base', 'list_price', 'saving', 'available']) if (e[k] !== h[k]) d('combo ' + id + '.' + k, e[k], h[k]);
    }

    // ---- replate
    const lE = Object.values(E.replate.listings).filter((l) => l.outcome == null);
    const idsLE = lE.map((l) => l.listing_id).sort();
    const idsLH = Object.keys(H.replate.listings).sort();
    if (!eq(idsLE, idsLH)) d('replate listings', idsLE, idsLH);
    for (const id of idsLH) {
      const e = E.replate.listings[id];
      const h = H.replate.listings[id];
      if (!e) continue;
      for (const k of ['price', 'discount_pct', 'sku', 'lot_id', 'made_at_s', 'use_by_s']) if (e[k] !== h[k]) d('listing ' + id + '.' + k, e[k], h[k]);
      // the lot also sells at full price (no event), so the snapshot can only have fewer units left than the events say
      if (e.units < h.units - 0.011) d('listing ' + id + '.units', e.units, h.units);
      else if (e.units !== h.units) gap('replate-units', 'listing units: lot also consumed by full-price sales / premake without an event', e.units, h.units);
    }
    if (E.replate.mode !== H.replate.mode) d('replate.mode', E.replate.mode, H.replate.mode);
    if (!near(E.replate.units_sold_today, H.replate.units_sold_today, 0)) d('replate.units_sold_today', E.replate.units_sold_today, H.replate.units_sold_today);
    if (!near(E.replate.sold_today, H.replate.sold_today, 0.011)) d('replate.sold_today', E.replate.sold_today, H.replate.sold_today);

    // ---- fridge
    for (const h of H.fridge) {
      const e = E.fridge.find((r) => r.sku === h.sku);
      if (!eq(e.replate && { p: e.replate.price, d: e.replate.discount_pct }, h.replate && { p: h.replate.price, d: h.replate.discount_pct })) gap('fridge-replate', 'fridge row replate tag: the backend only tags the first stock lot / pre-made cold brew', e.replate, h.replate);
      if (h.key === 'coldbrew_concentrate') {
        if (e.qty !== h.qty) gap('coldbrew', 'fridge coldbrew qty (concentrate is not a finished good: only low-flag flips are streamed)', e.qty, h.qty);
      } else {
        if (e.qty !== h.qty) d('fridge ' + h.sku + '.qty', e.qty, h.qty);
        if (e.low !== h.low) d('fridge ' + h.sku + '.low', e.low, h.low);
      }
    }

    // ---- kpis, clock, weather, policy
    const lastTick = ctx && ctx.lastTickSim;
    if (lastTick === H.sim_s) {
      for (const k of Object.keys(H.kpis)) if (!near(E.kpis[k], H.kpis[k], 0.011)) d('kpis.' + k, E.kpis[k], H.kpis[k]);
    } else {
      gap('kpis', 'kpis only refresh on kpi.tick (every 5 sim-min); checkpoint falls between ticks', E.kpis.profit_today, H.kpis.profit_today);
    }
    for (const k of ['day', 'hhmm', 'weekday', 'date', 'is_open', 'open_s', 'close_s']) if (E.clock[k] !== H.clock[k]) d('clock.' + k, E.clock[k], H.clock[k]);
    if (E.weather.state !== H.weather.state) d('weather.state', E.weather.state, H.weather.state);
    if (E.weather.temp_c !== H.weather.temp_c || E.weather.rain_mm_h !== H.weather.rain_mm_h) gap('weather-temp', 'weather temp/rain drift hourly without a weather.changed (only state changes are streamed)', E.weather, H.weather);
    if (E.policy.policy !== H.policy.policy || E.policy.strategy !== H.policy.strategy || !eq(E.policy.throttles, H.policy.throttles)) d('policy', E.policy, H.policy);

    // ---- kitchen
    for (const k of Object.keys(H.equipment)) {
      if (E.equipment[k].status !== H.equipment[k].status) d('equipment ' + k + '.status', E.equipment[k].status, H.equipment[k].status);
      if (!eq(E.equipment[k].down_until_s, H.equipment[k].down_until_s)) d('equipment ' + k + '.down_until_s', E.equipment[k].down_until_s, H.equipment[k].down_until_s);
    }
    for (const k of Object.keys(H.stations)) if (E.stations[k].status !== H.stations[k].status) d('station ' + k + '.status', E.stations[k].status, H.stations[k].status);
    for (const id of Object.keys(H.staff)) {
      const e = E.staff[id];
      const h = H.staff[id];
      for (const k of ['present', 'on_break', 'absent']) if (e[k] !== h[k]) d('staff ' + id + '.' + k, e[k], h[k]);
      if ((e.station != null) !== (h.station != null)) d('staff ' + id + ' working', e.station, h.station);
      else if (e.station !== h.station || e.task !== h.task) gap('staff-task', 'staff ' + id + ' station/task (several concurrent tasks: the sim reports the latest started)', [e.station, e.task], [h.station, h.task]);
      if (e.state !== h.state) d('staff ' + id + '.state', e.state, h.state);
      gap('fatigue', 'staff fatigue is not streamed (pending staff.status)', e.fatigue, h.fatigue);
    }
    const actE = Object.values(E.disruptions).filter((x) => x.active).map((x) => x.id).sort();
    const actH = Object.values(H.disruptions).filter((x) => x.active).map((x) => x.id).sort();
    if (!eq(actE, actH)) d('active disruptions', actE, actH);

    // ---- shelf
    const bE = Object.values(E.shelf.bags).filter((b) => b.gone_s == null).map((b) => b.order_no + '@' + b.slot).sort();
    const bH = Object.values(H.shelf.bags).map((b) => b.order_no + '@' + b.slot).sort();
    if (!eq(bE, bH)) d('shelf bags', bE, bH);
    for (const b of Object.values(H.shelf.bags)) {
      const e = E.shelf.bags[b.order_no];
      if (e && !near(e.rider_eta_s, b.rider_eta_s, 0.06)) d('bag ' + b.order_no + '.rider_eta_s', e.rider_eta_s, b.rider_eta_s);
      if (e && e.quality !== b.quality) gap('bag-quality', 'bag quality decays on the shelf between events (only the quality at shelving / pickup is streamed)', e.quality, b.quality);
    }
    return { diffs, gaps };
  }

  /** reduce the fixture checkpoint by checkpoint and diff each against hydrate(checkpoint) */
  async function verifyCheckpoints(name) {
    const fx = await load(name);
    let s = BrewStore.hydrate(fx.snapshot);
    const out = [];
    let prev = fx.snapshot.last_seq;
    let lastTickSim = null;
    for (const cp of fx.checkpoints) {
      const evs = slice(fx, prev, cp.seq);
      for (const e of evs) if (e.type === 'kpi.tick') lastTickSim = e.sim_s;
      s = BrewStore.reduceAll(s, evs);
      const H = BrewStore.hydrate(cp.data);
      const r = compare(s, H, { lastTickSim });
      out.push({ seq: cp.seq, hhmm: cp.data.clock.hhmm, n_events: evs.length, diffs: r.diffs, gaps: r.gaps });
      prev = cp.seq;
    }
    return out;
  }

  /** hydrate(snapshot) + every event with seq <= upTo */
  async function stateAt(name, upTo) {
    const fx = await load(name);
    return BrewStore.reduceAll(BrewStore.hydrate(fx.snapshot), fx.events.filter((e) => e.seq <= upTo));
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  window.T = { load, slice, stateAt, sleep, deepFreeze, compare, verifyCheckpoints, eq, near, FINAL, GONE };
})();
