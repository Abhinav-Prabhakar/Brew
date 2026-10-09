/* brew — the menu book.
   Click the lectern book in the lobby (or the "menu" tab): the book flies off its stand, grows to fill the view and
   opens. Turn pages (buttons, ← →, click the page edge, swipe) to see every price updating live.

   Spreads: coffee | not coffee · bakes | plates · meal combos | rescue shelf
   - meal combos: two-item bundles priced off the components' LIVE prices (backend.md 3.12) — the up-spend
   - rescue shelf: Replate listings (backend.md 3.11) — pre-made food about to be thrown away, heavily discounted

   Data: window.BREW_MENU is the static catalogue (names, descriptions, categories; scripts/export_menu.py). Live
   prices, combo prices, 86'd items and rescue listings come from window.BrewLive.state (hydrate) and the event bus
   window.BREW_LIVE (price.changed incl. combo:*, menu.hidden/restored, replate.listed/marked_down/sold/retired). */
(() => {
  const DATA = window.BREW_MENU;
  if (!DATA) { console.warn('menu: window.BREW_MENU missing (design/data/menu.js)'); return; }
  const viewport = document.getElementById('viewport');
  const $ = (s, r = document) => r.querySelector(s);
  const rs = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || /[?&]still\b/.test(location.search);

  /* ------------------------------------------------------------------ live state (from BrewLive.state) */
  const ITEMS = Object.fromEntries(DATA.menu.map((m) => [m.sku, { ...m, base: m.price, dir: null, note: '', hidden: false }]));
  const COMBOS = DATA.combos.map((c) => ({ ...c, price: null, list: null, dir: null }));
  const comboList = (c) => c.list ?? c.skus.reduce((s, k) => s + ITEMS[k].price, 0);
  const RESCUE = new Map(); // listing_id -> listing
  const live = window.BREW_LIVE;
  const hm = (sec) => { const t = ((sec % 86400) + 86400) % 86400, h = Math.floor(t / 3600), mm = Math.floor(t % 3600 / 60);
    return `${h % 12 || 12}:${String(mm).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
  const isLive = (l) => !l.outcome && (l.units ?? 1) > 0;
  function hydrate(st) {
    if (!st) return;
    for (const m of Object.values(st.menu || {})) { const it = ITEMS[m.sku]; if (!it) continue;
      Object.assign(it, { price: m.price, base: m.base ?? it.base, min: m.min_price ?? it.min, max: m.max_price ?? it.max,
        hidden: !!m.hidden, hidden_reason: m.hidden_reason, featured: !!m.featured,
        dir: m.dir ?? m.chip?.dir ?? null, note: m.note ?? m.chip?.text ?? '' }); }
    for (const c of COMBOS) { const b = st.combos?.[c.id] || st.combos?.['combo:' + c.id];
      if (b) Object.assign(c, { price: b.price, list: b.list_price ?? null, dir: b.dir ?? c.dir, available: b.available !== false }); }
    const pe = document.querySelector('[data-mbpol]'); if (pe) pe.textContent = 'policy ' + (st.policy?.policy || st.world?.policy || 'D');
    RESCUE.clear();
    for (const l of Object.values(st.replate?.listings || {})) if (isLive(l)) RESCUE.set(l.listing_id, { ...l });
    if (open) renderSpread(at);
  }
  if (live) {
    live.on('hydrate', (st) => hydrate(st || window.BrewLive?.state));
    live.on('price.changed', (e) => {
      if (e.sku.startsWith('combo:')) { const c = COMBOS.find((x) => 'combo:' + x.id === e.sku); if (!c) return;
        c.price = e.new; c.dir = e.dir; paintPrice(`[data-combo="${c.id}"]`, e.old, e.new, e.dir, e.reason_text); paintSaving(c); return; }
      const m = ITEMS[e.sku]; if (!m) return;
      m.price = e.new; m.dir = e.dir; m.note = e.reason_text;
      paintPrice(`[data-sku="${e.sku}"]`, e.old, e.new, e.dir, e.reason_text);
      for (const c of COMBOS) if (c.skus.includes(e.sku)) { c.list = null; paintSaving(c); }
    });
    live.on('menu.hidden', (e) => { if (ITEMS[e.sku]) { ITEMS[e.sku].hidden = true; ITEMS[e.sku].hidden_reason = e.reason; markHidden(e.sku); } });
    live.on('menu.restored', (e) => { if (ITEMS[e.sku]) { ITEMS[e.sku].hidden = false; markHidden(e.sku); } });
    live.on('menu.featured', (e) => { if (ITEMS[e.sku]) ITEMS[e.sku].featured = e.on !== false; });
    live.on('replate.listed', (e) => { RESCUE.set(e.listing_id, { ...e }); renderRescue(e.listing_id, 'in'); });
    live.on('replate.marked_down', (e) => {
      const l = RESCUE.get(e.listing_id); if (!l) { RESCUE.set(e.listing_id, { ...e }); return renderRescue(e.listing_id, 'in'); }
      const old = l.price; Object.assign(l, { discount_pct: e.discount_pct, price: e.price, units: e.units });
      paintPrice(`[data-listing="${l.listing_id}"]`, old, l.price, 'down', `marked down · −${Math.round(l.discount_pct)}%`);
      const st2 = $(`[data-listing="${l.listing_id}"] .stamp`, book); if (st2) { st2.textContent = `−${Math.round(l.discount_pct)}%`; bump(st2); }
    });
    live.on('replate.sold', (e) => {
      const l = RESCUE.get(e.listing_id); if (!l) return;
      l.units = Math.max(0, l.units - (e.units || 1));
      const u = $(`[data-listing="${l.listing_id}"] .units`, book); if (u) { u.textContent = `×${Math.round(l.units)} left`; bump(u); }
    });
    live.on('replate.retired', (e) => {
      if (!RESCUE.has(e.listing_id)) return;
      RESCUE.delete(e.listing_id);
      const row = $(`[data-listing="${e.listing_id}"]`, book);
      if (!row) return;
      row.querySelector('.gone').textContent = { sold_out: 'all rescued ♡', donated: 'donated ♡', wasted: 'composted' }[e.outcome] || 'gone';
      row.classList.add('out');
      setTimeout(() => { row.remove(); emptyRescue(); }, reduced ? 0 : 1400);
    });
  }

  /* ------------------------------------------------------------------ pages */
  const ICON = { cappuccino: 'latte', latte: 'latte', flatwhite: 'latte', roselatte: 'latte', espresso: 'k-cup', filtercoffee: 'k-cup',
    icedlatte: 'coldbrew', coldbrew: 'coldbrew', matcha: 'matcha', chai: 'k-cup', hotchoc: 'k-cup', rosemilk: 'k-smoothie',
    strawberryshake: 'k-smoothie', croissant: 'croissant', cinnamon: 'croissant', muffin: 'cake', cheesecake: 'cake', waffle: 'toast',
    avotoast: 'k-avo', sandwich: 'k-panini', cheesetoast: 'toast', fries: 'k-fries', pasta: 'p-plate' };
  const ico = (sku, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 60 60" aria-hidden="true"><use href="#${ICON[sku] || 'p-plate'}"/></svg>`;
  const priceTag = (n) => `<span class="pr"><span class="old"><span class="ot"></span><svg class="strike" viewBox="0 0 60 20" preserveAspectRatio="none" aria-hidden="true"><path d="M2 13 C18 9 38 12 58 6"/></svg></span><b class="now">${rs(n)}</b></span>`;
  const leaf = (k) => `<svg class="leaf" viewBox="0 0 14 14" aria-label="${k}"><path d="M2 12C2 5 6 2 12 2C12 8 9 12 2 12Z" fill="#cfe0bf" stroke="#1d1a1c" stroke-width="1.4"/></svg>`;

  function itemRow(m) {
    m = ITEMS[m.sku] || m; // live price / sold-out state (DATA.menu is only the static catalogue)
    return `<li class="row${m.hidden ? ' hidden86' : ''}" data-sku="${m.sku}"><span class="ribbon">sold out</span>
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
      <div class="cp">${c.price != null ? priceTag(c.price) : '<span class="pr"><b class="now">—</b></span>'}<span class="save">${c.price != null ? 'save ' + rs(comboList(c) - c.price) : ''}</span></div></li>`;
  }
  function rescueRow(l) {
    const m = ITEMS[l.sku];
    return `<li class="rrow" data-listing="${l.listing_id}">
      ${ico(l.sku)}
      <div class="nm"><b>${esc(m.name.toLowerCase())}</b><small>made ${hm(l.made_at_s)} · good till ${hm(l.use_by_s)}</small>
        <span class="units">×${Math.round(l.units)} left</span></div>
      <span class="stamp">−${Math.round(l.discount_pct)}%</span>
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
    <span class="chip mb-live"><i></i>live prices · <span data-mbpol>policy D</span></span>`;
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
  function paintSaving(c) { const s = $(`[data-combo="${c.id}"] .save`, book); if (s && c.price != null) s.textContent = `save ${rs(comboList(c) - c.price)}`; }
  function markHidden(sku) { for (const row of book.querySelectorAll(`[data-sku="${sku}"]`)) row.classList.toggle('hidden86', !!ITEMS[sku].hidden); }

  /* ------------------------------------------------------------------ open / close (book flies off the lectern) */
  const FINAL = { x: 800, y: 512, w: 1180, h: 740 };
  function sourceRect() {
    if (document.body.dataset.room === 'lobby') return { x: 170, y: 492, w: 250, h: 150 }; // the lectern book
    return { x: 800, y: 960, w: 80, h: 50 };
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

  // hot-spot over the lectern book in the lobby
  const hot = document.createElement('button');
  hot.className = 'mb-hot'; hot.setAttribute('aria-label', 'open the menu book');
  hot.innerHTML = '<span class="chip">open the menu ♡</span>';
  document.getElementById('lobby').appendChild(hot);
  hot.addEventListener('click', openBook);
  if (window.BrewLive?.state) hydrate(window.BrewLive.state);

  window.BREW_MENUBOOK = { open: openBook, close: closeBook, turn, state: { ITEMS, COMBOS, RESCUE } };
})();
