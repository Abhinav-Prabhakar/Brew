/* brew — tiny render kit shared by the rooms: keyed diffing of SVG/HTML layers, CSS-transitioned placement,
   rolling numbers and sim-time formatting. No state of its own; rooms render from window.BrewLive.state. */
const R = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || /[?&]still\b/.test(location.search);
  const DAY = 86400;

  /** Keyed layer: sync(list) creates/updates/removes one child per key. `html(item)` re-renders only when
      `sig(item)` changes; `place(rec, item, isNew)` positions it; `exit(rec)` may return a delay (ms) before removal. */
  function layer(el, {key, sig, html, place, exit, tag}) {
    const map = new Map();
    const svg = el instanceof SVGElement;
    return {
      map,
      sync(list) {
        const seen = new Set();
        list.forEach((it, i) => {
          const k = String(key(it, i)); seen.add(k);
          let r = map.get(k), isNew = false;
          if (!r || r.gone) {
            if (r) { clearTimeout(r.t); r.el.remove(); }
            const node = svg ? document.createElementNS(NS, tag || 'g') : document.createElement(tag || 'div');
            node.dataset.key = k; el.appendChild(node);
            r = {el: node, sig: null, gone: false, data: {}}; map.set(k, r); isNew = true;
          }
          const s = sig ? sig(it) : JSON.stringify(it);
          if (s !== r.sig) { r.el.innerHTML = html(it, r); r.sig = s; }
          r.item = it;
          if (place) place(r, it, isNew, i);
        });
        for (const [k, r] of map) {
          if (seen.has(k) || r.gone) continue;
          r.gone = true;
          const ms = exit ? exit(r) : 0;
          r.t = setTimeout(() => { if (map.get(k) === r) { r.el.remove(); map.delete(k); } }, reduced ? 0 : (ms || 0));
        }
      },
    };
  }

  /** Move an element with a CSS transform transition (SVG user units = px). */
  function moveTo(el, x, y, {dur = .8, ease = 'cubic-bezier(.45,.05,.3,1)', rot = 0, scale = 1, instant = false} = {}) {
    const t = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)${rot ? ` rotate(${rot}deg)` : ''}${scale !== 1 ? ` scale(${scale})` : ''}`;
    if (el.style.transform === t) return 0;
    el.style.transition = instant || reduced ? 'none' : `transform ${dur}s ${ease}`;
    el.style.transform = t;
    return instant || reduced ? 0 : dur * 1000;
  }
  const xyOf = (el) => { const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform || ''); return m ? [+m[1], +m[2]] : null; };

  /** Re-trigger a one-shot CSS animation class. */
  function bump(el, cls) { if (!el || reduced) return; el.classList.remove(cls); void el.getBoundingClientRect(); el.classList.add(cls); }

  /** Roll a number in place (odometer feel). fmt(n) → string. */
  function roll(el, to, fmt, ms = 900) {
    if (!el) return;
    const from = el._v ?? to; el._v = to;
    if (reduced || from === to) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    cancelAnimationFrame(el._raf);
    const step = (t) => { const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(from + (to - from) * e); if (k < 1) el._raf = requestAnimationFrame(step); };
    el._raf = requestAnimationFrame(step);
  }

  /** Bake the static hand-drawn groups of a room into bitmaps (perf: the #wob turbulence filter on a big group is
      re-run on every repaint of the SVG, ~150 ms/frame in the lobby). A static group = a `g[filter=url(#wob)]`
      without an id, outside every live layer (`[id]` child of the scene). Drawn once to a canvas at device
      resolution (filter included) and swapped for an <image> in place, so the z-order is unchanged. Children that
      animate or are interactive (class / data-* / tabindex / role) stay live: the original group is kept but hidden,
      those children stay visible and carry the wobble themselves (a small filter region is cheap).
      Resolves when every group is swapped; sets `data-baked` on the scene. */
  function bake(scene, {scale} = {}) {
    if (!scene || /[?&]nobake\b/.test(location.search)) return Promise.resolve(0);
    const s = scale || Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    // live layers with a room-wide wobble: the filter moves onto each child (a person, a bag, a table), so one walking
    // customer re-filters ~100×200 px instead of the whole layer. New children get it too.
    for (const L of scene.querySelectorAll(':scope > [id][filter="url(#wob)"]')) {
      L.removeAttribute('filter');
      const fix = () => { for (const c of L.children) if (!c.hasAttribute('filter')) c.setAttribute('filter', 'url(#wob)'); };
      fix(); new MutationObserver(fix).observe(L, {childList: true});
    }
    const groups = [...scene.querySelectorAll('g[filter="url(#wob)"]:not([id])')].filter((g) => g.parentNode.closest('[id]') === scene);
    const keepLive = (e) => e.hasAttribute('class') || e.hasAttribute('tabindex') || e.hasAttribute('role') || Object.keys(e.dataset || {}).length;
    const refs = (html, out) => { for (const m of html.matchAll(/(?:href="#|url\(#)([\w-]+)/g)) if (!out.has(m[1])) { const el = document.getElementById(m[1]); if (el) { out.set(m[1], el.outerHTML); refs(el.outerHTML, out); } } return out; };
    const jobs = groups.map(async (g) => {
      const b = g.getBBox(), pad = 8;
      const x0 = Math.max(-10, Math.floor(b.x - pad)), y0 = Math.max(-10, Math.floor(b.y - pad));
      const x1 = Math.min(1620, Math.ceil(b.x + b.width + pad)), y1 = Math.min(1010, Math.ceil(b.y + b.height + pad));
      const w = x1 - x0, h = y1 - y0; if (w <= 0 || h <= 0) return;
      const live = [...g.querySelectorAll('*')].filter(keepLive);
      const clone = g.cloneNode(true); clone.removeAttribute('transform');
      clone.querySelectorAll('*').forEach((e) => { if (keepLive(e)) e.setAttribute('visibility', 'hidden'); });
      const body = clone.outerHTML, defs = [...refs(body, new Map()).values()].join('');
      const svg = `<svg xmlns="${NS}" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w * s}" height="${h * s}" viewBox="${x0} ${y0} ${w} ${h}"><defs>${defs}</defs>${body}</svg>`;
      const img = new Image(); img.src = URL.createObjectURL(new Blob([svg], {type: 'image/svg+xml'}));
      await img.decode();
      const cv = document.createElement('canvas'); cv.width = w * s; cv.height = h * s;
      cv.getContext('2d').drawImage(img, 0, 0, w * s, h * s); URL.revokeObjectURL(img.src);
      const png = await new Promise((r) => cv.toBlob(r, 'image/png'));
      const im = document.createElementNS(NS, 'image');
      for (const [k, v] of Object.entries({x: x0, y: y0, width: w, height: h, preserveAspectRatio: 'none', href: URL.createObjectURL(png)})) im.setAttribute(k, v);
      if (g.getAttribute('transform')) im.setAttribute('transform', g.getAttribute('transform'));
      im.setAttribute('aria-hidden', 'true'); im.dataset.baked = '';
      await im.decode?.().catch(() => {});
      g.parentNode.insertBefore(im, g);
      if (!live.length) { g.remove(); return; }
      g.removeAttribute('filter'); g.setAttribute('visibility', 'hidden');
      for (const e of live) { e.setAttribute('visibility', 'visible'); if (!e.closest('[filter]')) e.setAttribute('filter', 'url(#wob)'); }
    });
    return Promise.all(jobs).then(() => { scene.dataset.baked = String(jobs.length); return jobs.length; },
      (e) => { console.warn('bake failed, keeping live groups', e); return 0; });
  }

  const tod = (s) => ((s % DAY) + DAY) % DAY;
  const hm12 = (s) => { const t = tod(s), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60);
    return `${String(h % 12 || 12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
  const hm = (s) => { const t = tod(s), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };
  const mmss = (sec) => { sec = Math.max(0, Math.round(sec)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
  const dur = (sec) => { sec = Math.max(0, Math.round(sec)); if (sec < 60) return `${sec}s`;
    if (sec < 3600) { const m = Math.floor(sec / 60), s = sec % 60; return s ? `${m}m${String(s).padStart(2, '0')}s` : `${m} min`; }
    const h = Math.floor(sec / 3600), m = Math.round(sec % 3600 / 60); return m ? `${h}h ${m}m` : `${h}h`; };
  const rs = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
  const rsk = (n) => Math.abs(n) >= 1e5 ? '₹' + (n / 1e5).toFixed(1) + 'L' : Math.abs(n) >= 1e3 ? '₹' + (n / 1e3).toFixed(1) + 'k' : rs(n);
  const human = (k) => String(k || '').replace(/_fg$|_baked$|_slice$/, '').replace(/_/g, ' ');
  const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

  /** Live sim clock: interpolated between frames by boot.js (falls back to the last event time). */
  const now = () => (window.BrewLive && BrewLive.now ? BrewLive.now() : (BrewLive?.state?.sim_s || 0));
  const S = () => window.BrewLive && BrewLive.state;
  /** Subscribe a room renderer to hydrate + frame (coalesced per animation frame by boot.js). */
  function onState(fn) {
    const bus = window.BREW_LIVE; if (!bus) return;
    bus.on('hydrate', (s) => fn(s || S(), true));
    bus.on('frame', (s) => fn(s || S(), false));
    if (S()) fn(S(), true);
  }
  return {NS, reduced, layer, bake, moveTo, xyOf, bump, roll, hm12, hm, mmss, dur, rs, rsk, human, hash, now, S, onState, tod, DAY};
})();
