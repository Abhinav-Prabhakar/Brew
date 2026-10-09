/* brew — the menu book.
   Click the lectern book in the lobby (or the "menu" tab): the book flies off its stand, grows to fill the view and
   opens. Turn pages (buttons, ← →, click the page edge, swipe) to see every price updating live.

   Spreads: coffee | not coffee · bakes | plates · meal combos | rescue shelf
   - meal combos: two-item bundles priced off the components' LIVE prices (backend.md 3.12) — the up-spend
   - rescue shelf: Replate listings (backend.md 3.11) — pre-made food about to be thrown away, heavily discounted

   Data: window.BREW_MENU (generated from configs/cafe by scripts/export_menu.py) + a live feed with the backend's
   event shapes (backend.md 6.3: price.changed, replate.listed / marked_down / sold / retired). LiveFeed below is a
   MOCK that emits those events; the backend integration replaces it with the WebSocket stream (same `on(type, fn)`
   contract) — nothing else in this file needs to change. */
(() => {
  const DATA = window.BREW_MENU;
  if (!DATA) { console.warn('menu: window.BREW_MENU missing (design/data/menu.js)'); return; }
  const viewport = document.getElementById('viewport');
  const $ = (s, r = document) => r.querySelector(s);
  const rs = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------------ live state */
  const ITEMS = Object.fromEntries(DATA.menu.map((m) => [m.sku, { ...m, base: m.price, dir: null, note: '' }]));
  const ROUND = DATA.combo_round_to || 5;
  const comboList = (c) => c.skus.reduce((s, k) => s + ITEMS[k].price, 0);
  const comboPrice = (c) => Math.min(comboList(c) - 1, Math.round((comboList(c) * (1 - c.discount_pct / 100)) / ROUND) * ROUND);
  const COMBOS = DATA.combos.map((c) => ({ ...c, price: 0, dir: null }));
  COMBOS.forEach((c) => (c.price = comboPrice(c)));
  const RESCUE = new Map(); // listing_id -> listing

  /* ------------------------------------------------------------------ event bus (WS-compatible) */
  const subs = {};
  const live = (window.BREW_LIVE = window.BREW_LIVE || {
    on(type, fn) { (subs[type] = subs[type] || []).push(fn); },
    emit(type, data) { (subs[type] || []).forEach((f) => f(data)); (subs['*'] || []).forEach((f) => f(type, data)); },
  });

  /* ------------------------------------------------------------------ MOCK live feed (replace with WS) */
  const REASONS_UP = ['kitchen 92% · 34°C', 'demand ▲ · lunch rush', 'iced drinks trending', 'rain → delivery surge', 'oat milk running low'];
  const REASONS_DN = ['slow hour · nudge', 'student hour', 'pairs with combo', 'quiet afternoon', 'clear the pastry case'];
  const nowHM = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const hm = (m) => { m = ((Math.round(m) % 1440) + 1440) % 1440; const h = Math.floor(m / 60), mm = m % 60; return `${h % 12 || 12}:${String(mm).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
  let lid = 0;
  const mock = {
    reprice() {
      const pool = DATA.menu.filter((m) => !m.staple || Math.random() < 0.3);
      const m = ITEMS[pool[Math.floor(Math.random() * pool.length)].sku];
      const up = m.staple ? false : Math.random() < 0.5;
      const step = Math.max(5, Math.round((m.base * (0.04 + Math.random() * 0.05)) / 5) * 5);
      const next = Math.max(m.min, Math.min(m.max, m.price + (up ? step : -step)));
      if (next === m.price) return;
      live.emit('price.changed', { sku: m.sku, old: m.price, new: next, base: m.base, dir: next > m.price ? 'up' : 'down',
        reason_text: (next > m.price ? REASONS_UP : REASONS_DN)[Math.floor(Math.random() * 5)], by: 'policy D' });
    },
    list() {
      const elig = DATA.menu.filter((m) => m.replate_eligible && ![...RESCUE.values()].some((l) => l.sku === m.sku));
      if (!elig.length || RESCUE.size >= 5) return;
      const m = elig[Math.floor(Math.random() * elig.length)];
      const made = nowHM() - 60 - Math.floor(Math.random() * 300), useBy = nowHM() + 40 + Math.floor(Math.random() * 150);
      const d = [30, 30, 50][Math.floor(Math.random() * 3)];
      live.emit('replate.listed', { listing_id: 'L' + ++lid, sku: m.sku, lot_id: 'lot' + lid, units: 1 + Math.floor(Math.random() * 4),
        made_at_min: made, use_by_min: useBy, discount_pct: d, price: Math.max(5, Math.round((ITEMS[m.sku].price * (1 - d / 100)) / 5) * 5) });
    },
    tick() {
      for (const l of RESCUE.values()) {
        const r = Math.random();
        if (r < 0.25 && l.units > 0) live.emit('replate.sold', { listing_id: l.listing_id, units: 1, price: l.price });
        else if (r < 0.45 && l.discount_pct < 70) {
          const d = Math.min(70, l.discount_pct + 20);
          live.emit('replate.marked_down', { ...l, discount_pct: d, price: Math.max(5, Math.round((ITEMS[l.sku].price * (1 - d / 100)) / 5) * 5) });
        } else if (r > 0.93) live.emit('replate.retired', { listing_id: l.listing_id, units: l.units, outcome: ITEMS[l.sku].cat === 'bakes' ? 'donated' : 'wasted' });
      }
    },
    start() {
      for (let i = 0; i < 3; i++) this.list();
      setInterval(() => this.reprice(), 5200);
      setInterval(() => this.list(), 14000);
      setInterval(() => this.tick(), 6500);
    },
  };

  /* ------------------------------------------------------------------ state reducers */
  live.on('price.changed', (e) => {
    if (e.sku.startsWith('combo:')) return; // combos are derived locally from their components
    const m = ITEMS[e.sku]; if (!m) return;
    m.price = e.new; m.dir = e.dir; m.note = e.reason_text;
    paintPrice(`[data-sku="${e.sku}"]`, e.old, e.new, e.dir, e.reason_text);
    for (const c of COMBOS) {
      if (!c.skus.includes(e.sku)) continue;
      const old = c.price; c.price = comboPrice(c); c.dir = c.price > old ? 'up' : 'down';
      if (c.price !== old) paintPrice(`[data-combo="${c.id}"]`, old, c.price, c.dir, `${m.name.toLowerCase()} repriced`);
      paintSaving(c);
    }
    lectern(e.sku);
  });
  live.on('replate.listed', (e) => { RESCUE.set(e.listing_id, { ...e }); renderRescue(e.listing_id, 'in'); });
  live.on('replate.marked_down', (e) => {
    const l = RESCUE.get(e.listing_id); if (!l) return;
    const old = l.price; Object.assign(l, { discount_pct: e.discount_pct, price: e.price });
    paintPrice(`[data-listing="${l.listing_id}"]`, old, l.price, 'down', `marked down · −${l.discount_pct}%`);
    const st = $(`[data-listing="${l.listing_id}"] .stamp`, book); if (st) { st.textContent = `−${l.discount_pct}%`; bump(st); }
  });
  live.on('replate.sold', (e) => {
    const l = RESCUE.get(e.listing_id); if (!l) return;
    l.units = Math.max(0, l.units - (e.units || 1));
    const u = $(`[data-listing="${l.listing_id}"] .units`, book); if (u) { u.textContent = `×${l.units} left`; bump(u); }
    if (l.units === 0) live.emit('replate.retired', { listing_id: l.listing_id, units: 0, outcome: 'sold_out' });
  });
  live.on('replate.retired', (e) => {
    const l = RESCUE.get(e.listing_id); if (!l) return;
    RESCUE.delete(e.listing_id);
    const row = $(`[data-listing="${e.listing_id}"]`, book);
    if (!row) return;
    row.querySelector('.gone').textContent = { sold_out: 'all rescued ♡', donated: 'donated ♡', wasted: 'composted' }[e.outcome] || 'gone';
    row.classList.add('out');
    setTimeout(() => { row.remove(); emptyRescue(); }, reduced ? 0 : 1400);
  });

  /* ------------------------------------------------------------------ pages */
  const ICON = { cappuccino: 'latte', latte: 'latte', flatwhite: 'latte', roselatte: 'latte', espresso: 'k-cup', filtercoffee: 'k-cup',
    icedlatte: 'coldbrew', coldbrew: 'coldbrew', matcha: 'matcha', chai: 'k-cup', hotchoc: 'k-cup', rosemilk: 'k-smoothie',
    strawberryshake: 'k-smoothie', croissant: 'croissant', cinnamon: 'croissant', muffin: 'cake', cheesecake: 'cake', waffle: 'toast',
    avotoast: 'k-avo', sandwich: 'k-panini', cheesetoast: 'toast', fries: 'k-fries', pasta: 'p-plate' };
  const ico = (sku, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 60 60" aria-hidden="true"><use href="#${ICON[sku] || 'p-plate'}"/></svg>`;
  const priceTag = (n) => `<span class="pr"><span class="old"><span class="ot"></span><svg class="strike" viewBox="0 0 60 20" preserveAspectRatio="none" aria-hidden="true"><path d="M2 13 C18 9 38 12 58 6"/></svg></span><b class="now">${rs(n)}</b></span>`;
  const leaf = (k) => `<svg class="leaf" viewBox="0 0 14 14" aria-label="${k}"><path d="M2 12C2 5 6 2 12 2C12 8 9 12 2 12Z" fill="#cfe0bf" stroke="#1d1a1c" stroke-width="1.4"/></svg>`;

  function itemRow(m) {
    return `<li class="row" data-sku="${m.sku}">
      ${ico(m.sku)}
      <div class="nm"><b>${esc(m.name.toLowerCase())}${m.vegan ? leaf('vegan') : ''}${m.staple ? '<span class="staple" title="staple: never priced up">staple</span>' : ''}</b>
        <small>${esc(m.desc)}</small><em class="why"></em></div>
      <span class="dots"></span>${priceTag(m.price)}</li>`;
  }
  const PAGES = [
    { title: 'coffee', sub: 'house blend · chikmagalur', body: () => `<ul class="rows">${DATA.menu.filter((m) => m.cat === 'coffee').map(itemRow).join('')}</ul>` },
    { title: 'not coffee', sub: 'teas, shakes & things', body: () => `<ul class="rows">${DATA.menu.filter((m) => m.cat === 'notcoffee').map(itemRow).join('')}</ul>` },
    { title: 'bakes', sub: 'out of the oven at 6', body: () => `<ul class="rows">${DATA.menu.filter((m) => m.cat === 'bakes').map(itemRow).join('')}</ul>` },
    { title: 'plates', sub: 'all day', body: () => `<ul class="rows">${DATA.menu.filter((m) => m.cat === 'plates').map(itemRow).join('')}</ul>` },
    { title: 'meal combos', sub: 'better together · always cheaper', cls: 'combos', body: () => `<ul class="cards">${COMBOS.map(comboCard).join('')}</ul>` },
    { title: 'rescue shelf', sub: 'made earlier, still lovely · help us waste nothing', cls: 'rescue', body: () => `<ul class="rescue-list"></ul><p class="empty">nothing to rescue right now ♡</p>` },
  ];
  function comboCard(c) {
    const [a, b] = c.skus;
    return `<li class="card-c" data-combo="${c.id}">
      <div class="duo">${ico(a, 'ic big')}<span class="plus">+</span>${ico(b, 'ic big')}</div>
      <div class="nm"><b>${esc(c.name.toLowerCase())}</b><small>${esc(ITEMS[a].name.toLowerCase())} + ${esc(ITEMS[b].name.toLowerCase())}</small><em class="why">${esc(c.tagline)}</em></div>
      <div class="cp">${priceTag(c.price)}<span class="save">save ${rs(comboList(c) - c.price)}</span></div></li>`;
  }
  function rescueRow(l) {
    const m = ITEMS[l.sku];
    return `<li class="rrow" data-listing="${l.listing_id}">
      ${ico(l.sku)}
      <div class="nm"><b>${esc(m.name.toLowerCase())}</b><small>made ${hm(l.made_at_min)} · good till ${hm(l.use_by_min)}</small>
        <span class="units">×${l.units} left</span></div>
      <span class="stamp">−${l.discount_pct}%</span>
      <div class="cp"><s class="was">${rs(m.price)}</s>${priceTag(l.price)}</div><span class="gone"></span></li>`;
  }

  /* ------------------------------------------------------------------ DOM */
  const root = document.createElement('div');
  root.id = 'mb';
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'menu book');
  root.innerHTML = `<div class="mb-dim"></div>
    <div class="mb-book"><div class="mb-cover"></div><div class="mb-spread"></div>
      <button class="mb-edge prev" aria-label="previous page"></button><button class="mb-edge next" aria-label="next page"></button></div>
    <div class="mb-ui"><button class="btn mb-prev" aria-label="previous page">← turn</button>
      <span class="mb-dots"></span><button class="btn mb-next" aria-label="next page">turn →</button></div>
    <button class="btn mb-close" aria-label="close the menu">close ✕</button>
    <span class="chip mb-live"><i></i>live prices · policy D</span>`;
  viewport.appendChild(root);
  const book = $('.mb-book', root), spread = $('.mb-spread', root), dots = $('.mb-dots', root);
  const pageHTML = (i) => {
    const p = PAGES[i];
    return p ? `<header><h2>~ ${p.title} ~</h2><small>${p.sub}</small></header><div class="pg-body">${p.body()}</div><footer>${i + 1}</footer>` : '';
  };
  const N = Math.ceil(PAGES.length / 2);
  let at = 0, busy = false, open = false;
  function renderSpread(s) {
    spread.innerHTML = `<section class="page left ${PAGES[2 * s]?.cls || ''}">${pageHTML(2 * s)}</section>
                        <section class="page right ${PAGES[2 * s + 1]?.cls || ''}">${pageHTML(2 * s + 1)}</section>`;
    dots.innerHTML = Array.from({ length: N }, (_, i) => `<button class="d${i === s ? ' on' : ''}" data-spread="${i}" aria-label="spread ${i + 1}"></button>`).join('');
    for (const l of RESCUE.values()) renderRescue(l.listing_id);
    emptyRescue();
    for (const m of Object.values(ITEMS)) if (m.dir) markRow(`[data-sku="${m.sku}"]`, m.dir, m.note);
  }
  function renderRescue(id, how) {
    const list = $('.rescue-list', spread), l = RESCUE.get(id);
    if (!list || !l || $(`[data-listing="${id}"]`, list)) return emptyRescue();
    list.insertAdjacentHTML('beforeend', rescueRow(l));
    if (how === 'in') bump(list.lastElementChild, 'slide');
    emptyRescue();
  }
  const emptyRescue = () => { const e = $('.rescue .empty', spread); if (e) e.style.display = RESCUE.size ? 'none' : ''; };

  /* ------------------------------------------------------------------ live paint */
  function bump(el, kind = 'pop') { if (!el || reduced) return; el.classList.remove(kind); void el.offsetWidth; el.classList.add(kind); }
  function markRow(sel, dir, note) {
    for (const row of book.querySelectorAll(sel)) {
      row.classList.toggle('up', dir === 'up'); row.classList.toggle('down', dir === 'down');
      const w = row.querySelector('.why'); if (w && note && !row.matches('.card-c')) w.textContent = `${dir === 'up' ? '▲' : '▼'} ${note}`;
    }
  }
  function paintPrice(sel, oldN, newN, dir, note) {
    if (!open) return; // the book re-renders from state when it opens
    for (const row of book.querySelectorAll(sel)) {
      const pr = row.querySelector('.pr'); if (!pr) continue;
      pr.querySelector('.old .ot').textContent = rs(oldN);
      pr.querySelector('.now').textContent = rs(newN);
      pr.classList.remove('chg', 'settled'); void pr.offsetWidth; pr.classList.add('chg');
      clearTimeout(pr._t); pr._t = setTimeout(() => pr.classList.add('settled'), reduced ? 0 : 5200);
      row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
    }
    markRow(sel, dir, note);
  }
  function paintSaving(c) { const s = $(`[data-combo="${c.id}"] .save`, book); if (s) s.textContent = `save ${rs(comboList(c) - c.price)}`; }

  /* lectern (the small book in the lobby scene) shows the same live prices */
  const LECTERN = ['latte', 'coldbrew', 'matcha', 'espresso', 'croissant', 'avotoast', 'cheesecake', 'muffin'];
  function lectern(sku) {
    const t = document.querySelector(`#lobby-scene [data-lsku="${sku}"]`); if (!t) return;
    const m = ITEMS[sku];
    t.innerHTML = `${Math.round(m.price)} <tspan fill="${m.dir === 'up' ? '#c0634f' : '#5f7d55'}">${m.dir === 'up' ? '▲' : '▼'}</tspan>`;
    t.classList.remove('lpop'); void t.getBoundingClientRect(); t.classList.add('lpop');
  }

  /* ------------------------------------------------------------------ open / close (book flies off the lectern) */
  const FINAL = { x: 800, y: 512, w: 1180, h: 740 };
  function sourceRect() {
    if (document.body.dataset.room === 'lobby') return { x: 170, y: 492, w: 250, h: 150 }; // the lectern book
    const t = document.querySelector('.tab[data-menu]').getBoundingClientRect(), v = viewport.getBoundingClientRect(), k = v.width / 1600;
    return { x: (t.left + t.width / 2 - v.left) / k, y: (t.top + t.height / 2 - v.top) / k, w: 60, h: 34 };
  }
  const fromTransform = (r) => `translate(${r.x - FINAL.x}px, ${r.y - FINAL.y}px) scale(${r.w / FINAL.w}, ${r.h / FINAL.h})`;
  let lastFocus = null;
  function openBook() {
    if (open || busy) return;
    open = true; busy = true; lastFocus = document.activeElement;
    renderSpread(at);
    root.classList.add('on');
    document.body.classList.add('reading');
    book.style.transition = 'none'; book.style.transform = fromTransform(sourceRect()); root.classList.remove('opened');
    void book.offsetWidth;
    book.style.transition = ''; book.style.transform = 'none';
    setTimeout(() => { root.classList.add('opened'); busy = false; $('.mb-next', root).focus({ preventScroll: true }); }, reduced ? 0 : 820);
  }
  function closeBook() {
    if (!open || busy) return;
    busy = true; root.classList.remove('opened');
    setTimeout(() => { book.style.transform = fromTransform(sourceRect()); root.classList.add('closing'); }, reduced ? 0 : 260);
    setTimeout(() => {
      root.classList.remove('on', 'closing'); document.body.classList.remove('reading');
      open = false; busy = false; lastFocus?.focus?.({ preventScroll: true });
    }, reduced ? 0 : 1080);
  }

  /* ------------------------------------------------------------------ page turn (a real 3D leaf) */
  function turn(dir) {
    const to = at + dir;
    if (!open || busy || to < 0 || to >= N) { bump(book, 'nudge'); return; }
    busy = true;
    const fwd = dir > 0;
    const leafEl = document.createElement('div');
    leafEl.className = `leaf3d ${fwd ? 'fwd' : 'back'}`;
    const frontIdx = fwd ? 2 * at + 1 : 2 * at, backIdx = fwd ? 2 * to : 2 * to + 1;
    leafEl.innerHTML = `<section class="page face front ${fwd ? 'right' : 'left'} ${PAGES[frontIdx]?.cls || ''}">${pageHTML(frontIdx)}</section>
                        <section class="page face backf ${fwd ? 'left' : 'right'} ${PAGES[backIdx]?.cls || ''}">${pageHTML(backIdx)}</section><i class="shade"></i>`;
    // underneath: the side being uncovered already shows the destination page
    const under = spread.querySelector(fwd ? '.page.right' : '.page.left');
    under.className = `page ${fwd ? 'right' : 'left'} ${PAGES[fwd ? 2 * to + 1 : 2 * to]?.cls || ''}`;
    under.innerHTML = pageHTML(fwd ? 2 * to + 1 : 2 * to);
    spread.appendChild(leafEl);
    for (const l of RESCUE.values()) renderRescue(l.listing_id);
    void leafEl.offsetWidth;
    leafEl.classList.add('go');
    const done = () => { at = to; renderSpread(at); busy = false; };
    if (reduced) done(); else setTimeout(done, 900);
  }

  /* ------------------------------------------------------------------ input */
  root.addEventListener('click', (e) => {
    if (e.target.closest('.mb-close') || e.target.classList.contains('mb-dim')) return closeBook();
    if (e.target.closest('.mb-next, .mb-edge.next')) return turn(1);
    if (e.target.closest('.mb-prev, .mb-edge.prev')) return turn(-1);
    const d = e.target.closest('[data-spread]');
    if (d) { const s = +d.dataset.spread; if (s !== at) turn(s > at ? 1 : -1); }
  });
  addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); closeBook(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); turn(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); turn(-1); }
  }, true);
  let sx = null;
  book.addEventListener('pointerdown', (e) => { sx = e.clientX; });
  book.addEventListener('pointerup', (e) => { if (sx != null && Math.abs(e.clientX - sx) > 60) turn(e.clientX < sx ? 1 : -1); sx = null; });

  // hot-spot over the lectern book in the lobby + the "menu" tab
  const hot = document.createElement('button');
  hot.className = 'mb-hot'; hot.setAttribute('aria-label', 'open the menu book');
  hot.innerHTML = '<span class="chip">open the menu ♡</span>';
  document.getElementById('lobby').appendChild(hot);
  hot.addEventListener('click', openBook);
  const tab = document.querySelector('.tab[data-soon][title="coming soon"]');
  const menuTab = [...document.querySelectorAll('.tab')].find((t) => t.textContent.trim() === 'menu');
  if (menuTab) { menuTab.removeAttribute('data-soon'); menuTab.removeAttribute('title'); menuTab.dataset.menu = '1'; menuTab.addEventListener('click', openBook); }
  void tab;

  LECTERN.forEach(lectern);
  mock.start();
  window.BREW_MENUBOOK = { open: openBook, close: closeBook, turn, state: { ITEMS, COMBOS, RESCUE } };
})();
