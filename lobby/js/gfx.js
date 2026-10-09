/* brew · gfx.js — renderer, lighting, post-processing, materials, procedural
   textures, picking, HTML anchors and the camera rig. */
(function () {
  const B = window.B, T = THREE, X = window.TX;
  const G = (B.gfx = {});

  /* ------------------------------------------------------------------ */
  /* renderer                                                            */
  /* ------------------------------------------------------------------ */
  const stage = B.$('#stage');
  const renderer = new T.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
  G.maxDpr = Math.min(window.devicePixelRatio, 1.5);
  renderer.setPixelRatio(G.maxDpr);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.outputColorSpace = T.SRGBColorSpace;
  stage.appendChild(renderer.domElement);
  G.renderer = renderer;
  G.maxAniso = renderer.capabilities.getMaxAnisotropy();

  const scene = new T.Scene();
  scene.background = new T.Color('#f6d3dc');
  G.scene = scene;
  const pmrem = new T.PMREMGenerator(renderer);
  const envScene = new X.RoomEnvironment(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.035).texture;
  G.envIntensity = 0.55;
  G.pmrem = pmrem;

  const camera = new T.PerspectiveCamera(36, 16 / 9, 0.08, 220);
  G.camera = camera;

  /* camera rig: base pose + look-around + pointer parallax */
  const rig = {
    pos: new T.Vector3(0, 2.42, 7.15),
    target: new T.Vector3(0, 1.38, -3.6),
    yaw: 0, pitch: 0, // user look-around (radians)
    par: new T.Vector2(), parT: new T.Vector2(),
  };
  G.HOME = { pos: rig.pos.clone(), target: rig.target.clone() };
  G.rig = rig;

  /* ------------------------------------------------------------------ */
  /* post-processing: MSAA → N8AO ambient occlusion → bloom + ACES + vignette */
  /* ------------------------------------------------------------------ */
  const PP = X.PP;
  renderer.toneMapping = T.NoToneMapping;
  renderer.toneMappingExposure = 0.62;
  const composer = new PP.EffectComposer(renderer, { frameBufferType: T.HalfFloatType, multisampling: Math.min(4, renderer.capabilities.maxSamples || 4) });
  composer.addPass(new PP.RenderPass(scene, camera));
  let ao = null;
  try {
    ao = new X.N8AOPostPass(scene, camera, 1, 1);
    Object.assign(ao.configuration, { aoRadius: 0.6, distanceFalloff: 0.7, intensity: 2.4, color: new T.Color('#3a1424'), gammaCorrection: false, halfRes: true, depthAwareUpsampling: true });
    ao.setQualityMode('Low'); // with denoise this is visually indistinguishable from Medium, ~10–15 % cheaper
    composer.addPass(ao);
  } catch (e) { console.warn('N8AO unavailable', e); }
  G.ao = ao;
  const bloom = new PP.BloomEffect({ intensity: 0.55, luminanceThreshold: 0.82, luminanceSmoothing: 0.18, mipmapBlur: true, radius: 0.72, resolutionScale: 0.5 });
  const tone = new PP.ToneMappingEffect({ mode: PP.ToneMappingMode.ACES_FILMIC });
  const vignette = new PP.VignetteEffect({ offset: 0.32, darkness: 0.42 });
  const grade = new PP.BrightnessContrastEffect({ brightness: -0.015, contrast: 0.09 });
  const sat = new PP.HueSaturationEffect({ saturation: 0.12 });
  composer.addPass(new PP.EffectPass(camera, bloom, tone, grade, sat, vignette));
  G.bloom = bloom;
  G.tone = tone;
  G.vignette = vignette;
  G.composer = composer;
  G.exposure = 1;

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    camera.aspect = w / h;
    // keep the horizontal field of view stable on narrow screens
    const baseV = 36, baseAspect = 16 / 9;
    camera.fov = camera.aspect >= baseAspect ? baseV : (2 * Math.atan(Math.tan((baseV * Math.PI) / 360) * (baseAspect / camera.aspect)) * 180) / Math.PI;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  /* ------------------------------------------------------------------ */
  /* lights                                                              */
  /* ------------------------------------------------------------------ */
  const hemi = new T.HemisphereLight('#ffeef2', '#b97888', 0.24);
  scene.add(hemi);

  // interior key: big soft "skylight" from above the camera
  const key = new T.DirectionalLight('#fff1e4', 1.2);
  key.position.set(-3.5, 9, 7);
  key.target.position.set(0, 0, -1);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -10, right: 10, top: 9, bottom: -9, near: 1, far: 30 });
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 5;
  scene.add(key, key.target);

  // the sun outside, slanting in through the arched windows
  const sun = new T.DirectionalLight('#ffe0b8', 2.6);
  sun.position.set(-7, 6.5, -18);
  sun.target.position.set(0, 0, -2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 10, bottom: -6, near: 1, far: 45 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  // a soft fill from the camera so faces never go muddy
  const fill = new T.DirectionalLight('#ffe9ef', 0.25);
  fill.position.set(2, 3, 10);
  scene.add(fill);
  G.lights = { hemi, key, sun, fill, lamps: [] };

  /* ------------------------------------------------------------------ */
  /* procedural textures                                                 */
  /* ------------------------------------------------------------------ */
  G.canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  G.tex = (canvas, { srgb = true, repeat, wrap = true } = {}) => {
    const t = new T.CanvasTexture(canvas);
    if (srgb) t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = G.maxAniso;
    if (wrap) t.wrapS = t.wrapT = T.RepeatWrapping;
    if (repeat) t.repeat.set(repeat[0], repeat[1]);
    return t;
  };

  // value noise → fBm, tileable
  function makeNoise(size, seed = 1) {
    let s = seed * 9973;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const grid = (n) => { const g = new Float32Array(n * n); for (let i = 0; i < g.length; i++) g[i] = rnd(); return g; };
    const octs = [4, 8, 16, 32, 64].map((n) => ({ n, g: grid(n) }));
    const out = new Float32Array(size * size);
    const smooth = (t) => t * t * (3 - 2 * t);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        let v = 0, amp = 0.5, tot = 0;
        for (const o of octs) {
          const fx = (x / size) * o.n, fy = (y / size) * o.n;
          const x0 = Math.floor(fx), y0 = Math.floor(fy);
          const tx = smooth(fx - x0), ty = smooth(fy - y0);
          const g = o.g, n = o.n;
          const a = g[(y0 % n) * n + (x0 % n)], b = g[(y0 % n) * n + ((x0 + 1) % n)];
          const c = g[((y0 + 1) % n) * n + (x0 % n)], d = g[((y0 + 1) % n) * n + ((x0 + 1) % n)];
          v += amp * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
          tot += amp;
          amp *= 0.5;
        }
        out[y * size + x] = v / tot;
      }
    return out;
  }
  G.noise = makeNoise;

  /** normal map from a height function (Float32Array size×size, 0..1) */
  G.normalFromHeight = (h, size, strength = 2) => {
    const c = G.canvas(size, size), ctx = c.getContext('2d'), img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const l = h[y * size + ((x - 1 + size) % size)], r = h[y * size + ((x + 1) % size)];
        const u = h[((y - 1 + size) % size) * size + x], d = h[((y + 1) % size) * size + x];
        let nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
        const len = Math.hypot(nx, ny, nz);
        const i = (y * size + x) * 4;
        img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
        img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
        img.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    return G.tex(c, { srgb: false });
  };

  /* shared texture library (built lazily) */
  const LIB = {};
  G.lib = (name) => LIB[name] || (LIB[name] = BUILD[name]());
  const BUILD = {
    plasterN() { const n = makeNoise(256, 3); return G.normalFromHeight(n, 256, 3.2); },
    paperN() { const n = makeNoise(256, 7); return G.normalFromHeight(n, 256, 1.2); },
    clayN() { const n = makeNoise(128, 11); return G.normalFromHeight(n, 128, 1.6); },
    marble() {
      const S = 1024, c = G.canvas(S, S), x = c.getContext('2d');
      const n = makeNoise(256, 5);
      const g = x.createLinearGradient(0, 0, S, S);
      g.addColorStop(0, '#fbf8f8'); g.addColorStop(1, '#f2ecee');
      x.fillStyle = g; x.fillRect(0, 0, S, S);
      // soft clouds
      const im = x.getImageData(0, 0, S, S);
      for (let i = 0; i < S * S; i++) {
        const v = n[((i / S) | 0) % 256 * 256 + (i % S) % 256];
        const k = (v - 0.5) * 18;
        im.data[i * 4] += k; im.data[i * 4 + 1] += k; im.data[i * 4 + 2] += k * 0.9;
      }
      x.putImageData(im, 0, 0);
      // veins
      for (let v = 0; v < 14; v++) {
        x.strokeStyle = `rgba(${150 + Math.random() * 30},${140 + Math.random() * 20},${150 + Math.random() * 20},${0.12 + Math.random() * 0.22})`;
        x.lineWidth = 0.6 + Math.random() * 2.4;
        x.beginPath();
        let px = Math.random() * S, py = Math.random() * S;
        x.moveTo(px, py);
        for (let k = 0; k < 40; k++) {
          px += (Math.random() - 0.3) * 60; py += (Math.random() - 0.5) * 50;
          x.lineTo(px, py);
        }
        x.stroke();
      }
      return G.tex(c);
    },
    wood() {
      const S = 512, c = G.canvas(S, S), x = c.getContext('2d');
      x.fillStyle = '#c9956a'; x.fillRect(0, 0, S, S);
      for (let i = 0; i < 220; i++) {
        const y = Math.random() * S;
        x.strokeStyle = `rgba(${90 + Math.random() * 40},${50 + Math.random() * 20},${25},${0.05 + Math.random() * 0.12})`;
        x.lineWidth = 0.5 + Math.random() * 2;
        x.beginPath();
        x.moveTo(0, y);
        for (let k = 0; k <= 16; k++) x.lineTo((k / 16) * S, y + Math.sin(k * 0.8 + i) * 3 + (Math.random() - 0.5) * 2);
        x.stroke();
      }
      return G.tex(c);
    },
    checker() {
      const S = 512, c = G.canvas(S, S), x = c.getContext('2d');
      const n = makeNoise(128, 21);
      const cols = ['#f4b9c8', '#fff8f9'];
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { x.fillStyle = cols[(i + j) % 2]; x.fillRect(i * 256, j * 256, 256, 256); }
      // subtle mottling
      const im = x.getImageData(0, 0, S, S);
      for (let i = 0; i < S * S; i++) { const v = (n[(((i / S) | 0) % 128) * 128 + (i % S) % 128] - 0.5) * 10; im.data[i * 4] += v; im.data[i * 4 + 1] += v; im.data[i * 4 + 2] += v; }
      x.putImageData(im, 0, 0);
      // grout
      x.strokeStyle = 'rgba(200,160,170,.55)'; x.lineWidth = 3;
      [0, 256, 512].forEach((p) => { x.beginPath(); x.moveTo(p, 0); x.lineTo(p, S); x.stroke(); x.beginPath(); x.moveTo(0, p); x.lineTo(S, p); x.stroke(); });
      return G.tex(c);
    },
    checkerRough() {
      const S = 512, c = G.canvas(S, S), x = c.getContext('2d');
      x.fillStyle = '#3a3a3a'; x.fillRect(0, 0, S, S);
      x.strokeStyle = '#d0d0d0'; x.lineWidth = 6;
      [0, 256, 512].forEach((p) => { x.beginPath(); x.moveTo(p, 0); x.lineTo(p, S); x.stroke(); x.beginPath(); x.moveTo(0, p); x.lineTo(S, p); x.stroke(); });
      return G.tex(c, { srgb: false });
    },
    tileN() {
      const S = 256, h = new Float32Array(S * S), n = makeNoise(S, 31);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const gx = Math.min(x % 128, 128 - (x % 128)), gy = Math.min(y % 128, 128 - (y % 128));
        const g = Math.min(gx, gy);
        h[y * S + x] = (g < 2 ? 0 : g < 5 ? (g - 2) / 3 : 1) * 0.8 + n[y * S + x] * 0.06;
      }
      return G.normalFromHeight(h, S, 4);
    },
    wallpaper() {
      const S = 512, c = G.canvas(S, S), x = c.getContext('2d');
      x.fillStyle = '#f4c4d0'; x.fillRect(0, 0, S, S);
      for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,0)'; x.fillRect(i * 64, 0, 64, S); }
      x.fillStyle = 'rgba(255,255,255,.22)';
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { x.beginPath(); x.arc(i * 64 + 32, j * 64 + (i % 2) * 32, 2.2, 0, 7); x.fill(); }
      return G.tex(c);
    },
    // ---- cloth, hair & skin: grey-scale albedo (tinted by material colour) + matching normals
    weaveMap() { return clothTex('weave').map; },
    weaveN() { return clothTex('weave').normal; },
    denimMap() { return clothTex('denim').map; },
    denimN() { return clothTex('denim').normal; },
    knitMap() { return clothTex('knit').map; },
    knitN() { return clothTex('knit').normal; },
    hairMap() { return clothTex('hair').map; },
    hairN() { return clothTex('hair').normal; },
    skinN() { const n = makeNoise(256, 77); const h = new Float32Array(256 * 256); for (let i = 0; i < h.length; i++) h[i] = n[i] * 0.6; return G.normalFromHeight(h, 256, 1.0); },
    fabric() { const n = makeNoise(128, 41); const h = new Float32Array(128 * 128); for (let i = 0; i < h.length; i++) h[i] = n[i] * 0.5 + (((i % 128) % 4 < 2) ^ (((i / 128) | 0) % 4 < 2) ? 0.1 : 0); return G.normalFromHeight(h, 128, 2.5); },
  };

  /** procedural cloth/hair: a height field → (albedo canvas, normal map), cached per kind */
  const CLOTH = {};
  function clothTex(kind) {
    if (CLOTH[kind]) return CLOTH[kind];
    const S = 256, h = new Float32Array(S * S), n = makeNoise(S, kind.length * 13 + 5);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      let v;
      if (kind === 'weave') { const a = Math.sin((x / S) * Math.PI * 2 * 48), b = Math.sin((y / S) * Math.PI * 2 * 48); v = 0.5 + 0.22 * (((x >> 2) + (y >> 2)) % 2 ? a : b) + (n[i] - 0.5) * 0.3; }
      else if (kind === 'denim') { v = 0.5 + 0.3 * Math.sin(((x + y) / S) * Math.PI * 2 * 56) + (n[i] - 0.5) * 0.5 + (Math.random() - 0.5) * 0.12; }
      else if (kind === 'knit') { const rib = Math.abs(Math.sin((x / S) * Math.PI * 24)); const st = Math.abs(Math.sin((y / S) * Math.PI * 40 + (x % 21 < 10 ? 0.6 : -0.6))); v = 0.25 + 0.5 * rib * (0.7 + 0.3 * st) + (n[i] - 0.5) * 0.15; }
      else { const strand = Math.sin((x / S) * Math.PI * 2 * 90 + n[(y >> 3) * S + x] * 6) * 0.5 + 0.5; v = 0.35 + 0.45 * strand + (n[i] - 0.5) * 0.4; }
      h[i] = v;
    }
    const c = G.canvas(S, S), x = c.getContext('2d'), img = x.createImageData(S, S);
    for (let i = 0; i < S * S; i++) {
      const base = kind === 'denim' ? 0.72 + h[i] * 0.32 : kind === 'hair' ? 0.62 + h[i] * 0.45 : 0.8 + h[i] * 0.22;
      const vv = Math.min(255, base * 255);
      img.data[i * 4] = vv; img.data[i * 4 + 1] = vv; img.data[i * 4 + 2] = kind === 'denim' ? Math.min(255, vv * 1.04) : vv; img.data[i * 4 + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    const rep = kind === 'hair' ? [6, 2] : kind === 'knit' ? [5, 5] : [7, 7];
    const map = G.tex(c, { repeat: rep });
    const normal = G.normalFromHeight(h, S, kind === 'hair' ? 2.4 : kind === 'knit' ? 3.0 : 1.8);
    normal.repeat.set(rep[0], rep[1]);
    return (CLOTH[kind] = { map, normal });
  }

  /* ------------------------------------------------------------------ */
  /* materials & geometry caches                                         */
  /* ------------------------------------------------------------------ */
  const MAT = {};
  /** standard PBR material, cached by its parameters */
  G.mat = (color, o = {}) => {
    const k = color + JSON.stringify(o);
    if (MAT[k]) return MAT[k];
    const p = Object.assign({ color, roughness: 0.62, metalness: 0, envMapIntensity: o.metalness ? 0.8 : 0.36 }, o);
    if (p.tex) { p.map = G.lib(p.tex + 'Map'); p.normal = p.tex + 'N'; }
    if (p.normal) { p.normalMap = G.lib(p.normal); p.normalScale = new T.Vector2(p.ns || 0.5, p.ns || 0.5); }
    delete p.tex;
    const { physical, normal, ns, ...rest } = p;
    const m = physical ? new T.MeshPhysicalMaterial(rest) : new T.MeshStandardMaterial(rest);
    return (MAT[k] = m);
  };
  /** glass: true transmission in the photo studio; in the live room a reflective
      transparent shell (transmission would re-render the whole scene every frame) */
  G.studio = false;
  G.glass = (tint = '#ffffff', o = {}) => G.studio
    ? G.mat(tint, Object.assign({ physical: true, roughness: 0.04, metalness: 0, transmission: 1, thickness: 0.02, ior: 1.45, transparent: true, envMapIntensity: 1.3, specularIntensity: 1 }, o))
    : G.mat(tint, { physical: true, roughness: Math.min(0.08, o.roughness ?? 0.04), metalness: 0, transparent: true, opacity: 0.16, envMapIntensity: 1.6, clearcoat: 1, clearcoatRoughness: 0.04, depthWrite: false, specularIntensity: 1 });
  G.metal = (color = '#d9dce3', rough = 0.22) => G.mat(color, { metalness: 1, roughness: rough });
  G.brass = () => G.mat('#d1a462', { metalness: 1, roughness: 0.28 });
  const GEO = {};
  G.rbox = (w, h, d, r = 0.02, s = 3) => GEO[`rb${w},${h},${d},${r},${s}`] || (GEO[`rb${w},${h},${d},${r},${s}`] = new X.RoundedBoxGeometry(w, h, d, s, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)));
  G.cyl = (rt, rb, h, seg = 32) => GEO[`c${rt},${rb},${h},${seg}`] || (GEO[`c${rt},${rb},${h},${seg}`] = new T.CylinderGeometry(rt, rb, h, seg));
  G.sph = (r, ws = 24, hs = 16) => GEO[`s${r},${ws},${hs}`] || (GEO[`s${r},${ws},${hs}`] = new T.SphereGeometry(r, ws, hs));
  G.cap = (r, l, cs = 6, rs = 14) => GEO[`p${r},${l},${cs},${rs}`] || (GEO[`p${r},${l},${cs},${rs}`] = new T.CapsuleGeometry(r, l, cs, rs));
  G.tor = (R, r, ts = 16, rs = 40, arc = Math.PI * 2) => GEO[`t${R},${r},${arc}`] || (GEO[`t${R},${r},${arc}`] = new T.TorusGeometry(R, r, ts, rs, arc));
  G.lathe = (pts, seg = 48) => new T.LatheGeometry(pts.map(([x, y]) => new T.Vector2(x, y)), seg);

  /** batch sibling meshes that share a material into one draw call (recursively).
      Groups keep their transforms, so joints/doors/pivots still animate. */
  G.mergeChildren = (root) => {
    let saved = 0;
    const visit = (node) => {
      if (node.userData.noMerge) return;
      const buckets = new Map();
      node.children.slice().forEach((c) => {
        if (c.isMesh && !c.isInstancedMesh && !c.isSkinnedMesh && !Array.isArray(c.material) && !c.userData.noMerge && c.visible && c.geometry.attributes.position && c.geometry.attributes.normal && c.geometry.attributes.uv && !c.userData.pick && !c.customDepthMaterial) {
          const k = c.material.uuid + (c.castShadow ? 'c' : '') + (c.receiveShadow ? 'r' : '') + c.renderOrder;
          if (!buckets.has(k)) buckets.set(k, []);
          buckets.get(k).push(c);
        }
      });
      buckets.forEach((list) => {
        if (list.length < 2) return;
        const vc = !!list[0].material.vertexColors;
        const geos = list.map((m) => {
          m.updateMatrix();
          let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
          g.applyMatrix4(m.matrix);
          const keep = vc ? ['position', 'normal', 'uv', 'color'] : ['position', 'normal', 'uv'];
          Object.keys(g.attributes).forEach((a) => { if (!keep.includes(a)) g.deleteAttribute(a); });
          g.morphAttributes = {};
          g.clearGroups();
          return g;
        });
        if (vc && geos.some((g) => !g.attributes.color)) return;
        const merged = X.BufferGeometryUtils.mergeGeometries(geos, false);
        if (!merged) return;
        const mesh = new T.Mesh(merged, list[0].material);
        mesh.castShadow = list[0].castShadow;
        mesh.receiveShadow = list[0].receiveShadow;
        mesh.renderOrder = list[0].renderOrder;
        node.add(mesh);
        list.forEach((m) => node.remove(m));
        saved += list.length - 1;
      });
      node.children.forEach((c) => { if (!c.isMesh || c.children.length) visit(c); });
    };
    visit(root);
    return saved;
  };

  /** small things don't need to cast shadows: skip casters under `minR` metres (saves shadow-pass work) */
  G.trimCasters = (root, minR = 0.035) => {
    let n = 0;
    root.traverse((o) => {
      if (!o.isMesh || !o.castShadow || o.isInstancedMesh) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      const s = o.getWorldScale(new T.Vector3());
      if (o.geometry.boundingSphere.radius * Math.max(s.x, s.y, s.z) < minR) { o.castShadow = false; n++; }
    });
    return n;
  };

  /** mesh helper: G.m(geo, mat, {p:[x,y,z], r:[x,y,z], s:[..]|n, cast, recv, parent}) */
  G.m = (geo, mat, o = {}) => {
    const m = new T.Mesh(geo, mat);
    if (o.p) m.position.set(...o.p);
    if (o.r) m.rotation.set(...o.r);
    if (o.s != null) Array.isArray(o.s) ? m.scale.set(...o.s) : m.scale.setScalar(o.s);
    m.castShadow = o.cast !== false;
    m.receiveShadow = o.recv !== false;
    if (o.parent) o.parent.add(m);
    if (o.name) m.name = o.name;
    return m;
  };
  G.group = (parent, p) => { const g = new T.Group(); if (p) g.position.set(...p); if (parent) parent.add(g); return g; };

  /* ------------------------------------------------------------------ */
  /* frame callbacks, picking, anchors                                   */
  /* ------------------------------------------------------------------ */
  const frameFns = [];
  G.onFrame = (fn) => frameFns.push(fn);

  const ray = new T.Raycaster();
  const ptr = new T.Vector2();
  const pickables = [];
  let hovered = null;
  G.pickable = (obj, handlers) => { obj.userData.pick = handlers; pickables.push(obj); };
  G.unpick = (obj) => { const i = pickables.indexOf(obj); if (i >= 0) pickables.splice(i, 1); };
  function hit(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ptr.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ptr.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ptr, camera);
    const hits = ray.intersectObjects(pickables, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.pick) o = o.parent;
      if (o && o.visible !== false) return { obj: o, point: h.point, uv: h.uv };
    }
    return null;
  }
  G.hitTest = hit;
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, yaw: rig.yaw, pitch: rig.pitch, moved: false, id: e.pointerId };
    if (G.modal && G.modal.down) G.modal.down(e);
  });
  window.addEventListener('pointermove', (e) => {
    rig.parT.set((e.clientX / window.innerWidth - 0.5) * 2, (e.clientY / window.innerHeight - 0.5) * 2);
    if (G.modal && G.modal.move) { G.modal.move(e); return; }
    if (down && e.buttons) {
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (Math.hypot(dx, dy) > 6) down.moved = true;
      if (down.moved && G.allowLook) {
        rig.yaw = B.clamp(down.yaw - dx * 0.0016, -0.32, 0.32);
        rig.pitch = B.clamp(down.pitch + dy * 0.0012, -0.12, 0.16);
        renderer.domElement.style.cursor = 'grabbing';
      }
      return;
    }
    const h = hit(e);
    const o = h && h.obj;
    if (o !== hovered) {
      if (hovered && hovered.userData.pick.hover) hovered.userData.pick.hover(false);
      hovered = o;
      if (o && o.userData.pick.hover) o.userData.pick.hover(true, h);
    }
    renderer.domElement.style.cursor = o ? 'pointer' : G.allowLook ? 'grab' : 'default';
  });
  window.addEventListener('pointerup', (e) => {
    if (G.modal && G.modal.up) { G.modal.up(e); down = null; return; }
    if (down && !down.moved && e.target === renderer.domElement) {
      const h = hit(e);
      if (h && h.obj.userData.pick.click) h.obj.userData.pick.click(h);
    }
    if (down && down.moved) gsap.to(rig, { yaw: 0, pitch: 0, duration: 2.4, delay: 1.5, ease: 'power2.inOut' });
    down = null;
  });

  /* HTML anchored to 3D objects (glass bubbles, tags, chips) */
  const anchors = [];
  const v3 = new T.Vector3();
  G.anchor = (el, obj, off = [0, 0, 0], o = {}) => {
    const shell = document.createElement('div');
    shell.className = 'anc' + (o.cls ? ' ' + o.cls : '');
    shell.appendChild(el);
    B.$('#anchors').appendChild(shell);
    const a = { el: shell, obj, off: new T.Vector3(...off), o };
    anchors.push(a);
    return {
      remove() { const i = anchors.indexOf(a); if (i >= 0) anchors.splice(i, 1); shell.remove(); },
      a,
    };
  };
  G.toScreen = (vec) => {
    v3.copy(vec).project(camera);
    return { x: (v3.x * 0.5 + 0.5) * window.innerWidth, y: (-v3.y * 0.5 + 0.5) * window.innerHeight, behind: v3.z > 1 };
  };
  G.objScreen = (obj, off = [0, 0, 0]) => {
    const p = new T.Vector3(...off);
    obj.localToWorld(p);
    return G.toScreen(p);
  };
  function updateAnchors() {
    for (const a of anchors) {
      if (!a.obj.parent && !a.o.free) { a.el.style.visibility = 'hidden'; continue; }
      v3.copy(a.off);
      a.obj.localToWorld(v3);
      v3.project(camera);
      const vis = v3.z < 1 && a.obj.visible !== false;
      a.el.style.visibility = vis ? '' : 'hidden';
      const x = (v3.x * 0.5 + 0.5) * window.innerWidth, y = (-v3.y * 0.5 + 0.5) * window.innerHeight;
      a.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }
  }

  /* camera moves */
  const camState = { pos: rig.pos.clone(), target: rig.target.clone() };
  G.camTo = (pos, target, dur = 1.4, ease = 'power3.inOut') => new Promise((res) => {
    gsap.to(rig.pos, { x: pos[0], y: pos[1], z: pos[2], duration: dur, ease, overwrite: 'auto' });
    gsap.to(rig.target, { x: target[0], y: target[1], z: target[2], duration: dur, ease, overwrite: 'auto', onComplete: res });
  });
  G.camHome = (dur) => G.camTo(G.HOME.pos.toArray(), G.HOME.target.toArray(), dur);
  /* The app is one canvas of rooms: moving between them is a camera move —
     a View Transition swaps the UI chrome while GSAP pans the camera.
     Only the lobby exists today; kitchen/storeroom/office slot in here. */
  G.ROOMS = { lobby: { pos: G.HOME.pos.toArray(), target: G.HOME.target.toArray(), label: 'Lobby' } };
  G.goRoom = (name, dur = 1.6) => {
    const r = G.ROOMS[name];
    if (!r) return Promise.resolve();
    B.vt(() => { document.body.dataset.room = name; const chip = B.$('.room-chip'); if (chip) chip.lastChild.textContent = r.label; });
    return G.camTo(r.pos, r.target, dur);
  };
  G.allowLook = true;

  const lookDir = new T.Vector3(), tmp = new T.Vector3();
  function updateCamera(dt) {
    rig.par.lerp(rig.parT, Math.min(1, dt * 2.5));
    const pm = G.modal ? 0.15 : 1;
    camera.position.copy(rig.pos);
    camera.position.x += rig.par.x * 0.16 * pm;
    camera.position.y += -rig.par.y * 0.06 * pm;
    // orbit the target by yaw/pitch for look-around
    lookDir.subVectors(rig.target, rig.pos);
    const dist = lookDir.length();
    const yaw = Math.atan2(lookDir.x, -lookDir.z) + rig.yaw;
    const pitch = Math.asin(lookDir.y / dist) - rig.pitch;
    tmp.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist).add(rig.pos);
    camera.lookAt(tmp);
  }

  /* ------------------------------------------------------------------ */
  /* main render loop                                                    */
  /* ------------------------------------------------------------------ */
  let last = performance.now(), frameNo = 0;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  // adaptive resolution: trade pixels for frame rate on slower GPUs
  let acc = 0, frames = 0, cool = 3;
  function adapt(dt) {
    acc += dt; frames++;
    if (acc < 1) return;
    const fps = frames / acc;
    acc = 0; frames = 0;
    if (cool-- > 0) return;
    const pr = renderer.getPixelRatio();
    if (fps < 42 && pr > 0.8) { renderer.setPixelRatio(Math.max(0.8, pr - 0.2)); resize(); cool = 2; }
    else if (fps > 57 && pr < G.maxDpr) { renderer.setPixelRatio(Math.min(G.maxDpr, pr + 0.1)); resize(); cool = 4; }
  }
  G.time = 0;
  G.render = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    G.time += dt;
    updateCamera(dt);
    for (const fn of frameFns) fn(dt, G.time);
    // shadows refresh at ~half rate; people move slowly enough not to notice
    frameNo++;
    renderer.shadowMap.needsUpdate = frameNo % 2 === 0;
    composer.render(dt);
    adapt(dt);
    updateAnchors();
  };
  G.start = () => gsap.ticker.add(G.render);

  /* ------------------------------------------------------------------ */
  /* time of day lighting                                                */
  /* ------------------------------------------------------------------ */
  const C = (h) => new T.Color(h);
  const EXP = 0.6; // global exposure (the pmndrs tone-mapping effect ignores renderer exposure)
  const envMats = [];
  G.normalizeEnv = () => scene.traverse((o) => [].concat(o.material || []).forEach((m) => {
    if (m.envMapIntensity === undefined || m.userData.envBase !== undefined) return;
    if (m.envMapIntensity === 1 && !(m.metalness > 0.5)) m.envMapIntensity = 0.38;
    m.userData.envBase = m.envMapIntensity;
    envMats.push(m);
  }));
  let lastEnv = -1;
  const setEnvScale = (k) => {
    if (Math.abs(k - lastEnv) < 0.01) return;
    lastEnv = k;
    envMats.forEach((m) => (m.envMapIntensity = m.userData.envBase * k));
  };
  G.setDaylight = ({ day, night, golden, grey, sunX }) => {
    sun.intensity = 8.5 * day * (1 - grey * 0.9);
    sun.color.copy(C('#fff1dc')).lerp(C('#ffb36b'), golden);
    sun.position.set(-11 + sunX * 22, 4 + day * 6, -18);
    key.intensity = 0.95 + day * 0.35 - grey * 0.15;
    key.color.copy(C('#fff4ec')).lerp(C('#ffe2c4'), night * 0.6);
    hemi.intensity = 0.16 + day * 0.12;
    hemi.color.copy(C('#fff3f5')).lerp(C('#c9c2ee'), night * 0.5).lerp(C('#e4e2ee'), grey * 0.5);
    G.exposure = 1 - night * 0.08;
    G.lights.lamps.forEach((l) => (l.intensity = l.userData.base * (0.6 + night * 1.2)));
    key.intensity *= 1 - night * 0.6;
    hemi.intensity *= 1 - night * 0.55;
    [sun, key, hemi].forEach((l) => (l.intensity *= EXP));
    setEnvScale(1 - night * 0.62 - grey * 0.12);
    fill.intensity = 0.25 * EXP;
    G.lights.lamps.forEach((l) => (l.intensity *= 0.8));
    bloom.intensity = 0.5 + night * 0.5;
  };
})();
