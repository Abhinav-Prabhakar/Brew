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
  return {NS, reduced, layer, moveTo, xyOf, bump, roll, hm12, hm, mmss, dur, rs, rsk, human, hash, now, S, onState, tod, DAY};
})();
