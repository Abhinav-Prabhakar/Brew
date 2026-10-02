/* brew · props.js — room furniture, the pastry fridge, delivery bags & riders */
(function () {
  const B = window.B, A = B.art;
  const room = () => B.$('#room');

  /* =================== room furniture =================== */
  const TABLES = [
    { id: 'T1', x: 330, y: 592, pair: 'T2', mx: 366 },
    { id: 'T2', x: 492, y: 592, pair: 'T1', mx: 458 },
    { id: 'T3', x: 250, y: 500 },
    { id: 'T4', x: 560, y: 506 },
    { id: 'T5', x: 805, y: 500 },
    { id: 'T6', x: 1035, y: 512 },
  ];

  function placeEnt(el, x, y, w, h) { B.place(el, x, y, w, h); }

  function buildTable(t) {
    t.el = B.h(`<div class="tbl-wrap ent">${A.table()}<div class="tbl-items"></div></div>`);
    t.items = t.el.querySelector('.tbl-items');
    room().appendChild(t.el);
    t.chairs = [-1, 1].map((side) => {
      const c = B.h(`<div class="chr-wrap ent">${A.chair(side > 0)}</div>`);
      room().appendChild(c);
      return { el: c, side };
    });
    t.seats = [{ side: -1, who: null }, { side: 1, who: null }];
    t.cx = t.x;
    layoutTable(t);
  }
  function seatPos(t, side) {
    const s = B.proj(t.y);
    return { x: t.cx + side * 54 * s, y: t.y - 8 };
  }
  function layoutTable(t) {
    placeEnt(t.el, t.cx, t.y, 120, 112);
    t.chairs.forEach((c) => {
      const p = seatPos(t, c.side);
      placeEnt(c.el, p.x, p.y - 1, 70, 122);
    });
  }

  function buildDecor() {
    // corner monstera by the door
    const plant = B.h(`<div class="plant-wrap ent" style="width:150px;height:230px"><svg viewBox="0 0 150 230" overflow="visible">
      <ellipse cx="75" cy="226" rx="44" ry="7" fill="#5c2a3a" opacity=".16"/>
      <path d="M44 170 L106 170 L98 226 L52 226Z" fill="#f2a3b8"/><path d="M44 170 L106 170 L105 180 L45 180Z" fill="#e48aa3"/><path d="M52 180 L58 226" stroke="#fff" stroke-width="3" opacity=".35"/>
      <g stroke="#3f6e46" stroke-width="2.4" fill="none"><path d="M75 172 C70 130 50 100 32 80"/><path d="M75 172 C80 120 96 80 112 58"/><path d="M75 172 C74 140 76 100 70 40"/><path d="M75 172 C86 150 116 130 136 120"/><path d="M75 172 C62 156 30 146 12 140"/></g>
      ${[[30, 76, -40, 1.1], [112, 54, 30, 1.2], [68, 36, -5, 1.25], [134, 118, 60, 0.95], [14, 136, -70, 0.9]].map(([x, y, r, s]) => `<g transform="translate(${x} ${y}) rotate(${r}) scale(${s})"><path d="M0 22 C-26 18 -30 -10 -10 -24 C-4 -28 4 -28 10 -24 C30 -10 26 18 0 22Z" fill="#4f8a5a"/><path d="M0 22 C-26 18 -30 -10 -10 -24 C-4 -28 4 -28 10 -24 C30 -10 26 18 0 22Z" fill="url(#shadeBody)"/><path d="M0 20 V-24" stroke="#3a6e44" stroke-width="1.4"/><g stroke="#f9dbe1" stroke-width="2.6"><path d="M-22 -2 L-8 0"/><path d="M-20 10 L-6 8"/><path d="M22 -2 L8 0"/><path d="M20 10 L6 8"/></g></g>`).join('')}
    </svg></div>`);
    room().appendChild(plant);
    placeEnt(plant, 1540, 462, 150, 230);

    // small fiddle-leaf on the left
    const p2 = B.h(`<div class="plant-wrap ent" style="width:90px;height:200px"><svg viewBox="0 0 90 200" overflow="visible">
      <ellipse cx="45" cy="197" rx="28" ry="5" fill="#5c2a3a" opacity=".16"/>
      <path d="M26 156 L64 156 L60 196 L30 196Z" fill="#fff" stroke="#e8c3cc" stroke-width="1.5"/>
      <path d="M45 156 L45 30" stroke="#6d4a3a" stroke-width="3"/>
      ${[[45, 26, 0], [32, 50, -40], [58, 60, 40], [30, 86, -50], [60, 96, 45], [36, 120, -40], [56, 130, 40]].map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="12" ry="17" fill="#5c9a62" transform="rotate(${r} ${x} ${y})"/><path d="M${x} ${y - 14} L${x} ${y + 14}" stroke="#447a50" stroke-width="1" transform="rotate(${r} ${x} ${y})"/>`).join('')}
    </svg></div>`);
    room().appendChild(p2);
    placeEnt(p2, 40, 470, 90, 200);

    // A-frame chalkboard
    const af = B.h(`<div class="plant-wrap ent" style="width:80px;height:110px"><svg viewBox="0 0 80 110" overflow="visible">
      <ellipse cx="40" cy="107" rx="34" ry="4" fill="#5c2a3a" opacity=".16"/>
      <path d="M12 106 L28 4 L52 4 L68 106" stroke="#c99a6b" stroke-width="5" fill="none" stroke-linecap="round"/>
      <rect x="18" y="14" width="44" height="74" rx="3" fill="#2f2a2e" stroke="#c99a6b" stroke-width="3"/>
      <text x="40" y="32" text-anchor="middle" font-family="Caveat" font-weight="700" font-size="11" fill="#fff">today</text>
      <text x="40" y="50" text-anchor="middle" font-family="Caveat" font-weight="700" font-size="12" fill="#f6a3b8">rose milk</text>
      <text x="40" y="64" text-anchor="middle" font-family="Caveat" font-size="10" fill="#fff">+ cheesecake</text>
      <text x="40" y="80" text-anchor="middle" font-family="Caveat" font-size="12" fill="#ffd36b">♥ ♥ ♥</text>
    </svg></div>`);
    room().appendChild(af);
    placeEnt(af, 1270, 478, 80, 110);

    // the cafe cat, asleep-ish on the window sill
    const cat = B.h(`<div class="plant-wrap" style="width:64px;height:44px;z-index:1"><svg viewBox="0 0 64 44" overflow="visible">
      <ellipse cx="34" cy="42" rx="26" ry="3" fill="#5c2a3a" opacity=".18"/>
      <path class="cat-tail" d="M54 38 C66 36 66 22 58 18" stroke="#f0a35e" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M12 40 C8 24 18 14 34 14 C50 14 58 24 56 40Z" fill="#f4b06c"/>
      <path d="M20 22 C26 18 30 26 34 20 M40 20 C44 26 48 18 52 24" stroke="#d9873f" stroke-width="2.2" fill="none"/>
      <path d="M16 40 C16 32 24 30 30 34 C32 38 30 40 28 40Z" fill="#fff6ee"/>
      <g><circle cx="16" cy="20" r="11" fill="#f4b06c"/><path d="M7 14 L8 3 L15 10Z" fill="#f4b06c"/><path d="M19 10 L25 3 L26 14Z" fill="#f4b06c"/><path d="M9 12 L9.6 6 L13 10Z" fill="#f6b3c4"/>
      <path d="M10 21 Q12 23 14 21 M18 21 Q20 23 22 21" stroke="#5a3a2a" stroke-width="1.2" fill="none" stroke-linecap="round"/><ellipse cx="16" cy="24.6" rx="1.4" ry="1" fill="#e46d8d"/><path d="M8 26 L2 25 M8 27.5 L2 28.5 M24 26 L30 25 M24 27.5 L30 28.5" stroke="#fff" stroke-width=".7"/></g>
    </svg></div>`);
    room().appendChild(cat);
    gsap.set(cat, { x: 316, y: 300, zIndex: 1 });
    const tail = cat.querySelector('.cat-tail');
    gsap.to(tail, { rotation: 14, svgOrigin: '54 38', duration: 1.4, yoyo: true, repeat: -1, ease: 'sine.inOut', repeatDelay: 1.2 });
    cat.style.pointerEvents = 'auto';
    cat.addEventListener('click', () => {
      B.audio.play('pop');
      gsap.fromTo(cat, { y: 300 }, { y: 292, duration: 0.18, yoyo: true, repeat: 1 });
      B.toast('🐈', 'Biscuit the cafe cat', 'Mrrp. (Biscuit approves of your service.)');
    });
  }

  B.room = {
    tables: TABLES,
    init() {
      TABLES.forEach(buildTable);
      buildDecor();
    },
    seatPos,
    /** find seats for a party of n; returns {tables, seats:[{table, side|pos}]} or null */
    claim(n, who) {
      if (n <= 2) {
        const free = TABLES.filter((t) => !t.merged && t.seats.every((s) => !s.who));
        if (!free.length) {
          // a solo guest may share a half-empty table
          if (n === 1) {
            const half = TABLES.filter((t) => !t.merged && t.seats.some((s) => !s.who) && !t.laptop);
            if (half.length) {
              const t = B.pick(half), s = t.seats.find((x) => !x.who);
              s.who = who;
              return { tables: [t], seats: [{ table: t, side: s.side, ...seatPos(t, s.side) }] };
            }
          }
          return null;
        }
        const t = B.pick(free);
        const order = Math.random() < 0.5 ? [-1, 1] : [1, -1];
        const seats = order.slice(0, n).map((side) => {
          t.seats.find((s) => s.side === side).who = who;
          return { table: t, side, ...seatPos(t, side) };
        });
        return { tables: [t], seats };
      }
      // groups of 3-4 push T1 + T2 together
      const a = TABLES[0], b = TABLES[1];
      if ([a, b].some((t) => t.seats.some((s) => s.who))) return null;
      [a, b].forEach((t) => t.seats.forEach((s) => (s.who = who)));
      return { tables: [a, b], merge: true, seats: null };
    },
    canSeat(n) {
      if (n <= 2) return TABLES.some((t) => !t.merged && t.seats.every((s) => !s.who)) || (n === 1 && TABLES.some((t) => !t.merged && !t.laptop && t.seats.some((s) => !s.who)));
      return [TABLES[0], TABLES[1]].every((t) => t.seats.every((s) => !s.who));
    },
    merge() {
      const a = TABLES[0], b = TABLES[1];
      a.merged = b.merged = true;
      B.audio.play('scrape');
      return new Promise((res) => {
        [a, b].forEach((t) => {
          const o = { x: t.cx };
          B.tw(o, { x: t.mx, duration: 0.9, ease: 'power2.inOut', onUpdate: () => { t.cx = o.x; layoutTable(t); }, onComplete: res });
        });
        // chairs: outer chairs stay at the ends, inner chairs move behind the joined tables
        B.after(0.95, res);
      }).then(() => {
        const s = B.proj(a.y);
        return [
          { x: a.mx - 54 * s, y: a.y - 8 },
          { x: b.mx + 54 * s, y: b.y - 8 },
          { x: a.mx + 10, y: a.y - 40, back: true },
          { x: b.mx - 10, y: b.y - 40, back: true },
        ];
      });
    },
    unmerge() {
      const a = TABLES[0], b = TABLES[1];
      [a, b].forEach((t) => {
        const o = { x: t.cx };
        B.tw(o, { x: t.x, duration: 0.9, ease: 'power2.inOut', onUpdate: () => { t.cx = o.x; layoutTable(t); }, onComplete: () => { t.merged = false; } });
        t.chairs.forEach((c) => gsap.to(c.el, { opacity: 1, duration: 0.4 }));
      });
      B.audio.play('scrape');
    },
    release(claim, who) {
      claim.tables.forEach((t) => t.seats.forEach((s) => { if (s.who === who || claim.merge) s.who = null; }));
      if (claim.merge) B.room.unmerge();
    },
    /** dishes on a table, keyed so they can be eaten/cleared */
    dish(t, id, offsetX) {
      const el = B.h(`<div style="position:absolute;left:${48 + offsetX}px;top:2px;width:30px;height:18px">${A.dish(id, 0)}</div>`);
      el.firstElementChild.style.width = '100%';
      el.firstElementChild.style.height = '100%';
      t.items.appendChild(el);
      gsap.from(el, { y: -12, opacity: 0, duration: 0.35, ease: 'back.out(2)' });
      return el;
    },
  };

  /* =================== pastry fridge =================== */
  const STOCK0 = { cheesecake: 5, croissant: 8, muffin: 6, cinnamon: 6, coldbrew: 10 };
  const SHELVES = [['cheesecake', 'cheesecake', 'cheesecake', 'cheesecake'], ['croissant', 'croissant', 'muffin', 'muffin'], ['cinnamon', 'cinnamon', 'coldbrew', 'coldbrew']];
  const bare = (id) => A.foodBare(id);
  const fridge = {
    stock: { ...STOCK0 },
    open: false,
    build() {
      const inside = B.$('#fridge-inside');
      inside.innerHTML = '';
      SHELVES.forEach((row, r) => {
        const sh = B.h(`<div class="fr-shelf" style="top:${r * 72}px"></div>`);
        row.forEach((id, i) => {
          const it = B.h(`<div class="fr-item" data-id="${id}" style="left:${4 + i * 41}px">${bare(id)}</div>`);
          sh.appendChild(it);
        });
        const ids = [...new Set(row)];
        ids.forEach((id, j) => sh.appendChild(B.h(`<span class="fr-tag" data-tag="${id}" style="${ids.length > 1 ? `right:${j === 0 ? 92 : 4}px` : ''}"></span>`)));
        inside.appendChild(sh);
      });
      this.sync();
    },
    sync() {
      Object.keys(this.stock).forEach((id) => {
        const n = this.stock[id];
        const els = B.$$(`.fr-item[data-id="${id}"]`, B.$('#fridge-inside'));
        els.forEach((e, i) => e.classList.toggle('gone', i >= n));
        B.$$(`[data-tag="${id}"]`).forEach((t) => {
          t.textContent = n ? `×${n}` : 'OUT';
          t.classList.toggle('low', n <= 1);
        });
      });
    },
    has(id) { return this.stock[id] == null || this.stock[id] > 0; },
    take(id) {
      if (this.stock[id] == null) return true;
      if (this.stock[id] <= 0) return false;
      this.stock[id]--;
      if (!this.open && B.state.speed < 10) this.peek();
      this.sync();
      B.emit('stock', id, this.stock[id]);
      return true;
    },
    restock() {
      let cost = 0;
      Object.keys(STOCK0).forEach((id) => {
        const add = STOCK0[id] - this.stock[id];
        if (add > 0) cost += add * Math.round(B.ITEM[id].base * 0.32);
        this.stock[id] = STOCK0[id];
      });
      this.sync();
      Object.keys(STOCK0).forEach((id) => B.emit('stock', id, this.stock[id]));
      return cost;
    },
    toggle(force) {
      this.open = force != null ? force : !this.open;
      B.$('#fridge').classList.toggle('open', this.open);
      B.audio.play(this.open ? 'fridgeOpen' : 'fridgeClose');
      if (this.open) gsap.fromTo('.fr-mist', { opacity: 0.85, y: 0, scale: 0.8 }, { opacity: 0, y: -40, scale: 1.3, duration: 1.6, ease: 'power2.out' });
    },
    peek() {
      if (this._peek) return;
      this._peek = true;
      this.toggle(true);
      setTimeout(() => { this.toggle(false); this._peek = false; }, 900);
    },
  };
  B.fridge = fridge;
  B.$('#fridge').addEventListener('click', () => {
    if (fridge._peek) return;
    fridge.toggle();
    if (fridge.open) {
      const low = Object.entries(fridge.stock).filter(([, n]) => n <= 2).map(([id]) => B.ITEM[id].name);
      if (low.length) {
        const cost = Object.keys(STOCK0).reduce((s, id) => s + Math.max(0, STOCK0[id] - fridge.stock[id]) * Math.round(B.ITEM[id].base * 0.32), 0);
        B.toast('🧁', 'Running low', `${low.join(', ')}. Tap the fridge again within 3s to restock (−${B.inr(cost)}).`);
        fridge._restockOffer = performance.now();
      }
    } else if (fridge._restockOffer && performance.now() - fridge._restockOffer < 3500) {
      fridge._restockOffer = 0;
      const cost = fridge.restock();
      B.game.spend(cost, 'Bakery restock');
      B.toast('🥐', 'Fridge restocked', `Fresh trays from the bakery · −${B.inr(cost)}`);
    }
  });

  /* =================== delivery bags & riders =================== */
  const bags = [];
  const CH = { zomato: { color: '#d23434', label: 'ZOMATO' }, swiggy: { color: '#ec7716', label: 'SWIGGY' } };
  B.CHANNELS = CH;

  function addBag(t) {
    const el = B.h(`<div class="bag-wrap">
      <div class="bag-steam"><i></i><i></i><i></i></div>
      ${A.bag(B.rand(-14, 6))}
      <div class="bag-tag" style="--c:${CH[t.channel].color}"><b>#${t.no}</b><span class="eta"></span><br><span class="q">Q 100%</span></div>
    </div>`);
    B.$('#bags').appendChild(el);
    const b = { t, el, readyAt: B.state.t, q: 1, ui: { eta: el.querySelector('.eta'), q: el.querySelector('.q'), tag: el.querySelector('.bag-tag') } };
    bags.push(b);
    gsap.fromTo(el, { y: -120, rotation: -10, opacity: 0 }, { y: 0, rotation: 0, opacity: 1, duration: 0.6, ease: 'bounce.out' });
    B.audio.play('rustle', 1460);
    B.after(0.5, () => B.audio.play('thud', 1460));
    refreshBag(b);
    return b;
  }
  function refreshBag(b) {
    const rem = b.t.riderAt - B.state.t;
    const txt = b.rider ? ' HERE' : rem > 0 ? ` ${Math.ceil(rem / B.SEC_PER_MIN)}m` : ' soon';
    b.ui.eta.textContent = txt;
    const age = B.state.t - b.readyAt;
    b.q = B.clamp(1 - Math.max(0, age - 20) / 90, 0.4, 1);
    b.ui.q.textContent = `Q ${Math.round(b.q * 100)}%`;
    b.ui.tag.classList.toggle('stale', b.q < 0.75);
    b.el.style.setProperty('--q', Math.max(0, (b.q - 0.45) / 0.55).toFixed(2));
  }

  function rider(t) {
    const ch = CH[t.channel];
    const el = B.h(`<div class="rider-wrap ent">${A.rider(ch.color)}</div>`);
    room().appendChild(el);
    const r = { t, el, x: 1405, y: 446 };
    t.rider = r;
    gsap.set(el, { opacity: 0 });
    B.place(el, r.x, r.y, 100, 220);
    B.scene.door(1405);
    B.tw(el, { opacity: 1, duration: 0.4 });
    walk(r, 1470, 700, () => {
      r.arrived = true;
      tryPickup(t);
    });
  }
  function walk(r, x, y, done) {
    const o = { x: r.x, y: r.y };
    const d = Math.hypot(x - r.x, y - r.y);
    const bob = B.tw(r.el.firstElementChild, { y: -4, duration: 0.18, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    B.tw(o, {
      x, y, duration: d / 150, ease: 'none',
      onUpdate: () => { r.x = o.x; r.y = o.y; B.place(r.el, r.x, r.y, 100, 220); },
      onComplete: () => { bob.kill(); gsap.set(r.el.firstElementChild, { y: 0 }); done && done(); },
    });
  }
  function tryPickup(t) {
    const b = bags.find((x) => x.t === t);
    const r = t.rider;
    if (!b || !r || !r.arrived || b.leaving) return;
    b.rider = r;
    b.leaving = true;
    refreshBag(b);
    B.after(0.6, () => {
      // the bag lifts toward the rider's hand, then the rider heads out
      const bagEl = b.el;
      B.tw(bagEl, { y: -70, x: 10, rotation: 8, duration: 0.45, ease: 'power2.out' });
      B.tw(bagEl, { opacity: 0, duration: 0.4, delay: 0.3 });
      B.audio.play('rustle', 1460);
      B.after(0.75, () => {
        bagEl.remove();
        bags.splice(bags.indexOf(b), 1);
        B.emit('bag:picked', t, b.q);
        walk(r, 1405, 446, () => {
          B.scene.door(1405);
          B.tw(r.el, { opacity: 0, duration: 0.35, onComplete: () => r.el.remove() });
          B.audio.play('scooter', 1405);
          B.scene.scooterAway(CH[t.channel].color);
        });
      });
    });
  }

  B.delivery = {
    addBag,
    rider,
    tryPickup,
    tick() { bags.forEach(refreshBag); },
    get bags() { return bags; },
  };
})();
