/* brew · night kitchen — event plumbing.
   The frontend only ever consumes backend.md §6.3-shaped events:
     frame  = { frame: n, events: [Event, …] }
     Event  = { seq, sim_s, t, type, data }
   A MockSource runs a tiny dinner-service sim in the browser and emits those frames on a
   50–100 ms cadence, exactly like the WebSocket would. Wiring the real backend later means
   swapping MockSource for WsSource (same `onFrame` contract, actions go to POST /actions). */

/* ------------------------------------------------------------------ */
/* bus                                                                 */
/* ------------------------------------------------------------------ */
const subs = new Map();
export const bus = {
  on(type, fn) { if (!subs.has(type)) subs.set(type, []); subs.get(type).push(fn); return () => subs.get(type).splice(subs.get(type).indexOf(fn), 1); },
  dispatch(evt) {
    for (const fn of subs.get(evt.type) || []) try { fn(evt.data, evt); } catch (e) { console.error(evt.type, e); }
    for (const fn of subs.get('*') || []) try { fn(evt.data, evt); } catch (e) { console.error(e); }
  },
};
export const deliver = (frame) => frame.events.forEach((e) => bus.dispatch(e));

/* ------------------------------------------------------------------ */
/* menu used by the night kitchen                                      */
/* SKUs marked `fe` are frontend-only for now (dinner plates for the    */
/* restaurant vibe) — they need adding to src/brew/config/menu.yaml.    */
/* ------------------------------------------------------------------ */
export const MENU = {
  ribeye: { name: 'Ribeye Steak', price: 890, station: 'grill', prep_s: 0, fe: true, player: true },
  margherita: { name: 'Margherita Pizza', price: 540, station: 'oven', prep_s: 260, fe: true },
  pasta: { name: 'Pasta Arrabbiata', price: 330, station: 'stove', prep_s: 300 },
  avotoast: { name: 'Avocado Toast', price: 380, station: 'press', prep_s: 200 },
  fries: { name: 'Fries', price: 160, station: 'fryer', prep_s: 150 },
  cheesecake: { name: 'Cheesecake', price: 290, station: 'display', prep_s: 40 },
  cappuccino: { name: 'Cappuccino', price: 220, station: 'espresso', prep_s: 90 },
  icedlatte: { name: 'Iced Latte', price: 260, station: 'espresso', prep_s: 80 },
  coldbrew: { name: 'Cold Brew', price: 250, station: 'cold', prep_s: 30 },
  matcha: { name: 'Iced Matcha', price: 290, station: 'bar', prep_s: 90 },
};
const PLATES = ['ribeye', 'ribeye', 'margherita', 'pasta', 'avotoast', 'ribeye', 'fries'];
const DRINKS = ['cappuccino', 'icedlatte', 'coldbrew', 'matcha', 'cheesecake'];
const NAMES = ['Riya', 'Arjun', 'Meera', 'Kabir', 'Zoya', 'Dev', 'Ananya', 'Ishaan', 'Tara', 'Neel', 'Sana', 'Omar', 'Leah', 'Kavya'];

/* ------------------------------------------------------------------ */
/* mock source                                                         */
/* ------------------------------------------------------------------ */
export class MockSource {
  constructor({ speed = 6, startHHMM = 20 * 60 + 38, day = 3, seed = 7 } = {}) {
    this.speed = speed;           // sim seconds per real second
    this.sim_s = 0;
    this.seq = 0;
    this.frameNo = 0;
    this.day = day;
    this.start = startHHMM * 60;  // seconds since midnight at sim_s = 0
    this.out = [];
    this.handlers = [];
    this.orders = new Map();
    this.nextOrderNo = 12;
    this.nextArrival = 4;
    this.lastMinute = -1;
    this.nextKpi = 0;
    this.cash = 4280;
    this.revenue = 18650;
    this.served = 41;
    this.rating = 4.6;
    this.ratingN = 312;
    this.replate = [];
    this.r = seed;
  }
  rand() { this.r = (this.r * 16807) % 2147483647; return this.r / 2147483647; }
  pick(a) { return a[Math.floor(this.rand() * a.length)]; }
  onFrame(fn) { this.handlers.push(fn); }
  emit(type, data) { this.out.push({ seq: ++this.seq, sim_s: Math.round(this.sim_s * 10) / 10, t: new Date().toISOString(), type, data }); }
  clock() { const s = this.start + this.sim_s; return { hh: Math.floor(s / 3600) % 24, mm: Math.floor((s % 3600) / 60), s }; }

