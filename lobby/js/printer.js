/* brew · printer.js — thermal bill printer + receipt spike (3D).
   The receipt is a bendable paper strip: it feeds out of the slot line by
   line, curls back over the printer as it grows, then tears and flutters
   down onto the spike. */
(function () {
  const B = window.B, T = THREE, G = B.gfx, A = B.art, L = B.L;
  const queue = [];
  let busy = false, lastReceipt = null, spiked = 0;

  /* ---------- the printer ---------- */
  const pr = G.group(G.scene, [L.printer[0], L.counterTop, L.printer[1]]);
  pr.rotation.y = -0.18;
  const shell = G.mat('#f6c3d0', { physical: true, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.1 });
  const shell2 = G.mat('#fdf2f5', { physical: true, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 });
  G.m(G.rbox(0.26, 0.12, 0.3, 0.035), shell, { p: [0, 0.06, 0], parent: pr });
  G.m(G.rbox(0.24, 0.05, 0.2, 0.03), shell2, { p: [0, 0.125, -0.03], parent: pr });
  G.m(G.rbox(0.17, 0.008, 0.012, 0.003), G.mat('#2a2126', { roughness: 0.4 }), { p: [0, 0.149, 0.07], parent: pr });
  G.m(G.rbox(0.18, 0.012, 0.014, 0.004), G.metal('#cfd2d9', 0.3), { p: [0, 0.152, 0.085], parent: pr });
  const led = G.m(G.sph(0.008, 12, 8), new T.MeshStandardMaterial({ color: '#9de7bd', emissive: '#6fe0a4', emissiveIntensity: 2.5 }), { p: [0.09, 0.08, 0.151], parent: pr, cast: false });
  G.m(G.cyl(0.014, 0.014, 0.01, 20), G.mat('#ffffff', { roughness: 0.3 }), { p: [0.06, 0.08, 0.151], r: [Math.PI / 2, 0, 0], parent: pr });
  {
    const c = G.canvas(256, 64), x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.font = 'italic 700 44px Fraunces'; x.textBaseline = 'middle'; x.fillText('brew', 10, 34);
    B.on('fonts', () => { x.clearRect(0, 0, 256, 64); x.fillStyle = '#ffffff'; x.font = 'italic 700 44px Fraunces'; x.fillText('brew', 10, 34); logoTex.needsUpdate = true; });
    const logoTex = G.tex(c, { wrap: false });
    G.m(new T.PlaneGeometry(0.1, 0.025), new T.MeshStandardMaterial({ map: logoTex, transparent: true, roughness: 0.4 }), { p: [-0.05, 0.075, 0.1505], parent: pr, cast: false });
  }
  // a paper roll peeking out the back
  G.m(G.cyl(0.04, 0.04, 0.16, 24), G.mat('#fffdf6', { roughness: 0.8 }), { p: [0, 0.11, -0.1], r: [0, 0, Math.PI / 2], parent: pr });

  /* ---------- the spike ---------- */
  const spike = G.group(G.scene, [L.spike[0], L.counterTop, L.spike[1]]);
  G.m(G.cyl(0.05, 0.055, 0.02, 32), shell, { p: [0, 0.01, 0], parent: spike });
  G.m(G.cyl(0.003, 0.0045, 0.17, 10), G.metal('#e1e4ea', 0.15), { p: [0, 0.1, 0], parent: spike });
  G.m(new T.ConeGeometry(0.003, 0.012, 10), G.metal('#e1e4ea', 0.15), { p: [0, 0.19, 0], parent: spike });
  const stack = G.group(spike, [0, 0.025, 0]);
  G.pickable(spike, {
    click: () => {
      if (!lastReceipt) return B.toast('🧾', 'No receipts yet', 'They land on the spike after each payment.');
      const z = B.h(`<div class="receipt-zoom"><div class="receipt-card"><img src="${lastReceipt}" alt="Last receipt"></div></div>`);
      document.body.appendChild(z);
      gsap.from(z.firstChild, { y: 60, rotation: -6, scale: 0.6, opacity: 0, duration: 0.55, ease: 'back.out(1.6)' });
      B.audio.play('rustle');
      z.addEventListener('click', () => gsap.to(z, { opacity: 0, duration: 0.25, onComplete: () => z.remove() }));
    },
  });

  /* ---------- receipt content (canvas) ---------- */
  const RW = 340, PX = RW / 0.11; // 11cm wide paper
  function lines(bill) {
    const out = [];
    const d = new Date(2026, 9, 2 + B.state.day);
    const ck = B.fmtClock(B.gameMin());
    out.push({ t: 'logo' }, { c: '12, 100 Ft Rd, Indiranagar' }, { c: 'GSTIN 29BREW0000C1Z5' }, { rule: 1 });
    out.push({ l: `Bill #${String(bill.no).padStart(4, '0')}`, r: bill.where, b: 1 });
    out.push({ l: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }), r: `${ck.hm} ${ck.ap}` });
    out.push({ l: `Guest: ${bill.name}` }, { rule: 1 });
    let sub = 0;
    bill.items.forEach((it) => {
      const m = B.ITEM[it.id];
      const p = it.price * it.qty;
      sub += p;
      out.push({ l: `${it.qty} ${m.name.length > 17 ? m.name.slice(0, 16) + '.' : m.name}`, r: p.toFixed(2) });
      it.mods.forEach((k) => {
        const md = B.MODS[k];
        if (md.price) { sub += md.price * it.qty; out.push({ l: `   + ${md.long}`, r: (md.price * it.qty).toFixed(2) }); }
        else out.push({ l: `   ${md.x ? 'no ' + md.label : md.long}` });
      });
    });
    const cg = Math.round(sub * 2.5) / 100, tot = sub + cg * 2, rnd = Math.round(tot) - tot;
    out.push({ rule: 1 }, { l: 'Subtotal', r: sub.toFixed(2) }, { l: 'CGST @2.5%', r: cg.toFixed(2) }, { l: 'SGST @2.5%', r: cg.toFixed(2) }, { l: 'Round off', r: (rnd >= 0 ? '+' : '') + rnd.toFixed(2) });
    out.push({ l: 'TOTAL', r: '₹' + Math.round(tot).toLocaleString('en-IN'), big: 1 }, { rule: 1 }, { l: `Paid · ${bill.pay}`, r: '✓' }, { qr: bill.no * 13 + 7 }, { c: 'scan to rate us ♥' }, { c: 'thank you · come back soon' }, { gap: 1 });
    return { lines: out, total: Math.round(tot) };
  }
  function lineH(l) { return l.t === 'logo' ? 64 : l.rule ? 16 : l.qr ? 150 : l.big ? 40 : l.gap ? 30 : 26; }
  function drawReceipt(ls, upto) {
    const H = ls.reduce((s, l) => s + lineH(l), 20);
    const c = G.canvas(RW, H), x = c.getContext('2d');
    x.fillStyle = '#fffdf8'; x.fillRect(0, 0, RW, H);
    const n = G.noise(64, 5);
    for (let i = 0; i < 1500; i++) { x.fillStyle = `rgba(120,100,90,${n[i % 4096] * 0.05})`; x.fillRect(Math.random() * RW, Math.random() * H, 1.5, 1.5); }
    let y = 12;
    x.fillStyle = '#1d1a1c';
    ls.forEach((l, i) => {
      const h = lineH(l);
      if (i < upto) {
        x.textBaseline = 'middle';
        const fade = 0.82 + Math.random() * 0.18;
        x.globalAlpha = fade;
        if (l.t === 'logo') { x.font = 'italic 700 46px Fraunces'; x.textAlign = 'center'; x.fillText('brew', RW / 2, y + h / 2); }
        else if (l.rule) { x.setLineDash([6, 5]); x.strokeStyle = '#555'; x.lineWidth = 2; x.beginPath(); x.moveTo(14, y + h / 2); x.lineTo(RW - 14, y + h / 2); x.stroke(); x.setLineDash([]); }
        else if (l.qr) { const im = A.img(A.qr(l.qr), 280, 280); if (im.complete) x.drawImage(im, RW / 2 - 66, y + 8, 132, 132); }
        else if (l.c) { x.font = '400 17px "Space Mono"'; x.textAlign = 'center'; x.fillText(l.c, RW / 2, y + h / 2); }
        else if (!l.gap) {
          x.font = `${l.b || l.big ? 700 : 400} ${l.big ? 24 : 18}px "Space Mono"`;
          x.textAlign = 'left'; x.fillText(l.l, 14, y + h / 2);
          if (l.r) { x.textAlign = 'right'; x.fillText(l.r, RW - 14, y + h / 2); }
        }
        x.globalAlpha = 1;
      }
      y += h;
    });
    return c;
  }

  /* ---------- the paper strip mesh ---------- */
  const SEG = 60;
  const slotLocal = new T.Vector3(0, 0.152, 0.07);
  function stripGeo() {
    const g = new T.PlaneGeometry(0.11, 1, 1, SEG);
    return g;
  }
  /** bend the strip: s=0 at the slot, rising, then curling back over the printer */
  function bend(geo, visLen, totalLen) {
    const p = geo.attributes.position, uv = geo.attributes.uv;
    const straight = 0.11, R = 0.055;
    for (let i = 0; i < p.count; i++) {
      const row = Math.floor(i / 2); // 2 verts per row
      const k = 1 - row / SEG; // 0 bottom → 1 top
      const s = k * visLen;
      let y, z;
      if (s <= straight) { y = s; z = 0; }
      else {
        const a = Math.min((s - straight) / R, Math.PI * 0.95);
        y = straight + Math.sin(a) * R;
        z = -(1 - Math.cos(a)) * R;
        const extra = s - straight - a * R;
        if (extra > 0) { y += Math.cos(Math.PI * 0.95) * 0 - extra * Math.sin(Math.PI * 0.05); z += -extra; }
      }
      p.setY(i, y);
      p.setZ(i, z);
      // texture: the far end shows the top of the bill
      uv.setY(i, 1 - (visLen - s) / totalLen);
    }
    p.needsUpdate = true;
    uv.needsUpdate = true;
    geo.computeVertexNormals();
  }

  async function run() {
    if (busy || !queue.length) return;
    busy = true;
    const job = queue.shift();
    const fast = B.state.speed >= 10 || queue.length > 2;
    const totalH = job.lines.reduce((s, l) => s + lineH(l), 20);
    const totalLen = totalH / PX;
    const geo = stripGeo();
    const tex = G.tex(drawReceipt(job.lines, 0), { wrap: false });
    const mat = new T.MeshStandardMaterial({ map: tex, roughness: 0.85, side: T.DoubleSide, envMapIntensity: 0.3 });
    const strip = new T.Mesh(geo, mat);
    strip.castShadow = true;
    strip.position.copy(slotLocal);
    pr.add(strip);
    led.material.emissive.set('#ffb02e');
    B.audio.play('printFeed');
    const steps = job.lines.length;
    let y = 0;
    for (let i = 1; i <= steps; i++) {
      y += lineH(job.lines[i - 1]);
      const vis = (y + 10) / PX;
      tex.image = drawReceipt(job.lines, i);
      tex.needsUpdate = true;
      if (fast) continue;
      const o = { v: (y - lineH(job.lines[i - 1])) / PX };
      await new Promise((r) => gsap.to(o, { v: vis, duration: job.lines[i - 1].qr ? 0.28 : 0.09, ease: 'none', onUpdate: () => bend(geo, o.v, totalLen), onComplete: r }));
      B.audio.play('printLine', i);
      led.material.emissiveIntensity = i % 2 ? 3 : 1.5;
    }
    bend(geo, totalLen, totalLen);
    led.material.emissive.set('#6fe0a4');
    led.material.emissiveIntensity = 2.5;
    lastReceipt = tex.image.toDataURL('image/png');
    if (!fast) await new Promise((r) => setTimeout(r, 350));
    B.audio.play('rip');
    await flutter(strip, totalLen, fast);
    busy = false;
    run();
  }

  function flutter(strip, len, fast) {
    return new Promise((res) => {
      // detach into world space, flatten, then tumble onto the spike
      const wp = new T.Vector3(), wq = new T.Quaternion();
      strip.getWorldPosition(wp);
      strip.getWorldQuaternion(wq);
      pr.remove(strip);
      G.scene.add(strip);
      strip.position.copy(wp);
      strip.quaternion.copy(wq);
      const o = { k: 0 };
      const target = new T.Vector3(); spike.localToWorld(target.set(0, 0.17, 0));
      const tl = gsap.timeline({ onComplete: () => { G.scene.remove(strip); addSpiked(); res(); } });
      tl.to(o, { k: 1, duration: fast ? 0.15 : 0.3, onUpdate: () => bend(strip.geometry, len * (1 - o.k * 0.0001), len) });
      tl.to(strip.position, { y: wp.y + 0.18, duration: fast ? 0.15 : 0.35, ease: 'power2.out' }, 0);
      tl.to(strip.scale, { x: 0.45, y: 0.45, z: 0.45, duration: fast ? 0.3 : 1.1, ease: 'power1.inOut' }, 0.1);
      tl.to(strip.position, { x: target.x, z: target.z, duration: fast ? 0.3 : 1.1, ease: 'sine.inOut' }, 0.15);
      tl.to(strip.position, { y: target.y - 0.02, duration: fast ? 0.2 : 0.8, ease: 'power2.in' }, fast ? 0.2 : 0.45);
      tl.to(strip.rotation, { x: -1.3, z: 0.5, y: '+=1.2', duration: fast ? 0.3 : 1.2, ease: 'sine.inOut' }, 0.1);
    });
  }
  function addSpiked() {
    if (stack.children.length >= 10) stack.children.slice().forEach((c, i) => gsap.to(c.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.3, delay: i * 0.02, onComplete: () => stack.remove(c) }));
    const n = stack.children.length;
    const g = new T.PlaneGeometry(0.075, 0.06, 4, 4);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, (Math.random() - 0.5) * 0.006 + Math.abs(p.getX(i)) * 0.15);
    g.computeVertexNormals();
    const m = G.m(g, G.mat('#fffdf6', { roughness: 0.9, side: T.DoubleSide }), { parent: stack });
    m.rotation.set(-Math.PI / 2 + B.rand(-0.15, 0.15), 0, B.rand(0, 6));
    m.position.y = 0.15;
    gsap.to(m.position, { y: n * 0.005, duration: 0.35, ease: 'power3.in', onComplete: () => B.audio.play('thud', 1400) });
    spiked++;
  }

  B.printer = {
    print(bill) {
      const l = lines(bill);
      queue.push(l);
      run();
      return l.total;
    },
    group: pr,
  };
})();
