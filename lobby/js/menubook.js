/* brew · menubook.js — the live menu book
   Stand-up book on the counter → opens full-screen through a view transition.
   Pages are categories; leaves turn with drag physics (fling, spring back). */
(function () {
  const B = window.B, A = B.art;
  const overlay = B.$('#menu-overlay');
  const book = B.$('#book');
  const leaves = [];
  let spread = 0; // 0 = closed (cover), N = all leaves turned
  let isOpen = false;
  let unseen = 0;

  /* live menu state lives in B.menuState (written by game.js) */
  const ms = () => B.menuState;

  function priceHTML(id) {
    const s = ms()[id];
    if (!s) return '';
    if (s.price !== s.base) return `<s>₹${s.base}</s><span class="hand">₹${s.price}</span>`;
    return `₹${s.price}`;
  }
  function itemHTML(id) {
    const m = B.ITEM[id], s = ms()[id] || {};
    const chip = s.chip ? `<span class="chip ${s.chip.dir}">${s.chip.dir === 'up' ? '↑' : '↓'} ${s.chip.text}</span>` : '';
    return `<div class="mi ${s.out ? 'out' : ''} ${s.pick ? 'pick' : ''}" data-id="${id}">
      <div class="photo">${A.food(id)}</div>
      <div class="mi-row"><span class="mi-name">${m.name}</span><span class="mi-dots"></span><span class="mi-price">${priceHTML(id)}</span></div>
      <div class="mi-desc">${m.desc}</div>
      ${chip}
      ${s.pick ? `<div class="sticker"><span class="s-in">Today’s<br>pick</span></div>` : ''}
      ${s.out ? `<div class="ribbon">${s.outWhy || 'Sold out for now'}</div>` : ''}
    </div>`;
  }
  function catPage(cat, num) {
    const items = B.MENU.filter((m) => m.cat === cat.id);
    return `<div class="pg-h"><h3>${cat.name} <em>${cat.em}</em></h3><span class="live-dot">live</span></div>
      <div class="pg-items">${items.map((m) => itemHTML(m.id)).join('')}</div>
      <span class="pg-num">${num}</span>`;
  }
  function welcomePage() {
    return `<div class="pg-notes">
      <h4>Hello, welcome in ♥</h4>
      <p>This menu is <span class="tip">alive</span> — prices nudge with the rush, the rain and what’s left in the fridge.</p>
      <p>Look for the little arrows:</p>
      <ul><li><span class="chip up">↑ ₹20 · rush hour</span></li><li><span class="chip down">↓ ₹30 · slow afternoon</span></li></ul>
      <p>Golden stickers are what we’d order today.</p>
      <p style="margin-top:18px">— the brew crew</p>
    </div><span class="pg-num">i</span>`;
  }
  function notesPage() {
    return `<div class="pg-notes">
      <h4>House notes</h4>
      <p>Oat, almond or soy milk on anything: <b>+₹40</b>.</p>
      <p>Tell us about allergies — we write them in big letters on your ticket.</p>
      <p>Laptop friends: plugs are under the window bench. Refills are half price after your first.</p>
      <p class="tip">Prices inclusive of 5% GST on the bill.</p>
      <p id="mb-policy" style="margin-top:14px"></p>
    </div><span class="pg-num">6</span>`;
  }
  function coverFront() {
    return `<h2>brew</h2><p>menu</p><span class="est">Indiranagar · est. 2026</span>`;
  }
  function backCover() {
    return `<div style="display:grid;place-items:center;height:100%;text-align:center"><div><div style="font:italic 700 54px var(--font-display);color:#fde7b5">brew</div><div style="font:700 11px var(--font-ui2);letter-spacing:.4em;color:#fde7b5;margin-top:8px">SEE YOU TOMORROW</div></div></div>`;
  }

  const PAGES = [
    // [front, back] for each leaf
    [{ cls: 'cover', html: coverFront }, { html: welcomePage }],
    [{ html: () => catPage(B.CATS[0], 1) }, { html: () => catPage(B.CATS[1], 2) }],
    [{ html: () => catPage(B.CATS[2], 3) }, { html: () => catPage(B.CATS[3], 4) }],
    [{ html: notesPage }, { cls: 'cover', html: backCover }],
  ];
  const LABELS = ['Cover', 'Coffee · Not Coffee', 'Bakes · Plates', 'House notes', 'Back cover'];
  const LABELS2 = ['Cover', 'Welcome · Coffee', 'Not Coffee · Bakes', 'Plates · House notes', 'Back cover'];

  function build() {
    book.innerHTML = '';
    leaves.length = 0;
    PAGES.forEach(([f, b], i) => {
      const leaf = B.h(`<div class="leaf"><div class="face front ${f.cls || ''}"></div><div class="face back ${b.cls || ''}"></div></div>`);
      leaf.querySelector('.front').innerHTML = f.html() + '<i class="shadow"></i>';
      leaf.querySelector('.back').innerHTML = b.html() + '<i class="shadow"></i>';
      book.appendChild(leaf);
      leaves.push({ el: leaf, angle: 0 });
    });
    applyAll();
  }

  const bookX = () => (spread === 0 ? -25 : spread === leaves.length ? 25 : 0);
  function zFor(i, s) {
    return i < s ? i + 1 : leaves.length - i + 10;
  }
  function setAngle(i, a) {
    const L = leaves[i];
    L.angle = a;
    const fold = Math.sin((-a * Math.PI) / 180); // 0 flat, 1 at 90°
    gsap.set(L.el, { rotationY: a, z: fold * 2 });
    L.el.querySelector('.front .shadow').style.opacity = (fold * 0.9).toFixed(3);
    L.el.querySelector('.back .shadow').style.opacity = (fold * 0.9).toFixed(3);
  }
  function applyAll() {
    leaves.forEach((L, i) => {
      setAngle(i, i < spread ? -180 : 0);
      L.el.style.zIndex = zFor(i, spread);
    });
    book.classList.toggle('closed', spread === 0);
    book.classList.toggle('back-closed', spread === leaves.length);
    gsap.to(book, { xPercent: bookX(), duration: 0.6, ease: 'power3.out', overwrite: 'auto' });
    B.$('#mo-page').textContent = LABELS2[spread];
    B.$('#mo-prev').disabled = spread === 0;
    B.$('#mo-next').disabled = spread === leaves.length;
  }

  function turn(dir, fromAngle) {
    const target = dir > 0 ? spread : spread - 1;
    if (target < 0 || target >= leaves.length) return;
    const L = leaves[target];
    L.el.style.zIndex = 200;
    const end = dir > 0 ? -180 : 0;
    const start = fromAngle != null ? fromAngle : dir > 0 ? 0 : -180;
    const o = { a: start };
    if (fromAngle == null) B.audio.play('page');
    const remaining = Math.abs(end - start) / 180;
    if (dir > 0) spread++; else spread--;
    book.classList.toggle('closed', spread === 0);
    gsap.to(book, { xPercent: bookX(), duration: 0.7, ease: 'power3.inOut', overwrite: 'auto' });
    gsap.to(o, {
      a: end, duration: 0.25 + remaining * 0.6, ease: 'power2.out',
      onUpdate: () => setAngle(target, o.a),
      onComplete: () => applyAll(),
    });
    B.$('#mo-page').textContent = LABELS2[spread];
  }

  /* ---------- drag-to-turn with fling + spring-back ---------- */
  let drag = null;
  book.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const r = book.getBoundingClientRect();
    const fwd = e.clientX > r.left + r.width / 2;
    const idx = fwd ? spread : spread - 1;
    if (idx < 0 || idx >= leaves.length) return;
    drag = { fwd, idx, x0: e.clientX, half: r.width / 2, moved: false, lastX: e.clientX, lastT: performance.now(), v: 0 };
    book.setPointerCapture(e.pointerId);
  });
  book.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    if (!drag.moved && Math.abs(dx) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      leaves[drag.idx].el.style.zIndex = 200;
      B.audio.play('page');
    }
    const now = performance.now();
    drag.v = (e.clientX - drag.lastX) / Math.max(1, now - drag.lastT);
    drag.lastX = e.clientX;
    drag.lastT = now;
    let a = drag.fwd ? B.clamp((dx / (drag.half * 1.6)) * 180, -180, 0) : B.clamp(-180 + (dx / (drag.half * 1.6)) * 180, -180, 0);
    setAngle(drag.idx, a);
  });
  const endDrag = (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moved) {
      // simple click: turn toward the clicked side
      if (d.fwd) turn(1); else turn(-1);
      return;
    }
    const a = leaves[d.idx].angle;
    const commit = d.fwd ? a < -90 || d.v < -0.45 : a > -90 || d.v > 0.45;
    if (commit) turn(d.fwd ? 1 : -1, a);
    else {
      const o = { a };
      gsap.to(o, { a: d.fwd ? 0 : -180, duration: 0.9, ease: 'elastic.out(1, 0.55)', onUpdate: () => setAngle(d.idx, o.a), onComplete: applyAll });
    }
  };
  book.addEventListener('pointerup', endDrag);
  book.addEventListener('pointercancel', endDrag);

  /* ---------- open / close with a view transition ---------- */
  function open() {
    if (isOpen) return;
    isOpen = true;
    build();
    spread = 0;
    applyAll();
    gsap.killTweensOf(book);
    gsap.set(book, { xPercent: -25 });
    const closed = B.$('#mb-closed');
    unseen = 0;
    badge();
    B.audio.play('whoosh');
    const swap = () => {
      closed.style.viewTransitionName = 'none';
      book.style.viewTransitionName = 'menu-book';
      overlay.hidden = false;
      closed.style.visibility = 'hidden';
    };
    closed.style.viewTransitionName = 'menu-book';
    book.style.viewTransitionName = 'none';
    if (document.startViewTransition) {
      const vt = document.startViewTransition(swap);
      vt.finished.finally(() => setTimeout(() => turn(1), 120));
    } else {
      swap();
      gsap.from(book, { scale: 0.3, opacity: 0, duration: 0.6, ease: 'power3.out', onComplete: () => turn(1) });
    }
  }
  function close() {
    if (!isOpen) return;
    isOpen = false;
    const closed = B.$('#mb-closed');
    const finish = () => {
      book.style.viewTransitionName = 'none';
      closed.style.viewTransitionName = 'menu-book';
      overlay.hidden = true;
      closed.style.visibility = '';
    };
    // close the book first, then morph back onto the stand
    if (spread > 0 && spread < leaves.length) {
      leaves.forEach((L, i) => i < spread && gsap.to({ a: -180 }, { a: 0, duration: 0.45, delay: (spread - i - 1) * 0.08, onUpdate() { setAngle(i, this.targets()[0].a); } }));
      spread = 0;
      B.audio.play('page');
      book.classList.add('closed');
      gsap.to(book, { xPercent: -25, duration: 0.5 });
    }
    setTimeout(() => {
      B.audio.play('thud');
      if (document.startViewTransition) document.startViewTransition(finish).finished.finally(() => closed.style.viewTransitionName = '');
      else finish();
    }, spread === 0 ? 420 : 0);
  }

  function badge() {
    const b = B.$('#mb-badge');
    b.hidden = unseen === 0;
    b.textContent = unseen > 9 ? '9+' : unseen;
  }

  /** game.js calls this when an item's live state changes */
  function changed(ids) {
    if (!ids.length) return;
    if (!isOpen) {
      unseen += ids.length;
      badge();
      const b = B.$('#mb-badge');
      gsap.fromTo(b, { scale: 1.6 }, { scale: 1, duration: 0.5, ease: 'back.out(3)' });
      return;
    }
    ids.forEach((id) => {
      const el = book.querySelector(`.mi[data-id="${id}"]`);
      if (!el) return;
      const fresh = B.h(itemHTML(id));
      el.replaceWith(fresh);
      fresh.classList.add('flash');
      const hand = fresh.querySelector('.hand');
      if (hand) gsap.from(hand, { clipPath: 'inset(0 100% 0 0)', duration: 0.7, ease: 'power1.inOut' });
    });
    B.audio.play('rustle');
  }

  B.menubook = { open, close, changed, get isOpen() { return isOpen; }, policyNote(t) { const p = book.querySelector('#mb-policy'); if (p) p.textContent = t; } };

  B.$('#menu-stand').addEventListener('click', open);
  B.$('#menu-stand').addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && open());
  B.$('#mo-close').addEventListener('click', close);
  B.$('.mo-backdrop').addEventListener('click', close);
  B.$('#mo-prev').addEventListener('click', () => turn(-1));
  B.$('#mo-next').addEventListener('click', () => turn(1));
  window.addEventListener('keydown', (e) => {
    if (!isOpen) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight') turn(1);
    if (e.key === 'ArrowLeft') turn(-1);
  });
})();