  run() {
    let last = performance.now();
    this.boot();
    this.timer = setInterval(() => {
      const now = performance.now();
      this.step(Math.min(0.5, (now - last) / 1000) * this.speed);
      last = now;
      this.flush();
    }, 80);
  }
  stop() { clearInterval(this.timer); }
  flush() {
    if (!this.out.length) return;
    const frame = { frame: ++this.frameNo, events: this.out.splice(0) };
    this.handlers.forEach((h) => h(frame));
  }
  /** advance the sim by `dt` sim seconds (also used by the dev fast-forward) */
  advance(simSec, dt = 1) { for (let t = 0; t < simSec; t += dt) this.step(dt); this.flush(); }

  /* the opening state: a service already under way */
  boot() {
    this.emit('day.started', { day: this.day, summary: null });
    this.emit('weather.changed', { state: 'clear', temp_c: 24, rain_mm_h: 0 });
    [['croissant', 4, 30], ['cheesecake', 2, 20], ['avotoast', 1, 25]].forEach(([sku, units, pct], i) => {
      const l = { listing_id: 'rp' + (i + 1), sku, lot_id: 'lot' + (40 + i), units, made_at_s: -3600 * (2 + i), use_by_s: 3600 * (1.5 + i), discount_pct: pct, price: Math.round((MENU[sku]?.price || 180) * (1 - pct / 100)) };
      this.replate.push(l);
      this.emit('replate.listed', l);
    });
    // three tickets already on the rail
    this.placeOrder(['margherita', 'icedlatte', 'ribeye'], -135);
    this.placeOrder(['pasta', 'coldbrew'], -118);
    this.placeOrder(['avotoast', 'cappuccino'], -100);
    this.placeOrder(['ribeye', 'matcha'], -78);
    this.kpi();
  }

  placeOrder(skus, ageS = 0) {
    const order_no = this.nextOrderNo++;
    const items = skus.map((sku) => ({ sku, qty: 1, mods: [], unit_price: MENU[sku].price }));
    const o = {
      order_no, order_id: 'o' + order_no, placed_s: this.sim_s + ageS, promised_s: this.sim_s + ageS + 900,
      items: items.map((it) => ({ ...it, progress: 0, done: false, player: !!MENU[it.sku].player })), state: 'queued', progress: 0,
    };
    this.orders.set(order_no, o);
    this.emit('order.placed', { order_no, order_id: o.order_id, channel: 'dine', party_id: 'p' + order_no, persona: 'leisurely', name: this.pick(NAMES), items, note: null, note_flags: [], promised_s: o.promised_s, priority: 0, placed_s: o.placed_s });
    this.emit('order.accepted', { order_no, promised_s: o.promised_s });
    return o;
  }

