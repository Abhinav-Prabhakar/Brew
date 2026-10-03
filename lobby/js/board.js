/* brew · board.js — the customer-facing split-flap ("Solari") board.
   A real 3D board hung from the ceiling; its face is a live canvas where each
   character cell flips through the alphabet with a hinged-flap animation. */
(function () {
  const B = window.B, T = THREE, G = B.gfx;
  const CHARS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#-';
  const COLS = [
    { id: 'brewing', label: 'NOW BREWING', c: '#f6a3b8' },
    { id: 'almost', label: 'ALMOST READY', c: '#f3b45a' },
    { id: 'ready', label: 'READY FOR PICKUP', c: '#6fe0a4' },
  ];
  const ROWS = 4, W = 9;
  const CW = 2048, CH = 600;
  const cellW = 60, cellH = 92, gap = 5, colW = W * (cellW + gap) - gap, colGap = (CW - 3 * colW) / 4;
  const canvas = G.canvas(CW, CH), ctx = canvas.getContext('2d');
  const tex = G.tex(canvas, { wrap: false });
  const cells = {}; // col -> rows -> cells
  const counts = { brewing: 0, almost: 0, ready: 0 };
  let foot = { load: 0, clock: '08:00 AM' };
  let pending = 0;
  const flipping = new Set();

  const cellXY = (ci, r, i) => [colGap + ci * (colW + colGap) + i * (cellW + gap), 112 + r * (cellH + 14)];

  function drawCellBase(x, y) {
    const g = ctx.createLinearGradient(0, y, 0, y + cellH);
    g.addColorStop(0, '#3a3237'); g.addColorStop(0.49, '#2c2529'); g.addColorStop(0.51, '#241e22'); g.addColorStop(1, '#2e272b');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(x, y, cellW, cellH, 7); ctx.fill();
  }
  function glyph(ch, x, y, color) {
    ctx.fillStyle = color;
    ctx.font = '700 70px "Space Mono"';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ch, x + cellW / 2, y + cellH / 2 + 4);
  }
  function half(ch, x, y, top, color, shade = 0) {
    ctx.save();
    ctx.beginPath(); ctx.rect(x, top ? y : y + cellH / 2, cellW, cellH / 2); ctx.clip();
    drawCellBase(x, y);
    glyph(ch, x, y, color);
    if (shade) { ctx.fillStyle = `rgba(0,0,0,${shade})`; ctx.fillRect(x, y, cellW, cellH); }
    ctx.restore();
  }
  function drawCell(c) {
    const [x, y] = c.xy;
    ctx.clearRect(x - 2, y - 2, cellW + 4, cellH + 4);
    ctx.fillStyle = '#1b1619'; ctx.fillRect(x - 2, y - 2, cellW + 4, cellH + 4);
    const color = c.col === 'ready' ? '#c2f5d6' : '#f8f2e8';
    if (c.anim == null) {
      half(c.cur, x, y, true, color);
      half(c.cur, x, y, false, color);
    } else {
      // classic split flap: new top revealed, old bottom until the flap lands
      const k = c.anim; // 0..1
      half(c.next, x, y, true, color);
      half(c.cur, x, y, false, color);
      const mid = y + cellH / 2;
      if (k < 0.5) {
        const s = Math.cos(k * Math.PI); // 1 → 0
        ctx.save(); ctx.translate(0, mid); ctx.scale(1, s); ctx.translate(0, -mid);
        half(c.cur, x, y, true, color, (1 - s) * 0.5);
        ctx.restore();
      } else {
        const s = -Math.cos(k * Math.PI); // 0 → 1
        ctx.save(); ctx.translate(0, mid); ctx.scale(1, s); ctx.translate(0, -mid);
        half(c.next, x, y, false, color, (1 - s) * 0.4);
        ctx.restore();
      }
    }
    ctx.fillStyle = '#0d0a0c'; ctx.fillRect(x, y + cellH / 2 - 1.5, cellW, 3);
    ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(x + 2, y + 2, cellW - 4, 2);
  }
  function drawChrome() {
    ctx.fillStyle = '#1b1619'; ctx.fillRect(0, 0, CW, CH);
    COLS.forEach((col, ci) => {
      const x = colGap + ci * (colW + colGap);
      ctx.fillStyle = col.c; ctx.shadowColor = col.c; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(x + 12, 62, 9, 0, 7); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#f6c3d0'; ctx.font = '700 34px "DM Sans"'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.letterSpacing = '6px';
      ctx.fillText(col.label, x + 34, 63);
      ctx.letterSpacing = '0px';
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '48px VT323'; ctx.textAlign = 'right';
      ctx.fillText(String(counts[col.id]), x + colW, 64);
    });
    drawFoot();
  }
  function drawFoot() {
    ctx.fillStyle = '#1b1619'; ctx.fillRect(0, CH - 64, CW, 64);
    ctx.fillStyle = '#f3b45a'; ctx.font = '46px VT323'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.shadowColor = '#f3b45a'; ctx.shadowBlur = 10;
    ctx.fillText(`KITCHEN ${foot.load}%  ·  3 STATIONS  ·  brew`, colGap, CH - 32);
    ctx.textAlign = 'right'; ctx.fillText(foot.clock, CW - colGap, CH - 32);
    ctx.shadowBlur = 0;
  }

  function nextChar(cur, target) {
    const a = CHARS.indexOf(cur), b = CHARS.indexOf(target);
    if (a < 0 || b < 0) return target;
    const d = (b - a + CHARS.length) % CHARS.length;
    if (d > 5) return CHARS[(b - 4 + CHARS.length) % CHARS.length];
    return CHARS[(a + 1) % CHARS.length];
  }
  function kick(c) {
    if (c.anim != null || c.cur === c.target) return;
    c.next = nextChar(c.cur, c.target);
    c.anim = 0;
    c.delay = c.delay || 0;
    flipping.add(c);
  }

  // build the 3D board
  const group = G.group(G.scene, [0, 3.12, -1.5]);
  {
    const w = 3.56, h = 1.06;
    G.m(G.rbox(w + 0.1, h + 0.1, 0.1, 0.04), G.mat('#f2a3b8', { physical: true, roughness: 0.3, clearcoat: 0.8 }), { p: [0, 0, -0.03], parent: group });
    G.m(G.rbox(w, h, 0.12, 0.035), G.mat('#2a2327', { physical: true, roughness: 0.35, clearcoat: 0.6 }), { parent: group });
    const face = new T.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.28, roughness: 0.42, metalness: 0.1 });
    G.m(new T.PlaneGeometry(w - 0.1, ((w - 0.1) * CH) / CW), face, { p: [0, 0, 0.062], parent: group, cast: false });
    // a sheet of glass in front
    G.m(new T.PlaneGeometry(w - 0.06, h - 0.06), new T.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.06, roughness: 0.02, envMapIntensity: 1.5, depthWrite: false }), { p: [0, 0, 0.068], parent: group, cast: false, recv: false });
    [-1.1, 1.1].forEach((x) => G.m(G.cyl(0.012, 0.012, B.L.ceil - 3.12 - h / 2, 10), G.brass(), { p: [x, (B.L.ceil - 3.12) / 2 + h / 4, 0], parent: group }));
  }
  G.onFrame((dt) => {
    if (!flipping.size) return;
    flipping.forEach((c) => {
      if (c.delay > 0) { c.delay -= dt; return; }
      c.anim += dt / 0.11;
      if (c.anim >= 1) {
        c.cur = c.next;
        c.anim = null;
        pending++;
        flipping.delete(c);
        drawCell(c);
        kick(c);
      } else drawCell(c);
    });
    tex.needsUpdate = true;
  });
  setInterval(() => { if (pending) { B.audio.play('clatter', Math.min(18, pending)); pending = 0; } }, 240);

  B.board = {
    init() {
      COLS.forEach((col, ci) => {
        cells[col.id] = [];
        for (let r = 0; r < ROWS; r++) {
          const row = [];
          for (let i = 0; i < W; i++) row.push({ col: col.id, xy: cellXY(ci, r, i), cur: ' ', target: ' ', next: ' ', anim: null });
          cells[col.id].push(row);
        }
      });
      this.redraw();
    },
    redraw() {
      drawChrome();
      COLS.forEach((col) => cells[col.id].forEach((row) => row.forEach(drawCell)));
      tex.needsUpdate = true;
    },
    update(lists) {
      let chromeDirty = false;
      COLS.forEach((col) => {
        const arr = lists[col.id] || [];
        if (counts[col.id] !== arr.length) { counts[col.id] = arr.length; chromeDirty = true; }
        for (let r = 0; r < ROWS; r++) {
          let txt = arr[r] || '';
          if (r === ROWS - 1 && arr.length > ROWS) txt = `+${arr.length - ROWS + 1} MORE`;
          const s = txt.toUpperCase().padEnd(W, ' ').slice(0, W);
          cells[col.id][r].forEach((c, i) => {
            const ch = CHARS.includes(s[i]) ? s[i] : ' ';
            if (c.target !== ch) { c.target = ch; c.delay = i * 0.025 + r * 0.05; kick(c); }
          });
        }
      });
      if (chromeDirty) { drawChrome(); COLS.forEach((col) => cells[col.id].forEach((row) => row.forEach(drawCell))); tex.needsUpdate = true; }
    },
    foot(load, clock) {
      if (foot.load === load && foot.clock === clock) return;
      foot = { load, clock };
      drawFoot();
      tex.needsUpdate = true;
    },
    sweep() {
      COLS.forEach((col) => cells[col.id].forEach((row, r) => row.forEach((c, i) => { c.target = CHARS[B.ri(1, 26)]; c.delay = r * 0.06 + i * 0.03; kick(c); })));
    },
    group,
  };
})();
