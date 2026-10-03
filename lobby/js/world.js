/* brew · world.js — the lobby: architecture, the street outside, lighting
   fixtures, decor, the counter and the ticket pass. Units are metres. */
(function () {
  const B = window.B, T = THREE, G = B.gfx, X = window.TX;
  const scene = G.scene;
  const W = (B.world = {});

  /* layout shared with every other module */
  const L = (B.L = {
    wallZ: -6, ceil: 4.4, counterZ: 2.85, counterTop: 1.03,
    railZ: 4.6, railY: 1.84, railX: [-1.02, 0.92],
    fridge: [-2.74, 2.82], book: [-1.9, 2.98], printer: [1.62, 2.86], spike: [2.06, 3.0], shelf: [2.74, 2.8],
    door: [5.6, -6], doorIn: [5.6, -5.3], windows: [-6.0, -3.9, 3.0],
  });
  const WIN = { w: 1.5, sill: 0.92, spring: 2.72 };

  const room = G.group(scene);
  W.room = room;

  /* ================================================================== */
  /* floor                                                               */
  /* ================================================================== */
  {
    const tile = 1.1;
    const map = G.lib('checker').clone(); map.needsUpdate = true; map.repeat.set(16 / tile, 13 / tile);
    const nrm = G.lib('tileN').clone(); nrm.needsUpdate = true; nrm.repeat.set(16 / tile, 13 / tile);
    const rough = G.lib('checkerRough').clone(); rough.needsUpdate = true; rough.repeat.set(16 / tile, 13 / tile);
    const floor = G.m(new T.PlaneGeometry(16, 13), new T.MeshPhysicalMaterial({ map, normalMap: nrm, normalScale: new T.Vector2(0.6, 0.6), roughnessMap: rough, roughness: 0.55, clearcoat: 0.55, clearcoatRoughness: 0.16 }), { r: [-Math.PI / 2, 0, 0], p: [0, 0, 0.5], cast: false, parent: room });
    floor.name = 'floor';
  }

  /* ================================================================== */
  /* back wall with arched windows + door                               */
  /* ================================================================== */
  function archPath(cx, w, sill, spring, P = new T.Path()) {
    const r = w / 2;
    P.moveTo(cx - r, sill);
    P.lineTo(cx + r, sill);
    P.lineTo(cx + r, spring);
    P.absarc(cx, spring, r, 0, Math.PI, false);
    P.lineTo(cx - r, sill);
    return P;
  }
  const DOOR = { cx: L.door[0], w: 1.18, spring: 2.12 };
  {
    const sh = new T.Shape();
    sh.moveTo(-8.2, -0.05); sh.lineTo(8.2, -0.05); sh.lineTo(8.2, L.ceil); sh.lineTo(-8.2, L.ceil); sh.closePath();
    L.windows.forEach((cx) => sh.holes.push(archPath(cx, WIN.w, WIN.sill, WIN.spring)));
    sh.holes.push(archPath(DOOR.cx, DOOR.w, 0, DOOR.spring));
    const geo = new T.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: false, curveSegments: 40 });
    const paper = G.lib('wallpaper').clone(); paper.needsUpdate = true; paper.repeat.set(1 / 1.4, 1 / 1.4);
    const pn = G.lib('plasterN').clone(); pn.needsUpdate = true; pn.repeat.set(1 / 1.4, 1 / 1.4);
    const wallMat = new T.MeshStandardMaterial({ map: paper, normalMap: pn, normalScale: new T.Vector2(0.25, 0.25), roughness: 0.9 });
    const reveal = G.mat('#f9e3e8', { roughness: 0.85 });
    G.m(geo, [wallMat, reveal], { p: [0, 0, L.wallZ - 0.3], parent: room });
    // exterior skin (seen through the open door)
    G.m(new T.PlaneGeometry(16.4, L.ceil), G.mat('#efc3cd', { roughness: 0.95 }), { p: [0, L.ceil / 2, L.wallZ - 0.31], r: [0, Math.PI, 0], parent: room, cast: false });
  }
  // side walls + ceiling
  {
    const sideMat = new T.MeshStandardMaterial({ map: (() => { const t = G.lib('wallpaper').clone(); t.needsUpdate = true; t.repeat.set(13 / 1.4, L.ceil / 1.4); return t; })(), roughness: 0.9 });
    [-8, 8].forEach((x) => G.m(new T.PlaneGeometry(13, L.ceil), sideMat, { p: [x, L.ceil / 2, 0.5], r: [0, x < 0 ? Math.PI / 2 : -Math.PI / 2, 0], parent: room, cast: false }));
    G.m(new T.PlaneGeometry(16.4, 13), G.mat('#fbe4ea', { roughness: 0.95 }), { p: [0, L.ceil, 0.5], r: [Math.PI / 2, 0, 0], parent: room, cast: false });
    // ceiling beams
    for (let x = -7; x <= 7; x += 2.33) G.m(G.rbox(0.22, 0.22, 13, 0.02), G.mat('#ffffff', { roughness: 0.7 }), { p: [x, L.ceil - 0.11, 0.5], parent: room, cast: false });
    // cornice
    G.m(G.rbox(16.4, 0.16, 0.16, 0.03), G.mat('#ffffff', { roughness: 0.6 }), { p: [0, L.ceil - 0.08, L.wallZ + 0.08], parent: room, cast: false });
  }
  // wainscoting with raised panels (merged into one mesh)
  {
    const parts = [];
    const add = (g, x, y, z) => { const c = g.clone(); c.translate(x, y, z); parts.push(c); };
    const z = L.wallZ + 0.02;
    const segs = [[-8, DOOR.cx - DOOR.w / 2 - 0.09], [DOOR.cx + DOOR.w / 2 + 0.09, 8]];
    segs.forEach(([a, b]) => {
      const w = b - a, cx = (a + b) / 2;
      add(new T.BoxGeometry(w, WIN.sill, 0.03), cx, WIN.sill / 2, z);
      const n = Math.max(1, Math.round(w / 1.05)), pw = w / n;
      for (let i = 0; i < n; i++) {
        const px = a + pw * (i + 0.5);
        const fw = pw - 0.22, fh = WIN.sill - 0.34;
        const rail = new X.RoundedBoxGeometry(fw, 0.035, 0.03, 2, 0.012), stile = new X.RoundedBoxGeometry(0.035, fh, 0.03, 2, 0.012);
        add(rail, px, 0.2, z + 0.025); add(rail, px, 0.2 + fh, z + 0.025);
        add(stile, px - fw / 2, 0.2 + fh / 2, z + 0.025); add(stile, px + fw / 2, 0.2 + fh / 2, z + 0.025);
      }
    });
    const merged = X.BufferGeometryUtils.mergeGeometries(parts.map((p) => p.toNonIndexed ? p.toNonIndexed() : p));
    G.m(merged, G.mat('#fff9f9', { roughness: 0.55 }), { parent: room });
    // chair rail + skirting
    segs.forEach(([a, b]) => {
      G.m(G.rbox(b - a, 0.06, 0.09, 0.02), G.mat('#ffffff', { roughness: 0.45 }), { p: [(a + b) / 2, WIN.sill, z + 0.04], parent: room });
      G.m(G.rbox(b - a, 0.14, 0.05, 0.01), G.mat('#eaa9b9', { roughness: 0.5 }), { p: [(a + b) / 2, 0.07, z + 0.03], parent: room });
    });
  }

  /* window frames, mullions, glass, sills */
  const glassMat = new T.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.08, roughness: 0.02, metalness: 0, envMapIntensity: 1.4, depthWrite: false });
  const rainCanvas = G.canvas(512, 512);
  {
    const x = rainCanvas.getContext('2d');
    for (let i = 0; i < 900; i++) {
      const px = Math.random() * 512, py = Math.random() * 512, r = Math.random() < 0.85 ? 1 + Math.random() * 2.2 : 3 + Math.random() * 3;
      const g = x.createRadialGradient(px - r * 0.3, py - r * 0.3, 0, px, py, r);
      g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(0.5, 'rgba(255,255,255,.25)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.beginPath(); x.ellipse(px, py, r, r * 1.15, 0, 0, 7); x.fill();
    }
    x.strokeStyle = 'rgba(255,255,255,.35)';
    for (let i = 0; i < 40; i++) { x.lineWidth = 1 + Math.random() * 1.5; x.beginPath(); const px = Math.random() * 512; x.moveTo(px, Math.random() * 300); x.lineTo(px + (Math.random() - 0.5) * 8, 300 + Math.random() * 212); x.stroke(); }
  }
  const rainTex = G.tex(rainCanvas, { repeat: [0.9, 0.9] });
  const rainGlass = new T.MeshStandardMaterial({ map: rainTex, transparent: true, opacity: 0, roughness: 0.1, depthWrite: false });
  W.rainGlass = rainGlass;
  const frameMat = G.mat('#fffafa', { roughness: 0.38 });
  function frame(cx, w, sill, spring, depth = 0.16, border = 0.09) {
    const outer = new T.Shape();
    archPath(cx, w + border * 2, sill - (sill > 0 ? border : 0), spring, outer);
    outer.holes.push(archPath(cx, w, sill, spring));
    const g = new T.ExtrudeGeometry(outer, { depth, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2, curveSegments: 40 });
    G.m(g, frameMat, { p: [0, 0, L.wallZ - 0.04], parent: room });
  }
  L.windows.forEach((cx) => {
    frame(cx, WIN.w, WIN.sill, WIN.spring);
    const r = WIN.w / 2;
    const bar = (w, h, x, y, rz = 0) => G.m(G.rbox(w, h, 0.05, 0.012), frameMat, { p: [x, y, L.wallZ - 0.12], r: [0, 0, rz], parent: room });
    bar(0.045, WIN.spring + r - WIN.sill, cx, (WIN.sill + WIN.spring + r) / 2);
    bar(WIN.w, 0.045, cx, WIN.spring);
    bar(WIN.w, 0.04, cx, (WIN.sill + WIN.spring) / 2);
    [Math.PI / 4, -Math.PI / 4].forEach((a) => bar(0.04, r, cx + Math.sin(-a) * r * 0.5, WIN.spring + Math.cos(a) * r * 0.5, a));
    const pane = new T.ShapeGeometry(archPath(cx, WIN.w, WIN.sill, WIN.spring, new T.Shape()), 40);
    G.m(pane, glassMat, { p: [0, 0, L.wallZ - 0.1], parent: room, cast: false, recv: false });
    const rg = pane.clone();
    const uv = rg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 1.5, uv.getY(i) / 1.5);
    G.m(rg, rainGlass, { p: [0, 0, L.wallZ - 0.08], parent: room, cast: false, recv: false });
    G.m(G.rbox(WIN.w + 0.42, 0.06, 0.32, 0.02), G.mat('#ffffff', { roughness: 0.4 }), { p: [cx, WIN.sill - 0.01, L.wallZ + 0.1], parent: room });
  });
  frame(DOOR.cx, DOOR.w, 0, DOOR.spring, 0.2, 0.12);

  /* the door leaf (hinged on its left edge) */
  const doorPivot = G.group(room, [DOOR.cx - DOOR.w / 2 + 0.02, 0, L.wallZ - 0.16]);
  {
    const w = DOOR.w - 0.04, leaf = new T.Shape();
    archPath(w / 2, w, 0.0, DOOR.spring, leaf);
    leaf.holes.push(archPath(w / 2, w - 0.24, 0.62, DOOR.spring, new T.Path()));
    G.m(new T.ExtrudeGeometry(leaf, { depth: 0.06, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 2, curveSegments: 32 }), G.mat('#ec9fb4', { roughness: 0.4, physical: true, clearcoat: 0.6 }), { parent: doorPivot });
    G.m(new T.ShapeGeometry(archPath(w / 2, w - 0.24, 0.62, DOOR.spring, new T.Shape()), 32), glassMat, { p: [0, 0, 0.03], parent: doorPivot, cast: false });
    G.m(G.cyl(0.016, 0.016, 0.34, 16), G.brass(), { p: [w - 0.12, 1.05, 0.12], parent: doorPivot });
    G.m(G.rbox(0.9, 0.1, 0.02, 0.01), G.brass(), { p: [w / 2, 0.36, 0.075], parent: doorPivot });
    // OPEN / CLOSED sign
    const sign = G.group(doorPivot, [w / 2, 1.62, 0.1]);
    const mk = (txt, bg, fg) => {
      const c = G.canvas(256, 100), x = c.getContext('2d');
      x.fillStyle = bg; x.beginPath(); x.roundRect(4, 4, 248, 92, 14); x.fill();
      x.strokeStyle = fg; x.lineWidth = 4; x.beginPath(); x.roundRect(12, 12, 232, 76, 10); x.stroke();
      x.fillStyle = fg; x.font = '800 44px "DM Sans"'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(txt, 128, 52);
      return new T.MeshStandardMaterial({ map: G.tex(c, { wrap: false }), roughness: 0.5 });
    };
    W._signMats = () => [mk('CLOSED', '#3a2430', '#ffffff'), mk('OPEN', '#ffffff', '#d6336c')];
    const flip = G.group(sign);
    const [mc, mo] = W._signMats();
    G.m(new T.PlaneGeometry(0.4, 0.156), mc, { parent: flip, cast: false });
    G.m(new T.PlaneGeometry(0.4, 0.156), mo, { parent: flip, r: [0, Math.PI, 0], p: [0, 0, -0.004], cast: false });
    const strg = new T.BufferGeometry().setFromPoints([new T.Vector3(-0.15, 0.078, 0), new T.Vector3(0, 0.24, -0.01), new T.Vector3(0.15, 0.078, 0)]);
    sign.add(new T.Line(strg, new T.LineBasicMaterial({ color: '#8f6630' })));
    W.doorSign = flip;
  }
  W.signFlip = (open) => {
    // refresh textures once fonts are loaded
    const [mc, mo] = W._signMats();
    W.doorSign.children[0].material = mc; W.doorSign.children[1].material = mo;
    gsap.to(W.doorSign.rotation, { y: open ? Math.PI : 0, duration: 1.1, ease: 'elastic.out(1, 0.5)' });
  };
  let doorTimer = null;
  W.door = (x) => {
    gsap.to(doorPivot.rotation, { y: -1.25, duration: 0.5, ease: 'power2.out', overwrite: 'auto' });
    B.audio.play('chime', 1500);
    B.audio.play('door', 1500);
    clearTimeout(doorTimer);
    doorTimer = setTimeout(() => gsap.to(doorPivot.rotation, { y: 0, duration: 1.2, ease: 'elastic.out(1, 0.5)', overwrite: 'auto' }), 1400 / Math.min(B.state.speed || 1, 6));
  };

  /* ================================================================== */
  /* outside: the street                                                 */
  /* ================================================================== */
  const out = G.group(scene);
  W.outside = out;
  const sky = new T.Mesh(new T.PlaneGeometry(260, 120), new T.ShaderMaterial({
    uniforms: { top: { value: new T.Color('#8fcbef') }, bot: { value: new T.Color('#fde6d6') }, haze: { value: new T.Color('#ffe9ef') } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bot; uniform vec3 haze; varying vec2 vUv; void main(){ float t = smoothstep(0.42, 0.75, vUv.y); vec3 c = mix(bot, top, t); c = mix(haze, c, smoothstep(0.38, 0.5, vUv.y)); gl_FragColor = vec4(c, 1.0); }',
    depthWrite: false,
  }));
  sky.position.set(0, 10, -80);
  out.add(sky);
  W.sky = sky;
  const sunDisc = G.m(G.sph(2.2, 32, 16), new T.MeshBasicMaterial({ color: '#fff3c8' }), { p: [-20, 10, -78], parent: out, cast: false, recv: false });
  const moon = G.m(G.sph(1.2, 32, 16), new T.MeshBasicMaterial({ color: '#fff8e1' }), { p: [20, 14, -78], parent: out, cast: false, recv: false });
  W.sunDisc = sunDisc; W.moon = moon;

  // ground: pavers, kerb, road, far pavement
  const paveC = G.canvas(256, 256);
  {
    const x = paveC.getContext('2d'); x.fillStyle = '#e8c2ca'; x.fillRect(0, 0, 256, 256);
    x.strokeStyle = '#cfa3ad'; x.lineWidth = 3;
    for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(0, i * 64); x.lineTo(256, i * 64); x.stroke(); }
    for (let j = 0; j < 4; j++) for (let i = 0; i <= 2; i++) { const px = i * 128 + (j % 2) * 64; x.beginPath(); x.moveTo(px, j * 64); x.lineTo(px, j * 64 + 64); x.stroke(); }
  }
  const paveMat = new T.MeshStandardMaterial({ map: G.tex(paveC, { repeat: [12, 1.6] }), roughness: 0.85 });
  G.m(new T.PlaneGeometry(40, 2.6), paveMat, { r: [-Math.PI / 2, 0, 0], p: [0, 0, -7.6], parent: out });
  G.m(G.rbox(40, 0.16, 0.25, 0.03), G.mat('#cbbcc0', { roughness: 0.9 }), { p: [0, 0.02, -8.95], parent: out });
  const roadMat = new T.MeshPhysicalMaterial({ color: '#5d5862', roughness: 0.92, normalMap: G.lib('plasterN'), normalScale: new T.Vector2(0.8, 0.8), clearcoat: 0, clearcoatRoughness: 0.1 });
  W.roadMat = roadMat;
  G.m(new T.PlaneGeometry(60, 5.4), roadMat, { r: [-Math.PI / 2, 0, 0], p: [0, -0.08, -11.75], parent: out });
  for (let i = -12; i <= 12; i++) G.m(new T.PlaneGeometry(1.3, 0.12), G.mat('#f3efe6', { roughness: 0.8 }), { r: [-Math.PI / 2, 0, 0], p: [i * 2.6, -0.07, -11.75], parent: out, cast: false });
  G.m(G.rbox(60, 0.16, 0.25, 0.03), G.mat('#cbbcc0', { roughness: 0.9 }), { p: [0, 0.0, -14.55], parent: out });
  G.m(new T.PlaneGeometry(60, 2.4), paveMat, { r: [-Math.PI / 2, 0, 0], p: [0, 0.04, -15.8], parent: out });

  // our striped awning (outside, above the windows)
  {
    const c = G.canvas(512, 128), x = c.getContext('2d');
    for (let i = 0; i < 16; i++) { x.fillStyle = i % 2 ? '#ffffff' : '#f39ab3'; x.fillRect(i * 32, 0, 32, 128); }
    const t = G.tex(c, { repeat: [12, 1] });
    const aw = G.m(new T.PlaneGeometry(16.4, 1.5, 1, 1), new T.MeshStandardMaterial({ map: t, roughness: 0.8, side: T.DoubleSide }), { p: [0, 3.55, -6.95], r: [-1.05, 0, 0], parent: out });
    // scalloped valance
    const v = G.canvas(512, 64), vx = v.getContext('2d');
    for (let i = 0; i < 16; i++) { vx.fillStyle = i % 2 ? '#ffffff' : '#f39ab3'; vx.fillRect(i * 32, 0, 32, 30); vx.beginPath(); vx.arc(i * 32 + 16, 30, 16, 0, Math.PI); vx.fill(); }
    const vt = G.tex(v, { repeat: [12, 1] });
    G.m(new T.PlaneGeometry(16.4, 0.26), new T.MeshStandardMaterial({ map: vt, alphaTest: 0.5, roughness: 0.8, side: T.DoubleSide }), { p: [0, 3.05, -7.6], parent: out });
  }

  // shopfronts across the street
  function facade(name, base, sign, signBg, glow, w, h, opts = {}) {
    const S = 512, c = G.canvas(S, Math.round((S * h) / w)), x = c.getContext('2d');
    const H = c.height;
    x.fillStyle = base; x.fillRect(0, 0, S, H);
    const n = G.noise(64, name.length * 7);
    for (let i = 0; i < 1600; i++) { x.fillStyle = `rgba(0,0,0,${n[i % 4096] * 0.04})`; x.fillRect(Math.random() * S, Math.random() * H, 3, 3); }
    const groundH = (3.3 / h) * H;
    // upper floor windows
    if (h > 4) {
      const cols = Math.max(2, Math.round(w / 1.6));
      for (let i = 0; i < cols; i++) {
        const wx = (S / cols) * (i + 0.5) - 26, wy = 30;
        x.fillStyle = '#7a8ea6'; x.fillRect(wx, wy, 52, 70);
        x.fillStyle = 'rgba(255,255,255,.35)'; x.fillRect(wx + 4, wy + 4, 18, 62);
        x.fillStyle = opts.shutter || '#5f9a86'; x.fillRect(wx - 12, wy, 10, 70); x.fillRect(wx + 54, wy, 10, 70);
        x.fillStyle = '#fff'; x.fillRect(wx - 6, wy + 72, 64, 6);
      }
    }
    // shop front
    const sy = H - groundH;
    x.fillStyle = signBg; x.fillRect(16, sy + 8, S - 32, 46);
    x.fillStyle = '#fff'; x.font = '800 30px "DM Sans"'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(sign, S / 2, sy + 32);
    x.fillStyle = '#3b3239'; x.fillRect(24, sy + 64, S - 48, H - sy - 64);
    const gg = x.createLinearGradient(0, sy + 70, 0, H);
    gg.addColorStop(0, glow); gg.addColorStop(1, '#fff8ea');
    x.fillStyle = gg; x.fillRect(34, sy + 72, S * 0.62, H - sy - 80);
    x.fillStyle = 'rgba(255,255,255,.25)'; x.beginPath(); x.moveTo(40, sy + 72); x.lineTo(120, sy + 72); x.lineTo(60, H - 8); x.lineTo(40, H - 8); x.fill();
    (opts.goods || ['#c98a4b', '#e9a65a', '#b8763a']).forEach((col, i) => { x.fillStyle = col; for (let k = 0; k < 5; k++) { x.beginPath(); x.arc(60 + k * 46 + i * 14, H - 40 - i * 28, 14, 0, 7); x.fill(); } });
    x.fillStyle = '#5a4a52'; x.fillRect(S * 0.7, sy + 72, S * 0.22, H - sy - 72);
    const tex = G.tex(c, { wrap: false });
    const mats = [G.mat(base, { roughness: 0.9 }), G.mat(base, { roughness: 0.9 }), G.mat(base, { roughness: 0.9 }), G.mat(base, { roughness: 0.9 }), new T.MeshStandardMaterial({ map: tex, roughness: 0.8, emissive: '#ffffff', emissiveMap: (() => { const ec = G.canvas(c.width, c.height), ex = ec.getContext('2d'); ex.fillStyle = '#000'; ex.fillRect(0, 0, c.width, c.height); ex.fillStyle = glow; ex.fillRect(34, sy + 72, S * 0.62, H - sy - 80); if (h > 4) { ex.fillStyle = '#ffd98a'; } return G.tex(ec, { wrap: false }); })(), emissiveIntensity: 0 }), G.mat(base)];
    return { mats, tex };
  }
  const shopMats = [];
  [
    ['bakery', '#f7e7c9', 'BAKERY', '#6aa58e', '#ffe1a6', -11, 4.2, 6.5],
    ['flowers', '#f4cfd6', 'FLOWERS', '#c43e64', '#ffd9e2', -6.6, 4.6, 4.2, { goods: ['#e46d8d', '#ffd36b', '#b8d98b'] }],
    ['tailor', '#e6dcf2', 'TAILOR', '#6d5a7a', '#efe4ff', -2.2, 4.2, 3.6],
    ['chai', '#d9ebe3', 'BOOKS & CHAI', '#2f5a4c', '#ffe7b0', 1.9, 4.4, 4.4, { goods: ['#c43e64', '#2f5a4c', '#e8a33a'] }],
    ['sweets', '#fbe7b9', 'MITHAI', '#e46d8d', '#ffd7a1', 6.4, 4.6, 6.2, { shutter: '#c43e64' }],
    ['pharmacy', '#e9f1f7', 'PHARMACY', '#2f6f9a', '#e4f6ff', 11.2, 4.0, 5.6],
  ].forEach(([n, base, sign, sbg, glow, x, w, h, o]) => {
    const f = facade(n, base, sign, sbg, glow, w, h, o);
    const b = G.m(new T.BoxGeometry(w, h, 4), f.mats, { p: [x, h / 2, -18.05], parent: out });
    shopMats.push(f.mats[4]);
    // little canopy
    G.m(G.rbox(w * 0.9, 0.08, 0.9, 0.03), G.mat(sbg, { roughness: 0.7 }), { p: [x, 3.0, -15.7], r: [0.2, 0, 0], parent: out });
  });
  W.shopMats = shopMats;
  // trees with bougainvillea
  function tree(x, z, s = 1) {
    const g = G.group(out, [x, 0, z]);
    g.scale.setScalar(s);
    G.m(G.cyl(0.09, 0.14, 2.6, 10), G.mat('#6d4a3a', { roughness: 0.95 }), { p: [0, 1.3, 0], parent: g });
    const leaf = G.mat('#4f8a5a', { roughness: 0.85 }), leaf2 = G.mat('#5f9c64', { roughness: 0.85 });
    [[0, 3.1, 0, 1.1], [0.8, 2.8, 0.2, 0.8], [-0.8, 2.9, -0.1, 0.85], [0.3, 3.6, -0.2, 0.75], [-0.4, 2.5, 0.4, 0.7]].forEach(([a, b, c, r], i) => G.m(G.sph(r, 18, 12), i % 2 ? leaf : leaf2, { p: [a, b, c], parent: g }));
    const fl = new T.InstancedMesh(G.sph(0.09, 8, 6), G.mat('#ea4f8a', { roughness: 0.6 }), 90);
    const m4 = new T.Matrix4(), v = new T.Vector3();
    for (let i = 0; i < 90; i++) { v.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(1.05); m4.makeTranslation(v.x * 1.1, 3.0 + v.y * 0.9, v.z); fl.setMatrixAt(i, m4); }
    fl.castShadow = true;
    g.add(fl);
    return g;
  }
  W.trees = [tree(-8.6, -15.2, 1.1), tree(-4.3, -15.0, 0.95), tree(4.2, -15.2, 1.05), tree(9.4, -15.1)];
  // street lamps
  const lampHeads = [];
  [-9.5, -1.0, 8.2].forEach((x) => {
    const g = G.group(out, [x, 0, -14.9]);
    G.m(G.cyl(0.05, 0.07, 4.2, 12), G.mat('#4a4248', { roughness: 0.5, metalness: 0.6 }), { p: [0, 2.1, 0], parent: g });
    G.m(G.rbox(0.12, 0.08, 0.9, 0.03), G.mat('#4a4248', { roughness: 0.5, metalness: 0.6 }), { p: [0, 4.2, 0.4], parent: g });
    const head = G.m(G.sph(0.14, 16, 10), new T.MeshStandardMaterial({ color: '#fff2c4', emissive: '#ffd98a', emissiveIntensity: 0 }), { p: [0, 4.1, 0.8], parent: g, cast: false });
    lampHeads.push(head);
  });
  W.lampHeads = lampHeads;
  // clouds
  const clouds = G.group(out);
  W.clouds = clouds;
  function cloud(x, y, z, s) {
    const g = G.group(clouds, [x, y, z]);
    g.scale.setScalar(s);
    const mat = new T.MeshStandardMaterial({ color: '#ffffff', roughness: 1, emissive: '#ffffff', emissiveIntensity: 0.35 });
    for (let i = 0; i < 6; i++) G.m(G.sph(1, 16, 12), mat, { p: [i * 1.1 - 2.8, Math.sin(i) * 0.4, Math.cos(i * 2) * 0.4], s: 0.9 + Math.sin(i * 3) * 0.35, parent: g, cast: false, recv: false });
    g.userData.mat = mat;
    g.userData.v = 0.25 + Math.random() * 0.3;
    return g;
  }
  for (let i = 0; i < 9; i++) cloud(-50 + i * 13 + Math.random() * 6, 9 + Math.random() * 6, -60 + Math.random() * 8, 1.4 + Math.random() * 1.4);
  G.onFrame((dt) => clouds.children.forEach((c) => { c.position.x += c.userData.v * dt * (B.state.speed || 1) * 0.6; if (c.position.x > 70) c.position.x = -70; }));

  // rain (outside)
  const RAIN = 1800;
  const rainGeo = new T.BufferGeometry();
  const rp = new Float32Array(RAIN * 6);
  for (let i = 0; i < RAIN; i++) { const x = (Math.random() - 0.5) * 30, y = Math.random() * 9, z = -6.6 - Math.random() * 14; rp.set([x, y, z, x - 0.04, y - 0.38, z], i * 6); }
  rainGeo.setAttribute('position', new T.BufferAttribute(rp, 3));
  const rainLines = new T.LineSegments(rainGeo, new T.LineBasicMaterial({ color: '#dbe8ff', transparent: true, opacity: 0 }));
  out.add(rainLines);
  W.rain = rainLines;
  G.onFrame((dt) => {
    if (rainLines.material.opacity < 0.01) return;
    const a = rainGeo.attributes.position.array;
    for (let i = 0; i < RAIN; i++) {
      const o = i * 6;
      let y = a[o + 1] - dt * 14;
      if (y < 0) y += 9;
      a[o + 1] = y; a[o + 4] = y - 0.38;
    }
    rainGeo.attributes.position.needsUpdate = true;
  });
  // the rain glass droplets slowly run
  G.onFrame((dt) => { if (rainGlass.opacity > 0.01) rainTex.offset.y -= dt * 0.012; });

  /* ================================================================== */
  /* lighting fixtures                                                   */
  /* ================================================================== */
  function pendant(x, z, drop = 1.3) {
    const g = G.group(room, [x, L.ceil, z]);
    G.m(G.cyl(0.006, 0.006, drop, 6), G.mat('#3a2a30'), { p: [0, -drop / 2, 0], parent: g, cast: false });
    G.m(G.cyl(0.045, 0.045, 0.06, 16), G.brass(), { p: [0, -drop, 0], parent: g });
    const shade = G.lathe([[0.02, 0], [0.09, -0.02], [0.2, -0.12], [0.27, -0.27], [0.265, -0.28], [0.19, -0.13], [0.08, -0.03], [0.02, -0.01]], 48);
    G.m(shade, G.mat('#fdf4f6', { physical: true, roughness: 0.3, clearcoat: 0.8, side: T.DoubleSide }), { p: [0, -drop - 0.02, 0], parent: g });
    const bulb = G.m(G.sph(0.06, 20, 14), new T.MeshStandardMaterial({ color: '#fff6e0', emissive: '#ffd59a', emissiveIntensity: 3.2 }), { p: [0, -drop - 0.2, 0], parent: g, cast: false });
    const light = new T.PointLight('#ffd6a0', 4, 9, 1.6);
    light.position.set(0, -drop - 0.26, 0);
    light.userData.base = 4;
    g.add(light);
    G.lights.lamps.push(light);
    g.userData.swing = Math.random() * 6;
    G.onFrame((dt, t) => (g.rotation.z = Math.sin(t * 0.6 + g.userData.swing) * 0.008));
    return g;
  }
  pendant(-4.6, -1.8, 1.5);
  pendant(3.6, -2.2, 1.5);
  pendant(-1.2, 1.4, 1.2);

  /* neon sign */
  const neon = G.group(room, [-0.1, 2.18, L.wallZ + 0.06]);
  {
    const c = G.canvas(1024, 400), x = c.getContext('2d');
    W._drawNeon = () => {
      x.clearRect(0, 0, 1024, 400);
      x.font = 'italic 600 250px Fraunces';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.lineJoin = 'round';
      x.strokeStyle = '#ffffff'; x.lineWidth = 16; x.strokeText('brew', 512, 190);
      x.font = '700 40px "DM Sans"';
      tex.needsUpdate = true;
    };
    const tex = G.tex(c, { wrap: false });
    const mat = new T.MeshStandardMaterial({ color: '#ffd2e0', emissive: '#ff4f8a', emissiveMap: tex, alphaMap: tex, transparent: true, emissiveIntensity: 5, roughness: 0.4, depthWrite: false });
    W.neonMat = mat;
    G.m(new T.PlaneGeometry(1.9, 0.74), mat, { parent: neon, cast: false });
    G.m(G.rbox(2.05, 0.82, 0.02, 0.02), new T.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.05, roughness: 0.05, clearcoat: 1, envMapIntensity: 1.2, depthWrite: false }), { p: [0, 0, -0.02], parent: neon, cast: false });
    [[-0.9, 0.33], [0.9, 0.33], [-0.9, -0.33], [0.9, -0.33]].forEach(([a, b]) => G.m(G.cyl(0.012, 0.012, 0.06, 10), G.metal(), { p: [a, b, -0.03], r: [Math.PI / 2, 0, 0], parent: neon }));
    const glow = new T.PointLight('#ff6fa0', 1.8, 3.5, 1.8);
    glow.position.set(0, 0, 0.4);
    neon.add(glow);
    W.neonLight = glow;
    // tagline under the sign
    const tc = G.canvas(1024, 80), tx = tc.getContext('2d');
    W._drawTag = () => { tx.clearRect(0, 0, 1024, 80); tx.fillStyle = '#c26a86'; tx.font = '700 40px "DM Sans"'; tx.textAlign = 'center'; tx.textBaseline = 'middle'; tx.letterSpacing = '14px'; tx.fillText('COFFEE · BAKES · KINDNESS', 512, 40); ttex.needsUpdate = true; };
    const ttex = G.tex(tc, { wrap: false });
    G.m(new T.PlaneGeometry(1.7, 0.13), new T.MeshStandardMaterial({ map: ttex, transparent: true, roughness: 0.9 }), { p: [0, -0.52, 0], parent: neon, cast: false });
  }
  W.neonOn = (on) => { W.neonMat.emissiveIntensity = on ? 5 : 0.15; W.neonLight.intensity = on ? 1.8 : 0; };

  /* wall shelves, clock, framed print */
  function shelf(x, y) {
    const g = G.group(room, [x, y, L.wallZ + 0.15]);
    G.m(G.rbox(1.3, 0.04, 0.28, 0.01), G.mat('#fffafa', { roughness: 0.5 }), { parent: g });
    [-0.5, 0.5].forEach((bx) => G.m(G.rbox(0.03, 0.14, 0.2, 0.01), G.brass(), { p: [bx, -0.08, -0.03], parent: g }));
    return g;
  }
  {
    const s1 = shelf(-2.05, 1.95);
    [['#6b3818', -0.48], ['#f6dfb9', -0.3], ['#a5612c', -0.12]].forEach(([c, x], i) => {
      G.m(G.lathe([[0, 0], [0.06, 0], [0.065, 0.2], [0.04, 0.24], [0, 0.24]], 24), G.glass(), { p: [x, 0.02, 0], parent: s1 });
      G.m(G.cyl(0.055, 0.055, 0.14 - i * 0.03, 24), G.mat(c, { roughness: 0.9 }), { p: [x, 0.09 - i * 0.015, 0], parent: s1 });
      G.m(G.cyl(0.045, 0.045, 0.02, 20), G.mat('#d9b66a', { metalness: 0.8, roughness: 0.3 }), { p: [x, 0.25, 0], parent: s1 });
    });
    const pot = G.m(G.lathe([[0, 0], [0.08, 0], [0.1, 0.16], [0.105, 0.17], [0, 0.17]], 24), G.mat('#f3a9bd', { roughness: 0.5 }), { p: [0.28, 0.02, 0], parent: s1 });
    for (let i = 0; i < 14; i++) G.m(G.sph(0.05, 10, 8), G.mat(i % 2 ? '#5c9a62' : '#4f8a5a', { roughness: 0.8 }), { p: [0.28 + Math.sin(i) * 0.09, 0.2 + (i % 3) * 0.03 - (i > 8 ? (i - 8) * 0.08 : 0), Math.cos(i * 1.7) * 0.06], s: [1, 0.6, 1.2], parent: s1 });
    for (let i = 0; i < 7; i++) G.m(G.sph(0.035, 10, 8), G.mat('#4f8a5a'), { p: [0.4 + i * 0.012, 0.12 - i * 0.07, 0.08], s: [1, 0.5, 1.3], parent: s1 });
    const s2 = shelf(1.95, 1.95);
    for (let i = 0; i < 3; i++) G.m(G.lathe([[0, 0], [0.04, 0], [0.055, 0.09], [0.058, 0.1], [0, 0.1]], 24), i === 1 ? G.mat('#f2b3c4', { roughness: 0.3 }) : G.mat('#fbf7f5', { roughness: 0.3 }), { p: [-0.45, 0.02 + i * 0.1, 0], parent: s2 });
    [['#e46d8d', 0.1], ['#2f5a4c', 0.16], ['#ffd36b', 0.21], ['#6d93c8', 0.26]].forEach(([c, x], i) => G.m(G.rbox(0.045, 0.24 + (i % 2) * 0.03, 0.17, 0.005), G.mat(c, { roughness: 0.7 }), { p: [x, 0.14, 0], r: [0, 0, i === 3 ? 0.2 : 0], parent: s2 }));
    G.m(G.lathe([[0, 0], [0.09, 0], [0.12, 0.12], [0.125, 0.13], [0, 0.13]], 24), G.mat('#c06540', { roughness: 0.9 }), { p: [0.45, 0.02, 0], parent: s2 });
    [[-0.05, 0.3, -0.3], [0.05, 0.32, 0.3], [0, 0.36, 0]].forEach(([a, b, r]) => G.m(G.sph(0.06, 12, 8), G.mat('#6aa06e'), { p: [0.45 + a, b, 0], s: [0.5, 1.6, 0.5], r: [0, 0, r], parent: s2 }));
  }
  // wall clock (game time)
  {
    const g = G.group(room, [3.85, 3.25, L.wallZ + 0.05]);
    G.m(G.cyl(0.3, 0.3, 0.06, 48), G.mat('#ffffff', { roughness: 0.3 }), { r: [Math.PI / 2, 0, 0], parent: g });
    G.m(G.tor(0.3, 0.025, 12, 48), G.brass(), { parent: g });
    const c = G.canvas(256, 256), x = c.getContext('2d');
    x.fillStyle = '#fffaf9'; x.beginPath(); x.arc(128, 128, 126, 0, 7); x.fill();
    x.fillStyle = '#c9a5b0';
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; x.save(); x.translate(128 + Math.sin(a) * 104, 128 - Math.cos(a) * 104); x.rotate(a); x.fillRect(-2, -8, 4, i % 3 ? 10 : 18); x.restore(); }
    x.fillStyle = '#e46d8d'; x.font = 'italic 600 30px Fraunces'; x.textAlign = 'center'; x.fillText('brew', 128, 90);
    G.m(new T.CircleGeometry(0.29, 48), new T.MeshStandardMaterial({ map: G.tex(c, { wrap: false }), roughness: 0.4 }), { p: [0, 0, 0.031], parent: g, cast: false });
    const hand = (len, w, col) => { const p = G.group(g, [0, 0, 0.045]); G.m(G.rbox(w, len, 0.008, 0.003), G.mat(col, { roughness: 0.4 }), { p: [0, len / 2 - 0.02, 0], parent: p }); return p; };
    const hh = hand(0.15, 0.022, '#4a3040'), mh = hand(0.22, 0.014, '#4a3040');
    G.m(G.cyl(0.018, 0.018, 0.02, 16), G.mat('#e46d8d'), { p: [0, 0, 0.05], r: [Math.PI / 2, 0, 0], parent: g });
    W.setClock = (h, m) => { hh.rotation.z = -((h % 12) + m / 60) * (Math.PI / 6); mh.rotation.z = -m * (Math.PI / 30); };
  }
  // framed print
  {
    const g = G.group(room, [-3.0 + 7.95, 2.4, L.wallZ + 0.04]);
    g.position.x = -7.15;
    G.m(G.rbox(0.7, 0.9, 0.04, 0.01), G.mat('#ffffff', { roughness: 0.4 }), { parent: g });
    const c = G.canvas(256, 330), x = c.getContext('2d');
    x.fillStyle = '#fbe1e7'; x.fillRect(0, 0, 256, 330);
    x.fillStyle = '#e46d8d'; x.beginPath(); x.arc(128, 130, 60, 0, 7); x.fill();
    x.strokeStyle = '#2f5a4c'; x.lineWidth = 10; x.beginPath(); x.moveTo(40, 280); x.quadraticCurveTo(128, 180, 216, 280); x.stroke();
    x.fillStyle = '#3a2430'; x.font = 'italic 600 34px Fraunces'; x.textAlign = 'center'; x.fillText('slow mornings', 128, 318);
    G.m(new T.PlaneGeometry(0.56, 0.74), new T.MeshStandardMaterial({ map: G.tex(c, { wrap: false }), roughness: 0.8 }), { p: [0, 0, 0.022], parent: g, cast: false });
  }

  /* plants */
  function monstera(x, z, s = 1) {
    const g = G.group(room, [x, 0, z]);
    g.scale.setScalar(s);
    G.m(G.lathe([[0, 0], [0.2, 0], [0.24, 0.42], [0.255, 0.44], [0, 0.44]], 32), G.mat('#f2a3b8', { physical: true, roughness: 0.35, clearcoat: 0.5 }), { parent: g });
    G.m(G.cyl(0.235, 0.235, 0.02, 32), G.mat('#4a3328', { roughness: 1 }), { p: [0, 0.42, 0], parent: g });
    const ls = new T.Shape();
    ls.moveTo(0, 0); ls.bezierCurveTo(0.28, 0.05, 0.34, 0.42, 0, 0.55); ls.bezierCurveTo(-0.34, 0.42, -0.28, 0.05, 0, 0);
    [[0.14, 0.18], [0.16, 0.32], [-0.14, 0.2], [-0.15, 0.33]].forEach(([hx, hy]) => { const h = new T.Path(); h.absellipse(hx, hy, 0.04, 0.025, 0, Math.PI * 2, false, hx > 0 ? 0.4 : -0.4); ls.holes.push(h); });
    const lg = new T.ShapeGeometry(ls, 16);
    const p = lg.attributes.position;
    for (let i = 0; i < p.count; i++) { const xx = p.getX(i), yy = p.getY(i); p.setZ(i, -Math.abs(xx) * 0.5 + yy * yy * 0.3); }
    lg.computeVertexNormals();
    const lm = new T.MeshStandardMaterial({ color: '#3f7f4c', roughness: 0.55, side: T.DoubleSide });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + Math.random() * 0.3, h = 0.7 + Math.random() * 0.8;
      const st = G.group(g, [0, 0.42, 0]);
      st.rotation.y = a;
      G.m(G.cyl(0.008, 0.012, h, 6), G.mat('#4f8a5a'), { p: [0, h / 2, 0.05], r: [0.25, 0, 0], parent: st });
      const leaf = G.m(lg, lm, { p: [0, h, 0.2], r: [-0.9 - Math.random() * 0.4, 0, 0], s: 0.8 + Math.random() * 0.5, parent: st });
      leaf.userData.sw = Math.random() * 6;
    }
    return g;
  }
  monstera(7.1, -5.2, 1.15);
  monstera(-7.3, -5.0, 0.9);
  // succulents on sills
  L.windows.forEach((cx, i) => {
    const g = G.group(room, [cx + (i % 2 ? 0.5 : -0.5), WIN.sill + 0.02, L.wallZ + 0.12]);
    G.m(G.lathe([[0, 0], [0.06, 0], [0.075, 0.1], [0, 0.1]], 20), G.mat(i % 2 ? '#ffffff' : '#f3a9bd', { roughness: 0.4 }), { parent: g });
    for (let k = 0; k < 7; k++) G.m(G.sph(0.03, 10, 8), G.mat('#7fae7c', { roughness: 0.6 }), { p: [Math.sin(k) * 0.035, 0.12 + (k % 2) * 0.02, Math.cos(k) * 0.035], s: [0.6, 1.4, 0.6], r: [Math.sin(k) * 0.6, 0, Math.cos(k) * 0.6], parent: g });
  });

  /* the cafe cat, on the sill */
  {
    const g = G.group(room, [-3.55, WIN.sill + 0.03, L.wallZ + 0.16]);
    g.rotation.y = 0.5;
    const fur = G.mat('#eea866', { roughness: 0.9, normal: 'fabric', ns: 0.3 }), white = G.mat('#fff4ea', { roughness: 0.9 });
    G.m(G.sph(0.13, 24, 16), fur, { p: [0, 0.1, 0], s: [1.5, 0.85, 1], parent: g });
    G.m(G.sph(0.08, 20, 14), white, { p: [0.08, 0.06, 0.06], s: [1.2, 0.8, 0.9], parent: g });
    const head = G.group(g, [0.17, 0.2, 0.02]);
    G.m(G.sph(0.085, 24, 16), fur, { parent: head, s: [1, 0.92, 1] });
    [-1, 1].forEach((sd) => { G.m(new T.ConeGeometry(0.035, 0.07, 4), fur, { p: [0.0, 0.08, sd * 0.045], r: [sd * 0.3, 0, 0], parent: head }); });
    G.m(G.sph(0.045, 16, 12), white, { p: [0.06, -0.025, 0], s: [0.8, 0.7, 1], parent: head });
    [-1, 1].forEach((sd) => G.m(G.rbox(0.004, 0.006, 0.03, 0.002), G.mat('#3a2a20'), { p: [0.075, 0.015, sd * 0.032], parent: head }));
    G.m(G.sph(0.008, 8, 6), G.mat('#e46d8d'), { p: [0.088, -0.01, 0], parent: head });
    const tail = G.group(g, [-0.18, 0.06, 0]);
    G.m(new T.TubeGeometry(new T.CatmullRomCurve3([new T.Vector3(0, 0, 0), new T.Vector3(-0.08, 0.02, 0.06), new T.Vector3(-0.06, 0.02, 0.16), new T.Vector3(0.04, 0.02, 0.2)]), 20, 0.022, 8), fur, { parent: tail });
    G.onFrame((dt, t) => { tail.rotation.y = Math.sin(t * 1.3) * 0.25; head.rotation.z = Math.sin(t * 0.4) * 0.06; });
    G.pickable(g, { click: () => { B.audio.play('pop'); gsap.fromTo(head.rotation, { x: 0 }, { x: 0.3, duration: 0.15, yoyo: true, repeat: 3 }); B.toast('🐈', 'Biscuit the cafe cat', 'Mrrp. (Biscuit approves of your service.)'); } });
  }

  /* chalkboard A-frame by the door */
  {
    const g = G.group(room, [4.3, 0, -4.9]);
    g.rotation.y = -0.35;
    const c = G.canvas(256, 360), x = c.getContext('2d');
    W._drawChalk = () => {
      x.fillStyle = '#2b2a2e'; x.fillRect(0, 0, 256, 360);
      const n = G.noise(64, 77); for (let i = 0; i < 3000; i++) { x.fillStyle = `rgba(255,255,255,${n[i % 4096] * 0.05})`; x.fillRect(Math.random() * 256, Math.random() * 360, 2, 2); }
      x.textAlign = 'center'; x.fillStyle = '#fff'; x.font = '700 44px Caveat'; x.fillText('today', 128, 70);
      x.fillStyle = '#f6a3b8'; x.font = '700 52px Caveat'; x.fillText('rose milk', 128, 140);
      x.fillStyle = '#fff'; x.font = '500 34px Caveat'; x.fillText('+ cheesecake', 128, 196);
      x.fillStyle = '#ffd36b'; x.font = '700 40px Caveat'; x.fillText('♥ ♥ ♥', 128, 270);
      ct.needsUpdate = true;
    };
    const ct = G.tex(c, { wrap: false });
    const board = new T.Group();
    G.m(G.rbox(0.62, 0.86, 0.035, 0.015), G.lib ? G.mat('#c99a6b', { roughness: 0.7 }) : null, { parent: board });
    G.m(new T.PlaneGeometry(0.52, 0.74), new T.MeshStandardMaterial({ map: ct, roughness: 0.95 }), { p: [0, 0, 0.019], parent: board, cast: false });
    const f = board, b = board.clone();
    f.position.set(0, 0.45, 0.14); f.rotation.x = -0.28;
    b.position.set(0, 0.45, -0.14); b.rotation.set(0.28, Math.PI, 0);
    g.add(f, b);
  }

  /* ================================================================== */
  /* the counter + the pass                                              */
  /* ================================================================== */
  {
    const z = L.counterZ, h = L.counterTop;
    const lacquer = G.mat('#f1a7ba', { physical: true, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.15 });
    G.m(G.rbox(15.2, h - 0.05, 0.96, 0.03), lacquer, { p: [0, (h - 0.05) / 2, z], parent: room });
    // fluted front (faces the dining room)
    const flute = new T.InstancedMesh(G.cyl(0.028, 0.028, h - 0.2, 12), lacquer, 250);
    const m4 = new T.Matrix4();
    for (let i = 0; i < 250; i++) { m4.makeTranslation(-7.5 + i * 0.06, (h - 0.2) / 2 + 0.1, z - 0.49); flute.setMatrixAt(i, m4); }
    flute.castShadow = flute.receiveShadow = true;
    room.add(flute);
    // brass kick + top band
    G.m(G.rbox(15.2, 0.06, 0.04, 0.015), G.brass(), { p: [0, 0.1, z - 0.52], parent: room });
    // marble slab
    const marble = G.lib('marble').clone(); marble.needsUpdate = true; marble.repeat.set(5, 0.4);
    G.m(G.rbox(15.5, 0.05, 1.14, 0.018), new T.MeshPhysicalMaterial({ map: marble, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08 }), { p: [0, h - 0.025, z], parent: room });
    // cook side: cabinets
    for (let i = -7; i < 7.5; i += 0.75) {
      G.m(G.rbox(0.72, 0.7, 0.03, 0.02), G.mat('#f6c3d0', { roughness: 0.45 }), { p: [i + 0.37, 0.48, z + 0.49], parent: room });
      G.m(G.rbox(0.16, 0.02, 0.025, 0.008), G.brass(), { p: [i + 0.37, 0.76, z + 0.52], parent: room });
    }
    // cook's prep bench (below the rail, mostly off-frame)
    G.m(G.rbox(4.2, 0.06, 0.7, 0.02), G.metal('#d8dbe1', 0.35), { p: [-0.05, 0.95, L.railZ + 0.25], parent: room });
    // the ticket rail
    const [a, b] = L.railX;
    const steel = G.metal('#e5e8ee', 0.16);
    G.m(G.cyl(0.016, 0.016, b - a + 0.16, 24), steel, { p: [(a + b) / 2, L.railY, L.railZ], r: [0, 0, Math.PI / 2], parent: room });
    G.m(G.rbox(b - a + 0.1, 0.03, 0.05, 0.01), steel, { p: [(a + b) / 2, L.railY - 0.03, L.railZ - 0.012], parent: room });
    [a - 0.06, b + 0.06].forEach((px) => {
      G.m(G.cyl(0.018, 0.018, L.railY - 0.95, 16), steel, { p: [px, (L.railY + 0.95) / 2, L.railZ], parent: room });
      G.m(G.sph(0.03, 16, 12), steel, { p: [px, L.railY, L.railZ], parent: room });
    });
  }

  /* ================================================================== */
  /* street traffic (people + scooters + autos)                          */
  /* ================================================================== */
  const traffic = [];
  function scooterModel(box, rider = true) {
    const g = new T.Group();
    const body = G.mat(B.pick(['#e9e4ea', '#f6c3d0', '#cfe3ee', '#2f2f38']), { physical: true, roughness: 0.3, clearcoat: 1 });
    [-0.55, 0.55].forEach((x) => { G.m(G.tor(0.2, 0.07, 12, 24), G.mat('#1f1b20', { roughness: 0.8 }), { p: [x, 0.25, 0], parent: g }); G.m(G.cyl(0.09, 0.09, 0.1, 16), G.metal(), { p: [x, 0.25, 0], r: [Math.PI / 2, 0, 0], parent: g }); });
    G.m(G.rbox(1.0, 0.24, 0.4, 0.1), body, { p: [-0.05, 0.48, 0], parent: g });
    G.m(G.rbox(0.18, 0.65, 0.34, 0.08), body, { p: [0.5, 0.72, 0], r: [0, 0, -0.25], parent: g });
    G.m(G.cyl(0.02, 0.02, 0.55, 8), G.metal('#333'), { p: [0.6, 1.08, 0], r: [Math.PI / 2, 0, 0], parent: g });
    G.m(G.rbox(0.5, 0.08, 0.3, 0.04), G.mat('#2a2228', { roughness: 0.6 }), { p: [-0.15, 0.66, 0], parent: g });
    if (rider) {
      const d = G.mat('#2e2430', { roughness: 0.75 });
      G.m(G.cap(0.15, 0.4), d, { p: [-0.1, 1.05, 0], r: [0, 0, -0.25], parent: g });
      G.m(G.cap(0.06, 0.4), d, { p: [0.15, 0.7, 0.12], r: [0, 0, 1.2], parent: g });
      G.m(G.cap(0.06, 0.4), d, { p: [0.15, 0.7, -0.12], r: [0, 0, 1.2], parent: g });
      G.m(G.sph(0.15, 20, 14), G.mat(box, { physical: true, roughness: 0.25, clearcoat: 1 }), { p: [0.0, 1.45, 0], parent: g });
      G.m(G.rbox(0.42, 0.42, 0.42, 0.04), G.mat(box, { roughness: 0.55 }), { p: [-0.45, 1.05, 0], parent: g });
    }
    return g;
  }
  function autoModel() {
    const g = new T.Group();
    const green = G.mat('#3e8a5c', { physical: true, roughness: 0.4, clearcoat: 0.8 }), yellow = G.mat('#f2c230', { physical: true, roughness: 0.4, clearcoat: 0.8 });
    G.m(G.rbox(2.2, 0.7, 1.3, 0.15), yellow, { p: [0, 0.6, 0], parent: g });
    G.m(G.rbox(2.0, 0.8, 1.32, 0.3), green, { p: [-0.1, 1.35, 0], parent: g });
    G.m(G.rbox(0.05, 0.6, 1.1, 0.02), G.glass('#cfe3ee'), { p: [0.9, 1.25, 0], parent: g });
    [[-0.7, 0.55], [-0.7, -0.55], [0.9, 0]].forEach(([x, z]) => G.m(G.tor(0.2, 0.08, 10, 20), G.mat('#1f1b20'), { p: [x, 0.25, z], parent: g }));
    return g;
  }
  W.spawnTraffic = () => {
    const wet = B.WX[B.state.weather].wet > 0.3;
    const r = Math.random();
    const dir = Math.random() < 0.5 ? 1 : -1;
    let obj, z, speed, walker = null;
    if (r < 0.45 && B.people) {
      walker = B.people.build(B.people.randomTraits(B.pick(['student', 'commuter', 'leisurely'])));
      if (wet || Math.random() < 0.08) B.people.umbrella(walker, B.pick(['#e46d8d', '#2f5a4c', '#f2b84b', '#3b4f8f', '#ffffff']));
      obj = walker.root;
      z = -7.3 - Math.random() * 0.9;
      speed = 1.1 + Math.random() * 0.35;
    } else if (r < 0.85) {
      obj = scooterModel(B.pick(['#e46d8d', '#3b4f8f', '#f2b84b', '#d23434', '#ec7716', '#2f5a4c']));
      z = dir > 0 ? -10.6 : -12.6;
      speed = 6 + Math.random() * 3;
    } else {
      obj = autoModel();
      z = dir > 0 ? -10.8 : -12.8;
      speed = 5 + Math.random() * 2;
    }
    obj.position.set(dir > 0 ? -18 : 18, 0, z);
    obj.rotation.y = walker ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : dir > 0 ? 0 : Math.PI;
    obj.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    out.add(obj);
    traffic.push({ obj, dir, speed, walker });
  };
  W.scooterAway = (box) => {
    const obj = scooterModel(box);
    obj.position.set(L.door[0] + 0.3, 0, -10.6);
    out.add(obj);
    traffic.push({ obj, dir: 1, speed: 0.5, accel: 9 });
  };
  G.onFrame((dt) => {
    const k = B.state.paused ? 0 : Math.min(B.state.speed || 1, 8);
    for (let i = traffic.length - 1; i >= 0; i--) {
      const t = traffic[i];
      if (t.accel) t.speed = Math.min(12, t.speed + t.accel * dt);
      t.obj.position.x += t.dir * t.speed * dt * k;
      if (t.walker) B.people.walkCycle(t.walker, dt * k * t.speed * 1.4);
      if (Math.abs(t.obj.position.x) > 19) { out.remove(t.obj); traffic.splice(i, 1); }
    }
  });
  W.trafficCount = () => traffic.length;
  // nothing outside may shade the windows — the sun has to reach the floor
  out.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  // a veil between the street and the room: night and rain dim the view out
  const veil = G.m(new T.PlaneGeometry(40, 14), new T.MeshBasicMaterial({ color: '#16183a', transparent: true, opacity: 0, depthWrite: false }), { p: [0, 5, L.wallZ - 0.36], parent: out, cast: false, recv: false });
  veil.renderOrder = -1;
  W.veil = veil;

  /* ================================================================== */
  /* time of day + weather                                               */
  /* ================================================================== */
  W.redrawText = () => { W._drawNeon(); W._drawTag(); W._drawChalk(); };
  const C = (h) => new T.Color(h);
  W.setSky = ({ top, bot, night, grey, wet, sunK, moonK }) => {
    sky.material.uniforms.top.value.set(top);
    sky.material.uniforms.bot.value.set(bot);
    sky.material.uniforms.haze.value.copy(C(bot)).lerp(C('#ffffff'), 0.25);
    sunDisc.position.set(-60 + sunK * 120, 4 + Math.sin(sunK * Math.PI) * 26, -78);
    sunDisc.material.color.set(C('#fff3c8').lerp(C('#ffb06b'), Math.max(0, Math.abs(sunK - 0.5) * 2 - 0.6) * 2.5));
    sunDisc.visible = night < 0.9 && grey < 0.5;
    moon.visible = night > 0.2;
    moon.position.set(-30 + moonK * 60, 8 + Math.sin(moonK * Math.PI) * 16, -78);
    clouds.children.forEach((c) => { c.userData.mat.color.copy(C('#ffffff').lerp(C('#8e8fa6'), grey)); c.userData.mat.emissiveIntensity = 0.35 * (1 - night) * (1 - grey * 0.6); });
    lampHeads.forEach((l) => (l.material.emissiveIntensity = night * 6));
    shopMats.forEach((m) => (m.emissiveIntensity = 0.15 + night * 0.9));
    rainLines.material.opacity = wet * 0.55;
    veil.material.opacity = Math.min(0.78, night * 0.7 + grey * 0.14 + wet * 0.08);
    veil.material.color.set(C('#16183a').lerp(C('#5d6274'), Math.max(0, grey - night)));
    glassMat.opacity = 0.08 - night * 0.04;
    glassMat.color.set(C('#ffffff').lerp(C('#3a3d5c'), night));
    rainGlass.opacity = wet * 0.85;
    roadMat.clearcoat = wet;
    roadMat.color.set(C('#5d5862').lerp(C('#3e3b44'), wet));
    scene.background.set(C(bot));
  };
})();
