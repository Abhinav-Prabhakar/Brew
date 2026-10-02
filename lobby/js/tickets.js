/* brew · tickets.js — paper tickets on the steel rail
   - slide in on arrival, swing on their clip
   - FLIP re-order whenever kitchen priority changes
   - batched tickets are fanned together under a pink paperclip
   - torn off (with a paper sound) when served */
(function () {
  const B = window.B, A = B.art;
  const box = () => B.$('#tickets');
  const STAMP = { dine: 'DINE-IN', take: 'TAKEAWAY', zomato: 'ZOMATO', swiggy: 'SWIGGY' };
  const batchEls = new Map();
  const AVAIL = 660, TW = 140, BATCH_STEP = 36;

  function itemHTML(it) {
    const m = B.ITEM[it.id];
    const ov = it.mods.map((k) => {
      const md = B.MODS[k];
      return `<span class="mod ${md.x ? 'x' : ''}">${A.modIcon[md.icon]}${md.label}</span>`;
    }).join('');
    const longMods = it.mods.map((k) => B.MODS[k].long).join(' · ');
    return `<div class="t-item">
      <div class="photo">${A.food(it.id)}<div class="mods-ov">${ov}</div></div>
      <div><div class="t-iname"><b>${it.qty}×</b>${m.name}</div>${longMods ? `<div class="t-imods">${longMods}</div>` : ''}</div>
    </div>`;
  }

  function render(t) {
    const items = t.items.slice(0, 3).map(itemHTML).join('');
    const more = t.items.length > 3 ? `<div class="t-imods" style="text-align:center;margin-top:2px">+ ${t.items.length - 3} more item${t.items.length > 4 ? 's' : ''}</div>` : '';
    const el = B.h(`<div class="ticket" data-no="${t.no}">
      <i class="t-clip"></i>
      <div class="t-paper">
        <div class="t-head"><span class="t-no">#${String(t.no).padStart(4, '0')}</span><span class="stamp ${t.channel}">${STAMP[t.channel]}</span></div>
        <div class="t-meta">${A.persona[t.persona] || ''}<span class="t-name">${t.name}</span><span class="t-timer"></span></div>
        <div class="t-items">${items}${more}</div>
        ${t.note ? `<div class="t-note">${t.note}</div>` : ''}
        <div class="t-status"><span class="t-st">QUEUED</span><span class="t-bar"><i></i></span></div>
        <span class="ready-stamp">READY</span>
      </div>
    </div>`);
    t.el = el;
    t.ui = { timer: el.querySelector('.t-timer'), st: el.querySelector('.t-st'), bar: el.querySelector('.t-bar i') };
    el._ticket = t;
    return el;
  }

  /** order: array of tickets, already in display order (batches contiguous) */
  function layout(order, newcomers = []) {
    const c = box();
    const k = c.getBoundingClientRect().width / c.offsetWidth || 1;
    const first = new Map();
    order.forEach((t) => { if (t.el && t.el.isConnected) first.set(t, t.el.getBoundingClientRect()); });

    // group into units
    const units = [];
    order.forEach((t) => {
      const last = units[units.length - 1];
      if (t.batch && last && last.batch === t.batch) last.tickets.push(t);
      else units.push({ batch: t.batch || null, tickets: [t] });
    });
    // build / reuse batch wrappers
    const live = new Set();
    const nodes = units.map((u) => {
      if (u.batch && u.tickets.length > 1) {
        live.add(u.batch);
        let w = batchEls.get(u.batch);
        if (!w) {
          w = B.h(`<div class="batch">${A.paperclip}<span class="batch-tag"></span></div>`);
          batchEls.set(u.batch, w);
          w._new = true;
        }
        w.querySelector('.batch-tag').textContent = `Batch ×${u.tickets.length}`;
        u.tickets.forEach((t) => w.appendChild(t.el));
        u.node = w;
        return w;
      }
      u.node = u.tickets[0].el;
      return u.node;
    });
    nodes.forEach((n) => c.appendChild(n));
    // drop empty / stale wrappers
    batchEls.forEach((w, id) => {
      if (!live.has(id)) {
        Array.from(w.querySelectorAll('.ticket')).forEach((t) => c.appendChild(t));
        w.remove();
        batchEls.delete(id);
      }
    });
    // keep unit order exact (wrappers dissolving may have appended tickets at the end)
    nodes.forEach((n) => c.appendChild(n));

    // compress when crowded
    const widths = units.map((u) => TW + (u.tickets.length > 1 ? (u.tickets.length - 1) * BATCH_STEP : 0));
    const sum = widths.reduce((a, b) => a + b, 0);
    let ml = 12;
    if (units.length > 1 && sum + 12 * (units.length - 1) > AVAIL) ml = Math.max(-108, (AVAIL - sum) / (units.length - 1));
    units.forEach((u, i) => {
      u.node.style.setProperty('--ml', i === 0 ? '0px' : ml + 'px');
      u.node.style.zIndex = 60 - i;
    });
    // ticket base rotations (batch members fan slightly)
    order.forEach((t) => {
      const inBatch = t.el.parentElement && t.el.parentElement.classList.contains('batch');
      const idx = inBatch ? Array.from(t.el.parentElement.querySelectorAll('.ticket')).indexOf(t.el) : 0;
      t.rotTarget = inBatch ? [0, 2.4, -1.6, 1.2][idx] || 0 : t.rot;
    });

    // FLIP: invert from the old rects, play to zero
    order.forEach((t) => {
      if (newcomers.includes(t)) return;
      const f = first.get(t);
      gsap.killTweensOf(t.el, 'x,y');
      if (!f) return;
      gsap.set(t.el, { x: 0, y: 0 });
      const l = t.el.getBoundingClientRect();
      const dx = (f.left - l.left) / k, dy = (f.top - l.top) / k;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        gsap.fromTo(t.el, { x: dx, y: dy }, { x: 0, y: 0, duration: 0.6, ease: 'power3.out' });
      }
      gsap.to(t.el, { rotation: t.rotTarget, duration: 0.6, ease: 'back.out(2)' });
    });
    // new batch wrappers: the clip snaps on
    batchEls.forEach((w) => {
      if (w._new) {
        w._new = false;
        const clip = w.querySelector('.pclip'), tag = w.querySelector('.batch-tag');
        gsap.fromTo(clip, { y: -30, rotation: -30, opacity: 0 }, { y: 0, rotation: 0, opacity: 1, duration: 0.5, delay: 0.25, ease: 'back.out(2.4)', onStart: () => B.audio.play('clip', 700) });
        gsap.fromTo(tag, { scale: 0 }, { scale: 1, duration: 0.4, delay: 0.4, ease: 'back.out(2.4)' });
      }
    });
    newcomers.forEach((t) => {
      gsap.fromTo(t.el, { x: 420, y: -10, rotation: 14, opacity: 0 }, {
        x: 0, y: 0, opacity: 1, duration: 0.75, ease: 'power3.out',
        onComplete: () => gsap.fromTo(t.el, { rotation: 7 }, { rotation: t.rotTarget, duration: 1.4, ease: 'elastic.out(1.2, 0.3)' }),
      });
      gsap.to(t.el, { rotation: -4, duration: 0.5, delay: 0.25 });
      setTimeout(() => B.audio.play('clip', 900), 520);
    });
    B.$('#rail-hint').classList.toggle('hide', order.length > 0);
  }

  function jagged(w, base, amp) {
    const pts = [];
    for (let x = 0; x <= w; x += 6) pts.push([x, base + B.rand(-amp, amp)]);
    pts[pts.length - 1][0] = w;
    return pts;
  }

  /** tear a ticket off the rail; resolves when the paper is gone */
  function tear(t, { voided = false } = {}) {
    return new Promise((res) => {
      const el = t.el;
      if (!el || !el.isConnected) return res();
      const rail = B.$('#rail');
      const k = rail.getBoundingClientRect().width / rail.offsetWidth || 1;
      gsap.killTweensOf(el);
      gsap.set(el, { x: 0, y: 0 });
      const r = el.getBoundingClientRect(), rr = rail.getBoundingClientRect();
      const x = (r.left - rr.left) / k, y = (r.top - rr.top) / k;
      const w = el.offsetWidth, h = el.offsetHeight;
      if (voided) el.classList.add('void');
      el.classList.remove('ready');
      const pts = jagged(w, 22, 2.6);
      const topPoly = ['0px -20px', `${w}px -20px`, ...pts.slice().reverse().map(([a, b]) => `${a}px ${b}px`)].join(',');
      const botPoly = [...pts.map(([a, b]) => `${a}px ${b}px`), `${w}px ${h + 20}px`, `0px ${h + 20}px`].join(',');
      const mk = (poly) => {
        const c = el.cloneNode(true);
        c.classList.add('tear-piece');
        c.style.cssText = `left:${x}px;top:${y}px;width:${w}px;margin:0;clip-path:polygon(${poly});transform:rotate(${gsap.getProperty(el, 'rotation')}deg);z-index:80`;
        rail.appendChild(c);
        return c;
      };
      const top = mk(topPoly), body = mk(botPoly);
      el.remove();
      B.audio.play(voided ? 'rip' : 'tear', 400 + x);
      const dir = Math.random() < 0.5 ? -1 : 1;
      gsap.timeline({ onComplete: () => { body.remove(); res(); } })
        .to(body, { y: '+=7', rotation: dir * 3, duration: 0.12, ease: 'power2.out' })
        .to(body, voided
          ? { y: '+=200', x: `+=${dir * 30}`, rotation: dir * 40, scale: 0.4, opacity: 0, duration: 0.7, ease: 'power2.in' }
          : { y: '+=230', x: `+=${dir * B.rand(30, 70)}`, rotation: dir * B.rand(14, 28), opacity: 0, duration: 0.85, ease: 'power2.in' });
      gsap.timeline({ onComplete: () => top.remove() })
        .to(top, { rotation: `+=${dir * 6}`, duration: 0.18, yoyo: true, repeat: 3, ease: 'sine.inOut' })
        .to(top, { opacity: 0, y: -6, duration: 0.5, delay: 0.3 });
    });
  }

  function wiggle(t) {
    gsap.fromTo(t.el, { rotation: t.rotTarget - 4 }, { rotation: t.rotTarget, duration: 0.8, ease: 'elastic.out(1.4, 0.3)' });
    B.audio.play('rustle', 700);
  }

  /** cheap per-frame text updates */
  function refresh(t, kitchenPos) {
    if (!t.ui) return;
    const rem = t.promise - B.state.t;
    const mins = Math.ceil(Math.abs(rem) / B.SEC_PER_MIN);
    const tm = t.ui.timer;
    const txt = rem >= 0 ? `⏱ ${mins}m` : `LATE ${mins}m`;
    if (tm.textContent !== txt) tm.textContent = txt;
    tm.classList.toggle('late', rem < 0);
    tm.classList.toggle('warn', rem >= 0 && rem < 2 * B.SEC_PER_MIN);
    t.el.classList.toggle('late-t', rem < 0);
    let st, pct = 0;
    if (t.state === 'queued') { st = kitchenPos ? `QUEUED · ${kitchenPos} ahead` : 'QUEUED · next'; }
    else if (t.state === 'brewing') { pct = t.progress; st = t.progress >= 0.7 ? `ALMOST · ${Math.round(pct * 100)}%` : `BREWING ${Math.round(pct * 100)}%`; }
    else if (t.state === 'ready') { pct = 1; st = t.channel === 'zomato' || t.channel === 'swiggy' ? 'READY · BAG IT' : 'READY · TAP'; }
    if (t.ui.st.textContent !== st) t.ui.st.textContent = st;
    t.ui.bar.style.width = (pct * 100).toFixed(1) + '%';
    t.el.classList.toggle('almost', t.state === 'brewing' && t.progress >= 0.7);
    t.el.classList.toggle('ready', t.state === 'ready');
    const flag = t.el.querySelector('.bump-flag');
    if (t.bumped && !flag) t.el.querySelector('.t-paper').appendChild(B.h('<span class="bump-flag">BUMPED ↑</span>'));
    if (!t.bumped && flag) flag.remove();
  }

  B.tickets = { render, layout, tear, wiggle, refresh };

  B.$('#tickets').addEventListener('click', (e) => {
    const el = e.target.closest('.ticket');
    if (el && el._ticket) B.emit('ticket:click', el._ticket);
  });
})();