  step(dt) {
    this.sim_s += dt;
    const c = this.clock();
    const minute = Math.floor(c.s / 60);
    if (minute !== this.lastMinute) {
      this.lastMinute = minute;
      this.emit('clock.tick', { day: this.day, hhmm: `${String(c.hh).padStart(2, '0')}:${String(c.mm).padStart(2, '0')}`, weekday: 'Fri', speed: this.speed });
    }
    // arrivals: keep the rail busy but not swamped
    this.nextArrival -= dt;
    const open = [...this.orders.values()].filter((o) => o.state !== 'served');
    if (this.nextArrival <= 0) {
      if (open.length < 6) {
        const n = this.rand() < 0.55 ? 2 : this.rand() < 0.5 ? 1 : 3;
        const skus = [this.pick(PLATES)];
        while (skus.length < n) skus.push(this.pick(this.rand() < 0.7 ? DRINKS : PLATES));
        this.placeOrder(skus);
      }
      this.nextArrival = 70 + this.rand() * 90;
    }
    // the team cooks everything except what the player owns (the grill)
    for (const o of open) {
      let changed = false;
      for (const it of o.items) {
        if (it.done || it.player) continue;
        const prep = MENU[it.sku].prep_s || 60;
        const waitedEnough = this.sim_s - o.placed_s > 6;
        if (!waitedEnough) continue;
        it.progress = Math.min(1, it.progress + dt / prep);
        if (it.progress >= 1) { it.done = true; changed = true; }
      }
      const prog = o.items.reduce((s, it) => s + (it.done ? 1 : it.progress), 0) / o.items.length;
      const step = Math.floor(prog * 20);
      if (step !== Math.floor(o.progress * 20) || changed) {
        o.progress = prog;
        const state = o.items.every((it) => it.done) ? 'ready' : prog > 0.7 ? 'almost' : prog > 0 ? 'brewing' : 'queued';
        this.emit('order.progress', { order_no: o.order_no, state, progress: Math.round(prog * 100) / 100, ahead: open.indexOf(o), items: o.items.map((it) => ({ sku: it.sku, done: it.done, progress: Math.round(it.progress * 100) / 100 })) });
      }
      if (o.state !== 'ready' && o.items.every((it) => it.done)) {
        o.state = 'ready';
        o.ready_s = this.sim_s;
        this.emit('order.ready', { order_no: o.order_no, ready_s: this.sim_s });
      } else if (o.state === 'queued' && o.progress > 0) o.state = 'cooking';
      // a runner takes ready plates out after a short while
      if (o.state === 'ready' && this.sim_s - o.ready_s > 45) this.serve(o.order_no, 'runner');
    }
    // Replate: a rescued sale now and then; deeper markdowns as use-by approaches
    if (this.rand() < dt / 240 && this.replate.length) {
      const l = this.pick(this.replate);
      l.units -= 1;
      this.revenue += l.price; this.cash += l.price;
      this.emit('replate.sold', { listing_id: l.listing_id, order_no: null, units: 1, price: l.price });
      if (l.units <= 0) { this.replate.splice(this.replate.indexOf(l), 1); this.emit('replate.retired', { listing_id: l.listing_id, units: 0, outcome: 'sold_out' }); }
    }
    if (this.rand() < dt / 600 && this.replate.length) {
      const l = this.pick(this.replate);
      if (l.discount_pct < 50) {
        l.discount_pct += 10;
        l.price = Math.round((MENU[l.sku]?.price || 180) * (1 - l.discount_pct / 100));
        this.emit('replate.marked_down', { ...l });
      }
    }
    this.nextKpi -= dt;
    if (this.nextKpi <= 0) { this.kpi(); this.nextKpi = 300; }
  }

  kpi() {
    const open = [...this.orders.values()].filter((o) => o.state !== 'served');
    this.emit('kpi.tick', { cash: this.cash, revenue_today: this.revenue, profit_today: Math.round(this.revenue * 0.31), rating: this.rating, rating_n: this.ratingN, load_pct: Math.min(100, open.length * 16), open_orders: open.length, walkouts_today: 0 });
  }

  serve(order_no, by = 'player') {
    const o = this.orders.get(order_no);
    if (!o || o.state === 'served') return;
    o.state = 'served';
    const total = o.items.reduce((s, it) => s + it.unit_price * it.qty, 0);
    const late = this.sim_s > o.promised_s;
    this.served += 1;
    this.revenue += total;
    this.cash += total;
    this.emit('order.served', { order_no, by, ticket_s: Math.round(this.sim_s - o.placed_s) });
    this.emit('payment.received', { order_no, amount: total, method: this.rand() < 0.7 ? 'upi' : 'card' });
    if (this.rand() < 0.35) {
      const stars = late ? 3 : this.rand() < 0.8 ? 5 : 4;
      this.ratingN += 1;
      this.rating = Math.round(((this.rating * (this.ratingN - 1) + stars) / this.ratingN) * 100) / 100;
      this.emit('review.posted', { review_id: 'r' + this.seq, order_no, stars, text: stars === 5 ? 'Perfect sear.' : 'Lovely, a bit slow.', causes: late ? { wait: 1 } : {} });
    }
    this.kpi();
  }

  /* ---------- actions (the shape POST /worlds/{id}/actions will take) ---------- */
  act(a) {
    const o = this.orders.get(a.order_no);
    if (a.type === 'item.progress' && o) {
      const it = o.items.find((x) => x.sku === a.sku && !x.done);
      if (it) { it.progress = a.progress; if (a.progress >= 1) it.done = true; }
    } else if (a.type === 'order.serve' && o && o.state === 'ready') this.serve(a.order_no, 'player');
    this.step(0);
    this.flush();
  }
}
