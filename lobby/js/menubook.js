/* brew · menubook.js — the live menu book (3D).
   It stands on a little brass easel on the counter. Clicking it is a camera
   move: the view transitions into "reading" mode, the book lifts toward you,
   the cover swings open and each leaf bends as it turns (drag to flip,
   flick to fling, let go early and it springs back). */
(function () {
  const B = window.B, T = THREE, G = B.gfx, L = B.L;
  const PW = 0.22, PH = 0.3; // page size (m)
  const CPX = 900, CPY = Math.round((CPX * PH) / PW);
  const SEGX = 28;

  const home = G.group(G.scene, [L.book[0], L.counterTop, L.book[1]]);
  home.rotation.y = 0.32;
  // easel
  {
    const brass = G.brass();
    G.m(G.rbox(0.2, 0.012, 0.06, 0.004), brass, { p: [0, 0.006, 0.02], parent: home });
    G.m(G.rbox(0.012, 0.3, 0.012, 0.004), brass, { p: [0, 0.14, -0.05], r: [-0.3, 0, 0], parent: home });
    G.m(G.rbox(0.22, 0.02, 0.03, 0.006), brass, { p: [0, 0.02, 0.035], parent: home });
  }
  const book = G.group(home, [0, 0.03, 0.03]);
  book.rotation.x = -0.26;
  const pages = G.group(book, [-PW / 2, PH / 2, 0]); // spine at x=0 (shifted so the closed book is centred)

  /* ---------- textures ---------- */
  const leather = (() => {
    const c = G.canvas(512, 700), x = c.getContext('2d');
    x.fillStyle = '#e46d8d'; x.fillRect(0, 0, 512, 700);
    const n = G.noise(256, 61);
    const im = x.getImageData(0, 0, 512, 700);
    for (let i = 0; i < 512 * 700; i++) { const v = (n[(((i / 512) | 0) % 256) * 256 + ((i % 512) % 256)] - 0.5) * 30; im.data[i * 4] += v; im.data[i * 4 + 1] += v * 0.6; im.data[i * 4 + 2] += v * 0.7; }
    x.putImageData(im, 0, 0);
    return c;
  })();
  function coverArt(x, back) {
    x.drawImage(leather, 0, 0, CPX, CPY);
    const g = x.createLinearGradient(0, 0, CPX, CPY);
    g.addColorStop(0, '#fff1c4'); g.addColorStop(0.45, '#e8bf6a'); g.addColorStop(0.55, '#fde6a8'); g.addColorStop(1, '#c99a45');
    x.strokeStyle = g; x.lineWidth = 6; x.beginPath(); x.roundRect(54, 54, CPX - 108, CPY - 108, 26); x.stroke();
    x.lineWidth = 2; x.beginPath(); x.roundRect(72, 72, CPX - 144, CPY - 144, 18); x.stroke();
    x.fillStyle = g; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.save();
    x.shadowColor = 'rgba(90,20,40,.45)'; x.shadowOffsetY = 3; x.shadowBlur = 4;
    if (!back) {
      x.font = 'italic 700 250px Fraunces'; x.fillText('brew', CPX / 2, CPY * 0.42);
      x.font = '700 44px "DM Sans"'; x.letterSpacing = '22px'; x.fillText('MENU', CPX / 2 + 11, CPY * 0.56); x.letterSpacing = '0px';
      x.font = '600 50px Caveat'; x.fillText('Indiranagar · est. 2026', CPX / 2, CPY * 0.8);
      x.font = '40px serif'; x.fillText('✦', CPX / 2, CPY * 0.66);
    } else {
      x.font = 'italic 700 120px Fraunces'; x.fillText('brew', CPX / 2, CPY * 0.46);
      x.font = '700 30px "DM Sans"'; x.letterSpacing = '12px'; x.fillText('SEE YOU TOMORROW', CPX / 2 + 6, CPY * 0.56); x.letterSpacing = '0px';
    }
    x.restore();
  }
  const paperBG = (() => {
    const c = G.canvas(CPX, CPY), x = c.getContext('2d');
    x.fillStyle = '#fffbf3'; x.fillRect(0, 0, CPX, CPY);
    const n = G.noise(128, 71);
    for (let i = 0; i < 14000; i++) { x.fillStyle = `rgba(150,120,90,${n[i % 16384] * 0.05})`; x.fillRect(Math.random() * CPX, Math.random() * CPY, 2, 2); }
    return c;
  })();

  function chip(x, cx, cy, dir, text) {
    x.font = '700 24px "DM Sans"';
    const label = (dir === 'up' ? '↑ ' : '↓ ') + text;
    const w = x.measureText(label).width + 26;
    x.fillStyle = dir === 'up' ? '#fff0e6' : '#e9f7ef'; x.strokeStyle = dir === 'up' ? '#f8cfb2' : '#bfe6cf'; x.lineWidth = 2;
    x.beginPath(); x.roundRect(cx, cy, w, 36, 18); x.fill(); x.stroke();
    x.fillStyle = dir === 'up' ? '#c25e1a' : '#2b8a5b'; x.textBaseline = 'middle'; x.textAlign = 'left';
    x.fillText(label, cx + 13, cy + 19);
    return w;
  }
  function drawItem(x, id, bx, by, bw) {
    const m = B.ITEM[id], s = (B.menuState && B.menuState[id]) || { price: m.base };
    const ph = bw * 0.62;
    x.save();
    if (s.out) x.globalAlpha = 0.5;
    x.save(); x.shadowColor = 'rgba(80,30,50,.3)'; x.shadowBlur = 16; x.shadowOffsetY = 6;
    x.beginPath(); x.roundRect(bx, by, bw, ph, 22); x.fillStyle = '#fbe1e8'; x.fill(); x.restore();
    x.save(); x.beginPath(); x.roundRect(bx, by, bw, ph, 22); x.clip();
    const im = B.food.imgs[id];
    if (im && im.complete) x.drawImage(im, bx, by - (bw - ph) / 2, bw, bw);
    x.restore();
    let y = by + ph + 46;
    // price first (right-aligned), then fit the name into what's left
    x.textAlign = 'right'; x.textBaseline = 'alphabetic';
    let pw;
    if (s.price !== m.base) {
      x.font = '700 50px Caveat'; x.fillStyle = '#c43e64'; x.fillText('₹' + s.price, bx + bw, y + 4);
      const nw = x.measureText('₹' + s.price).width;
      x.font = '400 30px Fraunces'; x.fillStyle = '#a08a95'; x.fillText('₹' + m.base, bx + bw - nw - 12, y);
      const ow = x.measureText('₹' + m.base).width;
      x.strokeStyle = '#e0607f'; x.lineWidth = 3; x.beginPath(); x.moveTo(bx + bw - nw - 14 - ow, y - 10); x.lineTo(bx + bw - nw - 10, y - 12); x.stroke();
      pw = nw + ow + 14;
    } else { x.font = '700 36px Fraunces'; x.fillStyle = '#3a2430'; x.fillText('₹' + s.price, bx + bw, y); pw = x.measureText('₹' + s.price).width; }
    x.textAlign = 'left'; x.fillStyle = '#3a2430';
    let fs = 38;
    const room = bw - pw - 18;
    do { x.font = `600 ${fs}px Fraunces`; } while (x.measureText(m.name).width > room && --fs > 26);
    if (x.measureText(m.name).width > room) {
      // still too long: wrap onto two lines
      const words = m.name.split(' ');
      const l1 = words.slice(0, -1).join(' '), l2 = words.slice(-1)[0];
      x.fillText(l1, bx + 4, y); x.fillText(l2, bx + 4, y + fs + 2); y += fs + 2;
    } else x.fillText(m.name, bx + 4, y);
    x.textAlign = 'left';
    x.fillStyle = '#6e5562'; x.font = '500 23px "DM Sans"';
    const words = m.desc.split(' ');
    let line = '', ly = y + 40;
    words.forEach((w) => { const t = line ? line + ' ' + w : w; if (x.measureText(t).width > bw - 8) { x.fillText(line, bx + 4, ly); ly += 30; line = w; } else line = t; });
    x.fillText(line, bx + 4, ly);
    if (s.chip) chip(x, bx + 2, ly + 16, s.chip.dir, s.chip.text);
    x.restore();
    if (s.pick && !s.out) {
      x.save(); x.translate(bx + bw - 54, by + 40); x.rotate(0.25);
      const g = x.createRadialGradient(-12, -14, 4, 0, 0, 62); g.addColorStop(0, '#fff3b0'); g.addColorStop(0.6, '#ffd36b'); g.addColorStop(1, '#f2b13a');
      x.shadowColor = 'rgba(140,80,0,.45)'; x.shadowBlur = 14; x.shadowOffsetY = 6;
      x.fillStyle = g; x.beginPath(); for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2, r = i % 2 ? 58 : 64; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); } x.fill();
      x.shadowColor = 'transparent';
      x.strokeStyle = 'rgba(255,255,255,.7)'; x.lineWidth = 3; x.beginPath(); x.arc(0, 0, 48, 0, 7); x.stroke();
      x.fillStyle = '#8a4a12'; x.textAlign = 'center'; x.font = '800 20px "DM Sans"'; x.fillText('TODAY’S', 0, -6); x.fillText('PICK ★', 0, 20);
      x.restore();
    }
    if (s.out) {
      x.save(); x.translate(bx + bw / 2, by + ph * 0.5); x.rotate(-0.2);
      x.fillStyle = '#2a1a22'; x.shadowColor = 'rgba(0,0,0,.4)'; x.shadowBlur = 14; x.fillRect(-bw * 0.62, -32, bw * 1.24, 64);
      x.shadowBlur = 0; x.fillStyle = '#ffe1ea'; x.font = '800 28px "DM Sans"'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.letterSpacing = '6px';
      x.fillText((s.outWhy || 'Sold out for now').toUpperCase(), 0, 2); x.letterSpacing = '0px';
      x.restore();
    }
  }
  const POL = { balanced: 'Balanced', delivery: 'Delivery first', rush: 'Rush menu', happy: 'Happy hour' };
  function drawPage(c) {
    const x = c.getContext('2d'), kind = c._kind;
    x.clearRect(0, 0, CPX, CPY);
    if (kind === 'cover' || kind === 'back') { coverArt(x, kind === 'back'); return; }
    x.drawImage(paperBG, 0, 0);
    const gg = c._side === 'back' ? x.createLinearGradient(CPX, 0, CPX - 130, 0) : x.createLinearGradient(0, 0, 130, 0);
    gg.addColorStop(0, 'rgba(90,50,40,.22)'); gg.addColorStop(1, 'rgba(90,50,40,0)');
    x.fillStyle = gg; x.fillRect(0, 0, CPX, CPY);
    const pad = 70;
    if (kind === 'welcome' || kind === 'notes') {
      x.fillStyle = '#3a2430'; x.font = '600 62px Fraunces'; x.textAlign = 'left'; x.textBaseline = 'alphabetic';
      x.fillText(kind === 'welcome' ? 'Hello, welcome in ♥' : 'House notes', pad, 150);
      x.font = '600 44px Caveat'; x.fillStyle = '#3b4f8f';
      const body = kind === 'welcome'
        ? ['This menu is alive — prices nudge', 'with the rush, the rain and', 'what’s left in the fridge.', '', 'Look for the little arrows:', '', '', 'Golden stickers are what', 'we’d order today.', '', '— the brew crew']
        : ['Oat, almond or soy on anything: +₹40', 'Allergies? We write them big', 'on your ticket.', 'Laptop friends: plugs under the', 'window bench. Refills half price.', '', 'Prices inclusive of 5% GST.', '', `Today’s policy: ${POL[B.state.policy]}`];
      body.forEach((ln, i) => x.fillText(ln, pad, 260 + i * 62));
      if (kind === 'welcome') { chip(x, pad, 260 + 5 * 62 - 30, 'up', '₹20 · rush hour'); chip(x, pad + 300, 260 + 5 * 62 - 30, 'down', '₹30 · slow afternoon'); }
    } else {
      const cat = B.CATS.find((cc) => cc.id === kind);
      x.fillStyle = '#3a2430'; x.font = '600 70px Fraunces'; x.textAlign = 'left'; x.textBaseline = 'alphabetic';
      x.fillText(cat.name, pad, 140);
      const nw = x.measureText(cat.name).width;
      x.fillStyle = '#e0607f'; x.font = 'italic 500 40px Fraunces'; x.fillText(cat.em, pad + nw + 20, 140);
      x.fillStyle = '#2f8f62'; x.beginPath(); x.arc(CPX - pad - 76, 124, 9, 0, 7); x.fill();
      x.font = '800 22px "DM Sans"'; x.letterSpacing = '4px'; x.fillText('LIVE', CPX - pad - 58, 132); x.letterSpacing = '0px';
      x.strokeStyle = '#ecd6d0'; x.lineWidth = 3; x.beginPath(); x.moveTo(pad, 170); x.lineTo(CPX - pad, 170); x.stroke();
      const items = B.MENU.filter((m) => m.cat === kind);
      const bw = (CPX - pad * 2 - 50) / 2;
      items.forEach((m, i) => drawItem(x, m.id, pad + (i % 2) * (bw + 50), 210 + Math.floor(i / 2) * 520, bw));
    }
    x.fillStyle = '#a08a95'; x.font = '600 26px Fraunces'; x.textAlign = 'center'; x.fillText(String(c._num || ''), CPX / 2, CPY - 40);
  }

  /* ---------- leaves ---------- */
  const SPEC = [['cover', 'welcome'], ['coffee', 'notcoffee'], ['bakes', 'plates'], ['notes', 'back']];
  const leaves = [];
  const allCanvases = [];
  SPEC.forEach(([front, back], i) => {
    const pivot = G.group(pages);
    const geo = new T.PlaneGeometry(PW, PH, SEGX, 1);
    geo.translate(PW / 2, 0, 0);
    const mk = (kind, side, num) => { const c = G.canvas(CPX, CPY); c._kind = kind; c._side = side; c._num = num; drawPage(c); allCanvases.push(c); return c; };
    const fc = mk(front, 'front', i * 2), bc = mk(back, 'back', i * 2 + 1);
    const ft = G.tex(fc, { wrap: false }), bt = G.tex(bc, { wrap: true });
    bt.repeat.x = -1; bt.offset.x = 1;
    const cov = (k) => k === 'cover' || k === 'back';
    const mat = (map, kind, side) => new T.MeshPhysicalMaterial({ map, side, roughness: cov(kind) ? 0.55 : 0.92, sheen: cov(kind) ? 0.6 : 0, sheenColor: new T.Color('#ffd0dc'), envMapIntensity: 0.45, emissive: '#ffffff', emissiveMap: map, emissiveIntensity: cov(kind) ? 0.02 : 0.16 });
    G.m(geo, mat(ft, front, T.FrontSide), { parent: pivot });
    G.m(geo, mat(bt, back, T.BackSide), { parent: pivot });
    leaves.push({ pivot, geo, fc, bc, ft, bt, angle: 0 });
  });
  const leatherTex = G.tex(leather, { wrap: false });
  G.m(G.rbox(PW - 0.008, PH - 0.01, 0.018, 0.003), G.mat('#fbf4e6', { roughness: 0.95 }), { p: [PW / 2, 0, -0.011], parent: pages });
  G.m(G.rbox(PW + 0.006, PH + 0.008, 0.006, 0.002), new T.MeshPhysicalMaterial({ map: leatherTex, roughness: 0.55, sheen: 0.6 }), { p: [PW / 2, 0, -0.022], parent: pages });
  G.m(G.cyl(0.013, 0.013, PH + 0.008, 16), new T.MeshPhysicalMaterial({ color: '#c2486c', roughness: 0.5, sheen: 0.6 }), { p: [0, 0, -0.011], parent: pages });

  let spread = 0;
  const LABELS = ['Cover', 'Welcome · Coffee', 'Not Coffee · Bakes', 'Plates · House notes', 'Back cover'];
  const zFor = (i, s) => (i < s ? 0.0012 * (i + 1) : 0.0012 * (leaves.length - i + 1));
  const bookX = () => (spread === 0 ? -PW / 2 : spread === leaves.length ? PW / 2 : 0);

  /** bend a leaf: rotate about the spine and curl along its width */
  function shape(lf, angle, bendAmt) {
    lf.angle = angle;
    const p = lf.geo.attributes.position, cols = SEGX + 1, dw = PW / SEGX;
    let px = 0, pz = 0;
    const xs = [0], zs = [0];
    for (let j = 1; j < cols; j++) {
      const phi = angle + bendAmt * Math.pow((j - 0.5) / SEGX, 1.6);
      px += Math.cos(phi) * dw;
      pz += -Math.sin(phi) * dw;
      xs.push(px); zs.push(pz);
    }
    for (let i = 0; i < p.count; i++) { const j = i % cols; p.setX(i, xs[j]); p.setZ(i, zs[j]); }
    p.needsUpdate = true;
    lf.geo.computeVertexNormals();
  }
  function ui() {
    B.$('#mo-page').textContent = LABELS[spread];
    B.$('#mo-prev').disabled = spread === 0;
    B.$('#mo-next').disabled = spread === leaves.length;
  }
  function settle() {
    leaves.forEach((lf, i) => { shape(lf, i < spread ? -Math.PI : 0, 0); lf.pivot.position.z = zFor(i, spread); });
    ui();
  }
  settle();

  function turn(dir, from, release = 0) {
    const idx = dir > 0 ? spread : spread - 1;
    if (idx < 0 || idx >= leaves.length) return;
    const lf = leaves[idx];
    const start = from != null ? from : dir > 0 ? 0 : -Math.PI, end = dir > 0 ? -Math.PI : 0;
    spread += dir;
    lf.pivot.position.z = 0.02;
    if (from == null) B.audio.play('page');
    const o = { a: start };
    gsap.to(o, {
      a: end, duration: Math.max(0.3, 0.35 + (Math.abs(end - start) / Math.PI) * 0.55 - release * 0.15), ease: 'power2.out',
      onUpdate: () => shape(lf, o.a, Math.sin((Math.abs(o.a) / Math.PI) * Math.PI) * 0.75 * (dir > 0 ? -1 : 1)),
      onComplete: settle,
    });
    gsap.to(pages.position, { x: bookX(), duration: 0.8, ease: 'power3.inOut' });
    ui();
  }

  /* ---------- reading mode (camera move + view transition) ---------- */
  let isOpen = false, unseen = 0;
  const badgeEl = B.h('<div class="book-badge" hidden>0</div>');
  G.anchor(badgeEl, home, [0.09, 0.37, 0.0]);

  function open() {
    if (isOpen) return;
    isOpen = true;
    unseen = 0;
    badge();
    allCanvases.forEach(drawPage);
    leaves.forEach((lf) => { lf.ft.needsUpdate = true; lf.bt.needsUpdate = true; });
    B.audio.play('whoosh');
    G.allowLook = false;
    G.modal = dragHandlers;
    const swap = () => { document.body.classList.add('reading'); B.$('#book-ui').hidden = false; };
    gsap.to(G.vignette, { darkness: 0.75, offset: 0.2, duration: 1.2 });
    B.vt(swap);
    const bp = new T.Vector3(); home.getWorldPosition(bp);
    pages.position.x = -PW / 2;
    const camPos = new T.Vector3(bp.x + 0.35, bp.y + 0.75, bp.z + 1.55), camTgt = new T.Vector3(bp.x + 0.12, bp.y + 0.3, bp.z - 0.5);
    G.camTo(camPos.toArray(), camTgt.toArray(), 1.2).then(() => {
      const dir = camTgt.clone().sub(camPos).normalize();
      const target = camPos.clone().addScaledVector(dir, 0.78);
      const cam = { position: camPos };
      G.scene.attach(book);
      const look = new T.Object3D();
      look.position.copy(target);
      look.lookAt(cam.position);
      const q0 = book.quaternion.clone(), q1 = look.quaternion.clone(), o = { k: 0 };
      const up = new T.Vector3(0, 1, 0).applyQuaternion(q1);
      const dest = target.clone().addScaledVector(up, -PH * 0.7);
      gsap.to(book.position, { x: dest.x, y: dest.y, z: dest.z, duration: 0.9, ease: 'power3.inOut' });
      gsap.to(o, { k: 1, duration: 0.9, ease: 'power3.inOut', onUpdate: () => book.quaternion.slerpQuaternions(q0, q1, o.k) });
      gsap.to(book.scale, { x: 1.4, y: 1.4, z: 1.4, duration: 0.9, ease: 'power3.inOut', onComplete: () => setTimeout(() => turn(1), 120) });
    });
  }
  function close() {
    if (!isOpen) return;
    isOpen = false;
    G.modal = null;
    const flipped = leaves.slice(0, spread).reverse();
    flipped.forEach((lf, k) => { const o = { a: -Math.PI }; gsap.to(o, { a: 0, duration: 0.4, delay: k * 0.07, onUpdate: () => shape(lf, o.a, Math.sin((Math.abs(o.a) / Math.PI) * Math.PI) * 0.5) }); });
    if (spread) B.audio.play('page');
    spread = 0;
    gsap.to(pages.position, { x: -PW / 2, duration: 0.5 });
    setTimeout(() => {
      settle();
      home.attach(book);
      gsap.to(book.position, { x: 0, y: 0.03, z: 0.03, duration: 0.8, ease: 'power3.inOut' });
      gsap.to(book.rotation, { x: -0.26, y: 0, z: 0, duration: 0.8, ease: 'power3.inOut' });
      gsap.to(book.scale, { x: 1, y: 1, z: 1, duration: 0.8, ease: 'power3.inOut', onComplete: () => B.audio.play('thud') });
      gsap.to(G.vignette, { darkness: 0.42, offset: 0.32, duration: 1.2 });
      const swap = () => { document.body.classList.remove('reading'); B.$('#book-ui').hidden = true; };
      B.vt(swap);
      G.camHome(1.3).then(() => (G.allowLook = true));
    }, 260 + flipped.length * 70);
  }

  let drag = null;
  const dragHandlers = {
    down(e) {
      const fwd = e.clientX > window.innerWidth / 2;
      const idx = fwd ? spread : spread - 1;
      drag = idx < 0 || idx >= leaves.length ? null : { fwd, idx, x0: e.clientX, lastX: e.clientX, lastT: performance.now(), v: 0, moved: false };
    },
    move(e) {
      if (!drag || !e.buttons) return;
      const dx = e.clientX - drag.x0;
      if (!drag.moved && Math.abs(dx) < 6) return;
      if (!drag.moved) { drag.moved = true; leaves[drag.idx].pivot.position.z = 0.02; B.audio.play('page'); }
      const now = performance.now();
      drag.v = (e.clientX - drag.lastX) / Math.max(1, now - drag.lastT);
      drag.lastX = e.clientX; drag.lastT = now;
      const span = window.innerWidth * 0.45;
      const a = drag.fwd ? B.clamp((dx / span) * Math.PI, -Math.PI, 0) : B.clamp(-Math.PI + (dx / span) * Math.PI, -Math.PI, 0);
      const k = Math.abs(a) / Math.PI;
      shape(leaves[drag.idx], a, Math.sin(k * Math.PI) * 0.9 * (drag.fwd ? -1 : 1) + B.clamp(-drag.v * 0.4, -0.5, 0.5));
    },
    up(e) {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (!d.moved) { if (e.target.tagName === 'CANVAS') turn(d.fwd ? 1 : -1); return; }
      const a = leaves[d.idx].angle;
      const commit = d.fwd ? a < -Math.PI / 2 || d.v < -0.45 : a > -Math.PI / 2 || d.v > 0.45;
      if (commit) turn(d.fwd ? 1 : -1, a, Math.min(1, Math.abs(d.v)));
      else {
        const o = { a };
        gsap.to(o, { a: d.fwd ? 0 : -Math.PI, duration: 1, ease: 'elastic.out(1, 0.5)', onUpdate: () => shape(leaves[d.idx], o.a, 0), onComplete: settle });
      }
    },
  };

  function badge() {
    badgeEl.hidden = unseen === 0;
    badgeEl.textContent = unseen > 9 ? '9+' : unseen;
  }
  function changed(ids) {
    if (!ids.length) return;
    if (!isOpen) {
      unseen += ids.length;
      badge();
      gsap.fromTo(badgeEl, { scale: 1.6 }, { scale: 1, duration: 0.5, ease: 'back.out(3)' });
      return;
    }
    const cats = new Set(ids.map((id) => B.ITEM[id].cat));
    leaves.forEach((lf) => [[lf.fc, lf.ft], [lf.bc, lf.bt]].forEach(([c, t]) => { if (cats.has(c._kind)) { drawPage(c); t.needsUpdate = true; } }));
    B.audio.play('rustle');
  }
  function refreshAll() { allCanvases.forEach(drawPage); leaves.forEach((lf) => { lf.ft.needsUpdate = true; lf.bt.needsUpdate = true; }); }

  G.pickable(home, { click: open, hover: (on) => gsap.to(book.position, { y: on ? 0.06 : 0.03, duration: 0.3 }) });
  B.menubook = { open, close, changed, refreshAll, get isOpen() { return isOpen; }, policyNote() {} };
  B.$('#mo-close').addEventListener('click', close);
  B.$('#mo-prev').addEventListener('click', () => turn(-1));
  B.$('#mo-next').addEventListener('click', () => turn(1));
  window.addEventListener('keydown', (e) => {
    if (!isOpen) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight') turn(1);
    if (e.key === 'ArrowLeft') turn(-1);
  });
})();
