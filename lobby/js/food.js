/* brew · food.js — 3D food models + a virtual photo studio.
   Every menu item is modelled at real scale. At boot each one is shot in the
   same studio (pink seamless, marble, softbox key) so the food photos on
   tickets, bubbles and the menu book all share one consistent look. */
(function () {
  const B = window.B, T = THREE, G = B.gfx;
  const F = (B.food = { photos: {}, imgs: {} });

  /* ---------------- materials ---------------- */
  const M = {
    cer: () => G.mat('#fbf7f5', { physical: true, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 }),
    cerPink: () => G.mat('#f2b3c4', { physical: true, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.08 }),
    terracotta: () => G.mat('#b45f39', { roughness: 0.92, normal: 'clayN', ns: 0.8 }),
    glass: () => G.glass('#ffffff', { thickness: 0.004, roughness: 0.02 }),
    ice: () => G.glass('#eef8ff', { thickness: 0.02, roughness: 0.12 }),
    golden: () => G.mat('#d4893b', { physical: true, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.4, normal: 'clayN', ns: 0.6 }),
    crumb: () => G.mat('#ecc98a', { roughness: 0.92, normal: 'clayN', ns: 1.2 }),
    crust: () => G.mat('#9a5422', { roughness: 0.75, normal: 'clayN', ns: 0.8 }),
  };
  const liquid = (map, o = {}) => new T.MeshPhysicalMaterial(Object.assign({ map, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 }, o));

  /* ---------------- surface textures (crema, latte art...) ---------------- */
  const SURF = {};
  function surface(kind) {
    if (SURF[kind]) return SURF[kind];
    const S = 256, c = G.canvas(S, S), x = c.getContext('2d');
    const rad = (stops) => { const g = x.createRadialGradient(S * 0.46, S * 0.44, 0, S / 2, S / 2, S / 2); stops.forEach(([o, col]) => g.addColorStop(o, col)); x.fillStyle = g; x.fillRect(0, 0, S, S); };
    const milk = '#fbf1e2';
    x.save();
    if (kind === 'heart' || kind === 'rosetta') {
      rad([[0, '#dca36a'], [0.55, '#b5713a'], [0.92, '#7a4220'], [1, '#5a2e14']]);
      x.fillStyle = milk; x.shadowColor = 'rgba(250,236,214,.9)'; x.shadowBlur = 6;
      if (kind === 'heart') {
        x.beginPath(); x.moveTo(128, 190);
        x.bezierCurveTo(60, 150, 52, 92, 92, 78); x.bezierCurveTo(112, 72, 124, 86, 128, 100);
        x.bezierCurveTo(132, 86, 144, 72, 164, 78); x.bezierCurveTo(204, 92, 196, 150, 128, 190); x.fill();
        x.fillStyle = 'rgba(181,113,58,.35)'; x.beginPath(); x.ellipse(128, 130, 20, 26, 0, 0, 7); x.fill();
      } else {
        for (let i = 0; i < 8; i++) { const y = 52 + i * 18, w = 70 - Math.abs(i - 3.5) * 9; x.beginPath(); x.ellipse(128, y, w / 2, 9, 0, 0, Math.PI); x.fill(); }
        x.fillRect(126, 40, 4, 170); x.beginPath(); x.arc(128, 214, 10, 0, 7); x.fill();
      }
    } else if (kind === 'tulip') {
      rad([[0, '#c6dd8c'], [0.6, '#9cbd59'], [1, '#668a33']]);
      x.fillStyle = milk; x.shadowColor = '#fff'; x.shadowBlur = 5;
      [[128, 172, 44], [128, 128, 34], [128, 92, 24]].forEach(([cx, cy, r]) => { x.beginPath(); x.ellipse(cx, cy, r, r * 0.7, 0, 0, 7); x.fill(); });
    } else if (kind === 'cocoa') {
      rad([[0, '#7e4632'], [1, '#3a1b10']]);
      x.fillStyle = 'rgba(160,100,70,.5)'; for (let i = 0; i < 60; i++) { x.beginPath(); x.arc(Math.random() * S, Math.random() * S, 1.5, 0, 7); x.fill(); }
    } else if (kind === 'chai') {
      rad([[0, '#e0b07c'], [0.7, '#b8773d'], [1, '#9b5a26']]);
      x.strokeStyle = 'rgba(245,225,195,.85)'; x.lineWidth = 16; x.beginPath(); x.arc(128, 128, 112, 0, 7); x.stroke();
      x.fillStyle = 'rgba(245,225,195,.6)'; for (let i = 0; i < 40; i++) { x.beginPath(); x.arc(128 + (Math.random() - 0.5) * 220, 128 + (Math.random() - 0.5) * 220, 2 + Math.random() * 4, 0, 7); x.fill(); }
    } else if (kind === 'latte-top') {
      rad([[0, '#f6e9d8'], [1, '#e8d2b6']]);
    } else if (kind === 'coldbrew-top') {
      rad([[0, '#7b3f1c'], [1, '#4a2310']]);
    } else if (kind === 'rose-top') {
      rad([[0, '#ffdbe6'], [1, '#f6a3bb']]);
    } else if (kind === 'cheese') {
      x.fillStyle = '#f7c548'; x.fillRect(0, 0, S, S);
      for (let i = 0; i < 26; i++) { const g = x.createRadialGradient(0, 0, 0, 0, 0, 20); g.addColorStop(0, 'rgba(190,110,30,.7)'); g.addColorStop(1, 'rgba(190,110,30,0)'); x.save(); x.translate(Math.random() * S, Math.random() * S); x.fillStyle = g; x.fillRect(-20, -20, 40, 40); x.restore(); }
      x.fillStyle = 'rgba(255,240,170,.5)'; for (let i = 0; i < 20; i++) { x.beginPath(); x.ellipse(Math.random() * S, Math.random() * S, 14, 6, Math.random() * 3, 0, 7); x.fill(); }
    } else if (kind === 'grill') {
      x.fillStyle = '#d9a35c'; x.fillRect(0, 0, S, S);
      const n = G.noise(64, 13);
      for (let i = 0; i < 400; i++) { x.fillStyle = `rgba(150,80,30,${n[i % 4096] * 0.25})`; x.fillRect(Math.random() * S, Math.random() * S, 4, 4); }
      x.strokeStyle = 'rgba(70,30,10,.75)'; x.lineWidth = 12; x.lineCap = 'round';
      for (let i = -2; i < 6; i++) { x.beginPath(); x.moveTo(i * 60, 0); x.lineTo(i * 60 + 120, S); x.stroke(); }
    } else if (kind === 'straw') {
      x.fillStyle = '#fff'; x.fillRect(0, 0, S, S); x.fillStyle = '#f07ea0';
      for (let i = -4; i < 12; i++) { x.save(); x.translate(i * 32, 0); x.rotate(0.5); x.fillRect(0, -40, 14, 400); x.restore(); }
    } else if (kind === 'orange') {
      x.fillStyle = '#ffd27a'; x.fillRect(0, 0, S, S);
      x.fillStyle = '#f39a2a'; x.beginPath(); x.arc(128, 128, 120, 0, 7); x.fill();
      x.fillStyle = '#ffc25a'; x.beginPath(); x.arc(128, 128, 104, 0, 7); x.fill();
      x.strokeStyle = '#fff1c8'; x.lineWidth = 5; for (let a = 0; a < 10; a++) { x.beginPath(); x.moveTo(128, 128); x.lineTo(128 + Math.cos(a * 0.628) * 104, 128 + Math.sin(a * 0.628) * 104); x.stroke(); }
    }
    x.restore();
    return (SURF[kind] = G.tex(c, { wrap: kind === 'straw' || kind === 'grill' || kind === 'cheese' }));
  }

  /* ---------------- geometry builders ---------------- */
  const GEO = {};
  const geo = (k, fn) => GEO[k] || (GEO[k] = fn());
  const add = (g, geom, mat, p, r, s) => G.m(geom, mat, { p, r, s, parent: g });

  function saucer(g, mat = M.cer()) {
    add(g, geo('saucer', () => G.lathe([[0, 0], [0.05, 0], [0.068, 0.006], [0.078, 0.013], [0.076, 0.015], [0.066, 0.009], [0.05, 0.006], [0, 0.006]], 64)), mat);
  }
  function plate(g, r = 0.11) {
    add(g, geo('plate' + r, () => G.lathe([[0, 0], [r * 0.72, 0], [r * 0.8, 0.003], [r, 0.016], [r * 0.985, 0.019], [r * 0.9, 0.011], [r * 0.74, 0.007], [0, 0.007]], 72)), M.cer());
    return 0.007;
  }
  function cup(g, { body = M.cer(), saucerMat = M.cer(), art = 'heart', s = 1 }) {
    const c = G.group(g);
    c.scale.setScalar(s);
    saucer(c, saucerMat);
    const prof = [[0, 0.006], [0.026, 0.006], [0.029, 0.009], [0.033, 0.022], [0.042, 0.048], [0.0465, 0.066], [0.0472, 0.07], [0.0458, 0.0712], [0.0442, 0.0685], [0.0405, 0.05], [0.031, 0.024], [0, 0.017]];
    add(c, geo('cup', () => G.lathe(prof, 64)), body);
    add(c, geo('cupLiq', () => new T.CircleGeometry(0.0435, 48)), liquid(surface(art)), [0, 0.0655, 0], [-Math.PI / 2, 0, -0.5]);
    add(c, geo('handle', () => new T.TorusGeometry(0.0145, 0.0042, 12, 28, Math.PI * 1.25)), body, [0.049, 0.045, 0], [0, 0, -Math.PI * 0.62]);
    return c;
  }
  function tallGlass(g, { liq, top, ice = true, straw = true, extra }) {
    const shell = [[0, 0], [0.032, 0], [0.034, 0.003], [0.0395, 0.15], [0.0385, 0.1512], [0.0372, 0.149], [0.0322, 0.006], [0, 0.006]];
    // liquid with a vertical colour gradient (vertex colours)
    const lg = G.lathe([[0, 0.007], [0.0318, 0.007], [0.0362, 0.118], [0, 0.118]], 48);
    const cols = [];
    const pos = lg.attributes.position;
    const cA = new T.Color(liq[0]), cB = new T.Color(liq[1]), cC = new T.Color(liq[2] || liq[1]);
    for (let i = 0; i < pos.count; i++) {
      const y = (pos.getY(i) - 0.007) / 0.111;
      const c = y < 0.5 ? cA.clone().lerp(cB, y / 0.5) : cB.clone().lerp(cC, (y - 0.5) / 0.5);
      cols.push(c.r, c.g, c.b);
    }
    lg.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    add(g, lg, new T.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.2, transmission: 0.25, thickness: 0.05, clearcoat: 1 }));
    add(g, geo('liqTop', () => new T.CircleGeometry(0.036, 40)), liquid(surface(top)), [0, 0.118, 0], [-Math.PI / 2, 0, 0]);
    if (ice) [[-0.012, 0.11, 0.008, 0.3], [0.013, 0.112, -0.006, 0.9], [0.002, 0.098, 0.012, 1.6], [-0.006, 0.124, -0.012, 2.2]].forEach(([x, y, z, r]) => add(g, G.rbox(0.021, 0.021, 0.021, 0.004), M.ice(), [x, y, z], [r, r * 1.3, r * 0.7]));
    if (straw) add(g, geo('straw', () => G.cyl(0.0034, 0.0034, 0.21, 12)), new T.MeshStandardMaterial({ map: surface('straw'), roughness: 0.6 }), [0.012, 0.13, 0.006], [0.05, 0, -0.22]);
    add(g, geo('glassShell', () => G.lathe(shell, 64)), M.glass());
    if (extra) extra(g);
  }

  /* ---------------- models ---------------- */
  const BUILD = {
    cappuccino: (g) => cup(g, { art: 'heart' }),
    flatwhite: (g) => cup(g, { art: 'rosetta', s: 0.86, saucerMat: M.cerPink() }),
    matcha: (g) => cup(g, { art: 'tulip', body: M.cerPink(), saucerMat: M.cerPink() }),
    hotchoc: (g) => {
      add(g, geo('mug', () => G.lathe([[0, 0], [0.037, 0], [0.04, 0.003], [0.041, 0.088], [0.0395, 0.0895], [0.0378, 0.087], [0.0372, 0.01], [0, 0.01]], 64)), M.cerPink());
      add(g, geo('cocoaTop', () => new T.CircleGeometry(0.037, 40)), liquid(surface('cocoa')), [0, 0.078, 0], [-Math.PI / 2, 0, 0]);
      add(g, geo('mugHandle', () => new T.TorusGeometry(0.022, 0.0058, 12, 28, Math.PI * 1.15)), M.cerPink(), [0.042, 0.046, 0], [0, 0, -Math.PI * 0.58]);
      [[-0.012, 0.004, 0.3, '#ffffff'], [0.01, -0.008, 1.1, '#ffd3df'], [0.004, 0.014, 2, '#ffffff'], [-0.016, -0.014, 0.6, '#ffe8ef']].forEach(([x, z, r, c]) =>
        add(g, G.rbox(0.017, 0.013, 0.017, 0.005), G.mat(c, { roughness: 0.85 }), [x, 0.082, z], [0.2, r, 0.15]));
    },
    chai: (g) => {
      add(g, geo('kulhad', () => G.lathe([[0, 0], [0.026, 0], [0.03, 0.004], [0.041, 0.055], [0.0445, 0.075], [0.0432, 0.0775], [0.0405, 0.0735], [0.03, 0.02], [0, 0.012]], 40)), M.terracotta());
      add(g, geo('chaiTop', () => new T.CircleGeometry(0.0405, 40)), liquid(surface('chai')), [0, 0.068, 0], [-Math.PI / 2, 0, 0]);
      // a cinnamon stick and cardamom alongside
      add(g, G.cyl(0.0055, 0.0055, 0.09, 12), G.mat('#7d3f1d', { roughness: 0.9 }), [0.075, 0.006, 0.03], [0, 0.6, Math.PI / 2]);
      [[0.07, 0.006, -0.03], [0.085, 0.006, -0.012]].forEach((p, i) => add(g, G.sph(0.008, 14, 10), G.mat('#9fb35a', { roughness: 0.8 }), p, [0, i, 0], [1, 0.6, 1.6]));
    },
    icedlatte: (g) => tallGlass(g, { liq: ['#6b371a', '#b97c4a', '#f1e2cf'], top: 'latte-top' }),
    coldbrew: (g) => tallGlass(g, {
      liq: ['#3a190a', '#5c2c12', '#7b3f1c'], top: 'coldbrew-top', straw: false,
      extra: (h) => add(h, G.cyl(0.026, 0.026, 0.005, 32), new T.MeshStandardMaterial({ map: surface('orange'), roughness: 0.5 }), [0.03, 0.148, 0], [Math.PI / 2, 0.4, 0.2]),
    }),
    rosemilk: (g) => tallGlass(g, {
      liq: ['#ec6f93', '#f6a0b8', '#ffd9e4'], top: 'rose-top', ice: false,
      extra: (h) => {
        const seeds = new T.InstancedMesh(G.sph(0.0018, 8, 6), G.mat('#22141a', { roughness: 0.4 }), 60);
        const m4 = new T.Matrix4();
        for (let i = 0; i < 60; i++) { const a = Math.random() * 6.28, r = Math.random() * 0.028; m4.setPosition(Math.cos(a) * r, 0.02 + Math.random() * 0.06, Math.sin(a) * r); seeds.setMatrixAt(i, m4); }
        h.add(seeds);
        [[0.008, 0.12, 0.004, 0.4], [-0.01, 0.121, -0.006, 1.6]].forEach(([x, y, z, r]) => add(h, G.sph(0.011, 16, 8), G.mat('#e0406c', { roughness: 0.5 }), [x, y, z], [0, r, 0], [1, 0.15, 0.6]));
      },
    }),
    croissant: (g) => {
      const y0 = plate(g);
      const lobes = [[-3, 0.012, 0.5], [-2, 0.019, 0.68], [-1, 0.025, 0.85], [0, 0.029, 1], [1, 0.025, 0.85], [2, 0.019, 0.68], [3, 0.012, 0.5]];
      const c = G.group(g, [0, y0, 0.012]);
      lobes.forEach(([i, r, k]) => {
        const a = i * 0.36, R = 0.048;
        const m = add(c, G.sph(1, 28, 18), M.golden(), [Math.sin(a) * R, r * 0.82, -Math.cos(a) * R * 0.72 + 0.03], [0.15, a, 0.12 * i], [r * 1.25, r * 0.9, r * 1.05 * k + 0.004]);
        m.scale.z = r * 1.7;
      });
    },
    muffin: (g) => {
      const y0 = plate(g, 0.085);
      const liner = new T.CylinderGeometry(0.044, 0.034, 0.042, 72, 1, true);
      const p = liner.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x), k = 1 + Math.sin(a * 30) * 0.035; p.setX(i, x * k); p.setZ(i, z * k); }
      liner.computeVertexNormals();
      add(g, liner, G.mat('#f4a9bd', { roughness: 0.7, side: T.DoubleSide }), [0, y0 + 0.021, 0]);
      add(g, G.sph(0.05, 40, 24), G.mat('#b9763d', { roughness: 0.85, normal: 'clayN', ns: 1.6 }), [0, y0 + 0.046, 0], null, [1, 0.62, 1]);
      [[0.02, 0.018, 0.4], [-0.018, 0.02, 1.2], [0.004, 0.026, 2.3], [-0.025, 0.01, 3.4], [0.028, 0.006, 4.4], [0.0, 0.03, 0]].forEach(([r, h, a]) =>
        add(g, G.sph(0.0072, 16, 10), G.mat('#2e2a5e', { roughness: 0.35 }), [Math.cos(a) * r, y0 + 0.054 + h * 0.5, Math.sin(a) * r]));
    },
    cheesecake: (g) => {
      const y0 = plate(g);
      const sh = new T.Shape();
      sh.moveTo(0, 0); sh.lineTo(0.1, -0.034); sh.absarc(0, 0, 0.105, -0.33, 0.33, false); sh.lineTo(0, 0);
      const layer = (h, d, mat, y) => {
        const eg = new T.ExtrudeGeometry(sh, { depth: d, bevelEnabled: true, bevelSize: 0.0015, bevelThickness: 0.0015, bevelSegments: 2, curveSegments: 24 });
        const m = add(g, eg, mat, [-0.045, y, 0.02], [-Math.PI / 2, 0, 0.5]);
        return m;
      };
      layer(0, 0.012, G.mat('#a8703c', { roughness: 0.9, normal: 'clayN', ns: 1.5 }), y0);
      layer(0, 0.034, G.mat('#f6e6c4', { roughness: 0.7 }), y0 + 0.012);
      layer(0, 0.006, G.mat('#d4283e', { physical: true, roughness: 0.12, clearcoat: 1 }), y0 + 0.046);
      [[0.0, 0.058, 0.005], [0.03, 0.058, -0.005]].forEach(([x, y, z], i) => {
        add(g, G.sph(0.012, 20, 14), G.mat('#e0283e', { physical: true, roughness: 0.25, clearcoat: 0.8 }), [x - 0.004, y0 + y, z + 0.02], [0, i, 0], [1, 1.25, 1]);
        add(g, new T.ConeGeometry(0.008, 0.006, 6), G.mat('#4f8f3a'), [x - 0.004, y0 + y + 0.015, z + 0.02]);
      });
    },
    cinnamon: (g) => {
      const y0 = plate(g);
      const pts = [];
      for (let t = 0; t <= Math.PI * 4.4; t += 0.15) { const r = 0.006 + t * 0.0034; pts.push(new T.Vector3(Math.cos(t) * r, 0, Math.sin(t) * r)); }
      const curve = new T.CatmullRomCurve3(pts);
      const tube = new T.TubeGeometry(curve, 160, 0.011, 12, false);
      add(g, tube, G.mat('#b56c33', { roughness: 0.75, normal: 'clayN', ns: 1.2 }), [0, y0 + 0.012, 0], null, [1, 1.3, 1]);
      add(g, G.cyl(0.05, 0.05, 0.016, 48), G.mat('#9c5627', { roughness: 0.8 }), [0, y0 + 0.006, 0]);
      const zz = [];
      for (let i = 0; i <= 10; i++) zz.push(new T.Vector3(-0.045 + i * 0.009, 0, (i % 2 ? 1 : -1) * 0.03));
      add(g, new T.TubeGeometry(new T.CatmullRomCurve3(zz), 120, 0.0028, 8, false), G.mat('#fffaf0', { physical: true, roughness: 0.3, clearcoat: 0.6 }), [0, y0 + 0.03, 0]);
    },
    avotoast: (g) => {
      const y0 = plate(g, 0.12);
      const bs = new T.Shape();
      bs.moveTo(-0.055, -0.045); bs.lineTo(0.055, -0.045); bs.lineTo(0.058, 0.02);
      bs.bezierCurveTo(0.07, 0.06, 0.03, 0.07, 0.0, 0.055); bs.bezierCurveTo(-0.03, 0.07, -0.07, 0.06, -0.058, 0.02); bs.closePath();
      const bread = new T.ExtrudeGeometry(bs, { depth: 0.018, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 3 });
      add(g, bread, [M.crumb(), M.crust()], [0, y0 + 0.003, 0.006], [-Math.PI / 2, 0, 0.15]);
      const cs = new T.Shape();
      cs.absarc(0, 0, 0.03, 0.2, Math.PI - 0.2, false); cs.absarc(0, -0.006, 0.026, Math.PI - 0.3, 0.3, true);
      const sl = new T.ExtrudeGeometry(cs, { depth: 0.006, bevelEnabled: true, bevelSize: 0.0015, bevelThickness: 0.0015, bevelSegments: 2, curveSegments: 20 });
      const avo = [G.mat('#b4cf62', { physical: true, roughness: 0.35, clearcoat: 0.6 }), G.mat('#3f6a22', { roughness: 0.6 })];
      for (let i = 0; i < 5; i++) add(g, sl, avo, [-0.034 + i * 0.017, y0 + 0.027 + i * 0.0015, 0.018 - i * 0.002], [-Math.PI / 2 + 0.25, 0, 1.4 + i * 0.05]);
      const fl = new T.InstancedMesh(G.rbox(0.003, 0.0015, 0.0025, 0.0005, 1), G.mat('#c72a17'), 40);
      const m4 = new T.Matrix4();
      for (let i = 0; i < 40; i++) { m4.makeRotationY(Math.random() * 6); m4.setPosition((Math.random() - 0.5) * 0.09, y0 + 0.036, (Math.random() - 0.5) * 0.06); fl.setMatrixAt(i, m4); }
      g.add(fl);
      [[0.03, -0.012], [0.035, -0.002], [-0.04, 0.02]].forEach(([x, z]) => add(g, G.sph(0.006, 10, 8), G.mat('#6fa83f'), [x, y0 + 0.037, z], null, [1, 0.4, 1.6]));
    },
    sandwich: (g) => {
      const y0 = plate(g, 0.12);
      const tri = new T.Shape(); tri.moveTo(-0.06, -0.04); tri.lineTo(0.06, -0.04); tri.lineTo(-0.06, 0.06); tri.closePath();
      const slab = (d) => new T.ExtrudeGeometry(tri, { depth: d, bevelEnabled: true, bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 2 });
      const grill = new T.MeshStandardMaterial({ map: surface('grill'), roughness: 0.8 });
      grill.map.repeat.set(12, 12);
      const half = (p, r) => {
        const h = G.group(g, p);
        h.rotation.set(...r);
        add(h, slab(0.012), [M.crumb(), M.crust()], [0, 0, 0], [-Math.PI / 2, 0, 0]);
        add(h, slab(0.004), G.mat('#4f9a3a', { roughness: 0.5 }), [0, 0.014, 0], [-Math.PI / 2, 0, 0], [1.02, 1.02, 1]);
        add(h, slab(0.012), G.mat('#e58a3c', { roughness: 0.7, normal: 'clayN', ns: 1.5 }), [0, 0.018, 0], [-Math.PI / 2, 0, 0], [1.01, 1.01, 1]);
        add(h, slab(0.003), G.mat('#9d4fa0', { roughness: 0.5 }), [0, 0.03, 0], [-Math.PI / 2, 0, 0], [1.02, 1.02, 1]);
        add(h, slab(0.012), [grill, M.crust()], [0, 0.034, 0], [-Math.PI / 2, 0, 0]);
      };
      half([-0.01, y0 + 0.002, 0.02], [0, 0.4, 0]);
      half([0.02, y0 + 0.03, -0.015], [0.5, -2.4, 0.1]);
      add(g, G.cyl(0.02, 0.016, 0.018, 24), M.cer(), [0.075, y0 + 0.009, 0.04]);
      add(g, G.cyl(0.0175, 0.0175, 0.002, 24), G.mat('#5e9a3b', { roughness: 0.3 }), [0.075, y0 + 0.016, 0.04]);
    },
    cheesetoast: (g) => {
      const y0 = plate(g, 0.12);
      const cheese = new T.MeshPhysicalMaterial({ map: surface('cheese'), roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.2 });
      [[-0.022, 0.02, 0.18, 0], [0.024, -0.016, -0.12, 0.014]].forEach(([x, z, r, dy]) => {
        const t = G.group(g, [x, y0 + dy, z]);
        t.rotation.y = r;
        add(t, G.rbox(0.09, 0.014, 0.06, 0.006), M.crust(), [0, 0.007, 0]);
        add(t, G.rbox(0.084, 0.006, 0.054, 0.003), cheese, [0, 0.016, 0]);
        [[-0.02, 0.01], [0.015, -0.012], [0.026, 0.014]].forEach(([cx, cz]) => add(t, G.tor(0.0045, 0.0014, 8, 20), G.mat('#3f8a2c', { roughness: 0.45 }), [cx, 0.02, cz], [Math.PI / 2, 0, 0]));
        [[-0.03, -0.01], [0.0, 0.016]].forEach(([cx, cz]) => add(t, G.sph(0.004, 8, 6), G.mat('#4e9a34'), [cx, 0.02, cz], null, [1.4, 0.3, 1]));
      });
    },
  };

  /** fresh 3D instance of a menu item (real scale, origin at its base) */
  F.model = (id) => {
    const g = new T.Group();
    (BUILD[id] || BUILD.cappuccino)(g);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.userData.food = id;
    return g;
  };

  /* ---------------- the photo studio ---------------- */
  F.shoot = async function (onProgress) {
    const S = 384;
    const r = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
    r.setPixelRatio(1);
    r.setSize(S, S);
    r.outputColorSpace = T.SRGBColorSpace;
    r.toneMapping = T.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = T.VSMShadowMap;
    const sc = new T.Scene();
    sc.background = new T.Color('#f6c9d5');
    const pm = new T.PMREMGenerator(r);
    sc.environment = pm.fromScene(new window.TX.RoomEnvironment(r), 0.04).texture;
    // seamless sweep + marble
    const sweep = new T.Mesh(new T.CylinderGeometry(1.2, 1.2, 3, 64, 1, true, Math.PI * 0.75, Math.PI * 1.5), new T.MeshStandardMaterial({ color: '#f7cad6', roughness: 0.95, side: T.BackSide }));
    sweep.position.set(0, 1.2, 0.3);
    sweep.receiveShadow = true;
    sc.add(sweep);
    const marble = G.lib('marble').clone();
    marble.needsUpdate = true;
    const table = new T.Mesh(new T.CircleGeometry(0.6, 64), new T.MeshPhysicalMaterial({ map: marble, roughness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.15 }));
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = true;
    sc.add(table);
    const keyL = new T.DirectionalLight('#fff4ea', 2.4);
    keyL.position.set(-0.5, 0.9, 0.45);
    keyL.castShadow = true;
    keyL.shadow.mapSize.set(1024, 1024);
    keyL.shadow.radius = 9;
    keyL.shadow.blurSamples = 16;
    Object.assign(keyL.shadow.camera, { left: -0.3, right: 0.3, top: 0.3, bottom: -0.3, near: 0.1, far: 3 });
    sc.add(keyL);
    const rim = new T.DirectionalLight('#ffd6e2', 1.2);
    rim.position.set(0.6, 0.5, -0.6);
    sc.add(rim);
    sc.add(new T.HemisphereLight('#fff6f8', '#e9b3c2', 0.6));
    const cam = new T.PerspectiveCamera(28, 1, 0.01, 10);
    const ids = B.MENU.map((m) => m.id);
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const mdl = F.model(id);
      mdl.rotation.y = -0.35;
      sc.add(mdl);
      const box = new T.Box3().setFromObject(mdl);
      const size = box.getSize(new T.Vector3()), ctr = box.getCenter(new T.Vector3());
      const rad = Math.max(size.x, size.y * 1.1, size.z) * 0.72;
      const dist = rad / Math.tan((28 * Math.PI) / 360) * 1.05;
      const dir = new T.Vector3(0.12, 0.62, 1).normalize();
      cam.position.copy(ctr).addScaledVector(dir, dist);
      cam.lookAt(ctr.x, ctr.y - size.y * 0.06, ctr.z);
      r.render(sc, cam);
      const c = G.canvas(S, S);
      c.getContext('2d').drawImage(r.domElement, 0, 0);
      F.photos[id] = c.toDataURL('image/jpeg', 0.9);
      const im = new Image();
      im.src = F.photos[id];
      F.imgs[id] = im;
      sc.remove(mdl);
      onProgress && onProgress((i + 1) / ids.length, B.ITEM[id].name);
      await new Promise((res) => setTimeout(res, 0));
    }
    await Promise.all(Object.values(F.imgs).map((im) => (im.complete ? 1 : new Promise((res) => (im.onload = res)))));
    pm.dispose();
    r.dispose();
    r.forceContextLoss();
  };
  F.photo = (id) => F.photos[id];
})();
