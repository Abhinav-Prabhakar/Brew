/* brew — easter eggs. Small, hidden, drawn by the same hand. Nothing here touches the café's state or the API: they
   are toys in the margins. The list (with spoilers) is in README.md → "Easter eggs".

   Each egg calls found(key) the first time it's discovered; the count lives in localStorage (brew.eggs) and a tiny
   toast says "🥚 3 of N". Everything is best-effort: a missing scene or audio context just means no egg. */
(() => {
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const reduced = R.reduced;
  const ink = (w = 2.4) => `stroke="#1d1a1c" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
  const play = (name, room = 'ui', ...a) => window.BrewAudio?.play?.(name, room, ...a);
  const toast = (m, bad) => window.BrewToast?.(m, bad);
  const room = () => document.body.dataset.room;

  /* ---------------------------------------------------------------- the egg basket */
  const EGGS = ['cat', 'cuckoo', 'tips', 'radio', 'konami', 'chai', 'upi', 'duck', 'mouse', 'logo', 'secret', 'wish', 'dizzy', 'away', 'festive'];
  const mem = (() => { try { return JSON.parse(localStorage.getItem('brew.eggs') || '{}'); } catch (e) { return {}; } })();
  mem.found = mem.found || []; mem.tips = mem.tips || 0;
  const keep = () => { try { localStorage.setItem('brew.eggs', JSON.stringify(mem)); } catch (e) { /* private mode */ } };
  function found(k) {
    if (mem.found.includes(k)) return;
    mem.found.push(k); keep();
    const n = mem.found.length;
    setTimeout(() => toast(n === EGGS.length ? `🥚 all ${n} eggs found · you're head barista now ♡` : `🥚 egg ${n} of ${EGGS.length}`), 900);
    if (n === EGGS.length) setTimeout(() => window.BrewHUD?.confetti?.(document.querySelector('#hud .logo'), 24, ['♡', '☕', '✿', '★']), 1100);
  }
  /** an SVG group inside a room scene, below the paper grain (so it's printed on the same paper) */
  function layer(scene, id, before) {
    const sc = $(scene + '-scene'); if (!sc) return null;
    const g = document.createElementNS(NS, 'g'); g.id = id;
    const ref = before ? $(before) : sc.querySelector(':scope > rect[filter="url(#grain)"]');
    if (ref) ref.parentNode.insertBefore(g, ref); else sc.appendChild(g);
    return g;
  }
  /** a click target on a doodle: data-action keeps the camera from zooming, no tabindex keeps it a secret */
  function hit(g, key, fn) { g.dataset.action = 'egg-' + key; g.style.cursor = 'pointer';
    g.addEventListener('click', (e) => { e.stopPropagation(); fn(e); }); }
  const bump = (el, cls, ms = 900) => { if (!el || reduced) return; el.classList.remove(cls); void el.getBoundingClientRect(); el.classList.add(cls); setTimeout(() => el.classList.remove(cls), ms); };
  const today = () => R.S()?.clock?.date || '';
  const tod = () => R.tod(R.now());

  /* ---------------------------------------------------------------- 1 · biscuit, the café cat */
  // naps on the window sill on one day in four (seeded by the sim date) and every night. Click: purrs, wakes, hearts.
  const cat = layer('lobby', 'egg-cat', 'l-hands');
  if (cat) {
    cat.setAttribute('filter', 'url(#wob)');
    cat.innerHTML = `<g transform="translate(1040 460)"><g class="egg-catbody">
      <path d="M30 -3q19 3 13 -17" fill="none" ${ink(3)}/>
      <path d="M-34 0Q-37 -27 -9 -31Q15 -33 27 -21Q35 -11 33 0Z" fill="#f0b77e" ${ink(2.6)}/>
      <path d="M1 -30q3 6 0 11M11 -28q3 6 0 11M20 -23q2 5 0 9" fill="none" ${ink(1.8)} opacity=".55"/>
      <path d="M-39 -31L-37 -47L-27 -38ZM-23 -40L-13 -49L-12 -35Z" fill="#f0b77e" ${ink(2.2)}/>
      <circle cx="-26" cy="-27" r="14" fill="#f0b77e" ${ink(2.6)}/>
      <g class="egg-cateyes-shut"><path d="M-33 -27q3 2.5 6 0M-22 -27q3 2.5 6 0" fill="none" ${ink(1.8)}/></g>
      <g class="egg-cateyes-open" opacity="0"><circle cx="-30" cy="-28" r="2" fill="#1d1a1c"/><circle cx="-19" cy="-28" r="2" fill="#1d1a1c"/></g>
      <path d="M-27.5 -22.5h3l-1.5 2z" fill="#e07e52"/><path d="M-36 -21l-8 -1M-36 -19l-8 2M-15 -21l8 -1M-15 -19l8 2" ${ink(1)} opacity=".6"/>
      <text class="egg-z" x="-14" y="-46" font-family="Gochi Hand" font-size="15" fill="#1d1a1c" opacity=".6">z</text></g></g>`;
    let shown = null;
    const show = (on) => { if (on === shown) return; shown = on; cat.style.transition = 'opacity .8s ease'; cat.style.opacity = on ? '1' : '0'; cat.style.pointerEvents = on ? '' : 'none'; };
    const visiting = () => { const s = R.S(); if (!s) return false; return !s.clock?.is_open || R.hash(today() + 'biscuit') % 4 === 0 || cat.dataset.summoned === today(); };
    show(false); setInterval(() => show(visiting()), 2000); window.BREW_LIVE?.on?.('hydrate', () => setTimeout(() => show(visiting()), 0));
    hit(cat, 'cat', () => { found('cat'); play('purr', 'lobby', 1040);
      const open = cat.querySelector('.egg-cateyes-open'), shut = cat.querySelector('.egg-cateyes-shut');
      open.setAttribute('opacity', '1'); shut.setAttribute('opacity', '0'); bump(cat.querySelector('.egg-catbody'), 'egg-stretch', 1200);
      setTimeout(() => { open.setAttribute('opacity', '0'); shut.setAttribute('opacity', '1'); }, 2600);
      window.BrewHUD?.confetti?.(cat, 6, ['♡']); });
    window.__summonCat = () => { cat.dataset.summoned = today(); show(true); };
  }

  /* ---------------------------------------------------------------- 2 · the cuckoo in the wall clock */
  // three quick taps on the lobby clock: a bird pops out and calls the hour (sim time), once per call
  const coo = layer('lobby', 'egg-cuckoo');
  if (coo) {
    coo.innerHTML = `<circle cx="1300" cy="210" r="38" fill="transparent"/><g class="egg-bird" transform="translate(1300 170)" opacity="0">
      <path d="M0 6V16" ${ink(2)}/><ellipse cx="0" cy="0" rx="13" ry="9" fill="#c9a27a" ${ink(2.2)}/><circle cx="-9" cy="-6" r="7" fill="#c9a27a" ${ink(2.2)}/>
      <path d="M-15 -7l-8 2l8 2z" fill="#e3b25a" ${ink(1.6)}/><circle cx="-10" cy="-8" r="1.6" fill="#1d1a1c"/><path d="M4 -2q6 4 12 -2" fill="none" ${ink(1.6)}/></g>`;
    let taps = [], busy = false;
    hit(coo, 'cuckoo', () => {
      const t = performance.now(); taps = taps.filter((x) => t - x < 1500).concat(t);
      if (taps.length < 3 || busy) return; taps = []; busy = true; found('cuckoo');
      const n = Math.floor(tod() / 3600) % 12 || 12, bird = coo.querySelector('.egg-bird');
      play('cuckoo', 'lobby', n); bird.setAttribute('opacity', '1');
      for (let i = 0; i < n; i++) setTimeout(() => bump(bird, 'egg-coo', 500), i * 620);
      setTimeout(() => { bird.setAttribute('opacity', '0'); busy = false; }, n * 620 + 400);
    });
  }

  /* ---------------------------------------------------------------- 3 · the tip jar */
  // every click drops a coin in (and remembers it); 10 / 50 / 100 coins get a thank-you
  const jar = layer('lobby', 'egg-tips');
  if (jar) {
    jar.innerHTML = `<rect x="1346" y="${B - 64}" width="60" height="64" fill="transparent"/><g class="egg-coins"></g>`;
    hit(jar, 'tips', () => {
      mem.tips++; keep(); if (mem.tips === 1) found('tips');
      play('clink', 'lobby');
      const c = document.createElementNS(NS, 'g');
      c.innerHTML = `<g class="egg-drop"><ellipse cx="${1366 + Math.random() * 16}" cy="${B - 84}" rx="6" ry="6" fill="#e3b25a" ${ink(1.6)}/></g>`;
      jar.querySelector('.egg-coins').appendChild(c); setTimeout(() => c.remove(), 900);
      jar.setAttribute('aria-label', `tip jar · ${mem.tips} coins from you`);
      if ([10, 50, 100, 500].includes(mem.tips)) { toast(`${mem.tips} tips! the crew says thank u ♡`); window.BrewHUD?.confetti?.(jar, 10, ['₹', '♡']); }
    });
  }

  /* ---------------------------------------------------------------- 4 · the radio has stations */
  const radio = layer('lobby', 'egg-radio');
  if (radio) {
    radio.innerHTML = `<rect x="1446" y="${B - 70}" width="134" height="72" fill="transparent"/><g class="egg-notes"></g>`;
    hit(radio, 'radio', () => {
      if (!window.BrewAudio) return;
      BrewAudio.init?.(); play('radio', 'lobby'); const name = BrewAudio.tune(); found('radio');
      toast(`📻 ${name}`);
      const notes = radio.querySelector('.egg-notes');
      notes.innerHTML = ['♪', '♫', '♪'].map((n, i) => `<text class="egg-note" style="animation-delay:${i * .25}s" x="${1480 + i * 26}" y="${B - 80}" font-family="Gochi Hand" font-size="${20 - i * 2}" fill="#e07e52">${n}</text>`).join('');
      setTimeout(() => { notes.innerHTML = ''; }, 2600);
    });
  }

  /* ---------------------------------------------------------------- 5 · words you can type */
  // "chai" brings a kulhad to the counter, "upi" toggles the soundbox voice, "biscuit" calls the cat,
  // and the Konami code (↑ ↑ ↓ ↓ ← → ← → b a) turns on barista mode
  const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  let keys = [], typed = '';
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    keys = keys.concat(e.key.length === 1 ? e.key.toLowerCase() : e.key).slice(-10);
    if (keys.join() === KONAMI.join()) { keys = []; barista(); }
    if (e.key.length === 1 && /[a-z]/i.test(e.key)) typed = (typed + e.key.toLowerCase()).slice(-12); else if (e.key.length === 1) typed = '';
    if (typed.endsWith('chai')) { typed = ''; chai(); }
    if (typed.endsWith('upi')) { typed = ''; upi(); }
    if (typed.endsWith('biscuit')) { typed = ''; window.__summonCat?.(); toast('psst… biscuit! 🐈'); }
    if (e.key === 's' && window.BREW_MENUBOOK?.isOpen) secret();
  }, true);
  function barista() {
    found('konami'); window.BrewAudio?.init?.(); play('jingle');
    const logo = document.querySelector('#hud .logo');
    window.BrewHUD?.confetti?.(logo, 26, ['☕', '♡', '✿', '★']);
    bump(logo, 'egg-wiggle', 2600);
    toast('★ barista mode ★ · ↑↑↓↓←→←→ b a');
  }
  let kulhadT = null;
  function chai() {
    const g = $('egg-chai') || layer('lobby', 'egg-chai'); if (!g) return;
    found('chai'); play('kettle', 'lobby');
    g.innerHTML = `<g class="egg-slidein" filter="url(#wob)"><path d="M1408 ${B - 34}l4 32q1 4 6 4h16q5 0 6 -4l4 -32z" fill="#c0634f" ${ink(2.4)}/>
      <ellipse cx="1426" cy="${B - 34}" rx="18" ry="5" fill="#d8a77a" ${ink(2.2)}/><path d="M1414 ${B - 22}q12 4 24 0" fill="none" ${ink(1.4)} opacity=".5"/></g>
      <g class="egg-steam"><path d="M1420 ${B - 44}q-5 -8 0 -14t0 -14M1432 ${B - 46}q-5 -8 0 -14t0 -12" fill="none" ${ink(1.8)} opacity=".45"/></g>`;
    toast('chai break ☕ · in a kulhad, obviously');
    clearTimeout(kulhadT); kulhadT = setTimeout(() => { g.innerHTML = ''; }, 60000);
  }
  function upi() {
    if (!window.BrewAudio) return;
    BrewAudio.soundbox = !BrewAudio.soundbox; found('upi');
    toast(BrewAudio.soundbox ? '🔊 UPI soundbox voice on · “₹415 received”' : 'UPI soundbox voice off');
  }

  /* ---------------------------------------------------------------- 6 · a rubber duck in the dish pit */
  const duck = layer('kitchen', 'egg-duck');
  if (duck) {
    duck.setAttribute('filter', 'url(#wob)');
    duck.innerHTML = `<g transform="translate(1326 549)"><g class="egg-duckbody">
      <path d="M-15 -2Q-17 -16 -4 -15Q-2 -26 7 -26Q16 -26 15 -16L22 -14L15 -11Q14 -2 4 0Z" fill="#f6d04d" ${ink(2.2)}/>
      <path d="M15 -16l8 1.5l-7.5 3.5" fill="#e07e52" ${ink(1.6)}/><circle cx="9" cy="-20" r="1.6" fill="#1d1a1c"/>
      <path d="M-9 -9q6 4 11 -1" fill="none" ${ink(1.6)}/></g></g>`;
    let n = 0;
    hit(duck, 'duck', () => { found('duck'); n++; play('squeak', 'kitchen', 1326); bump(duck.querySelector('.egg-duckbody'), 'egg-hop', 500);
      if (n % 7 === 0) toast('🦆 the dish pit’s debugging duck has heard it all'); });
  }

  /* ---------------------------------------------------------------- 7 · a mouse hole in the pantry */
  // a mouse peeks out now and then; catch it peeking and it bolts
  const hole = layer('pantry', 'egg-mouse');
  if (hole) {
    const clip = `<clipPath id="egg-holeclip"><path d="M1050 790V779Q1050 766 1062 766Q1074 766 1074 779V790Z"/></clipPath>`;
    hole.innerHTML = `<defs>${clip}</defs><path d="M1047 791V779Q1047 763 1062 763Q1077 763 1077 779V791Z" fill="#c9a27a" ${ink(2.2)}/>
      <path d="M1050 790V779Q1050 766 1062 766Q1074 766 1074 779V790Z" fill="#2b2326"/>
      <g clip-path="url(#egg-holeclip)"><g class="egg-mousehead" style="transform:translateY(22px)">
        <circle cx="1056" cy="774" r="4" fill="#b8b2ad" ${ink(1.4)}/><circle cx="1068" cy="774" r="4" fill="#b8b2ad" ${ink(1.4)}/>
        <ellipse cx="1062" cy="781" rx="7.5" ry="6.5" fill="#cfc9c4" ${ink(1.6)}/>
        <circle cx="1059" cy="779.5" r="1.2" fill="#1d1a1c"/><circle cx="1065" cy="779.5" r="1.2" fill="#1d1a1c"/><circle cx="1062" cy="784" r="1.4" fill="#e07e52"/></g></g>`;
    const head = hole.querySelector('.egg-mousehead');
    let peeking = false;
    const peek = () => { if (document.hidden || room() !== 'pantry' || reduced) return;
      peeking = true; head.style.transition = 'transform .5s cubic-bezier(.3,1.4,.5,1)'; head.style.transform = 'translateY(0)';
      setTimeout(() => { if (!peeking) return; peeking = false; head.style.transition = 'transform .35s ease-in'; head.style.transform = 'translateY(22px)'; }, 2600); };
    if (!reduced) (function loop() { setTimeout(() => { peek(); loop(); }, 25000 + Math.random() * 40000); })();
    hit(hole, 'mouse', () => {
      if (!peeking) { play('squeak', 'pantry', 1062, 1.4); return; }
      peeking = false; found('mouse'); play('squeak', 'pantry', 1062, 1.5);
      head.style.transition = 'transform .12s ease-in'; head.style.transform = 'translateY(22px)';
      toast('you didn’t see anything 🐭 (neither did the health inspector)');
    });
    window.__peek = peek;
  }

  /* ---------------------------------------------------------------- 8 · the logo's heart */
  const logo = document.querySelector('#hud .logo');
  if (logo) {
    const sub = logo.querySelector('.sub'), heart = logo.querySelector('.word span');
    const LINES = ['café sim', 'a little ML café', 'made with ♡ and math', 'est. 2026 · koramangala', 'MaskablePPO on espresso', 'no beans were harmed', 'serving ONNX lattes', 'café sim'];
    let li = 0;
    if (heart) { heart.style.display = 'inline-block'; heart.style.cursor = 'pointer'; heart.dataset.action = 'egg-logo'; }
    heart?.addEventListener('click', (e) => {
      e.stopPropagation(); found('logo'); bump(heart, 'egg-beat', 700); play('sparkle');
      li = (li + 1) % LINES.length; const t = sub.firstChild; if (t && t.nodeType === 3) t.textContent = LINES[li] + ' · ';
    });
  }

  /* ---------------------------------------------------------------- 9 · the secret menu */
  // press s with the menu book open: a sticky note for the regulars
  function secret() {
    const pg = document.querySelector('#mb .mb-spread .page.right'); if (!pg || pg.querySelector('.egg-sticky')) return;
    found('secret'); play('pen');
    pg.insertAdjacentHTML('beforeend', `<div class="egg-sticky" role="note"><b>secret menu ☆</b>dirty chai · masala chai + a shot<br>the “biscuit” · cold brew + rose milk<br><i>ask nicely ♡</i></div>`);
  }

  /* ---------------------------------------------------------------- 10 · make a wish at 11:11 */
  // a shooting star crosses the lobby window at 11:11 (sim time, am or pm), once each
  let wished = '';
  setInterval(() => {
    const s = R.S(); if (!s) return; const m = Math.floor(tod() / 60) % 720;
    if (m !== 671) return; const k = today() + (tod() < 43200 ? 'am' : 'pm'); if (wished === k) return; wished = k;
    const g = $('egg-wish') || layer('lobby', 'egg-wish', 'l-lights'); if (!g) return;
    g.innerHTML = `<g class="egg-star"><path d="M1110 196L1000 240" stroke="#f6d58e" stroke-width="3" stroke-linecap="round" opacity=".7"/><path d="M1000 240l3-7l3 7l7 3l-7 3l-3 7l-3-7l-7-3z" fill="#fff6d8" ${ink(1.4)}/></g>`;
    if (room() === 'lobby') { found('wish'); toast('11:11 · make a wish ✨'); play('sparkle'); }
    setTimeout(() => { g.innerHTML = ''; }, 2600);
  }, 1000);

  /* ---------------------------------------------------------------- 11 · dizzy */
  // whizz through the rooms (six switches in three seconds): the logo spins
  let hops = [], last = room();
  new MutationObserver(() => { const now = room(); if (now === last) return; last = now; const t = performance.now();
    hops = hops.filter((x) => t - x < 3000).concat(t);
    if (hops.length >= 6) { hops = []; found('dizzy'); bump(document.querySelector('#hud .logo'), 'egg-spin', 1000); toast('wheee ↺ · the café is spinning'); }
  }).observe(document.body, {attributes: true, attributeFilter: ['data-room']});

  /* ---------------------------------------------------------------- 12 · come back soon */
  // leave the tab and it misses you; come back after a while and it says hi
  const title = document.title; let leftAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { leftAt = Date.now(); document.title = '☕ your latte’s getting cold…'; return; }
    document.title = title;
    if (leftAt && Date.now() - leftAt > 90000) { found('away'); toast('welcome back ♡ · the café kept going without you'); }
  });

  /* ---------------------------------------------------------------- 13 · festive days (the sim's date) */
  // International Coffee Day (1 Oct): bunting in the window · Diwali: a marigold toran and diyas · Christmas: a hat on the bell
  const DIWALI = ['2026-11-08', '2027-10-29', '2028-10-17', '2029-11-05', '2030-10-26'];
  let festSig = null;
  function festive() {
    const d = today(); if (!d || d === festSig) return; festSig = d;
    const g = $('egg-fest') || layer('lobby', 'egg-fest', 'l-hands'); if (!g) return;
    const md = d.slice(5), cols = ['#f7c3a3', '#8fa585', '#e3b25a', '#e07e52', '#fdeee4'];
    let k = '';
    if (md === '10-01') { k += `<path d="M470 190Q800 250 1130 190" fill="none" ${ink(2)}/>`;
      for (let i = 0; i < 14; i++) { const x = 490 + i * 47, u = (x - 470) / 660, y = 190 + 120 * u * (1 - u) - 2;
        k += `<path d="M${x - 14} ${y}L${x + 14} ${y}L${x} ${y + 26}Z" fill="${cols[i % 5]}" ${ink(1.8)}/>`; }
      k += `<text x="800" y="290" text-anchor="middle" font-family="Gochi Hand" font-size="22" fill="#e07e52">happy coffee day ♡</text>`; }
    if (DIWALI.includes(d)) { k += `<path d="M405 182Q800 232 1195 182" fill="none" ${ink(1.6)}/>`;
      for (let i = 0; i < 28; i++) { const x = 420 + i * 28.5, u = (x - 405) / 790, y = 182 + 100 * u * (1 - u) + 8;
        k += `<circle cx="${x}" cy="${y.toFixed(1)}" r="8" fill="${i % 2 ? '#e3b25a' : '#e07e52'}" ${ink(1.4)}/>`; }
      for (const x of [22, 482, 1424]) k += `<g transform="translate(${x} ${B})"><path d="M-12 -6q12 10 24 0z" fill="#c0634f" ${ink(1.8)}/><path class="egg-flame" d="M0 -8q-5 -6 0 -14q5 8 0 14z" fill="#f2b33d" ${ink(1.2)}/></g>`; }
    if (md === '12-24' || md === '12-25') k += `<g transform="translate(870 ${B - 52})"><path d="M-12 0Q-4 -22 14 -14Q8 -8 10 0Z" fill="#c0634f" ${ink(1.8)}/><rect x="-14" y="-2" width="28" height="6" rx="3" fill="#fff" ${ink(1.6)}/><circle cx="15" cy="-15" r="4" fill="#fff" ${ink(1.4)}/></g>`;
    g.innerHTML = k;
    if (k) { found('festive'); if (md === '10-01') toast('happy international coffee day ☕'); else if (DIWALI.includes(d)) toast('happy diwali ✨'); else toast('merry christmas ♡'); }
  }
  window.BREW_LIVE?.on?.('hydrate', () => setTimeout(festive, 0)); setInterval(festive, 5000);

  /* ---------------------------------------------------------------- 14 · for the people who open devtools */
  console.log('%c   ( (\n    ) )\n  ........\n  |      |]\n  \\      /\n   `----\'  %c brew ♡ — a café that happens to be an ML system.\n%cyou opened the console, so here’s a hint: there are ' + EGGS.length + ' easter eggs. try ↑↑↓↓←→←→ b a.',
    'color:#e07e52;font:13px monospace', 'color:#1d1a1c;font:bold 14px sans-serif', 'color:#6f7a4c;font:12px sans-serif');

  window.BrewEggs = {found: () => [...mem.found], total: EGGS.length, peek: () => window.__peek?.(), summonCat: () => window.__summonCat?.()};
})();
