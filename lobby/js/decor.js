/* brew · decor.js — set dressing & atmosphere: the espresso bar (which steams
   while the kitchen brews), counter clutter, flowers, festoon lights, hanging
   plants, sunbeams through the arched windows and dust drifting in them. */
(function () {
  const B = window.B, T = THREE, G = B.gfx, L = B.L;
  const scene = G.scene;
  const D = (B.decor = {});
  const top = L.counterTop;

  /* ---------------- espresso machine ---------------- */
  const steamSprites = [];
  function espresso(x, z) {
    const g = G.group(scene, [x, top, z]);
    g.rotation.y = 0.12;
    const pink = G.mat('#f19bb3', { physical: true, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.06 });
    const chrome = G.metal('#eef0f4', 0.12);
    G.m(G.rbox(0.66, 0.06, 0.46, 0.015), chrome, { p: [0, 0.03, 0], parent: g });
    G.m(G.rbox(0.64, 0.34, 0.42, 0.05), pink, { p: [0, 0.23, -0.02], parent: g });
    G.m(G.rbox(0.66, 0.03, 0.44, 0.01), chrome, { p: [0, 0.415, -0.02], parent: g });
    // cup warmer: a row of little cups
    for (let i = 0; i < 6; i++) G.m(G.lathe([[0, 0], [0.025, 0], [0.032, 0.05], [0, 0.05]], 18), G.mat(i % 2 ? '#fbf7f5' : '#f3b9c8', { physical: true, roughness: 0.3, clearcoat: 1 }), { p: [-0.25 + i * 0.1, 0.43, -0.08], r: [Math.PI, 0, 0], parent: g });
    // front panel, gauges, group heads
    G.m(G.rbox(0.56, 0.16, 0.012, 0.01), chrome, { p: [0, 0.3, 0.195], parent: g });
    const gauge = (() => { const c = G.canvas(128, 128), x = c.getContext('2d'); x.fillStyle = '#fffaf2'; x.beginPath(); x.arc(64, 64, 62, 0, 7); x.fill(); x.strokeStyle = '#3a2430'; x.lineWidth = 3; for (let i = 0; i < 9; i++) { const a = Math.PI * 0.8 + (i / 8) * Math.PI * 1.4; x.beginPath(); x.moveTo(64 + Math.cos(a) * 46, 64 + Math.sin(a) * 46); x.lineTo(64 + Math.cos(a) * 56, 64 + Math.sin(a) * 56); x.stroke(); } x.strokeStyle = '#e0453a'; x.lineWidth = 4; x.beginPath(); x.moveTo(64, 64); x.lineTo(64 + Math.cos(-0.4) * 44, 64 + Math.sin(-0.4) * 44); x.stroke(); return G.tex(c, { wrap: false }); })();
    [-0.12, 0.12].forEach((gx) => {
      G.m(G.cyl(0.045, 0.045, 0.02, 32), chrome, { p: [gx, 0.33, 0.205], r: [Math.PI / 2, 0, 0], parent: g });
      G.m(new T.CircleGeometry(0.038, 32), new T.MeshStandardMaterial({ map: gauge, roughness: 0.2 }), { p: [gx, 0.33, 0.216], parent: g, cast: false });
    });
    [-0.17, 0.17].forEach((gx) => {
      G.m(G.cyl(0.045, 0.05, 0.06, 24), chrome, { p: [gx, 0.17, 0.17], parent: g });
      G.m(G.cyl(0.04, 0.034, 0.03, 24), chrome, { p: [gx, 0.13, 0.18], parent: g });
      G.m(G.cap(0.012, 0.13), G.mat('#2a2126', { roughness: 0.4 }), { p: [gx, 0.13, 0.27], r: [Math.PI / 2, 0, 0], parent: g });
      // a shot glass waiting under each head
      G.m(G.lathe([[0, 0], [0.022, 0], [0.026, 0.06], [0, 0.06]], 18), G.glass(), { p: [gx, 0.065, 0.17], parent: g });
      G.m(G.cyl(0.021, 0.021, 0.025, 18), G.mat('#5a2a12', { roughness: 0.3 }), { p: [gx, 0.08, 0.17], parent: g });
    });
    G.m(new T.TubeGeometry(new T.CatmullRomCurve3([new T.Vector3(0.3, 0.3, 0.12), new T.Vector3(0.36, 0.28, 0.2), new T.Vector3(0.37, 0.12, 0.24)]), 20, 0.007, 8), chrome, { parent: g });
    G.m(G.rbox(0.16, 0.024, 0.07, 0.008), G.mat('#f6f2f3', { roughness: 0.5 }), { p: [0, 0.48, -0.02], parent: g });
    // steam
    for (let i = 0; i < 10; i++) {
      const s = new T.Sprite(new T.SpriteMaterial({ map: B.mistTex, transparent: true, opacity: 0, depthWrite: false }));
      s.userData = { ph: Math.random(), x: [-0.17, 0.17, 0.37][i % 3] };
      g.add(s);
      steamSprites.push(s);
    }
    return g;
  }
  function grinder(x, z) {
    const g = G.group(scene, [x, top, z]);
    const pink = G.mat('#fbeff2', { physical: true, roughness: 0.25, clearcoat: 1 });
    G.m(G.rbox(0.16, 0.05, 0.22, 0.02), pink, { p: [0, 0.025, 0], parent: g });
    G.m(G.rbox(0.13, 0.26, 0.16, 0.03), pink, { p: [0, 0.18, -0.02], parent: g });
    G.m(G.cyl(0.05, 0.03, 0.04, 20), G.metal(), { p: [0, 0.33, -0.02], parent: g });
    G.m(G.lathe([[0.025, 0], [0.09, 0.14], [0.085, 0.145], [0.022, 0.005]], 32), G.glass('#fff', { thickness: 0.01 }), { p: [0, 0.35, -0.02], parent: g });
    G.m(G.lathe([[0, 0], [0.025, 0], [0.07, 0.09], [0, 0.09]], 24), G.mat('#3b1d0f', { roughness: 0.6, normal: 'clayN', ns: 2 }), { p: [0, 0.355, -0.02], parent: g });
    return g;
  }
  function cakeStand(x, z) {
    const g = G.group(scene, [x, top, z]);
    G.m(G.lathe([[0, 0], [0.09, 0], [0.08, 0.01], [0.02, 0.03], [0.018, 0.12], [0.03, 0.13], [0.16, 0.135], [0.16, 0.145], [0, 0.145]], 48), G.mat('#fbf7f5', { physical: true, roughness: 0.25, clearcoat: 1 }), { parent: g });
    const cake = G.group(g, [0, 0.145, 0]);
    G.m(G.cyl(0.11, 0.11, 0.05, 48), G.mat('#fff2e2', { roughness: 0.6 }), { p: [0, 0.025, 0], parent: cake });
    G.m(G.cyl(0.111, 0.111, 0.012, 48), G.mat('#f07ea0', { roughness: 0.5 }), { p: [0, 0.056, 0], parent: cake });
    G.m(G.cyl(0.1, 0.1, 0.045, 48), G.mat('#fff2e2', { roughness: 0.6 }), { p: [0, 0.084, 0], parent: cake });
    G.m(G.cyl(0.102, 0.1, 0.012, 48), G.mat('#f6a3b8', { physical: true, roughness: 0.2, clearcoat: 1 }), { p: [0, 0.112, 0], parent: cake });
    for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; G.m(G.sph(0.016, 14, 10), G.mat('#d8243c', { physical: true, roughness: 0.25, clearcoat: 1 }), { p: [Math.cos(a) * 0.07, 0.125, Math.sin(a) * 0.07], s: [1, 1.2, 1], parent: cake }); }
    // a slice taken out (the fridge has the rest)
    G.m(G.lathe([[0.15, 0], [0.15, 0.2], [0.11, 0.3], [0.03, 0.335], [0.018, 0.36], [0.03, 0.38], [0, 0.385]], 48), G.glass('#ffffff', { roughness: 0.03, thickness: 0.004 }), { p: [0, 0.145, 0], parent: g, cast: false });
    return g;
  }
  function tipJar(x, z) {
    const g = G.group(scene, [x, top, z]);
    G.m(G.lathe([[0, 0], [0.05, 0], [0.052, 0.1], [0.044, 0.12], [0.044, 0.13], [0, 0.13]], 32), G.glass(), { parent: g, cast: false });
    const coins = new T.InstancedMesh(G.cyl(0.011, 0.011, 0.003, 16), G.brass(), 16);
    const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler();
    for (let i = 0; i < 16; i++) { q.setFromEuler(e.set(Math.random(), Math.random(), Math.random())); m4.compose(new T.Vector3((Math.random() - 0.5) * 0.06, 0.006 + Math.random() * 0.03, (Math.random() - 0.5) * 0.06), q, new T.Vector3(1, 1, 1)); coins.setMatrixAt(i, m4); }
    g.add(coins);
    const c = G.canvas(128, 64), x2 = c.getContext('2d');
    D._tipLabel = () => { x2.clearRect(0, 0, 128, 64); x2.fillStyle = '#fffdf8'; x2.beginPath(); x2.roundRect(4, 8, 120, 48, 10); x2.fill(); x2.fillStyle = '#c43e64'; x2.font = '700 34px Caveat'; x2.textAlign = 'center'; x2.textBaseline = 'middle'; x2.fillText('tips ♥', 64, 34); lt.needsUpdate = true; };
    const lt = G.tex(c, { wrap: false });
    G.m(new T.PlaneGeometry(0.075, 0.037), new T.MeshStandardMaterial({ map: lt, transparent: true }), { p: [0, 0.06, 0.053], parent: g, cast: false });
  }
  function flowers(parent, x, y, z, s = 1, colors = ['#f07ea0', '#ffd3df', '#ffffff']) {
    const g = G.group(parent, [x, y, z]);
    g.scale.setScalar(s);
    G.m(G.lathe([[0, 0], [0.028, 0], [0.04, 0.04], [0.02, 0.1], [0.016, 0.13], [0.02, 0.135], [0, 0.135]], 24), G.mat('#fbf7f5', { physical: true, roughness: 0.25, clearcoat: 1 }), { parent: g });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + Math.random(), lean = 0.15 + Math.random() * 0.25, h = 0.15 + Math.random() * 0.1;
      const tip = new T.Vector3(Math.cos(a) * Math.sin(lean) * h, 0.13 + Math.cos(lean) * h, Math.sin(a) * Math.sin(lean) * h);
      G.m(new T.TubeGeometry(new T.CatmullRomCurve3([new T.Vector3(0, 0.12, 0), tip.clone().multiplyScalar(0.5).setY(0.13 + h * 0.55), tip]), 8, 0.0025, 5), G.mat('#4f8a5a'), { parent: g, cast: false });
      const bloom = G.group(g, tip.toArray());
      const col = colors[i % colors.length];
      for (let k = 0; k < 6; k++) G.m(G.sph(0.016, 10, 8), G.mat(col, { roughness: 0.7 }), { p: [Math.cos(k) * 0.012, Math.sin(k * 2) * 0.006, Math.sin(k) * 0.012], s: [1, 0.7, 1], parent: bloom, cast: false });
      G.m(G.sph(0.008, 8, 6), G.mat('#ffd36b'), { p: [0, 0.008, 0], parent: bloom, cast: false });
    }
    return g;
  }

  /* ---------------- festoon string lights ---------------- */
  const bulbMat = new T.MeshStandardMaterial({ color: '#fff3dc', emissive: '#ffcf8a', emissiveIntensity: 3 });
  D.bulbMat = bulbMat;
  function festoon(a, b, sag, n) {
    const pts = [];
    for (let i = 0; i <= 40; i++) { const t = i / 40; const p = new T.Vector3().lerpVectors(a, b, t); p.y -= Math.sin(t * Math.PI) * sag; pts.push(p); }
    const curve = new T.CatmullRomCurve3(pts);
    G.m(new T.TubeGeometry(curve, 80, 0.004, 5), G.mat('#3a2a30', { roughness: 0.6 }), { parent: scene, cast: false });
    const bulbs = new T.InstancedMesh(G.sph(0.028, 12, 10), bulbMat, n);
    const m4 = new T.Matrix4();
    for (let i = 0; i < n; i++) { const p = curve.getPoint((i + 0.5) / n); m4.makeTranslation(p.x, p.y - 0.04, p.z); bulbs.setMatrixAt(i, m4); }
    scene.add(bulbs);
  }

  /* ---------------- hanging pothos ---------------- */
  function pothos(x, z, drop = 1.1) {
    const g = G.group(scene, [x, L.ceil, z]);
    [-1, 0, 1].forEach((k) => G.m(G.cyl(0.002, 0.002, drop - 0.1, 4), G.mat('#d8b25a', { metalness: 0.6, roughness: 0.4 }), { p: [k * 0.06, -(drop - 0.1) / 2, (k % 2) * 0.05], r: [0, 0, k * 0.06], parent: g, cast: false }));
    G.m(G.lathe([[0, 0], [0.1, 0], [0.13, 0.12], [0.135, 0.13], [0, 0.13]], 28), G.mat('#fbf7f5', { physical: true, roughness: 0.3, clearcoat: 1 }), { p: [0, -drop - 0.06, 0], parent: g });
    const leaf = G.mat('#4f8a5a', { roughness: 0.6, side: T.DoubleSide }), leaf2 = G.mat('#6aa86a', { roughness: 0.6, side: T.DoubleSide });
    for (let v = 0; v < 7; v++) {
      const a = (v / 7) * Math.PI * 2, len = 0.4 + Math.random() * 0.7;
      const pts = [];
      for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(new T.Vector3(Math.cos(a) * (0.11 + t * 0.12), -drop + 0.05 - t * len, Math.sin(a) * (0.11 + t * 0.12))); }
      const c = new T.CatmullRomCurve3(pts);
      G.m(new T.TubeGeometry(c, 16, 0.003, 4), G.mat('#4f8a5a'), { parent: g, cast: false });
      for (let i = 1; i < 9; i++) { const p = c.getPoint(i / 9); G.m(G.sph(0.03, 10, 6), i % 2 ? leaf : leaf2, { p: [p.x, p.y, p.z], s: [1, 0.25, 0.7], r: [Math.random(), a, Math.random()], parent: g }); }
    }
    G.onFrame((dt, t) => (g.rotation.z = Math.sin(t * 0.5 + x) * 0.01));
  }

  /* ---------------- sunbeams + dust ---------------- */
  const beamMat = new T.ShaderMaterial({
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
    uniforms: { k: { value: 0.5 }, col: { value: new T.Color('#fff0d6') } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float k; uniform vec3 col; varying vec2 vUv;
      void main(){ float edge = smoothstep(0.0, 0.28, vUv.x) * smoothstep(1.0, 0.72, vUv.x);
        float along = smoothstep(0.0, 0.12, vUv.y) * (1.0 - vUv.y * 0.75);
        gl_FragColor = vec4(col * edge * along * k * 0.16, 1.0); }`,
  });
  D.beamMat = beamMat;
  const beams = [];
  function buildBeams() {
    L.windows.forEach((cx) => {
      const g = G.group(scene, [cx, 1.95, L.wallZ + 0.02]);
      for (let i = 0; i < 4; i++) {
        const p = G.m(new T.PlaneGeometry(1.25, 6.5), beamMat, { parent: g, cast: false, recv: false });
        p.position.set(0, 0, 0);
        p.geometry.translate(0, -3.25, 0);
        p.rotation.y = (i / 4) * Math.PI;
        p.renderOrder = 5;
      }
      beams.push(g);
    });
  }
  const DUST = 260;
  const dustGeo = new T.BufferGeometry();
  const dp = new Float32Array(DUST * 3), dv = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) { dp.set([(Math.random() - 0.5) * 14, Math.random() * 3.6, -5.8 + Math.random() * 5.5], i * 3); dv.set([(Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.03, (Math.random() - 0.5) * 0.04], i * 3); }
  dustGeo.setAttribute('position', new T.BufferAttribute(dp, 3));
  const dustTex = (() => { const c = G.canvas(32, 32), x = c.getContext('2d'); const g = x.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, 'rgba(255,248,230,1)'); g.addColorStop(1, 'rgba(255,248,230,0)'); x.fillStyle = g; x.fillRect(0, 0, 32, 32); return G.tex(c, { wrap: false }); })();
  const dust = new T.Points(dustGeo, new T.PointsMaterial({ size: 0.022, map: dustTex, transparent: true, opacity: 0.6, depthWrite: false, blending: T.AdditiveBlending, color: '#fff2da' }));
  scene.add(dust);
  D.dust = dust;

  /** called by game.js with the current sun state */
  D.setSun = ({ dir, k, golden }) => {
    // aim each beam group along the sun's travel direction
    const target = new T.Vector3();
    beams.forEach((g) => {
      target.copy(g.position).add(dir);
      g.lookAt(target);
      g.rotateX(-Math.PI / 2);
    });
    beamMat.uniforms.k.value = k;
    beamMat.uniforms.col.value.set('#fff3dc').lerp(new T.Color('#ffc58a'), golden);
    dust.material.opacity = 0.15 + k * 0.6;
  };

  let brewing = 0;
  D.setBrewing = (n) => (brewing = n);
  G.onFrame((dt, time) => {
    const a = dustGeo.attributes.position.array;
    for (let i = 0; i < DUST; i++) {
      const o = i * 3;
      a[o] += (dv[o] + Math.sin(time * 0.3 + i) * 0.01) * dt;
      a[o + 1] += (dv[o + 1] + Math.cos(time * 0.2 + i * 0.7) * 0.008) * dt;
      a[o + 2] += dv[o + 2] * dt;
      if (a[o + 1] < 0 || a[o + 1] > 3.8) dv[o + 1] *= -1;
      if (Math.abs(a[o]) > 7.5) dv[o] *= -1;
      if (a[o + 2] < -5.9 || a[o + 2] > 0) dv[o + 2] *= -1;
    }
    dustGeo.attributes.position.needsUpdate = true;
    // espresso steam while the kitchen is busy
    steamSprites.forEach((s) => {
      const k = (time * 0.55 + s.userData.ph) % 1;
      s.position.set(s.userData.x + Math.sin(k * 5 + s.userData.ph * 10) * 0.025, 0.15 + k * 0.5, 0.2 + (s.userData.x > 0.3 ? 0.04 : 0));
      s.scale.setScalar(0.05 + k * 0.16);
      s.material.opacity = Math.sin(k * Math.PI) * 0.4 * Math.min(1, brewing / 2);
    });
  });

  D.init = () => {
    espresso(-0.32, 2.98);
    grinder(0.48, 2.92);
    cakeStand(-1.28, 2.8);
    tipJar(1.18, 2.98);
    flowers(scene, 2.32, top, 2.55, 1.1);
    // festoon lights across the room
    [[-6.5, 1.6], [-2.4, 1.0], [2.0, 1.0], [6.2, 1.6]].forEach(([x, dx]) => festoon(new T.Vector3(x, 4.15, -5.85), new T.Vector3(x + dx, 4.15, 2.0), 0.55, 22));
    festoon(new T.Vector3(-7.6, 4.0, -2.4), new T.Vector3(7.6, 4.0, -2.4), 0.5, 40);
    pothos(-5.0, -5.3, 1.25);
    pothos(-2.9, -5.3, 1.0);
    pothos(4.15, -5.3, 1.15);
    buildBeams();
    // a bud vase on every table
    B.room.tables.forEach((t, i) => flowers(t.obj, 0, B.room.TOP_Y, 0, 0.75, i % 2 ? ['#f07ea0', '#ffffff'] : ['#ffd36b', '#ffd3df']));
    D._tipLabel();
  };
})();
