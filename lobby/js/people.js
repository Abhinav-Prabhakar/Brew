/* brew · people.js — articulated 3D people.
   Layered like a paper doll (body, skin tone, hair, outfit, accessory) but
   built in 3D: hips/knees/shoulders/elbows are real joints so people walk,
   sit, sip and slump. Every person carries a billboarded patience ring. */
(function () {
  const B = window.B, T = THREE, G = B.gfx, A = B.art;
  const P = (B.people = {});
  const all = new Set();

  const SKINS = ['#f7dcc8', '#efc3a1', '#e2a983', '#c98d63', '#ad7049', '#8c5536', '#6c3d24', '#4f2c1a'];
  const HAIRC = ['#1b1412', '#2a1b15', '#3a251a', '#563420', '#6e4527', '#8a5a33', '#a3483a', '#9a9590', '#d98aa6'];
  const skinMat = (c) => G.mat(c, { physical: true, roughness: 0.62, sheen: 0.4, sheenColor: new T.Color('#ffd9cc'), sheenRoughness: 0.6 });
  const cloth = (c, o = {}) => G.mat(c, Object.assign({ roughness: 0.84, normal: 'fabric', ns: 0.12 }, o));
  const hairMat = (c) => G.mat(c, { physical: true, roughness: 0.5, sheen: 1, sheenColor: new T.Color(B.art.mix(c, '#ffffff', 0.35)), sheenRoughness: 0.35 });

  /* ---------------- traits (what someone looks like) ---------------- */
  const PAL = {
    commuter: { tops: ['#2f3e5c', '#4a4f5a', '#8a6a4a', '#5f6f86', '#3d3a4a'], inner: ['#ffffff', '#dbe7f3', '#f7e1e6', '#f3efe6'], bottoms: ['#2b3140', '#3e4350', '#4a4f5a', '#b9a888'], shoes: ['#3b2a22', '#1f1a1a', '#5a3a2a'] },
    student: { tops: ['#a7c4a0', '#c9b6e4', '#f2c14e', '#f08fa6', '#7fb7d8', '#e9e4da', '#f4a582', '#2f2f38'], bottoms: ['#5878a5', '#3e5675', '#2b2b33', '#6f86a8'], shoes: ['#f4f1ec', '#ffffff', '#e9e4da', '#2b2b33'] },
    leisurely: { tops: ['#f6d1c1', '#fff3e6', '#e7a1b0', '#b5d3c7', '#f3e3a3', '#d9c8ef', '#f9c9d6'], bottoms: ['#efe6dc', '#c7b39a', '#fffaf2', '#e7d9c9'], shoes: ['#c79a6b', '#e9a7b8', '#8a5a33'] },
    camper: { tops: ['#6d5a7a', '#3f5a52', '#8c6f5b', '#2f2f38', '#5b6b86', '#9a7f6a'], inner: ['#efe6dc', '#ffffff', '#f2c14e'], bottoms: ['#2b2b33', '#5878a5', '#4a4f5a'], shoes: ['#f4f1ec', '#2b2b33', '#8a5a33'] },
  };
  P.randomTraits = function (persona) {
    const pal = PAL[persona] || PAL.leisurely;
    const fem = Math.random() < 0.52;
    const elder = persona === 'leisurely' && Math.random() < 0.22;
    const skin = SKINS[B.wpick([[0, 1], [1, 3], [2, 4], [3, 5], [4, 5], [5, 4], [6, 3], [7, 1]])];
    let hair = fem ? B.pick(['long', 'bob', 'bun', 'pony', 'wavy', 'braid', 'curly', 'long']) : B.pick(['crop', 'sidepart', 'buzz', 'curly', 'sidepart', 'crop']);
    let hairColor = HAIRC[B.wpick([[0, 4], [1, 4], [2, 3], [3, 2], [4, 1], [6, 0.5]])];
    if (persona === 'student' && Math.random() < 0.12) hairColor = HAIRC[8];
    if (elder) { hairColor = HAIRC[7]; if (!fem && Math.random() < 0.5) hair = 'bald'; }
    const t = { skin, hair, hairColor, fem, height: B.rand(0.94, 1.04) * (fem ? 0.96 : 1), build: B.pick([0.94, 1, 1, 1.07]), beard: !fem && Math.random() < 0.5 ? B.pick(['full', 'stubble', 'stubble', 'mustache']) : null, lip: fem && Math.random() < 0.5 ? B.pick(['#b8505e', '#a84858', '#c46470']) : null, acc: {}, o: {} };
    const o = t.o, a = t.acc;
    o.top = B.pick(pal.tops); o.bottom = B.pick(pal.bottoms); o.shoe = B.pick(pal.shoes); o.kind = 'tee';
    switch (persona) {
      case 'commuter':
        o.kind = fem && Math.random() < 0.25 ? 'dress' : Math.random() < 0.65 ? 'blazer' : 'shirt';
        o.inner = B.pick(pal.inner);
        if (o.kind === 'blazer' && !fem && Math.random() < 0.45) o.tie = B.pick(['#8a2a3a', '#23314f', '#c43e64', '#3f5a52']);
        if (o.kind === 'shirt') o.top = B.pick(['#dbe7f3', '#ffffff', '#f7e1e6', '#cfd8e8']);
        if (o.kind === 'dress') { o.top = B.pick(['#2f3e5c', '#5a2a3a', '#4a4f5a']); o.bottom = skin; }
        if (Math.random() < 0.5) a.messenger = B.pick(['#7a4a2a', '#3b2a22', '#5a3a2a']); else if (Math.random() < 0.6) a.lanyard = B.pick(['#3b4f8f', '#c43e64', '#2f5a4c']);
        if (Math.random() < 0.35) a.glasses = B.pick(['#2b2230', '#8a5a33', '#a8a8b0']);
        if (Math.random() < 0.6) a.watch = B.pick(['#d8b56a', '#2b2230', '#c0c4cc']);
        break;
      case 'student':
        o.kind = B.pick(['hoodie', 'tee', 'tee', 'sweater', 'hoodie']);
        if (o.kind === 'tee') o.short = true;
        if (Math.random() < 0.55) a.backpack = B.pick(['#e46d8d', '#3b4f8f', '#2f5a4c', '#f2b84b', '#2b2b33', '#c9b6e4']); else if (Math.random() < 0.6) a.tote = B.pick(['#f3e9d6', '#e9e4da', '#fff3e6']);
        if (Math.random() < 0.3) a.glasses = '#2b2230';
        if (Math.random() < 0.15) a.cap = B.pick(['#2b2b33', '#e46d8d', '#3b4f8f']); else if (Math.random() < 0.25) a.headphonesNeck = true;
        if (fem && Math.random() < 0.5) a.earrings = B.pick(['#f2d27a', '#e46d8d', '#c0c4cc']);
        break;
      case 'leisurely':
        o.kind = fem ? B.pick(['kurta', 'kurta', 'dress', 'cardigan']) : B.pick(['shirt', 'kurta', 'cardigan', 'shirt']);
        if (o.kind === 'kurta') { o.bottom = B.pick(['#ffffff', '#fffaf2', '#efe6dc', '#f2c9d4']); if (fem && Math.random() < 0.55) a.dupatta = B.pick(['#e46d8d', '#f3e3a3', '#b5d3c7', '#ffffff', '#d9c8ef']); if (fem && Math.random() < 0.5) a.bindi = true; }
        if (o.kind === 'dress') { o.short = true; o.bottom = skin; if (Math.random() < 0.3) a.sunhat = B.pick(['#f3e3c3', '#fff3e6']); }
        if (o.kind === 'cardigan') { o.inner = B.pick(['#ffffff', '#fff3e6', '#f7e1e6']); o.top = B.pick(['#e7a1b0', '#b5d3c7', '#f3e3a3', '#d9c8ef', '#c9a58a']); }
        if (o.kind === 'shirt') { o.top = B.pick(['#fff3e6', '#dbe7f3', '#f6d1c1', '#e3efe2']); o.short = Math.random() < 0.5; }
        if (elder || Math.random() < 0.25) a.glasses = B.pick(['#8a5a33', '#c9a061', '#2b2230']);
        if (fem) a.earrings = '#f2d27a';
        if (Math.random() < 0.35) a.tote = B.pick(['#f3e9d6', '#fff3e6']);
        break;
      case 'camper':
        o.kind = B.pick(['hoodie', 'cardigan', 'sweater', 'hoodie']);
        o.inner = B.pick(pal.inner);
        if (Math.random() < 0.7) a.backpack = B.pick(['#2b2b33', '#4a4f5a', '#3b4f8f', '#5a4038']);
        if (Math.random() < 0.5) a.glasses = B.pick(['#2b2230', '#8a5a33']);
        if (Math.random() < 0.4) a.beanie = B.pick(['#e46d8d', '#f2c14e', '#2b2b33', '#9a7f6a', '#3f5a52']);
        if (Math.random() < 0.35) a.headphones = true; else if (Math.random() < 0.4) a.headphonesNeck = true;
        break;
    }
    if ((a.beanie || a.sunhat || a.cap || a.headphones) && hair === 'bun') t.hair = 'crop';
    return t;
  };

  /* ---------------- the patience ring (billboard shader) ---------------- */
  const ringGeo = new T.PlaneGeometry(0.62, 0.62);
  function ringMaterial() {
    return new T.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { fill: { value: 1 }, col: { value: new T.Color('#ec7d98') }, op: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float fill; uniform vec3 col; uniform float op; varying vec2 vUv;
        void main(){
          vec2 p = vUv*2.0-1.0; float r = length(p);
          float a = atan(p.x, p.y); float t = (a < 0.0 ? a + 6.2831853 : a) / 6.2831853;
          float band = smoothstep(0.78, 0.81, r) * (1.0 - smoothstep(0.88, 0.91, r));
          float on = step(t, fill) * band;
          float glow = exp(-pow((r - 0.845) * 9.0, 2.0)) * step(t, fill) * 0.55;
          vec3 c = mix(vec3(1.0), col * 1.25, on) + col * glow;
          float alpha = max(band * 0.42, max(on, glow)) * op;
          gl_FragColor = vec4(c, alpha);
        }`,
    });
  }

  /* ---------------- builders ---------------- */
  const TORSO = (() => {
    const g = G.lathe([[0.0, 0.06], [0.148, 0.065], [0.158, 0.12], [0.145, 0.24], [0.158, 0.36], [0.185, 0.47], [0.172, 0.53], [0.11, 0.575], [0.05, 0.6], [0, 0.6]], 36);
    g.scale(1, 1, 0.62);
    return g;
  })();
  const HIPS = (() => { const g = G.lathe([[0, -0.06], [0.14, -0.06], [0.155, 0.02], [0.152, 0.13], [0, 0.13]], 32); g.scale(1, 1, 0.68); return g; })();
  const SKIRT = (() => { const g = new T.CylinderGeometry(0.15, 0.24, 0.5, 32, 1, true); g.translate(0, -0.2, 0); g.scale(1, 1, 0.75); return g; })();
  const TUNIC = (() => { const g = new T.CylinderGeometry(0.158, 0.21, 0.42, 32, 1, true); g.translate(0, -0.16, 0); g.scale(1, 1, 0.72); return g; })();
  const CAP = (r, tl = 1.55) => new T.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, tl);

  function limb(parent, r, len, mat) {
    return G.m(G.cap(r, len), mat, { p: [0, -len / 2 - r * 0.4, 0], parent });
  }

  P.build = function (t) {
    const p = { traits: t, root: new T.Group(), phase: Math.random() * 6, blinkT: B.rand(1, 4), mood: 'neutral' };
    const root = p.root;
    const body = G.group(root);
    p.body = body;
    body.scale.setScalar(t.height);
    const sk = skinMat(t.skin), o = t.o, acc = t.acc;
    const top = cloth(o.top), bottom = cloth(o.bottom, { roughness: 0.88 }), shoe = G.mat(o.shoe, { physical: true, roughness: 0.45, clearcoat: 0.3 });
    const legsSkin = o.kind === 'dress';

    // pelvis
    const pelvis = G.group(body, [0, 0.86, 0]);
    p.pelvis = pelvis;
    G.m(HIPS, legsSkin ? top : bottom, { parent: pelvis, s: [t.build, 1, 1] });
    // legs
    p.legs = [-1, 1].map((sd) => {
      const hip = G.group(pelvis, [sd * 0.08 * t.build, -0.02, 0]);
      limb(hip, 0.066, 0.3, legsSkin ? sk : bottom);
      const knee = G.group(hip, [0, -0.41, 0]);
      G.m(G.sph(0.058, 14, 10), legsSkin ? sk : bottom, { parent: knee });
      limb(knee, 0.054, 0.3, legsSkin || (o.kind === 'dress') ? sk : bottom);
      G.m(G.rbox(0.105, 0.075, 0.25, 0.035), shoe, { p: [0, -0.43, 0.045], parent: knee });
      G.m(G.rbox(0.108, 0.02, 0.254, 0.008), G.mat(o.shoe === '#f4f1ec' || o.shoe === '#ffffff' ? '#e9a7b8' : '#2a2224', { roughness: 0.6 }), { p: [0, -0.465, 0.045], parent: knee });
      return { hip, knee };
    });
    // torso
    const chest = G.group(pelvis, [0, 0, 0]);
    p.chest = chest;
    const torso = G.m(TORSO, top, { parent: chest, s: [t.build, 1, 1] });
    if (o.kind === 'kurta') G.m(TUNIC, cloth(o.top, { side: T.DoubleSide }), { parent: chest, s: [t.build, 1, 1] });
    if (o.kind === 'dress') G.m(SKIRT, cloth(o.top, { side: T.DoubleSide }), { p: [0, 0.14, 0], parent: chest, s: [t.build, 1, 1] });
    const fz = 0.104; // chest front surface
    const det = (geo, mat, pp, rr, ss) => G.m(geo, mat, { p: pp, r: rr, s: ss, parent: chest, cast: false });
    switch (o.kind) {
      case 'blazer': {
        const inner = cloth(o.inner);
        const v = new T.Shape(); v.moveTo(-0.055, 0.56); v.lineTo(0.055, 0.56); v.lineTo(0, 0.33); v.closePath();
        det(new T.ShapeGeometry(v), inner, [0, 0, fz + 0.004]);
        if (o.tie) det(G.rbox(0.03, 0.2, 0.01, 0.006), cloth(o.tie), [0, 0.43, fz + 0.012], [0, 0, 0]);
        const lap = cloth(B.art.shade(o.top, -0.2));
        det(G.rbox(0.04, 0.2, 0.012, 0.006), lap, [-0.05, 0.45, fz + 0.01], [0, 0, -0.35]);
        det(G.rbox(0.04, 0.2, 0.012, 0.006), lap, [0.05, 0.45, fz + 0.01], [0, 0, 0.35]);
        [0.28, 0.2].forEach((y) => det(G.sph(0.009, 10, 8), G.mat('#2a2224', { roughness: 0.3 }), [0.012, y, fz + 0.002]));
        break;
      }
      case 'hoodie':
        det(G.tor(0.095, 0.04, 10, 24), cloth(B.art.shade(o.top, -0.12)), [0, 0.56, -0.03], [Math.PI / 2 - 0.25, 0, 0], [1, 0.8, 1]);
        [-0.03, 0.03].forEach((x) => det(G.cyl(0.004, 0.004, 0.13, 6), G.mat('#ffffff'), [x, 0.46, fz + 0.006]));
        det(G.rbox(0.2, 0.09, 0.012, 0.01), cloth(B.art.shade(o.top, -0.08)), [0, 0.15, fz + 0.002]);
        break;
      case 'shirt':
        [-1, 1].forEach((sd) => det(G.rbox(0.06, 0.035, 0.01, 0.005), cloth(B.art.shade(o.top, 0.2)), [sd * 0.035, 0.565, fz - 0.01], [0.4, 0, sd * 0.5]));
        [0.48, 0.38, 0.28, 0.18].forEach((y) => det(G.sph(0.006, 8, 6), G.mat('#ffffff'), [0, y, fz + 0.002]));
        break;
      case 'tee':
        det(G.tor(0.052, 0.008, 8, 24), cloth(B.art.shade(o.top, -0.15)), [0, 0.585, 0.0], [Math.PI / 2, 0, 0], [1, 0.75, 1]);
        if (Math.random() < 0.5) det(new T.CircleGeometry(0.04, 20), G.mat(B.pick(['#e46d8d', '#ffd36b', '#ffffff', '#3b4f8f']), { roughness: 0.9 }), [0, 0.4, fz + 0.012]);
        break;
      case 'cardigan': {
        const inner = cloth(o.inner);
        det(G.rbox(0.09, 0.42, 0.02, 0.01), inner, [0, 0.33, fz - 0.004]);
        [0.45, 0.35, 0.25, 0.15].forEach((y) => det(G.sph(0.008, 8, 6), G.mat('#fffaf0'), [0.05, y, fz + 0.006]));
        break;
      }
      case 'kurta':
        det(G.rbox(0.012, 0.16, 0.008, 0.004), G.mat('#d8b25a', { metalness: 0.6, roughness: 0.4 }), [0, 0.5, fz + 0.004]);
        break;
      case 'sweater':
        det(G.tor(0.15, 0.014, 8, 32), cloth(B.art.shade(o.top, -0.1)), [0, 0.08, 0], [Math.PI / 2, 0, 0], [t.build, 0.66, 1]);
        det(G.tor(0.055, 0.012, 8, 24), cloth(B.art.shade(o.top, -0.1)), [0, 0.585, 0.0], [Math.PI / 2, 0, 0], [1, 0.75, 1]);
        break;
    }
    // arms
    const sleeve = top, fore = o.short ? sk : top;
    p.arms = [-1, 1].map((sd) => {
      const sh = G.group(chest, [sd * 0.195 * t.build, 0.5, 0]);
      sh.rotation.z = sd * 0.09;
      const up = o.short ? sk : sleeve;
      limb(sh, 0.05, 0.2, up);
      if (o.short) G.m(G.cap(0.056, 0.06), sleeve, { p: [0, -0.06, 0], parent: sh });
      G.m(G.sph(0.062, 18, 14), up === sk ? sleeve : sleeve, { p: [0, -0.01, 0], s: [1, 0.9, 0.95], parent: sh });
      const elbow = G.group(sh, [0, -0.29, 0]);
      G.m(G.sph(0.047, 14, 10), fore, { parent: elbow });
      limb(elbow, 0.043, 0.18, fore);
      G.m(G.sph(0.047, 16, 12), sk, { p: [0, -0.27, 0.005], s: [0.82, 1.15, 0.62], parent: elbow });
      if (acc.watch && sd === -1) G.m(G.tor(0.044, 0.008, 8, 20), G.mat(acc.watch, { metalness: 0.7, roughness: 0.3 }), { p: [0, -0.21, 0], r: [Math.PI / 2, 0, 0], parent: elbow });
      const held = G.group(elbow, [0, -0.3, 0.03]);
      return { sh, elbow, held };
    });
    p.held = p.arms[1].held;

    // neck + head
    G.m(G.cyl(0.05, 0.055, 0.1, 16), sk, { p: [0, 0.6, 0.004], parent: chest });
    const head = G.group(chest, [0, 0.6, 0.012]);
    head.scale.setScalar(1.16);
    p.head = head;
    const skull = G.m(G.sph(0.108, 40, 28), sk, { p: [0, 0.11, 0], s: [0.9, 1.06, 0.98], parent: head });
    [-1, 1].forEach((sd) => G.m(G.sph(0.026, 12, 10), sk, { p: [sd * 0.097, 0.1, -0.005], s: [0.5, 1, 0.8], parent: head }));
    G.m(G.sph(0.017, 12, 10), skinMat(B.art.shade(t.skin, -0.05)), { p: [0, 0.095, 0.104], s: [0.75, 1, 1.05], parent: head });
    // eyes
    const eyeMat = G.mat('#1e1512', { physical: true, roughness: 0.15, clearcoat: 1 });
    p.eyes = [-1, 1].map((sd) => {
      const e = G.group(head, [sd * 0.036, 0.125, 0.093]);
      G.m(G.sph(0.0155, 14, 10), G.mat('#fbf7f2', { roughness: 0.3 }), { s: [1.1, 0.85, 0.5], parent: e, cast: false });
      G.m(G.sph(0.0105, 14, 10), eyeMat, { p: [0, 0, 0.006], s: [1, 1, 0.6], parent: e, cast: false });
      G.m(G.sph(0.003, 6, 4), new T.MeshBasicMaterial({ color: '#ffffff' }), { p: [0.004, 0.004, 0.012], parent: e, cast: false });
      return e;
    });
    const browMat = G.mat(B.art.shade(t.hairColor, -0.2), { roughness: 0.8 });
    p.brows = [-1, 1].map((sd) => G.m(G.rbox(0.032, 0.0075, 0.008, 0.003), browMat, { p: [sd * 0.037, 0.153, 0.097], r: [0, 0, sd * -0.08], parent: head, cast: false }));
    // mouths
    const lip = G.mat(t.lip || B.art.shade(t.skin, -0.32), { roughness: 0.5 });
    p.mouths = {
      happy: G.m(G.tor(0.02, 0.0045, 8, 16, Math.PI), lip, { p: [0, 0.064, 0.1], r: [0, 0, Math.PI], parent: head, cast: false }),
      neutral: G.m(G.rbox(0.03, 0.006, 0.006, 0.003), lip, { p: [0, 0.058, 0.103], parent: head, cast: false }),
      sad: G.m(G.tor(0.016, 0.0045, 8, 16, Math.PI), lip, { p: [0, 0.046, 0.101], parent: head, cast: false }),
      eat: G.m(G.sph(0.012, 10, 8), G.mat('#5a2a2a'), { p: [0, 0.058, 0.1], s: [1, 0.8, 0.4], parent: head, cast: false }),
    };
    [-1, 1].forEach((sd) => G.m(G.sph(0.018, 10, 8), G.mat('#ff7c94', { roughness: 0.9, transparent: true, opacity: t.fem ? 0.32 : 0.16 }), { p: [sd * 0.055, 0.08, 0.087], s: [1, 0.6, 0.3], parent: head, cast: false }));

    // hair
    const hm = hairMat(t.hairColor);
    const hg = G.group(head, [0, 0.11, 0]);
    const cap = (r = 0.117, tl = 1.5, tilt = -0.42) => G.m(CAP(r, tl), hm, { r: [tilt, 0, 0], p: [0, 0.006, -0.008], s: [0.93, 1.04, 1.02], parent: hg });
    switch (t.hair) {
      case 'crop': cap(); G.m(G.sph(0.06, 16, 12), hm, { p: [0.02, 0.085, 0.06], s: [1.5, 0.5, 0.9], parent: hg }); break;
      case 'sidepart': cap(); G.m(G.sph(0.07, 16, 12), hm, { p: [0.035, 0.08, 0.055], s: [1.3, 0.55, 0.9], r: [0, 0, -0.3], parent: hg }); break;
      case 'buzz': G.m(CAP(0.112, 1.45), G.mat(B.art.mix(t.hairColor, t.skin, 0.35), { roughness: 0.9 }), { r: [-0.45, 0, 0], s: [0.93, 1.04, 1.02], parent: hg }); break;
      case 'bald': G.m(G.tor(0.1, 0.022, 8, 24, Math.PI * 1.2), hm, { p: [0, -0.01, -0.01], r: [Math.PI / 2, 0, Math.PI * -0.1 + Math.PI], parent: hg }); break;
      case 'long': cap(0.119, 1.62); G.m(G.rbox(0.23, 0.36, 0.08, 0.04), hm, { p: [0, -0.15, -0.065], parent: hg }); [-1, 1].forEach((sd) => G.m(G.cap(0.03, 0.22), hm, { p: [sd * 0.085, -0.1, 0.03], r: [0, 0, sd * 0.06], parent: hg })); break;
      case 'wavy': cap(0.119, 1.62); [-1, 0, 1].forEach((k) => G.m(G.sph(0.06, 14, 10), hm, { p: [k * 0.07, -0.09, -0.05], s: [1, 1.5, 0.9], parent: hg })); [-1, 1].forEach((sd) => G.m(G.sph(0.045, 12, 10), hm, { p: [sd * 0.09, -0.05, 0.02], s: [0.8, 1.6, 0.9], parent: hg })); break;
      case 'bob': cap(0.119, 1.62); G.m(new T.CylinderGeometry(0.118, 0.124, 0.16, 32, 1, true, Math.PI * 0.32, Math.PI * 1.36), hm, { p: [0, -0.04, -0.005], s: [0.93, 1, 1.02], parent: hg }); G.m(G.rbox(0.16, 0.035, 0.03, 0.012), hm, { p: [0, 0.06, 0.098], r: [-0.2, 0, 0], parent: hg }); break;
      case 'bun': cap(0.117, 1.62); G.m(G.sph(0.058, 18, 14), hm, { p: [0, 0.1, -0.075], parent: hg }); break;
      case 'pony': cap(0.117, 1.62); G.m(G.cap(0.036, 0.2), hm, { p: [0, -0.06, -0.135], r: [0.25, 0, 0], parent: hg }); break;
      case 'braid': cap(0.117, 1.62); for (let i = 0; i < 6; i++) G.m(G.sph(0.034 - i * 0.002, 12, 8), hm, { p: [0.06, -0.05 - i * 0.055, -0.05 + i * 0.012], parent: hg }); break;
      case 'curly': {
        cap(0.12, 1.65);
        const curls = new T.InstancedMesh(G.sph(0.034, 10, 8), hm, 40);
        const m4 = new T.Matrix4(), v = new T.Vector3();
        for (let i = 0; i < 40; i++) {
          const th = Math.acos(1 - Math.random() * 1.1), ph = Math.random() * Math.PI * 2;
          v.set(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph) - 0.15).normalize().multiplyScalar(0.118);
          if (v.z > 0.07 && v.y < 0.06) v.y += 0.04;
          m4.makeTranslation(v.x * 0.95, v.y + 0.01, v.z);
          curls.setMatrixAt(i, m4);
        }
        curls.castShadow = true;
        hg.add(curls);
        break;
      }
    }
    if (t.beard === 'full') G.m(new T.SphereGeometry(0.112, 32, 16, 0, Math.PI * 2, Math.PI * 0.56, Math.PI * 0.4), hm, { p: [0, 0.115, 0.004], s: [0.92, 1.06, 1.0], parent: head });
    if (t.beard === 'stubble') G.m(new T.SphereGeometry(0.11, 32, 16, 0, Math.PI * 2, Math.PI * 0.56, Math.PI * 0.4), G.mat(t.hairColor, { transparent: true, opacity: 0.35, roughness: 1 }), { p: [0, 0.112, 0.002], s: [0.91, 1.06, 1.0], parent: head, cast: false });
    if (t.beard === 'full' || t.beard === 'mustache') G.m(G.rbox(0.05, 0.012, 0.012, 0.005), hm, { p: [0, 0.074, 0.102], parent: head });

    // accessories
    if (acc.glasses) {
      const gm = G.mat(acc.glasses, { metalness: 0.4, roughness: 0.35 });
      [-1, 1].forEach((sd) => G.m(G.tor(0.022, 0.0035, 8, 24), gm, { p: [sd * 0.036, 0.125, 0.108], parent: head, cast: false }));
      G.m(G.rbox(0.025, 0.004, 0.004, 0.002), gm, { p: [0, 0.128, 0.11], parent: head, cast: false });
    }
    if (acc.bindi) G.m(G.sph(0.006, 8, 6), G.mat('#c8243a'), { p: [0, 0.165, 0.1], parent: head, cast: false });
    if (acc.earrings) [-1, 1].forEach((sd) => G.m(G.sph(0.008, 8, 6), G.mat(acc.earrings, { metalness: 0.8, roughness: 0.2 }), { p: [sd * 0.098, 0.065, 0.005], parent: head, cast: false }));
    if (acc.beanie) { const bm = cloth(acc.beanie); G.m(CAP(0.125, 1.35), bm, { p: [0, 0.12, -0.005], r: [-0.25, 0, 0], s: [0.95, 1.05, 1.02], parent: head }); G.m(G.tor(0.112, 0.022, 8, 32), cloth(B.art.shade(acc.beanie, -0.1)), { p: [0, 0.16, -0.02], r: [Math.PI / 2 - 0.25, 0, 0], s: [0.95, 1.02, 1], parent: head }); G.m(G.sph(0.03, 12, 10), cloth(B.art.shade(acc.beanie, 0.3)), { p: [0, 0.255, -0.04], parent: head }); }
    if (acc.sunhat) { const sm = G.mat(acc.sunhat, { roughness: 0.9 }); G.m(G.cyl(0.25, 0.25, 0.012, 40), sm, { p: [0, 0.17, 0], r: [-0.1, 0, 0], parent: head }); G.m(CAP(0.12, 1.3), sm, { p: [0, 0.16, 0], parent: head }); G.m(G.tor(0.105, 0.012, 8, 32), G.mat('#e46d8d'), { p: [0, 0.19, 0], r: [Math.PI / 2, 0, 0], parent: head }); }
    if (acc.cap) { const cm = cloth(acc.cap); G.m(CAP(0.12, 1.35), cm, { p: [0, 0.135, 0], r: [-0.15, 0, 0], parent: head }); G.m(G.rbox(0.15, 0.012, 0.11, 0.005), cm, { p: [0, 0.165, 0.12], r: [0.15, 0, 0], parent: head }); }
    if (acc.headphones) { const hp = G.mat('#2f2b33', { roughness: 0.4 }); G.m(G.tor(0.125, 0.01, 8, 32, Math.PI), hp, { p: [0, 0.115, 0], parent: head }); [-1, 1].forEach((sd) => G.m(G.cyl(0.035, 0.035, 0.03, 16), G.mat('#f2f2f5', { roughness: 0.3 }), { p: [sd * 0.115, 0.1, 0], r: [0, 0, Math.PI / 2], parent: head })); }
    if (acc.headphonesNeck) { G.m(G.tor(0.09, 0.012, 8, 28), G.mat('#2f2b33', { roughness: 0.4 }), { p: [0, 0.6, 0.02], r: [Math.PI / 2 + 0.3, 0, 0], parent: chest }); [-1, 1].forEach((sd) => G.m(G.cyl(0.032, 0.032, 0.03, 14), G.mat('#3d3d48'), { p: [sd * 0.085, 0.58, 0.06], r: [0.3, 0, Math.PI / 2], parent: chest })); }
    if (acc.backpack) { const bp = cloth(acc.backpack, { roughness: 0.7 }); G.m(G.rbox(0.3, 0.38, 0.15, 0.05), bp, { p: [0, 0.32, -0.17], parent: chest }); G.m(G.rbox(0.2, 0.12, 0.05, 0.02), cloth(B.art.shade(acc.backpack, -0.15)), { p: [0, 0.22, -0.25], parent: chest }); [-1, 1].forEach((sd) => G.m(G.rbox(0.04, 0.34, 0.015, 0.006), cloth(B.art.shade(acc.backpack, -0.2)), { p: [sd * 0.08, 0.37, fz + 0.003], parent: chest, cast: false })); }
    if (acc.messenger) { const mm = G.mat(acc.messenger, { roughness: 0.55 }); G.m(G.rbox(0.035, 0.5, 0.012, 0.006), mm, { p: [0.0, 0.27, fz + 0.01], r: [0, 0, 0.6], parent: chest, cast: false }); G.m(G.rbox(0.28, 0.2, 0.08, 0.03), mm, { p: [0.17, 0.05, 0.06], r: [0, -0.6, 0], parent: chest }); }
    if (acc.tote) { const tm = cloth(acc.tote); G.m(G.rbox(0.24, 0.28, 0.04, 0.01), tm, { p: [-0.25, -0.06, 0.02], r: [0, 0.2, 0.05], parent: chest }); G.m(G.tor(0.08, 0.008, 6, 16, Math.PI), tm, { p: [-0.25, 0.08, 0.02], parent: chest, cast: false }); G.m(new T.CircleGeometry(0.035, 16), G.mat('#e46d8d'), { p: [-0.25, -0.06, 0.042], parent: chest, cast: false }); }
    if (acc.lanyard) { G.m(G.tor(0.07, 0.004, 6, 20, Math.PI), G.mat(acc.lanyard), { p: [0, 0.52, fz - 0.02], r: [0.3, 0, Math.PI], parent: chest, cast: false }); G.m(G.rbox(0.06, 0.085, 0.006, 0.004), G.mat('#ffffff'), { p: [0, 0.4, fz + 0.01], parent: chest, cast: false }); }
    if (acc.dupatta) { const dm = cloth(acc.dupatta, { side: T.DoubleSide }); G.m(G.tor(0.11, 0.032, 8, 28), dm, { p: [0, 0.57, 0.0], r: [Math.PI / 2 + 0.2, 0, 0], parent: chest }); G.m(G.rbox(0.09, 0.5, 0.02, 0.01), dm, { p: [0.14, 0.32, 0.08], r: [0, 0, 0.12], parent: chest }); }

    // patience ring (billboard around the head)
    const ring = new T.Mesh(ringGeo, ringMaterial());
    ring.position.set(0, 0.11, 0);
    ring.renderOrder = 10;
    head.add(ring);
    p.ring = ring;

    root.traverse((m) => { if (m.isMesh && m.castShadow !== false) { m.castShadow = true; m.receiveShadow = true; } });
    ring.castShadow = false;
    ring.userData.noMerge = true;
    Object.values(p.mouths).forEach((m) => (m.userData.noMerge = true));
    p.brows.forEach((m) => (m.userData.noMerge = true));
    G.mergeChildren(root);
    all.add(p);
    return p;
  };

  /* ---------------- poses & animation ---------------- */
  P.setMood = (p, m) => {
    p.mood = m;
    Object.entries(p.mouths).forEach(([k, mesh]) => (mesh.visible = k === m));
    const sad = m === 'sad';
    p.brows.forEach((b, i) => { b.rotation.z = (i ? -1 : 1) * (sad ? -0.35 : 0.08); b.position.y = sad ? 0.148 : 0.153; });
    p.head.rotation.x = sad ? 0.12 : 0;
  };
  P.ring = (p, on, fill, color) => {
    const u = p.ring.material.uniforms;
    if (on != null) gsap.to(u.op, { value: on ? 1 : 0, duration: 0.4, overwrite: 'auto' });
    if (fill != null) u.fill.value = fill;
    if (color) u.col.value.set(color);
  };
  P.walkCycle = (p, dPhase) => {
    p.phase += dPhase;
    const s = Math.sin(p.phase), c = Math.cos(p.phase);
    p.legs[0].hip.rotation.x = s * 0.42;
    p.legs[1].hip.rotation.x = -s * 0.42;
    p.legs[0].knee.rotation.x = Math.max(0, -s) * 0.7 + 0.05;
    p.legs[1].knee.rotation.x = Math.max(0, s) * 0.7 + 0.05;
    if (!p.carrying) {
      p.arms[0].sh.rotation.x = -s * 0.32;
      p.arms[0].elbow.rotation.x = -0.18;
    }
    if (!p.posed) {
      p.arms[1].sh.rotation.x = s * 0.32;
      p.arms[1].elbow.rotation.x = -0.18;
    }
    p.pelvis.position.y = 0.86 + Math.abs(c) * 0.022;
    p.pelvis.rotation.y = s * 0.06;
    p.chest.rotation.y = -s * 0.1;
  };
  P.stand = (p) => {
    p.legs.forEach((l) => { l.hip.rotation.x = 0; l.knee.rotation.x = 0.02; });
    if (!p.carrying) { p.arms[0].sh.rotation.x = 0; p.arms[0].elbow.rotation.x = -0.08; }
    if (!p.posed) { p.arms[1].sh.rotation.x = 0; p.arms[1].elbow.rotation.x = -0.08; }
    p.pelvis.position.y = 0.86;
    p.pelvis.rotation.y = 0;
    p.chest.rotation.y = 0;
  };
  P.sit = (p, on, seatH = 0.47) => {
    p.seated = on;
    if (on) {
      p.pelvis.position.y = seatH + 0.05;
      p.legs.forEach((l) => { l.hip.rotation.x = -1.5; l.knee.rotation.x = 1.45; });
      p.arms.forEach((a) => { a.sh.rotation.x = -0.55; a.elbow.rotation.x = -0.9; });
    } else P.stand(p);
  };
  /** carry something in both hands in front (tray / bag) */
  P.carry = (p, on) => {
    p.carrying = on;
    p.posed = on;
    p.arms.forEach((a) => { gsap.to(a.sh.rotation, { x: on ? -0.55 : 0, z: on ? 0 : a.sh.rotation.z, duration: 0.3 }); gsap.to(a.elbow.rotation, { x: on ? -0.85 : -0.08, duration: 0.3 }); });
  };
  /** right arm to mouth: a in 0..1 */
  P.sipPose = (p, a) => {
    const arm = p.arms[1];
    p.posed = a > 0.01;
    arm.sh.rotation.x = -0.55 + -0.75 * a;
    arm.sh.rotation.z = 0.09 + 0.55 * a;
    arm.elbow.rotation.x = -0.9 - 1.25 * a;
    arm.elbow.rotation.y = -0.6 * a;
    arm.held.rotation.x = 0.9 + 2.0 * a;
    p.head.rotation.x = -0.12 * a;
  };
  P.hold = (p, obj) => {
    p.held.clear();
    if (obj) p.held.add(obj);
  };
  P.umbrella = (p, color) => {
    const u = new T.Group();
    G.m(G.cyl(0.008, 0.008, 0.9, 6), G.mat('#3a3440'), { p: [0, 0.4, 0], parent: u });
    G.m(new T.ConeGeometry(0.55, 0.22, 10, 1, true), G.mat(color, { roughness: 0.6, side: T.DoubleSide }), { p: [0, 0.85, 0], parent: u });
    u.position.set(0.0, 0.0, 0.05);
    const arm = p.arms[1];
    arm.sh.rotation.x = -0.4; arm.elbow.rotation.x = -1.2;
    p.posed = true;
    arm.held.add(u);
    u.rotation.x = 1.5;
  };
  P.dispose = (p) => all.delete(p);

  /** a delivery rider: dark gear, helmet, branded-colour box (no logos) */
  P.rider = (box) => {
    const t = P.randomTraits('commuter');
    Object.assign(t.o, { kind: 'hoodie', top: '#2e2a33', bottom: '#2a2730', shoe: '#1d1a1f' });
    t.acc = {};
    t.hair = 'buzz';
    const p = P.build(t);
    const hm = G.mat(box, { physical: true, roughness: 0.25, clearcoat: 1 });
    G.m(CAP(0.14, 1.75), hm, { p: [0, 0.11, -0.005], s: [0.95, 1.05, 1.05], parent: p.head });
    G.m(G.rbox(0.17, 0.06, 0.03, 0.02), G.mat('#141016', { physical: true, roughness: 0.05, clearcoat: 1 }), { p: [0, 0.13, 0.11], parent: p.head });
    G.m(G.rbox(0.44, 0.44, 0.38, 0.05), G.mat(box, { roughness: 0.55 }), { p: [0, 0.34, -0.3], parent: p.chest });
    G.m(G.rbox(0.2, 0.08, 0.01, 0.01), G.mat('#ffffff', { roughness: 0.6 }), { p: [0, 0.4, -0.11], r: [0, Math.PI, 0], parent: p.chest, cast: false });
    G.m(new T.PlaneGeometry(0.3, 0.06), G.mat('#ffffff', { emissive: '#ffffff', emissiveIntensity: 0.4 }), { p: [0, 0.2, fzR], parent: p.chest, cast: false });
    return p;
  };
  const fzR = 0.106;

  /* per-frame: blink, breathe, billboard the rings */
  const q = new T.Quaternion(), qp = new T.Quaternion();
  G.onFrame((dt, time) => {
    const cq = G.camera.quaternion;
    all.forEach((p) => {
      if (!p.root.parent) return;
      // blink
      p.blinkT -= dt;
      const bl = p.blinkT < 0.12 && p.blinkT > 0 ? 0.1 : 1;
      if (p.blinkT < 0) p.blinkT = B.rand(2.5, 6);
      p.eyes.forEach((e) => (e.scale.y = bl));
      // breathe
      p.chest.scale.y = 1 + Math.sin(time * 1.6 + p.phase) * 0.006;
      // ring faces the camera
      if (p.ring.material.uniforms.op.value > 0.001) {
        p.ring.parent.getWorldQuaternion(qp);
        q.copy(qp).invert().multiply(cq);
        p.ring.quaternion.copy(q);
      }
    });
  });

  P.SKINS = SKINS;
})();
