/* brew · tickets.js — paper tickets on the steel pass rail (3D).
   Tickets slide in and swing on their clips, FLIP to new positions when the
   kitchen re-prioritises, fan together under a pink paperclip when batched,
   and tear in two (with a paper sound) when served. */
(function () {
  const B = window.B, T = THREE, G = B.gfx, A = B.art, L = B.L;
  const PX = 1450; // canvas px per metre (tickets are ~41cm — game-scale, so they read from the pass)
  const CW = 600, TW = CW / PX;
  const STAMP = { dine: ['DINE-IN', '#d6336c'], take: ['TAKEAWAY', '#22856f'], zomato: ['ZOMATO', '#d23434'], swiggy: ['SWIGGY', '#ec7716'] };
  const rail = G.group(G.scene, [0, L.railY, L.railZ + 0.022]);
  const batches = new Map();

  /* ---------- paper ---------- */
  const paperPat = (() => {
    const c = G.canvas(256, 256), x = c.getContext('2d');
    x.fillStyle = '#fffcf5'; x.fillRect(0, 0, 256, 256);
    const n = G.noise(128, 91);
    for (let i = 0; i < 6000; i++) { const v = n[i % 16384]; x.fillStyle = `rgba(${150 + v * 60},${120 + v * 50},${100},${0.03 + v * 0.03})`; x.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5); }
    for (let i = 0; i < 40; i++) { x.strokeStyle = 'rgba(160,130,110,.05)'; x.beginPath(); const px = Math.random() * 256, py = Math.random() * 256; x.moveTo(px, py); x.lineTo(px + Math.random() * 20, py + Math.random() * 4); x.stroke(); }
    return c;
  })();

  function wrapText(x, text, maxW) {
    const words = text.split(' ');
    const lines = [];
    let cur = '';
    words.forEach((w) => { const t = cur ? cur + ' ' + w : w; if (x.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; });
    if (cur) lines.push(cur);
    return lines;
  }

  function stamp(x, label, color, cx, cy, rot) {
    x.save();
    x.translate(cx, cy); x.rotate(rot);
    x.font = '800 24px "DM Sans"';
    x.letterSpacing = '3px';
    const w = x.measureText(label).width + 22;
    x.strokeStyle = color; x.lineWidth = 4;
    x.beginPath(); x.roundRect(-w / 2, -20, w, 40, 6); x.stroke();
    x.fillStyle = color; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(label, 0, 2);
    x.letterSpacing = '0px';
    // ink speckle
    x.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 90; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.8})`; x.beginPath(); x.arc((Math.random() - 0.5) * w, (Math.random() - 0.5) * 40, Math.random() * 2.2, 0, 7); x.fill(); }
    x.restore();
  }

  function layoutHeight(t) {
    let h = 40 + 64 + 58 + 18;
    h += Math.min(3, t.items.length) * 128 + (t.items.length > 3 ? 36 : 0);
    if (t.note) h += 58;
    h += 70 + 18;
    return Math.ceil(h);
  }

  function paint(t) {
    const x = t.ctx, H = t.ch;
    x.clearRect(0, 0, CW, H);
    // paper body with zigzag bottom
    x.save();
    x.beginPath();
    x.moveTo(0, 0); x.lineTo(CW, 0); x.lineTo(CW, H - 16);
    for (let px = CW; px >= 0; px -= 20) x.lineTo(px - 10, H - ((px / 20) % 2 ? 2 : 16));
    x.lineTo(0, H - 16); x.closePath();
    x.clip();
    x.fillStyle = x.createPattern(paperPat, 'repeat'); x.fillRect(0, 0, CW, H);
    // a little shading toward the bottom (paper curls away)
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(120,80,60,.07)'); x.fillStyle = g; x.fillRect(0, 0, CW, H);
    // perforation
    x.fillStyle = 'rgba(90,60,70,.22)';
    for (let px = 12; px < CW; px += 18) { x.beginPath(); x.arc(px, 30, 3, 0, 7); x.fill(); }
    let y = 46;
    // header
    x.fillStyle = '#2a2026'; x.font = '700 50px "Space Mono"'; x.textBaseline = 'alphabetic'; x.textAlign = 'left';
    x.fillText('#' + String(t.no).padStart(4, '0'), 26, y + 46);
    const [lab, col] = STAMP[t.channel];
    stamp(x, lab, col, CW - 26 - (x.measureText(lab).width + 40) / 2 - 6, y + 30, -0.1);
    y += 64;
    // persona + name + timer
    const icon = A.img(A.persona[t.persona] || A.persona.leisurely, 64, 64);
    if (icon.complete) x.drawImage(icon, 24, y + 4, 40, 40);
    x.fillStyle = '#3b4f8f'; x.font = '700 46px Caveat'; x.fillText(t.name, 74, y + 38);
    const rem = t.promise - B.state.t;
    const mins = Math.ceil(Math.abs(rem) / B.SEC_PER_MIN);
    x.font = '700 28px "Space Mono"'; x.textAlign = 'right';
    x.fillStyle = rem < 0 ? '#e0453a' : rem < 2 * B.SEC_PER_MIN ? '#d9831f' : '#6e5562';
    x.fillText(rem >= 0 ? `⏱ ${mins}m` : `LATE ${mins}m`, CW - 26, y + 36);
    x.textAlign = 'left';
    y += 58;
    x.strokeStyle = 'rgba(120,90,90,.35)'; x.setLineDash([8, 7]); x.lineWidth = 2; x.beginPath(); x.moveTo(24, y); x.lineTo(CW - 24, y); x.stroke(); x.setLineDash([]);
    y += 18;
    // items
    t.items.slice(0, 3).forEach((it) => {
      const m = B.ITEM[it.id];
      const im = B.food.imgs[it.id];
      x.save();
      x.shadowColor = 'rgba(80,30,50,.35)'; x.shadowBlur = 8; x.shadowOffsetY = 3;
      x.beginPath(); x.roundRect(24, y, 108, 108, 14); x.fillStyle = '#fbe1e8'; x.fill();
      x.restore();
      x.save(); x.beginPath(); x.roundRect(24, y, 108, 108, 14); x.clip();
      if (im && im.complete) x.drawImage(im, 24, y, 108, 108);
      // customisation overlays on the photo
      let cx = 28, cy = y + 108 - 30;
      it.mods.forEach((k) => {
        const md = B.MODS[k];
        x.font = '800 15px "DM Sans"';
        const lw = x.measureText(md.label.toUpperCase()).width + 34;
        if (cx + lw > 128) { cx = 28; cy -= 28; }
        x.fillStyle = 'rgba(255,255,255,.95)'; x.beginPath(); x.roundRect(cx, cy, lw, 24, 12); x.fill();
        const ic = A.img(A.modIcon[md.icon], 48, 48);
        if (ic.complete) x.drawImage(ic, cx + 3, cy + 2, 20, 20);
        x.fillStyle = '#2a2026'; x.fillText(md.label.toUpperCase(), cx + 25, cy + 18);
        if (md.x) { x.strokeStyle = '#e0453a'; x.lineWidth = 2.5; x.beginPath(); x.moveTo(cx + 24, cy + 13); x.lineTo(cx + lw - 4, cy + 13); x.stroke(); }
        cx += lw + 3;
      });
      x.restore();
      x.fillStyle = '#c43e64'; x.font = '700 30px "Space Mono"'; x.fillText(`${it.qty}×`, 148, y + 36);
      x.fillStyle = '#2a2026'; x.font = '700 30px "DM Sans"';
      const nameLines = wrapText(x, m.name, CW - 26 - 200);
      nameLines.slice(0, 2).forEach((ln, i) => x.fillText(ln, 200, y + 36 + i * 32));
      if (it.mods.length) {
        x.fillStyle = '#6e5562'; x.font = '500 21px "DM Sans"';
        const ml = wrapText(x, it.mods.map((k) => B.MODS[k].long).join(' · '), CW - 26 - 148);
        ml.slice(0, 2).forEach((ln, i) => x.fillText(ln, 148, y + 40 + nameLines.slice(0, 2).length * 32 + i * 24));
      }
      y += 128;
    });
    if (t.items.length > 3) { x.fillStyle = '#6e5562'; x.font = '600 22px "DM Sans"'; x.textAlign = 'center'; x.fillText(`+ ${t.items.length - 3} more`, CW / 2, y + 22); x.textAlign = 'left'; y += 36; }
    if (t.note) {
      x.save(); x.translate(28, y + 40); x.rotate(-0.03);
      x.fillStyle = '#2b5aa8'; x.font = '700 40px Caveat'; x.fillText(t.note, 0, 0);
      x.restore();
      y += 58;
    }
    // status
    y += 14;
    let st = 'QUEUED', pct = 0, barCol = ['#f6a9bd', '#e0607f'];
    if (t.state === 'queued') st = t.ahead ? `QUEUED · ${t.ahead} AHEAD` : 'QUEUED · NEXT UP';
    if (t.state === 'brewing') { pct = t.progress; st = t.progress >= 0.7 ? `ALMOST · ${Math.round(pct * 100)}%` : `BREWING · ${Math.round(pct * 100)}%`; if (t.progress >= 0.7) barCol = ['#f6c46a', '#f29a3b']; }
    if (t.state === 'ready') { pct = 1; st = t.channel === 'zomato' || t.channel === 'swiggy' ? 'READY · TAP TO BAG' : 'READY · TAP TO SERVE'; barCol = ['#8fdcb0', '#3fae7a']; }
    x.fillStyle = 'rgba(220,200,200,.55)'; x.beginPath(); x.roundRect(24, y, CW - 48, 12, 6); x.fill();
    if (pct > 0) { const bg = x.createLinearGradient(24, 0, CW - 24, 0); bg.addColorStop(0, barCol[0]); bg.addColorStop(1, barCol[1]); x.fillStyle = bg; x.beginPath(); x.roundRect(24, y, (CW - 48) * pct, 12, 6); x.fill(); }
    x.fillStyle = t.state === 'ready' ? '#2f8f62' : '#6e5562'; x.font = '700 22px "Space Mono"'; x.fillText(st, 24, y + 44);
    if (t.bumped) { x.fillStyle = '#e0607f'; x.beginPath(); x.roundRect(CW - 150, y + 22, 128, 30, 8); x.fill(); x.fillStyle = '#fff'; x.font = '800 18px "DM Sans"'; x.fillText('BUMPED ↑', CW - 138, y + 43); }
    if (t.state === 'ready') stamp(x, 'READY', '#2f9b68', CW - 120, 200, -0.22);
    if (t.voided) stamp(x, 'VOID', '#e0453a', CW / 2, H / 2, -0.3);
    x.restore();
    t.tex.needsUpdate = true;
    t.sig = sigOf(t);
  }
  const sigOf = (t) => [t.state, Math.round(t.progress * 20), Math.ceil((t.promise - B.state.t) / B.SEC_PER_MIN), t.ahead, t.bumped, t.voided].join('|');

  function geometryFor(w, h) {
    const g = new T.PlaneGeometry(w, h, 8, 12);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const xx = p.getX(i) / w, yy = p.getY(i) / h; p.setZ(i, -xx * xx * 0.012 + (0.5 - yy) * (0.5 - yy) * 0.01); }
    g.computeVertexNormals();
    return g;
  }

  function render(t) {
    t.ch = layoutHeight(t);
    t.canvas = G.canvas(CW, t.ch);
    t.ctx = t.canvas.getContext('2d');
    t.tex = G.tex(t.canvas, { wrap: false });
    const h = t.ch / PX;
    t.h = h;
    const mat = new T.MeshStandardMaterial({ map: t.tex, alphaTest: 0.5, roughness: 0.88, side: T.DoubleSide, normalMap: G.lib('paperN'), normalScale: new T.Vector2(0.15, 0.15), envMapIntensity: 0.4, emissive: '#ffffff', emissiveMap: t.tex, emissiveIntensity: 0.06 });
    const pivot = new T.Group();
    const mesh = G.m(geometryFor(TW, h), mat, { p: [0, -h / 2 - 0.012, 0], parent: pivot });
    mesh.customDepthMaterial = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking, map: t.tex, alphaTest: 0.5 });
    G.m(G.rbox(0.06, 0.032, 0.026, 0.008), G.metal('#e8eaef', 0.2), { p: [0, -0.008, 0.004], parent: pivot });
    G.m(G.cyl(0.006, 0.006, 0.03, 12), G.metal('#c9ccd3', 0.25), { p: [0, -0.012, 0.018], r: [Math.PI / 2, 0, 0], parent: pivot });
    t.pivot = pivot; t.mesh = mesh;
    pivot.userData.ticket = t;
    t.sway = Math.random() * 6;
    rail.add(pivot);
    pivot.visible = false;
    paint(t);
    G.pickable(mesh, {
      click: () => B.emit('ticket:click', t),
      hover: (on) => { gsap.to(mesh.position, { z: on ? 0.05 : 0, duration: 0.25 }); gsap.to(mesh.scale, { x: on ? 1.04 : 1, y: on ? 1.04 : 1, duration: 0.25 }); if (on) B.audio.play('rustle', 800); },
    });
    return t;
  }

  /* ---------- clip for batches ---------- */
  function paperclip() {
    const pts = [[0, -0.07], [0, 0.04], [0.012, 0.055], [0.028, 0.04], [0.028, -0.06], [0.014, -0.075], [0.002, -0.06], [0.002, 0.02]].map(([a, b]) => new T.Vector3(a - 0.014, b, 0));
    const g = new T.Group();
    G.m(new T.TubeGeometry(new T.CatmullRomCurve3(pts, false, 'catmullrom', 0.2), 80, 0.0028, 8), G.mat('#f07ea0', { metalness: 0.75, roughness: 0.25 }), { parent: g });
    return g;
  }

  /* ---------- layout (FLIP: animate from the old slot to the new one) ---------- */
  const AVAIL = L.railX[1] - L.railX[0] - 0.06, GAP = 0.024, STEP = 0.075;
  function layout(order, newcomers = []) {
    const units = [];
    order.forEach((t) => {
      const last = units[units.length - 1];
      if (t.batch && last && last.batch === t.batch) last.tickets.push(t);
      else units.push({ batch: t.batch || null, tickets: [t] });
    });
    const widths = units.map((u) => TW + (u.tickets.length - 1) * STEP);
    const sum = widths.reduce((a, b) => a + b, 0);
    let gap = GAP;
    if (units.length > 1 && sum + GAP * (units.length - 1) > AVAIL) gap = Math.max(-TW + 0.08, (AVAIL - sum) / (units.length - 1));
    let x = L.railX[0] + 0.03;
    const live = new Set();
    units.forEach((u, ui) => {
      u.tickets.forEach((t, i) => {
        const tx = x + TW / 2 + i * STEP;
        const tz = -ui * 0.004 - i * 0.008;
        const rot = u.tickets.length > 1 ? [0, -0.04, 0.03][i] || 0 : ((t.rot || 0) * Math.PI) / 180;
        t.slotX = tx;
        if (newcomers.includes(t)) {
          t.pivot.visible = true;
          t.pivot.position.set(tx + 1.4, 0.06, tz);
          t.pivot.rotation.z = 0.25;
          gsap.to(t.pivot.position, { x: tx, y: 0, duration: 0.8, ease: 'power3.out' });
          gsap.to(t.pivot.rotation, { z: -0.18, duration: 0.45, ease: 'power2.out', onComplete: () => gsap.to(t.pivot.rotation, { z: rot, duration: 1.6, ease: 'elastic.out(1.1, 0.25)' }) });
          setTimeout(() => B.audio.play('clip', 900), 600);
        } else {
          gsap.to(t.pivot.position, { x: tx, y: 0, z: tz, duration: 0.65, ease: 'power3.out', overwrite: 'auto' });
          gsap.to(t.pivot.rotation, { z: rot, duration: 0.8, ease: 'back.out(2)', overwrite: 'auto' });
        }
        t.baseRot = rot;
      });
      if (u.batch && u.tickets.length > 1) {
        live.add(u.batch);
        let bt = batches.get(u.batch);
        if (!bt) {
          const clip = paperclip();
          rail.add(clip);
          const tag = B.h('<div class="batch-tag glass-chip"></div>');
          bt = { clip, tag, anchor: G.anchor(tag, clip, [0.03, 0.07, 0]) };
          batches.set(u.batch, bt);
          clip.position.set(x + 0.045, -0.02, 0.03);
          clip.scale.setScalar(0.01);
          gsap.to(clip.scale, { x: 1, y: 1, z: 1, duration: 0.5, delay: 0.3, ease: 'back.out(2.6)', onStart: () => B.audio.play('clip', 700) });
          gsap.fromTo(tag, { scale: 0 }, { scale: 1, duration: 0.4, delay: 0.45, ease: 'back.out(2.4)' });
        }
        bt.tag.textContent = `Batch ×${u.tickets.length}`;
        gsap.to(bt.clip.position, { x: x + 0.045, y: -0.02, z: 0.03, duration: 0.65, ease: 'power3.out' });
        bt.clip.rotation.z = -0.15;
      }
      x += widths[ui] + gap;
    });
    batches.forEach((bt, id) => {
      if (!live.has(id)) {
        bt.anchor.remove();
        gsap.to(bt.clip.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.3, onComplete: () => rail.remove(bt.clip) });
        batches.delete(id);
      }
    });
    B.emit('rail:count', order.length);
  }

  /* ---------- tear-off ---------- */
  function tear(t, { voided = false } = {}) {
    return new Promise((res) => {
      if (!t.pivot) return res();
      if (voided) { t.voided = true; paint(t); }
      G.unpick(t.mesh);
      const H = t.ch;
      const jag = [];
      for (let px = 0; px <= CW; px += 16) jag.push([px, 66 + B.rand(-7, 7)]);
      const piece = (top) => {
        const c = G.canvas(CW, H), x = c.getContext('2d');
        x.save(); x.beginPath();
        if (top) { x.moveTo(0, 0); x.lineTo(CW, 0); jag.slice().reverse().forEach(([a, b]) => x.lineTo(a, b)); }
        else { jag.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b))); x.lineTo(CW, H); x.lineTo(0, H); }
        x.closePath(); x.clip(); x.drawImage(t.canvas, 0, 0); x.restore();
        const tex = G.tex(c, { wrap: false });
        const m = new T.Mesh(t.mesh.geometry, new T.MeshStandardMaterial({ map: tex, alphaTest: 0.5, transparent: true, roughness: 0.9, side: T.DoubleSide }));
        m.position.copy(t.mesh.position);
        m.castShadow = true;
        t.pivot.add(m);
        return m;
      };
      const topM = piece(true), body = piece(false);
      t.mesh.visible = false;
      B.audio.play(voided ? 'rip' : 'tear', 800);
      const dir = Math.random() < 0.5 ? -1 : 1;
      // the body tugs, rips free and tumbles off the rail
      const tl = gsap.timeline({ onComplete: () => { t.pivot.parent && rail.remove(t.pivot); res(); } });
      tl.to(body.position, { y: '-=0.02', duration: 0.1, ease: 'power2.out' })
        .to(body.rotation, { z: dir * 0.08, duration: 0.1 }, '<')
        .to(body.position, { y: '-=0.9', x: `+=${dir * B.rand(0.08, 0.2)}`, z: '+=0.25', duration: 0.85, ease: 'power2.in' })
        .to(body.rotation, { z: dir * B.rand(0.5, 1.1), x: B.rand(0.6, 1.4), duration: 0.85, ease: 'power1.in' }, '<')
        .to(body.material, { opacity: 0, duration: 0.3 }, '-=0.3');
      gsap.timeline()
        .to(topM.rotation, { z: dir * 0.12, duration: 0.15, yoyo: true, repeat: 3, ease: 'sine.inOut' })
        .to(topM.material, { opacity: 0, duration: 0.5, delay: 0.4 });
    });
  }

  function wiggle(t) {
    gsap.fromTo(t.pivot.rotation, { z: t.baseRot - 0.12 }, { z: t.baseRot, duration: 0.9, ease: 'elastic.out(1.4, 0.3)' });
    B.audio.play('rustle', 800);
  }

  function refresh(t, ahead) {
    if (!t.ctx) return;
    t.ahead = ahead;
    if (sigOf(t) !== t.sig) paint(t);
    // ready tickets glow softly
    const m = t.mesh.material;
    const target = t.state === 'ready' ? 0.22 + Math.sin(G.time * 5) * 0.08 : 0.06;
    m.emissiveIntensity += (target - m.emissiveIntensity) * 0.2;
    m.emissive.set(t.state === 'ready' ? '#d8ffe8' : '#ffffff');
  }

  // idle sway from the kitchen draught
  G.onFrame((dt, time) => {
    rail.children.forEach((p) => {
      const t = p.userData.ticket;
      if (t && t.mesh.visible) t.mesh.rotation.x = Math.sin(time * 1.1 + t.sway) * 0.03 - 0.03;
    });
  });

  B.tickets = { render, layout, tear, wiggle, refresh, rail };
})();
