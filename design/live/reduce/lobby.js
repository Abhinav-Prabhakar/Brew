/* brew live — lobby slices: menu, combos, replate, orders, rail, batches, customers, tables, shelf, receipts, payments.

   Customer states follow the contract (README): arrived, queued, ordering, waiting, seated, eating, lingering, paying,
   left, balked, reneged, plus `seat_wait` (served at the counter, waiting for a table: the sim has no event for it, it
   is derived from order.served). The snapshot calls them 'arriving' / 'queueing'; hydrate normalises. */
(() => {
  const { U } = BrewStore;
  const GONE = ['left', 'balked', 'reneged'];
  const FINAL = ['served', 'voided', 'rejected'];
  const NORM = { arriving: 'arrived', queueing: 'queued' };

  /* ------------------------------------------------------------------ orders */
  const orderFromRow = (r) => ({
    order_no: r.order_no, order_id: r.order_id, channel: r.channel, party_id: r.party_id, persona: r.persona, name: r.name,
    items: r.items.map((i) => ({ sku: i.sku, qty: i.qty, mods: i.mods, unit_price: i.unit_price, replate: !!i.replate, combo: i.combo || null })),
    note: r.note, note_flags: r.note_flags, placed_s: r.placed_s, promised_s: r.promised_s, priority: 0, bumped: !!r.bumped,
    rider_eta_s: r.rider_eta_s ?? null, cook_at_s: r.cook_at_s ?? null,
    status: r.progress_state, progress: r.progress, ahead: null, ready_s: r.ready_s, served_by: null, void_reason: null,
    batch_id: r.batch != null ? 'b' + r.batch : null, gone_s: null,
  });

  const dropFromRail = (s, no) => {
    if (!s.rail.order_nos.includes(no)) return s.rail;
    return {
      order_nos: s.rail.order_nos.filter((n) => n !== no),
      batches: s.rail.batches.map((b) => (b.order_nos.includes(no) ? { ...b, order_nos: b.order_nos.filter((n) => n !== no) } : b)).filter((b) => b.order_nos.length >= 2),
    };
  };

  const finish = (s, ev, patch) => {
    const o = s.orders[ev.data.order_no];
    if (!o) return null;
    return {
      orders: U.upd(s.orders, o.order_no, { ...patch, gone_s: ev.sim_s }),
      rail: dropFromRail(s, o.order_no),
      _next_prune_s: U.gone(s, ev),
    };
  };

  /* ------------------------------------------------------------------ customers */
  const renumberQueue = (customers) => {
    const q = Object.values(customers).filter((c) => c.state === 'queued').sort((a, b) => a.arrived_s - b.arrived_s || (a.party_id < b.party_id ? -1 : 1));
    let out = customers;
    q.forEach((c, i) => {
      if (c.queue_pos !== i + 1) { if (out === customers) out = { ...customers }; out[c.party_id] = { ...c, queue_pos: i + 1 }; }
    });
    return out;
  };

  const customerFromRow = (r, now) => ({
    party_id: r.party_id, customer_id: r.customer_id, name: r.name, persona: r.persona, party_size: r.party_size, channel: r.channel,
    appearance_seeds: r.appearance_seeds, laptop: r.laptop, state: NORM[r.state] || r.state, queue_pos: null,
    order_no: r.order_nos.length ? r.order_nos[r.order_nos.length - 1] : null, order_nos: r.order_nos.slice(),
    patience_s: r.patience_s, patience_deadline_s: r.patience_left_s != null ? now + r.patience_left_s : null, patience_frac: r.patience_frac,
    tables: r.tables.slice(), seats: [], happy: null, pay_method: null, arrived_s: r.arrived_s, state_s: r.arrived_s, gone_s: null,
  });

  const setState = (s, ev, patch, party_id = ev.data.party_id) => {
    const c = s.customers[party_id];
    if (!c) return null;
    return { customers: U.set(s.customers, party_id, { ...c, ...patch, state_s: patch.state ? ev.sim_s : c.state_s }) };
  };

  const leaveQueue = (customers) => renumberQueue(customers);

  /* ------------------------------------------------------------------ menu / combos helpers */
  const comboRefresh = (s, menu, combos) => {
    let out = combos;
    for (const c of Object.values(combos)) {
      const list = c.skus.reduce((sum, k) => sum + (menu[k] ? menu[k].price : 0), 0);
      const avail = c.skus.every((k) => menu[k] && !menu[k].hidden);
      if (list !== c.list_price || avail !== c.available || U.round(list - c.price, 2) !== c.saving) {
        if (out === combos) out = { ...combos };
        out[c.id] = { ...c, list_price: list, saving: U.round(list - c.price, 2), available: avail };
      }
    }
    return out;
  };

  /* ------------------------------------------------------------------ replate / fridge link */
  const fridgeReplate = (fridge, sku, listing) => {
    const i = fridge.findIndex((r) => r.sku === sku);
    if (i < 0) return fridge;
    const row = { ...fridge[i], replate: listing ? { listing_id: listing.listing_id, price: listing.price, discount_pct: listing.discount_pct, units: listing.units } : null };
    return fridge.slice(0, i).concat([row], fridge.slice(i + 1));
  };

  const listingPatch = (s, ev) => {
    const d = ev.data;
    const prev = s.replate.listings[d.listing_id];
    const l = {
      listing_id: d.listing_id, sku: d.sku, lot_id: d.lot_id, units: d.units, made_at_s: d.made_at_s, use_by_s: d.use_by_s,
      discount_pct: d.discount_pct, price: d.price, listed_s: prev ? prev.listed_s : ev.sim_s, outcome: null, gone_s: null,
    };
    return {
      replate: { ...s.replate, listings: { ...s.replate.listings, [d.listing_id]: l } },
      fridge: fridgeReplate(s.fridge, d.sku, l),
    };
  };

  BrewStore.register('lobby', {
    hydrate(snap, s) {
      const now = s.sim_s;
      const menu = {};
      for (const m of snap.menu) {
        menu[m.sku] = {
          sku: m.sku, name: m.name, cat: m.cat, price: m.price, base: m.base, min_price: m.min_price, max_price: m.max_price,
          staple: m.staple, featured: m.featured, hidden: m.hidden, hidden_reason: m.hidden_reason,
          dir: m.chip ? m.chip.dir : null, note: m.chip ? m.chip.text : '', changed_s: null,
          drivers: (m.drivers || []).slice(), decision_id: m.decision_id || null,
          desc: m.desc, temp: m.temp, allergens: m.allergens, veg: m.veg, vegan: m.vegan, station: m.station, promo: m.promo,
        };
      }
      const combos = {};
      for (const c of snap.combos) combos[c.id] = { ...c, dir: null, changed_s: null };
      const listings = {};
      for (const l of snap.replate.listings) {
        listings[l.listing_id] = {
          listing_id: l.listing_id, sku: l.sku, lot_id: l.lot_id, units: l.units, made_at_s: l.made_at_s, use_by_s: l.use_by_s,
          discount_pct: l.discount_pct, price: l.price, listed_s: null, outcome: null, gone_s: null,
        };
      }
      const orders = {};
      for (const r of snap.rail.orders) orders[r.order_no] = orderFromRow(r);
      const customers = {};
      for (const r of snap.customers) customers[r.party_id] = customerFromRow(r, now);
      const tables = {};
      for (const t of snap.tables.tables) tables[t.id] = { id: t.id, seats: t.seats, state: t.state, occupants: t.occupants.slice(), merged: t.merged, turns: t.turns };
      const dirty = Object.values(tables).filter((t) => t.state === 'dirty').map((t) => [t.id]);
      const bags = {};
      for (const b of snap.shelf.bags) {
        bags[b.order_no] = { order_no: b.order_no, channel: b.channel, slot: b.slot, eta_s: b.rider_eta_s, quality: b.quality, rider: null, rider_eta_s: b.rider_eta_s, gone_s: null };
      }
      const rk = snap.replate.kpis || {};
      return {
        menu,
        combos,
        replate: { mode: snap.replate.mode, listings, sold_today: rk.replate_revenue || 0, units_sold_today: rk.replate_units_sold || 0 },
        orders,
        rail: { order_nos: snap.rail.order_nos.slice(), batches: snap.rail.batches.map((b) => ({ id: b.id, order_nos: b.order_nos.slice() })) },
        batches: {},
        customers: renumberQueue(customers),
        tables,
        _dirty_tables: dirty,
        shelf: { slots: snap.shelf.slots, bags, riders: {}, waiting_for_slot: snap.shelf.waiting_for_slot.slice() },
        receipts: [],
        payments: [],
      };
    },
    on: {
      /* ---- menu & combos */
      'price.changed': ['menu', (s, ev) => {
        const d = ev.data;
        if (d.sku.startsWith('combo:')) {
          const id = d.sku.slice(6);
          const c = s.combos[id];
          if (!c) return null;
          const combos = U.upd(s.combos, id, { price: d.new, base: d.base, dir: d.new !== d.base ? d.dir : null, changed_s: ev.sim_s, saving: U.round(c.list_price - d.new, 2) });
          return { combos };
        }
        const m = s.menu[d.sku];
        if (!m) return null;
        const menu = U.upd(s.menu, d.sku, {
          price: d.new, base: d.base, dir: d.new !== d.base ? d.dir : null,
          note: d.reason_text ? '₹' + U.fmtG(Math.abs(d.new - d.base)) + ' · ' + d.reason_text : '', changed_s: ev.sim_s, by: d.by,
          drivers: (d.drivers || []).slice(0, 3), decision_id: d.decision_id || null, // why it moved (short labelled factors) + /decisions/{id}/explain
        });
        return { menu, combos: comboRefresh(s, menu, s.combos) };
      }],
      'menu.featured': ['menu', (s, ev) => ({ menu: U.upd(s.menu, ev.data.sku, { featured: ev.data.on }) })],
      'menu.hidden': ['menu', (s, ev) => {
        const menu = U.upd(s.menu, ev.data.sku, { hidden: true, hidden_reason: ev.data.reason });
        return { menu, combos: comboRefresh(s, menu, s.combos) };
      }],
      'menu.restored': ['menu', (s, ev) => {
        const menu = U.upd(s.menu, ev.data.sku, { hidden: false, hidden_reason: null });
        return { menu, combos: comboRefresh(s, menu, s.combos) };
      }],

      /* ---- replate (rescue shelf) */
      'replate.listed': ['replate', listingPatch],
      'replate.marked_down': ['replate', listingPatch],
      'replate.sold': ['replate', (s, ev) => {
        const d = ev.data;
        const l = s.replate.listings[d.listing_id];
        const sold = { sold_today: s.replate.sold_today + d.price * d.units, units_sold_today: s.replate.units_sold_today + d.units };
        if (!l) return { replate: { ...s.replate, ...sold } };
        const nl = { ...l, units: Math.max(0, U.round(l.units - d.units, 2)) };
        return {
          replate: { ...s.replate, ...sold, listings: { ...s.replate.listings, [d.listing_id]: nl } },
          fridge: fridgeReplate(s.fridge, l.sku, nl),
        };
      }],
      'replate.retired': ['replate', (s, ev) => {
        const d = ev.data;
        const l = s.replate.listings[d.listing_id];
        if (!l) return null;
        return {
          replate: { ...s.replate, listings: { ...s.replate.listings, [d.listing_id]: { ...l, outcome: d.outcome, gone_s: ev.sim_s } } },
          fridge: fridgeReplate(s.fridge, l.sku, null),
          _next_prune_s: U.gone(s, ev),
        };
      }],
      'replate.mode': ['replate', (s, ev) => ({ replate: { ...s.replate, mode: ev.data.mode } })],
      'day.started': ['replate', (s) => ({ replate: { ...s.replate, sold_today: 0, units_sold_today: 0 } })],

      /* ---- orders & the rail */
      'order.placed': [['orders', (s, ev) => {
        const d = ev.data;
        const o = {
          order_no: d.order_no, order_id: d.order_id, channel: d.channel, party_id: d.party_id, persona: d.persona, name: d.name,
          items: d.items.map((i) => ({ sku: i.sku, qty: i.qty, mods: i.mods, unit_price: i.unit_price, replate: !!i.replate, combo: i.combo || null })),
          note: d.note, note_flags: d.note_flags, placed_s: ev.sim_s, promised_s: d.promised_s, priority: d.priority, bumped: false,
          rider_eta_s: null, cook_at_s: null,
          status: 'queued', progress: 0, ahead: null, ready_s: null, served_by: null, void_reason: null, batch_id: null, gone_s: null,
        };
        return {
          orders: { ...s.orders, [d.order_no]: o },
          rail: s.rail.order_nos.includes(d.order_no) ? s.rail : { ...s.rail, order_nos: s.rail.order_nos.concat([d.order_no]) },
        };
      }],
      // the party's tickets (a refill adds a second order without any customer.* event)
      ['customers', (s, ev) => {
        const c = ev.data.party_id ? s.customers[ev.data.party_id] : null;
        if (!c || c.order_nos.includes(ev.data.order_no)) return null;
        return { customers: U.set(s.customers, c.party_id, { ...c, order_nos: c.order_nos.concat([ev.data.order_no]), order_no: ev.data.order_no }) };
      }]],
      'order.accepted': ['orders', (s, ev) => ({ orders: U.upd(s.orders, ev.data.order_no, { promised_s: ev.data.promised_s,
        rider_eta_s: ev.data.rider_eta_s ?? null, cook_at_s: ev.data.cook_at_s ?? null }) })],   // delivery: the rider's ETA and the just-in-time cook time
      'order.rejected': ['orders', (s, ev) => finish(s, ev, { status: 'rejected', void_reason: ev.data.reason })],
      'order.progress': ['orders', (s, ev) => {
        const o = s.orders[ev.data.order_no];
        if (!o || FINAL.includes(o.status)) return null;
        return { orders: U.upd(s.orders, o.order_no, { status: ev.data.state, progress: ev.data.progress, ahead: ev.data.ahead }) };
      }],
      'order.ready': ['orders', (s, ev) => {
        const o = s.orders[ev.data.order_no];
        if (!o || FINAL.includes(o.status)) return null;
        return { orders: U.upd(s.orders, o.order_no, { status: 'ready', progress: 1, ready_s: ev.data.ready_s }) };
      }],
      'order.served': [
        ['orders', (s, ev) => finish(s, ev, { status: 'served', progress: 1, served_by: ev.data.by })],
        // the sim hands a served dine-in party to the seat-finder: they wait for a table until customer.seated
        ['customers', (s, ev) => {
          const o = s.orders[ev.data.order_no];
          const c = o && o.party_id ? s.customers[o.party_id] : null;
          if (!c || c.state !== 'waiting' || c.channel !== 'dine_in') return null;
          return setState(s, ev, { state: 'seat_wait' }, c.party_id);
        }],
      ],
      'order.voided': ['orders', (s, ev) => finish(s, ev, { status: 'voided', void_reason: ev.data.reason })],
      'rail.reordered': ['rail', (s, ev) => {
        const batches = ev.data.batches.map((b) => ({ id: b.id, order_nos: b.order_nos.slice() }));
        const idx = {};
        for (const b of batches) for (const no of b.order_nos) idx[no] = b.id;
        let orders = s.orders;
        for (const o of Object.values(s.orders)) {
          const want = FINAL.includes(o.status) ? o.batch_id : idx[o.order_no] || null;
          if (want !== o.batch_id) { if (orders === s.orders) orders = { ...s.orders }; orders[o.order_no] = { ...o, batch_id: want }; }
        }
        const live = new Set(batches.map((b) => b.id));
        let bmap = s.batches;
        for (const id of Object.keys(s.batches)) if (!live.has(id)) bmap = U.del(bmap, id);
        return { rail: { order_nos: ev.data.order_nos.slice(), batches }, orders, batches: bmap };
      }],
      'batch.formed': ['batches', (s, ev) => batchPatch(s, ev, false)],
      'batch.started': ['batches', (s, ev) => batchPatch(s, ev, true)],

      /* ---- customers */
      'customer.arrived': ['customers', (s, ev) => {
        const d = ev.data;
        const c = {
          party_id: d.party_id, customer_id: d.customer_id, name: d.name, persona: d.persona, party_size: d.party_size, channel: d.channel,
          appearance_seeds: d.appearance_seeds, laptop: d.laptop, state: 'arrived', queue_pos: null, order_no: null, order_nos: [],
          patience_s: null, patience_deadline_s: null, patience_frac: 1, tables: [], seats: [], happy: null, pay_method: null,
          arrived_s: ev.sim_s, state_s: ev.sim_s, gone_s: null,
        };
        return { customers: { ...s.customers, [d.party_id]: c } };
      }],
      'customer.queued': ['customers', (s, ev) => {
        const p = setState(s, ev, { state: 'queued', queue_pos: ev.data.position, patience_frac: 1 });
        return p && { customers: renumberQueue(p.customers) };
      }],
      'customer.balked': ['customers', (s, ev) => {
        const p = setState(s, ev, { state: 'balked', queue_pos: null, gone_s: ev.sim_s });
        return p && { customers: leaveQueue(p.customers), _next_prune_s: U.gone(s, ev) };
      }],
      'customer.ordering': ['customers', (s, ev) => {
        const c = s.customers[ev.data.party_id];
        if (!c || (c.state !== 'queued' && c.state !== 'arrived')) return null; // a refill order from a seated customer
        const p = setState(s, ev, { state: 'ordering', queue_pos: null });
        return { customers: leaveQueue(p.customers) };
      }],
      'customer.waiting': ['customers', (s, ev) => {
        const d = ev.data;
        const c = s.customers[d.party_id];
        if (!c) return null;
        return setState(s, ev, {
          state: 'waiting', order_no: d.order_no, order_nos: c.order_nos.includes(d.order_no) ? c.order_nos : c.order_nos.concat([d.order_no]),
          patience_s: d.patience_s, patience_deadline_s: d.patience_deadline_s, patience_frac: 1,
        });
      }],
      'customer.patience': ['customers', (s, ev) => setState(s, ev, { patience_frac: ev.data.frac })],
      'customer.reneged': ['customers', (s, ev) => {
        const p = setState(s, ev, { state: 'reneged', queue_pos: null, gone_s: ev.sim_s });
        return p && { customers: leaveQueue(p.customers), _next_prune_s: U.gone(s, ev) };
      }],
      'customer.seated': [
        ['customers', (s, ev) => setState(s, ev, { state: 'seated', tables: ev.data.table_ids.slice(), seats: ev.data.seats.slice() })],
        ['tables', (s, ev) => {
          const d = ev.data;
          const c = s.customers[d.party_id];
          let left = c ? c.party_size : d.seats.length;
          let tables = s.tables;
          for (const tid of d.table_ids) {
            const t = tables[tid];
            if (!t) continue;
            const n = d.merged ? Math.min(t.seats, left) : d.seats.length;
            left -= n;
            tables = U.upd(tables, tid, { state: 'occupied', occupants: t.occupants.concat(new Array(n).fill(d.party_id)), merged: d.merged ? d.table_ids.join('+') : t.merged });
          }
          return { tables };
        }],
      ],
      'customer.eating': ['customers', (s, ev) => setState(s, ev, { state: 'eating' })],
      'customer.lingering': ['customers', (s, ev) => setState(s, ev, { state: 'lingering', laptop: ev.data.laptop })],
      'customer.paying': ['customers', (s, ev) => setState(s, ev, { state: 'paying', pay_method: ev.data.method })],
      'customer.left': [
        ['customers', (s, ev) => {
          const c = s.customers[ev.data.party_id];
          if (!c) return null;
          const state = c.state === 'reneged' || c.state === 'balked' ? c.state : 'left';
          return {
            customers: U.set(s.customers, c.party_id, { ...c, state, happy: ev.data.happy, gone_s: c.gone_s != null ? c.gone_s : ev.sim_s, state_s: state !== c.state ? ev.sim_s : c.state_s }),
            _next_prune_s: U.gone(s, ev),
          };
        }],
        // the party's seats empty; a table with nobody left turns dirty until a 'clean' task finishes
        ['tables', (s, ev) => {
          const c = s.customers[ev.data.party_id];
          if (!c || !c.tables.length) return null;
          let tables = s.tables;
          const freed = [];
          for (const tid of c.tables) {
            const t = tables[tid];
            if (!t) continue;
            const occ = t.occupants.filter((x) => x !== c.party_id);
            if (occ.length === t.occupants.length) continue;
            if (occ.length === 0) { freed.push(tid); tables = U.upd(tables, tid, { occupants: [], state: 'dirty', merged: null, turns: t.turns + 1 }); }
            else tables = U.upd(tables, tid, { occupants: occ });
          }
          return { tables, _dirty_tables: freed.length ? s._dirty_tables.concat([freed]) : s._dirty_tables };
        }],
      ],

      // the sim has no "table cleaned" event: a finished pass/clean task frees the oldest dirty table group (FIFO)
      'task.finished': ['tables', (s, ev) => {
        if (ev.data.station !== 'pass' || ev.data.step !== 'clean' || !s._dirty_tables.length) return null;
        let tables = s.tables;
        for (const tid of s._dirty_tables[0]) tables = U.upd(tables, tid, { state: 'free', occupants: [], merged: null });
        return { tables, _dirty_tables: s._dirty_tables.slice(1) };
      }],

      /* ---- shelf & riders */
      'rider.assigned': ['shelf', (s, ev) => {
        const d = ev.data;
        const shelf = {
          ...s.shelf,
          riders: { ...s.shelf.riders, [d.order_no]: { order_no: d.order_no, channel: d.channel, status: 'assigned', eta_s: d.eta_s, gone_s: null } },
        };
        if (s.shelf.bags[d.order_no]) shelf.bags = U.upd(s.shelf.bags, d.order_no, { rider: 'assigned', rider_eta_s: d.eta_s });
        return { shelf };
      }],
      'bag.shelved': ['shelf', (s, ev) => {
        const d = ev.data;
        const r = s.shelf.riders[d.order_no];
        const bag = { order_no: d.order_no, channel: d.channel, slot: d.slot, eta_s: d.eta_s, quality: d.quality, rider: r ? r.status : null, rider_eta_s: d.eta_s, gone_s: null };
        return { shelf: { ...s.shelf, bags: { ...s.shelf.bags, [d.order_no]: bag }, waiting_for_slot: s.shelf.waiting_for_slot.filter((n) => n !== d.order_no) } };
      }],
      'rider.arrived': ['shelf', (s, ev) => {
        const d = ev.data;
        const shelf = { ...s.shelf, riders: U.upd(s.shelf.riders, d.order_no, { status: 'arrived', waiting: d.waiting }, true) };
        if (s.shelf.bags[d.order_no]) shelf.bags = U.upd(s.shelf.bags, d.order_no, { rider: 'arrived' });
        return { shelf };
      }],
      'rider.picked_up': ['shelf', (s, ev) => {
        const d = ev.data;
        const shelf = { ...s.shelf, riders: U.upd(s.shelf.riders, d.order_no, { status: 'picked_up', quality: d.quality, rider_wait_s: d.rider_wait_s, gone_s: ev.sim_s }, true) };
        if (s.shelf.bags[d.order_no]) shelf.bags = U.upd(s.shelf.bags, d.order_no, { rider: 'picked_up', quality: d.quality, gone_s: ev.sim_s });
        return { shelf, _next_prune_s: U.gone(s, ev) };
      }],

      /* ---- receipts & payments */
      'receipt.printed': [
        ['receipts', (s, ev) => ({ receipts: U.tail(s.receipts, { ...ev.data }, 6) })],
        // aggregator orders announce their lines when they arrive and lose out-of-stock ones when accepted (order.placed
        // is not re-sent): the receipt printed at acceptance carries the final lines
        ['orders', (s, ev) => {
          const o = s.orders[ev.data.order_no];
          if (!o || FINAL.includes(o.status)) return null;
          const lines = ev.data.lines;
          const same = lines.length === o.items.length && lines.every((l, i) => l.sku === o.items[i].sku && l.qty === o.items[i].qty);
          if (same) return null;
          const items = lines.map((l) => {
            const prev = o.items.find((i) => i.sku === l.sku && i.mods.join() === l.mods.join());
            return { sku: l.sku, qty: l.qty, mods: l.mods, unit_price: l.unit_price, replate: !!l.replate, combo: prev ? prev.combo : null };
          });
          return { orders: U.upd(s.orders, o.order_no, { items }) };
        }],
      ],
      'payment.received': ['payments', (s, ev) => ({ payments: U.tail(s.payments, { ...ev.data, sim_s: ev.sim_s }, 12) })],
    },
  });

  /* ---- handlers that need more than one line (hoisted; referenced above) */
  function batchPatch(s, ev, started) {
    const d = ev.data;
    const prev = s.batches[d.batch_id];
    const b = {
      batch_id: d.batch_id, station: d.station, step: d.step, order_nos: d.order_nos.slice(), size: d.size,
      started: started || (prev ? prev.started : false), saves_s: d.saves_s != null ? d.saves_s : prev ? prev.saves_s : null,
      formed_s: prev ? prev.formed_s : ev.sim_s,
    };
    let orders = s.orders;
    // one order with several units forms a 'batch' too, but only 2+ orders get a paperclip on the rail
    if (d.order_nos.length >= 2) for (const no of d.order_nos) if (orders[no] && orders[no].batch_id !== d.batch_id) orders = U.upd(orders, no, { batch_id: d.batch_id });
    return { batches: { ...s.batches, [d.batch_id]: b }, orders };
  }
})();
