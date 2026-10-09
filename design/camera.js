/* brew — the 2D camera. Room changes already slide the #track (brew.html); this adds:
   - parallax: what's seen through a window lags the slide a little (.cam-far), the door swings as you pass;
   - focus zooms: click (or Enter on) a station, the ticket rail, the counter or a shelf → the room zooms/pans to
     frame it. "← back", Esc, or a click on nothing interactive returns. The whole .room is transformed, so the HTML
     cards stay glued to the art;
   - chaos attention: on chaos.triggered the kitchen camera glances at the broken station once (rate limited, never
     while the user is interacting, never pulling you out of another room).
   Mouse hits are geometric (SVG coordinates vs the zones below), so existing click targets keep working; keyboard and
   screen readers get one invisible focusable rect per zone. */
(() => {
  const SVGNS = 'http://www.w3.org/2000/svg';
  const reduced = () => R.reduced || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const Z = {lobby: [], kitchen: [], pantry: []};

  /* ---------- zones, in room coordinates [x, y, w, h] ---------- */
  Z.lobby.push({id: 'rail', label: 'the ticket rail', r: [280, 40, 1040, 250]});  // lobby.js RAIL_L 310 … RAIL_R 1290
  Z.lobby.push({id: 'counter', label: 'the counter and pastry fridge', r: [430, B - 190, 420, 250]});
  const STN = {prep: 'prep board', oven: 'oven', fryer: 'fryer', press: 'panini press', espresso: 'espresso machine', grinder: 'grinder',
    blender: 'blender', cold: 'cold-brew tower', dishpit: 'dish pit'};
  const KM = {prep: [230, 500, 150], oven: [400, 430, 120], fryer: [545, 490, 110], press: [705, 500, 190], espresso: [930, 466, 220],
    grinder: [1095, 440, 70], blender: [1175, 470, 64], cold: [1266, 420, 84], dishpit: [1432, 480, 74]};  // kitchen.js MACHINE
  for (const [k, [cx, y, w]] of Object.entries(KM)) { const ww = Math.max(w, 150) + 60; Z.kitchen.push({id: k, label: `the ${STN[k]}`, r: [cx - ww / 2, y - 330, ww, 420]}); }
  const DECK = [318, 498, 678], DECKN = ['top', 'middle', 'bottom'];  // pantry.js S
  DECK.forEach((y, i) => {
    Z.pantry.push({id: `walkin-${i}`, label: `the walk-in, ${DECKN[i]} shelf`, r: [120, y - 150, 900, 210]});
    Z.pantry.push({id: `dry-${i}`, label: `the dry store, ${DECKN[i]} shelf`, r: [1080, y - 150, 510, 210]});
  });

  const rooms = Object.fromEntries(Object.keys(Z).map((k) => [k, document.getElementById(k)]));
  const scenes = Object.fromEntries(Object.keys(Z).map((k) => [k, document.getElementById(k + '-scene')]));
  let zoomed = null, lastInput = 0, lastNudge = -1e9, nudgeT = 0;

  /* ---------- the back chip ---------- */
  const back = document.createElement('button');
  back.id = 'camback'; back.type = 'button'; back.className = 'tab'; back.hidden = true;
  back.innerHTML = '← back'; back.setAttribute('aria-label', 'zoom back out');
  document.getElementById('viewport').appendChild(back);
  back.addEventListener('click', (e) => { e.stopPropagation(); unzoom(); });

  /* ---------- zoom ---------- */
  function frameOf([x, y, w, h]) {
    const k = Math.min(1.9, Math.max(1.15, Math.min(1600 / w, 1000 / h) * .9));
    const tx = Math.min(0, Math.max(1600 - 1600 * k, 800 - k * (x + w / 2)));
    const ty = Math.min(0, Math.max(1000 - 1000 * k, 520 - k * (y + h / 2)));
    return `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${k.toFixed(3)})`;
  }
  function zoom(room, zone, {auto = false} = {}) {
    const el = rooms[room]; if (!el) return;
    if (zoomed && zoomed.room !== room) unzoom(true);
    zoomed = {room, zone: zone.id, auto};
    el.classList.add('zoomed'); el.style.transform = frameOf(zone.r);
    back.hidden = false; back.textContent = `← back · ${zone.label.replace(/^the /, '')}`;
    document.body.classList.add('cam-zoomed');
    window.BREW_LIVE?.emit?.('camera.zoom', {room, zone: zone.id});
  }
  function unzoom(instant) {
    if (!zoomed) return;
    const el = rooms[zoomed.room];
    if (instant) el.style.transition = 'none';
    el.style.transform = ''; el.classList.remove('zoomed');
    if (instant) { void el.offsetWidth; el.style.transition = ''; }
    zoomed = null; back.hidden = true; clearTimeout(nudgeT);
    document.body.classList.remove('cam-zoomed');
    window.BREW_LIVE?.emit?.('camera.zoom', null);
  }

  /* ---------- hits: mouse is geometric, keyboard gets focusable rects ---------- */
  const INTERACTIVE = '[data-ticket],[data-action],[data-lsku],[data-staff],.p-hit,.tk,button,a,input,select,textarea,[role="button"]:not(.zoomhit),[tabindex]:not(.zoomhit)';
  for (const [room, list] of Object.entries(Z)) {
    const sc = scenes[room]; if (!sc) continue;
    const g = document.createElementNS(SVGNS, 'g'); g.id = room + '-zoom';
    for (const z of list) {
      const r = document.createElementNS(SVGNS, 'rect');
      const [x, y, w, h] = z.r;
      Object.entries({x, y, width: w, height: h, rx: 18, class: 'zoomhit', tabindex: 0, role: 'button', 'aria-label': `zoom to ${z.label}`}).forEach(([k, v]) => r.setAttribute(k, v));
      r.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); zoomed?.zone === z.id ? unzoom() : zoom(room, z); } });
      g.appendChild(r);
    }
    sc.appendChild(g);
    rooms[room].addEventListener('click', (e) => {
      if (e.target.closest(INTERACTIVE) || !e.target.closest('svg')) return;
      if (zoomed) return unzoom();
      const ctm = sc.getScreenCTM(); if (!ctm) return;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      const hit = list.find((z) => p.x >= z.r[0] && p.x <= z.r[0] + z.r[2] && p.y >= z.r[1] && p.y <= z.r[1] + z.r[3]);
      if (hit) zoom(room, hit);
    });
  }
  addEventListener('keydown', (e) => { lastInput = performance.now(); if (e.key === 'Escape' && zoomed) unzoom(); }, true);
  for (const t of ['pointerdown', 'wheel']) addEventListener(t, () => { lastInput = performance.now(); }, {capture: true, passive: true});

  /* ---------- room changes: unzoom, parallax, door ---------- */
  const ORDER = ['lobby', 'kitchen', 'pantry'];
  const far = {lobby: scenes.lobby?.querySelector(':scope > g[clip-path]'), kitchen: document.getElementById('k-outside')};
  for (const el of Object.values(far)) el?.classList.add('cam-far');
  let prev = document.body.dataset.room;
  new MutationObserver(() => {
    const now = document.body.dataset.room; if (now === prev) return;
    const dir = Math.sign(ORDER.indexOf(now) - ORDER.indexOf(prev)); prev = now;
    unzoom(true);
    if (reduced() || !dir) return;
    for (const el of Object.values(far)) {          // the view outside lags behind the slide, then catches up
      if (!el) continue;
      el.style.transition = 'none'; el.style.transform = `translateX(${dir * 46}px)`; void el.getBoundingClientRect();
      el.style.transition = 'transform 1.3s var(--ease-out) .15s'; el.style.transform = '';
    }
  }).observe(document.body, {attributes: true, attributeFilter: ['data-room']});

  /* ---------- chaos: one glance at the broken station ---------- */
  const EQ = {espresso_machine: 'espresso', panini_press: 'press', waffle_iron: 'press', dishwasher_machine: 'dishpit', cold_tower: 'cold',
    oven: 'oven', fryer: 'fryer', grinder: 'grinder', blender: 'blender'};
  window.BREW_LIVE?.on?.('chaos.triggered', (data) => {  // bus handlers get the payload first
    const d = data || {}, stn = d.station || EQ[d.target] || EQ[d.equipment] || (KM[d.target] ? d.target : null);
    const t = performance.now();
    if (!stn || zoomed || document.body.dataset.room !== 'kitchen' || document.hidden) return;
    if (t - lastInput < 6000 || t - lastNudge < 90000) return;
    lastNudge = t;
    zoom('kitchen', Z.kitchen.find((z) => z.id === stn), {auto: true});
    nudgeT = setTimeout(() => { if (zoomed?.auto) unzoom(); }, 3200);
  });

  window.BrewCamera = {zoom: (room, id) => { const z = Z[room]?.find((x) => x.id === id); if (z) zoom(room, z); }, unzoom, zones: Z, get zoomed() { return zoomed; }};
})();
