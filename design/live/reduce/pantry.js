/* brew live — pantry slices: stock, fridge, inventory, lots, pos.
   stock = raw on-hand of the keys the sim streams (finished goods, flagged ingredients); fridge = the pastry-case
   rows (cold brew is shown in 330 ml units). inventory / lots come from the REST read models (rest.inventory,
   rest.lots) and are kept fresh by stock.changed / lot.* events in between. */
(() => {
  const { U } = BrewStore;
  const CB_KEY = 'coldbrew_concentrate';
  const CB_UNIT = 330; // ml of concentrate per served cold brew (readmodels.fridge)
  const CB_LOW = 1200;

  const fridgeRow = (row, qty, low) => {
    if (row.key === CB_KEY) return { ...row, qty: U.round(qty / CB_UNIT, 1), low: qty < CB_LOW };
    return { ...row, qty: U.round(qty, 1), low };
  };

  BrewStore.register('pantry', {
    hydrate(snap) {
      const stock = {};
      for (const r of snap.fridge) {
        const raw = r.key === CB_KEY ? r.qty * CB_UNIT : r.qty;
        stock[r.key] = { key: r.key, qty: raw, low: r.low };
      }
      return {
        stock,
        fridge: snap.fridge.map((r) => ({ ...r, replate: r.replate ? { ...r.replate } : null })),
        inventory: {},
        lots: {},
        pos: {},
      };
    },
    on: {
      'stock.changed': ['stock', (s, ev) => {
        const d = ev.data;
        const patch = { stock: U.set(s.stock, d.key, { key: d.key, qty: d.qty, low: d.low }) };
        const i = s.fridge.findIndex((r) => r.key === d.key);
        if (i >= 0) patch.fridge = s.fridge.slice(0, i).concat([fridgeRow(s.fridge[i], d.qty, d.low)], s.fridge.slice(i + 1));
        if (s.inventory[d.key]) patch.inventory = U.upd(s.inventory, d.key, { on_hand: d.qty, low: d.low });
        return patch;
      }],
      'lot.opened': ['lots', (s, ev) => {
        const d = ev.data;
        const rows = s.lots[d.key];
        if (!rows) return null;
        return { lots: U.set(s.lots, d.key, rows.map((l) => (l.lot_id === d.lot_id ? { ...l, status: 'opened', opened_s: ev.sim_s, expires_s: d.expires_s } : l))) };
      }],
      'lot.expired': ['lots', (s, ev) => dropLot(s, ev.data)],
      'lot.donated': ['lots', (s, ev) => dropLot(s, ev.data)],
      'po.created': ['pos', (s, ev) => {
        const d = ev.data;
        return { pos: { ...s.pos, [d.po_id]: { po_id: d.po_id, supplier: d.supplier, lines: d.lines, eta_s: d.eta_s, status: 'open', short: false, created_s: ev.sim_s } } };
      }],
      'po.received': ['pos', (s, ev) => {
        const d = ev.data;
        const prev = s.pos[d.po_id];
        return { pos: { ...s.pos, [d.po_id]: { ...(prev || { po_id: d.po_id, eta_s: null, created_s: null }), supplier: d.supplier, lines: d.lines, status: 'received', short: d.short, received_s: ev.sim_s } } };
      }],

      'rest.inventory': ['inventory', (s, ev) => {
        const inventory = {};
        for (const r of ev.data.items || []) inventory[r.key] = { ...r };
        const { items, ...summary } = ev.data;
        return { inventory, rest: { ...s.rest, inventory_summary: summary } };
      }],
      'rest.usage': ['rest', (s, ev) => ({ rest: { ...s.rest, usage: { ...(s.rest.usage || {}), [ev.data.key]: ev.data } } })],
      'rest.lots': ['lots', (s, ev) => ({ lots: U.set(s.lots, ev.data.key, (ev.data.items || []).map((l) => ({ ...l }))) })],
      'rest.purchasing': ['rest', (s, ev) => ({ rest: { ...s.rest, purchasing: ev.data } })],
    },
  });

  function dropLot(s, d) {
    const rows = s.lots[d.key];
    if (!rows || !rows.some((l) => l.lot_id === d.lot_id)) return null;
    return { lots: U.set(s.lots, d.key, rows.filter((l) => l.lot_id !== d.lot_id)) };
  }
})();
