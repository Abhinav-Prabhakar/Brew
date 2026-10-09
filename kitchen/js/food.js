/* brew · night kitchen — food is the hero.
   · a ribeye with a per-side raw→seared blend (flipping it really cooks the other face)
   · a Margherita on a dark peel, a cappuccino with latte art, the ticket that goes with them
   · mise-en-place bins (herbs, cherry tomatoes, garlic, chickpeas), herbs and garlic on the board
   · a plated, sliced steak with a dressed salad */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { E } from './engine.js';
import { M, envMats } from './materials.js';
import { L } from './set.js';
import { P } from './props.js';
import { TX, canvas, tex, rng, fbm, normalFromHeight, greyTex } from './textures.js';
import { rbox, cyl, sph, plane, lathe, m, group } from './kit.js';

export const F = {};
const reg = (mm, env) => { mm.userData.envBase = mm.envMapIntensity = env; envMats.push(mm); return mm; };

export function buildFood() {
  F.root = group(E.scene);
  F.root.name = 'food';
  F.steak = makeSteak();
  F.root.add(F.steak);
  F.steak.userData.noMerge = true;
  resetSteakOnPan();
  pizza();
  cappuccino();
  ticket();
  miseBins();
  boardMise();
  platedSteak();
  return F.root;
}

/* ================================================================== */
/* steak                                                               */
/* ================================================================== */
function steakGeo(a = 0.085, b = 0.058, h = 0.0135) {
  const g = new THREE.SphereGeometry(1, 72, 28);
  const pos = g.attributes.position, uv = g.attributes.uv, n = fbm(64, { seed: 3, base: 4, octaves: 3 });
  const e = 0.3;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const th = Math.atan2(z, x), ph = Math.asin(Math.max(-1, Math.min(1, y)));
    const R = 1 + 0.1 * Math.sin(2 * th + 0.5) + 0.06 * Math.sin(3 * th + 1.7) + 0.035 * Math.sin(5 * th + 0.3);
    const c = Math.pow(Math.max(0, Math.cos(ph)), e), s = Math.sign(ph) * Math.pow(Math.abs(Math.sin(ph)), e);
    const px = a * R * c * Math.cos(th), pz = b * R * c * Math.sin(th);
    const u = px / (2.7 * a) + 0.5, v = pz / (2.7 * b) + 0.5;
    const nb = n[Math.floor(v * 63) * 64 + Math.floor(u * 63)];
    const rr = Math.min(1, Math.hypot(px / a, pz / b));
    const py = h * s * (1 + (1 - rr * rr) * 0.22) + (nb - 0.5) * 0.003 * (1 - rr);
    pos.setXYZ(i, px, py, pz);
    uv.setXY(i, u, v);
  }
  g.deleteAttribute('normal');
  const merged = mergeVertices(g, 1e-5);
  merged.computeVertexNormals();
  return merged;
}

/* the two looks of the meat, painted in the same planar UV space */
function steakTextures() {
  const S = 1024, r = rng(41);
  const lo = fbm(256, { seed: 44, base: 3, octaves: 4 }), mid = fbm(256, { seed: 45, base: 12, octaves: 4 }), hi = fbm(256, { seed: 46, base: 48, octaves: 2 });
  const at = (f, u, v) => f[(Math.floor(v * 255) & 255) * 256 + (Math.floor(u * 255) & 255)];
  const outline = (u, v) => { const x = (u - 0.5) * 2.7, z = (v - 0.5) * 2.7, th = Math.atan2(z, x), R = 1 + 0.1 * Math.sin(2 * th + 0.5) + 0.06 * Math.sin(3 * th + 1.7) + 0.035 * Math.sin(5 * th + 0.3); return [Math.hypot(x, z) / R, th]; };
  // rendered fat runs along one side of a ribeye
  const fatW = (u, v) => { const [d, th] = outline(u, v); const side = Math.max(0, Math.cos(th - 2.4)); return side < 0.2 ? 0 : Math.max(0, Math.min(1, (d - (0.88 - side * 0.16)) / 0.05)); };
  const sear = canvas(S), sx = sear.getContext('2d'), si = sx.createImageData(S, S);
  const raw = canvas(S), rx = raw.getContext('2d'), ri = rx.createImageData(S, S);
  const h = new Float32Array(S * S), rough = new Float32Array(S * S);
  const ang = 0.95, ca = Math.cos(ang), sa = Math.sin(ang);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = y * S + x;
    const a = at(lo, u, v), b = at(mid, u * 1.5, v * 1.5), c = at(hi, u * 2, v * 2);
    const fat = fatW(u, v);
    // grill bars: ~11 across the steak, edges wobble, burn depth varies along the bar
    const w = (u * ca + v * sa) * 10.5 + (b - 0.5) * 0.35;
    const f = w - Math.floor(w);
    const bar = Math.max(0, 1 - Math.abs(f - 0.5) / (0.13 + (a - 0.5) * 0.06)) ;
    const mark = Math.min(1, Math.pow(bar, 0.6) * (0.75 + c * 0.5));
    // crust: caramel → mahogany → near-black, mottled at two scales, fine grain on top
    const k = Math.min(1, Math.max(0, (a - 0.3) * 1.4 + (b - 0.5) * 0.6));
    let R = 98 - k * 60, G = 60 - k * 38, Bc = 36 - k * 23;
    const grain = (c - 0.5) * 28;
    R += grain; G += grain * 0.5; Bc += grain * 0.3;
    R = R * (1 - mark) + 18 * mark; G = G * (1 - mark) + 10 * mark; Bc = Bc * (1 - mark) + 6 * mark;
    const fr = 160 - a * 40, fg = 112 - a * 36, fb = 58 - a * 24; // fat renders golden
    R = R * (1 - fat) + fr * fat; G = G * (1 - fat) + fg * fat; Bc = Bc * (1 - fat) + fb * fat;
    si.data[i * 4] = R; si.data[i * 4 + 1] = G; si.data[i * 4 + 2] = Bc; si.data[i * 4 + 3] = 255;
    // raw: deep red, irregular intramuscular fat, creamy cap
    const marb = Math.max(0, Math.pow(Math.max(0, b - 0.56) * 4, 1.5)) * 0.8 + Math.max(0, Math.pow(Math.max(0, c - 0.74) * 4, 2)) * 0.3;
    let rr2 = 140 + (a - 0.5) * 50, rg = 26 + (a - 0.5) * 14, rb = 30 + (a - 0.5) * 10;
    const mk = Math.min(1, marb + fat);
    rr2 = rr2 * (1 - mk) + 232 * mk; rg = rg * (1 - mk) + 208 * mk; rb = rb * (1 - mk) + 190 * mk;
    ri.data[i * 4] = rr2; ri.data[i * 4 + 1] = rg; ri.data[i * 4 + 2] = rb; ri.data[i * 4 + 3] = 255;
    h[i] = b * 0.45 + c * 0.35 - mark * 0.45 + fat * 0.15;
    rough[i] = 0.72 - fat * 0.42 - (1 - mark) * (1 - k) * 0.18 + mark * 0.1;
  }
  sx.putImageData(si, 0, 0); rx.putImageData(ri, 0, 0);
  // cracked pepper and flaky salt on the seared side
  for (let k = 0; k < 420; k++) { sx.fillStyle = `rgba(12,8,6,${0.5 + r() * 0.5})`; const s2 = 1.5 + r() * 3.5; sx.fillRect(S * (0.12 + r() * 0.76), S * (0.12 + r() * 0.76), s2, s2 * (0.6 + r())); }
  for (let k = 0; k < 120; k++) { sx.fillStyle = `rgba(250,240,225,${0.35 + r() * 0.4})`; const s2 = 1.5 + r() * 3; sx.fillRect(S * (0.15 + r() * 0.7), S * (0.15 + r() * 0.7), s2, s2); }
  const H = 512, h2 = new Float32Array(H * H), r2 = new Float32Array(H * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < H; x++) { h2[y * H + x] = h[(y * 2) * S + x * 2]; r2[y * H + x] = rough[(y * 2) * S + x * 2]; }
  return {
    sear: tex(sear, { wrap: false }), raw: tex(raw, { wrap: false }),
    normal: normalFromHeight(h2, H, 6, { wrap: false }), rough: greyTex(r2, H, (v) => v, { wrap: false }),
  };
}

function makeSteak() {
  const t = steakTextures();
  const mat = reg(new THREE.MeshPhysicalMaterial({
    map: t.sear, normalMap: t.normal, normalScale: new THREE.Vector2(1.1, 1.1), roughnessMap: t.rough, roughness: 1,
    color: new THREE.Color(0.75, 0.72, 0.7), specularIntensity: 0.35, // a dry crust: little broad specular
    clearcoat: 0.25, clearcoatRoughness: 0.2, // …but a tight glaze of rendered fat and juices
    sheen: 0.15, sheenColor: new THREE.Color('#7a3a1c'), sheenRoughness: 0.5,
  }), 0.8);
  const u = { rawMap: { value: t.raw }, uTop: { value: 0 }, uBot: { value: 0 } };
  mat.userData.cook = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vSide;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvSide = normal.y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D rawMap; uniform float uTop; uniform float uBot; varying float vSide;')
      .replace('#include <map_fragment>', `
        vec4 searC = texture2D(map, vMapUv);
        vec4 rawC = texture2D(rawMap, vMapUv);
        float cookK = mix(uBot, uTop, smoothstep(-0.35, 0.35, vSide));
        // the edge band cooks with whichever face is hotter, a little behind
        float sideK = 1.0 - smoothstep(0.25, 0.8, abs(vSide));
        cookK = mix(cookK, max(uTop, uBot) * 0.85, sideK);
        // the planar UVs stretch on the edge band: blend toward a flat sear / raw tone there
        searC.rgb = mix(searC.rgb, vec3(0.13, 0.05, 0.022) * (0.7 + searC.r * 2.0), sideK * 0.75);
        rawC.rgb = mix(rawC.rgb, vec3(0.42, 0.06, 0.06), sideK * 0.6);
        diffuseColor *= mix(rawC, searC, smoothstep(0.0, 1.0, cookK));`);
  };
  mat.customProgramCacheKey = () => 'steak';
  const mesh = new THREE.Mesh(steakGeo(), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const g = new THREE.Group();
  g.add(mesh);
  // rosemary + thyme on top (rides along with the steak)
  const herbs = herbSprigs();
  herbs.position.y = 0.017;
  g.add(herbs);
  g.userData.herbs = herbs;
  g.userData.mesh = mesh;
  return g;
}
F.setCook = (top, bot) => { const u = F.steak.userData.mesh.material.userData.cook; u.uTop.value = top; u.uBot.value = bot; };

/* a little thyme scattered over the top + one rosemary sprig, irregular, oil-glossed */
function herbSprigs() {
  const g = new THREE.Group();
  const leaf = reg(new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.25 }), 0.7);
  const r = rng(8), mm = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
  // thyme: tiny oval leaves dropped across the crust
  const tg = new THREE.SphereGeometry(0.0022, 6, 4); tg.scale(1.6, 0.35, 1);
  const thyme = new THREE.InstancedMesh(tg, leaf, 70);
  for (let i = 0; i < 70; i++) {
    const a = r() * 6.28, d = Math.sqrt(r()) * 0.06;
    e.set(0, r() * 6.28, (r() - 0.5) * 0.4); q.setFromEuler(e);
    mm.compose(new THREE.Vector3(Math.cos(a) * d * 1.2, 0.001 + r() * 0.002, Math.sin(a) * d * 0.8), q, new THREE.Vector3(1, 1, 1).multiplyScalar(0.7 + r() * 0.6));
    thyme.setMatrixAt(i, mm);
    thyme.setColorAt(i, col.set('#3b5a26').lerp(new THREE.Color('#5d7a34'), r()));
  }
  g.add(thyme);
  // one rosemary sprig with uneven needles, lying off-centre
  const s = group(g, [0.02, 0.002, -0.008], [0, 0.9, 0.04]);
  m(cyl(0.001, 0.0013, 0.07, 5), reg(new THREE.MeshStandardMaterial({ color: '#4a3e24', roughness: 0.7 }), 0.4), { r: [0, 0, Math.PI / 2], parent: s });
  const ng = new THREE.CapsuleGeometry(0.0009, 0.008, 2, 4);
  const needles = new THREE.InstancedMesh(ng, leaf, 26);
  for (let i = 0; i < 26; i++) {
    const t = r(), side = r() < 0.5 ? 1 : -1;
    e.set(Math.PI / 2 + side * (0.4 + r() * 0.6), r() * 0.4, side * (0.6 + r() * 0.6)); q.setFromEuler(e);
    mm.compose(new THREE.Vector3(-0.034 + t * 0.068, 0.0015, side * 0.003), q, new THREE.Vector3(1, 0.7 + r() * 0.5, 1));
    needles.setMatrixAt(i, mm);
    needles.setColorAt(i, col.set('#2c4a20').lerp(new THREE.Color('#4a6a34'), r()));
  }
  s.add(needles);
  return g;
}

export function resetSteakOnPan() {
  const p = P.pan.position;
  F.steak.position.set(p.x + 0.005, p.y + 0.024, p.z - 0.004);
  F.steak.rotation.set(0, -0.35, 0);
  F.steak.visible = true;
}

/* ================================================================== */
/* margherita                                                          */
/* ================================================================== */
function pizzaTextures() {
  const S = 1024, c = canvas(S), x = c.getContext('2d'), r = rng(27);
  const H = new Float32Array(S * S);
  const R0 = S / 2, sauceR = (0.128 / 0.32) * S;
  // crust
  const g0 = x.createRadialGradient(R0, R0, sauceR * 0.9, R0, R0, R0);
  g0.addColorStop(0, '#b97a3c'); g0.addColorStop(0.35, '#d7a05a'); g0.addColorStop(0.7, '#c2803f'); g0.addColorStop(1, '#8a5326');
  x.fillStyle = g0; x.fillRect(0, 0, S, S);
  // sauce with uneven edge
  x.save(); x.translate(R0, R0);
  x.beginPath();
  for (let i = 0; i <= 64; i++) { const a = (i / 64) * Math.PI * 2, rr = sauceR * (1 + Math.sin(a * 7) * 0.012 + (r() - 0.5) * 0.02); i ? x.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : x.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  const sg = x.createRadialGradient(0, 0, 0, 0, 0, sauceR);
  sg.addColorStop(0, '#a3241a'); sg.addColorStop(0.8, '#b02c1c'); sg.addColorStop(1, '#8e2a18');
  x.fillStyle = sg; x.fill();
  for (let k = 0; k < 500; k++) { const a = r() * 7, d = Math.sqrt(r()) * sauceR * 0.95; x.fillStyle = `rgba(${90 + r() * 60},${10 + r() * 20},10,${0.15 + r() * 0.25})`; x.beginPath(); x.arc(Math.cos(a) * d, Math.sin(a) * d, 2 + r() * 7, 0, 7); x.fill(); }
  // mozzarella pools
  F.cheese = [];
  for (let k = 0; k < 9; k++) {
    const a = r() * 7, d = Math.sqrt(r()) * sauceR * 0.72, cx = Math.cos(a) * d, cy = Math.sin(a) * d, rad = 34 + r() * 30;
    F.cheese.push([cx / S * 0.32, cy / S * 0.32, rad / S * 0.32]);
    x.save(); x.translate(cx, cy); x.rotate(r() * 7);
    const cg = x.createRadialGradient(0, 0, rad * 0.2, 0, 0, rad * 1.15);
    cg.addColorStop(0, '#f6efdf'); cg.addColorStop(0.65, '#f0e2c2'); cg.addColorStop(0.85, '#d9a65e'); cg.addColorStop(1, 'rgba(176,90,40,0)');
    x.fillStyle = cg; x.beginPath();
    for (let i = 0; i <= 24; i++) { const aa = (i / 24) * Math.PI * 2, rr = rad * (1 + (r() - 0.5) * 0.35); i ? x.lineTo(Math.cos(aa) * rr, Math.sin(aa) * rr) : x.moveTo(Math.cos(aa) * rr, Math.sin(aa) * rr); }
    x.fill();
    for (let j = 0; j < 6; j++) { x.fillStyle = `rgba(190,120,50,${0.25 + r() * 0.3})`; x.beginPath(); x.arc((r() - 0.5) * rad, (r() - 0.5) * rad, 2 + r() * 6, 0, 7); x.fill(); }
    x.restore();
  }
  x.restore();
  // leopard char on the cornicione
  for (let k = 0; k < 140; k++) { const a = r() * 7, d = sauceR + (R0 - sauceR) * (0.15 + r() * 0.75); x.fillStyle = `rgba(${25 + r() * 20},${15 + r() * 10},8,${0.35 + r() * 0.5})`; x.beginPath(); x.ellipse(R0 + Math.cos(a) * d, R0 + Math.sin(a) * d, 2 + r() * 9, 2 + r() * 6, a, 0, 7); x.fill(); }
  // olive-oil glints and flecks of oregano
  for (let k = 0; k < 160; k++) { const a = r() * 7, d = Math.sqrt(r()) * sauceR; x.fillStyle = `rgba(40,70,30,${0.4 + r() * 0.4})`; x.fillRect(R0 + Math.cos(a) * d, R0 + Math.sin(a) * d, 2, 2); }
  // height from luminance (cheese + crust high, sauce low)
  const img = x.getImageData(0, 0, S, S).data;
  const n = fbm(256, { seed: 29, base: 32, octaves: 3 });
  const Hs = 512, h2 = new Float32Array(Hs * Hs), rg = new Float32Array(Hs * Hs);
  for (let y = 0; y < Hs; y++) for (let xx = 0; xx < Hs; xx++) {
    const i = ((y * 2) * S + xx * 2) * 4, lum = (img[i] * 0.3 + img[i + 1] * 0.59 + img[i + 2] * 0.11) / 255;
    const isSauce = img[i] > img[i + 1] * 2.2;
    h2[y * Hs + xx] = lum * 0.7 + n[(y & 255) * 256 + (xx & 255)] * 0.3;
    rg[y * Hs + xx] = isSauce ? 0.38 : lum > 0.75 ? 0.32 : 0.72;
  }
  return { map: tex(c, { wrap: false }), normal: normalFromHeight(h2, Hs, 4, { wrap: false }), rough: greyTex(rg, Hs, (v) => v, { wrap: false }) };
}
function pizza() {
  const g = group(F.root, [-0.3, L.passTop, -1.86], [0, 0.4, 0]);
  // dark slate peel
  const slate = reg(new THREE.MeshStandardMaterial({ color: '#1b1b1d', roughness: 0.72, normalMap: TX.ironN, normalScale: new THREE.Vector2(0.6, 0.6) }), 0.6);
  m(cyl(0.19, 0.19, 0.012, 64), slate, { p: [0, 0.006, 0], parent: g, cast: true });
  m(rbox(0.16, 0.012, 0.045, 0.01), M.walnut([0.3, 0.2]), { p: [0.24, 0.006, 0], parent: g });
  // base: thin centre, puffy irregular rim; planar UVs
  const prof = [[0, 0.009], [0.12, 0.0095], [0.128, 0.012], [0.136, 0.02], [0.146, 0.024], [0.153, 0.019], [0.157, 0.01], [0.154, 0.003], [0.146, 0], [0, 0]];
  const geo = lathe(prof, 96);
  const pos = geo.attributes.position, uv = geo.attributes.uv, r = rng(3);
  const bumps = Array.from({ length: 12 }, () => r());
  for (let i = 0; i < pos.count; i++) {
    let px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    const rr = Math.hypot(px, pz), a = Math.atan2(pz, px);
    if (rr > 0.124) {
      const k = 1 + 0.22 * Math.sin(a * 5 + bumps[0] * 6) + 0.14 * Math.sin(a * 11 + bumps[1] * 6) + 0.08 * Math.sin(a * 17);
      py *= k;
      const rk = 1 + 0.012 * Math.sin(a * 7 + bumps[2] * 5);
      px *= rk; pz *= rk;
    }
    pos.setXYZ(i, px, py, pz);
    uv.setXY(i, px / 0.32 + 0.5, pz / 0.32 + 0.5);
  }
  geo.computeVertexNormals();
  const t = pizzaTextures();
  const mat = reg(new THREE.MeshPhysicalMaterial({ map: t.map, normalMap: t.normal, normalScale: new THREE.Vector2(1.2, 1.2), roughnessMap: t.rough, roughness: 1, clearcoat: 0.35, clearcoatRoughness: 0.3, sheen: 0.3, sheenColor: new THREE.Color('#ffb070') }), 0.7);
  m(geo, mat, { p: [0, 0.012, 0], parent: g, cast: true });
  // melted mozzarella in relief
  const moz = reg(new THREE.MeshPhysicalMaterial({ color: '#f3ead6', roughness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.25, sheen: 0.6, sheenColor: new THREE.Color('#fff2d0') }), 0.7);
  F.cheese.forEach(([cx, cz, rad]) => m(sph(1, 20, 10), moz, { p: [cx, 0.0215, cz], s: [rad * 0.82, 0.0035, rad * 0.82], parent: g }));
  // basil leaves
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0); leafShape.bezierCurveTo(0.012, 0.008, 0.016, 0.026, 0, 0.042); leafShape.bezierCurveTo(-0.016, 0.026, -0.012, 0.008, 0, 0);
  const lg = new THREE.ShapeGeometry(leafShape, 8);
  const lp = lg.attributes.position;
  for (let i = 0; i < lp.count; i++) { const lx = lp.getX(i), ly = lp.getY(i); lp.setZ(i, -Math.abs(lx) * 0.35 + Math.sin(ly * 60) * 0.0008); }
  lg.computeVertexNormals();
  const basil = reg(new THREE.MeshPhysicalMaterial({ color: '#2d6a24', roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.15, side: THREE.DoubleSide, sheen: 0.4, sheenColor: new THREE.Color('#9be070') }), 0.8);
  [[0.02, 0.03, 0.4], [-0.05, -0.02, 2.2], [0.06, -0.05, 4.1], [-0.02, 0.07, 5.3], [0.0, -0.075, 1.2]].forEach(([bx, bz, a]) => m(lg, basil, { p: [bx, 0.024, bz], r: [-Math.PI / 2 + 0.08, 0, a], parent: g }));
  F.pizza = g;
}

/* ================================================================== */
/* cappuccino                                                          */
/* ================================================================== */
function latteArt() {
  const S = 512, c = canvas(S), x = c.getContext('2d'), r = rng(12);
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, '#c48a4f'); g.addColorStop(0.6, '#a86a33'); g.addColorStop(0.92, '#6e3f1a'); g.addColorStop(1, '#3a2010');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  for (let k = 0; k < 900; k++) { x.fillStyle = `rgba(${r() < 0.5 ? '255,230,200' : '70,35,15'},${0.04 + r() * 0.06})`; x.beginPath(); x.arc(r() * S, r() * S, 1 + r() * 3, 0, 7); x.fill(); }
  // rosetta: stacked hearts + a pulled line
  x.save(); x.translate(S / 2, S * 0.53);
  x.fillStyle = 'rgba(250,244,232,0.96)'; x.shadowColor = 'rgba(250,244,232,0.6)'; x.shadowBlur = 10;
  for (let i = 0; i < 6; i++) {
    const s = 1 - i * 0.13, y = 70 - i * 34;
    x.beginPath(); x.moveTo(0, y + 40 * s);
    x.bezierCurveTo(-120 * s, y - 10 * s, -60 * s, y - 70 * s, 0, y - 28 * s);
    x.bezierCurveTo(60 * s, y - 70 * s, 120 * s, y - 10 * s, 0, y + 40 * s);
    x.fill();
    x.fillStyle = i % 2 ? 'rgba(250,244,232,0.96)' : 'rgba(176,120,70,0.35)';
  }
  x.fillStyle = 'rgba(250,244,232,0.9)'; x.fillRect(-3, -150, 6, 230);
  x.restore();
  return tex(c, { wrap: false });
}
function cappuccino() {
  const g = group(F.root, [0.26, L.passTop, -1.78], [0, -0.6, 0]);
  const white = M.ceramic('#f2eee8');
  m(lathe([[0, 0], [0.06, 0], [0.072, 0.006], [0.074, 0.01], [0.07, 0.011], [0.04, 0.006], [0, 0.006]], 48), white, { parent: g, cast: true });
  const cup = group(g, [0, 0.006, 0]);
  m(lathe([[0, 0], [0.026, 0], [0.034, 0.012], [0.044, 0.045], [0.047, 0.068], [0.045, 0.069], [0.042, 0.047], [0.032, 0.014], [0, 0.01]], 48), white, { parent: cup, cast: true });
  m(new THREE.TorusGeometry(0.016, 0.0045, 10, 24, Math.PI * 1.15), white, { p: [0.048, 0.04, 0], r: [0, 0, -Math.PI * 0.55], parent: cup });
  const foam = reg(new THREE.MeshPhysicalMaterial({ map: latteArt(), roughness: 0.55, sheen: 0.6, sheenColor: new THREE.Color('#fff3e0') }), 0.5);
  m(new THREE.CircleGeometry(0.043, 48), foam, { p: [0, 0.064, 0], r: [-Math.PI / 2, 0, 0.8], parent: cup });
  const spoon = group(g, [-0.005, 0.012, 0.052], [0, 0.25, 0]);
  m(rbox(0.07, 0.0025, 0.007, 0.0012), M.chrome(), { p: [0.03, 0, 0], parent: spoon });
  m(sph(0.011, 16, 10), M.chrome(), { p: [-0.012, 0.001, 0], s: [1.35, 0.25, 1], parent: spoon });
  F.cappuccino = g;
  F.cupTop = new THREE.Vector3(0.26, L.passTop + 0.075, -1.78);
}

/* the paper ticket for #12, waiting by the plates */
function ticket() {
  const c = canvas(256, 384), x = c.getContext('2d');
  x.fillStyle = '#f4f1ea'; x.fillRect(0, 0, 256, 384);
  x.fillStyle = '#1a1a1a'; x.font = '700 30px "Space Mono", monospace, Inter'; x.fillText('#12', 20, 48);
  x.font = '500 18px Inter'; x.fillStyle = '#444';
  ['TABLE 7  ·  2 COVERS', '', '1  MARGHERITA', '1  ICED LATTE', '1  RIBEYE  MR', '   + herb butter', '', '20:41'].forEach((l, i) => x.fillText(l, 20, 96 + i * 32));
  x.strokeStyle = '#aaa'; x.setLineDash([4, 4]); x.beginPath(); x.moveTo(16, 66); x.lineTo(240, 66); x.stroke();
  const t = tex(c, { wrap: false });
  const geo = new THREE.PlaneGeometry(0.07, 0.105, 4, 8);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.pow((p.getY(i) + 0.0525) / 0.105, 2) * 0.012);
  geo.computeVertexNormals();
  const mat = reg(new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, side: THREE.DoubleSide }), 0.4);
  m(geo, mat, { p: [0.47, L.passTop + 0.002, -1.74], r: [-Math.PI / 2, 0, -0.2], parent: F.root });
}

/* ================================================================== */
/* mise en place                                                       */
/* ================================================================== */
function scatter(bin, n, geo, mat, { h = 0.03, scale = [1, 1], rot = true, seed = 1, tint } = {}) {
  const r = rng(seed), im = new THREE.InstancedMesh(geo, mat, n), mm = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const u = (r() - 0.5) * 2, v = (r() - 0.5) * 2;
    const mound = (1 - Math.min(1, Math.hypot(u * 0.9, v * 0.9))) * h + r() * 0.006;
    p.set(bin.x + u * bin.w * 0.46, bin.y + 0.002 + mound, bin.z + v * bin.d * 0.46);
    e.set(rot ? r() * 6 : 0, r() * 6, rot ? r() * 6 : 0);
    q.setFromEuler(e);
    const k = scale[0] + r() * (scale[1] - scale[0]);
    s.set(k, k, k);
    mm.compose(p, q, s);
    im.setMatrixAt(i, mm);
    if (tint) { col.set(tint[0]).lerp(new THREE.Color(tint[1]), r()); im.setColorAt(i, col); }
  }
  im.castShadow = false;
  im.receiveShadow = true;
  F.root.add(im);
  return im;
}
const herbMat = () => reg(new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.42, clearcoat: 0.4, clearcoatRoughness: 0.3, side: THREE.DoubleSide, sheen: 0.5, sheenColor: new THREE.Color('#9bd36e') }), 0.6);
const herbGeo = () => { const gg = new THREE.PlaneGeometry(0.007, 0.005); gg.rotateX(-Math.PI / 2); return gg; };
function miseBins() {
  const [b0, b1, b2, b3] = P.bins;
  // chopped herbs
  scatter(b0, 520, herbGeo(), herbMat(), { h: 0.028, scale: [0.7, 1.5], seed: 2, tint: ['#2c5e1f', '#4f8a2e'] });
  // cherry tomatoes: glossy, with a tiny calyx
  const tom = reg(new THREE.MeshPhysicalMaterial({ color: '#c8200e', roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05, sheen: 0.3, sheenColor: new THREE.Color('#ff8060') }), 1);
  const tg = new THREE.SphereGeometry(0.0125, 18, 12); tg.scale(1, 0.9, 1);
  scatter(b1, 34, tg, tom, { h: 0.02, scale: [0.85, 1.15], rot: false, seed: 3, tint: ['#ffffff', '#e8a090'] });
  // minced garlic
  const gar = reg(new THREE.MeshPhysicalMaterial({ color: '#efe6c8', roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.3 }), 0.6);
  scatter(b2, 420, new THREE.BoxGeometry(0.0045, 0.0035, 0.004), gar, { h: 0.022, scale: [0.6, 1.3], seed: 4, tint: ['#ffffff', '#e8d9a8'] });
  // chickpeas
  const chk = reg(new THREE.MeshStandardMaterial({ color: '#d9b679', roughness: 0.55, normalMap: TX.grainN, normalScale: new THREE.Vector2(0.8, 0.8) }), 0.6);
  scatter(b3, 120, new THREE.IcosahedronGeometry(0.0062, 1), chk, { h: 0.024, scale: [0.85, 1.15], seed: 5, tint: ['#ffffff', '#c9a26a'] });
}
function boardMise() {
  // a pile of chopped parsley and two garlic cloves on the board
  const bin = { x: L.board[0] - 0.04, y: L.top + 0.044, z: L.board[1] + 0.02, w: 0.09, d: 0.07 };
  F.boardHerbs = scatter(bin, 260, herbGeo(), herbMat(), { h: 0.012, scale: [0.7, 1.4], seed: 9, tint: ['#2a5a1c', '#5a9a34'] });
  const clove = new THREE.SphereGeometry(0.009, 14, 10); clove.scale(1.6, 0.8, 1);
  const cm = reg(new THREE.MeshPhysicalMaterial({ color: '#f1e8d2', roughness: 0.35, clearcoat: 0.6, sheen: 0.4, sheenColor: new THREE.Color('#fff') }), 0.7);
  m(clove, cm, { p: [L.board[0] + 0.06, L.top + 0.05, L.board[1] - 0.05], r: [0, 0.6, 0], parent: F.root });
  m(clove, cm, { p: [L.board[0] + 0.085, L.top + 0.05, L.board[1] - 0.03], r: [0, 2.1, 0.2], parent: F.root });
}

/* ================================================================== */
/* plated steak + salad (the finished dish, lower right)               */
/* ================================================================== */
function sliceGeo() {
  const g = new THREE.BoxGeometry(0.075, 0.024, 0.011, 10, 5, 1);
  const p = g.attributes.position, cols = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    // round the top a little
    p.setY(i, y + (y > 0 ? -Math.pow(x / 0.0375, 2) * 0.004 : 0));
    const edge = Math.min(0.0375 - Math.abs(x), 0.012 - Math.abs(y));
    const k = Math.min(1, Math.max(0, edge / 0.004));
    const c = new THREE.Color('#5a2a14').lerp(new THREE.Color('#c4505a'), k).lerp(new THREE.Color('#d8707a'), Math.max(0, k - 0.6));
    cols.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}
function platedSteak() {
  const g = group(F.root, [P.plate.position.x, L.top + 0.014, P.plate.position.z]);
  g.userData.noMerge = true;
  const meat = reg(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.25, sheen: 0.4, sheenColor: new THREE.Color('#ff7060') }), 0.7);
  const sg = sliceGeo();
  for (let i = 0; i < 5; i++) m(sg, meat, { p: [-0.035 + i * 0.013, 0.012, -0.02 + i * 0.006], r: [0, 0.35, -0.5 + i * 0.05], parent: g, cast: true });
  // salad: torn leaves + halved cherry tomatoes
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0); leafShape.bezierCurveTo(0.014, 0.01, 0.012, 0.03, 0, 0.038); leafShape.bezierCurveTo(-0.012, 0.03, -0.014, 0.01, 0, 0);
  const lg = new THREE.ShapeGeometry(leafShape, 6);
  const lp = lg.attributes.position;
  for (let i = 0; i < lp.count; i++) lp.setZ(i, Math.sin(lp.getY(i) * 90) * 0.002 - Math.abs(lp.getX(i)) * 0.4);
  lg.computeVertexNormals();
  const leaf = reg(new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.15, side: THREE.DoubleSide, sheen: 0.5, sheenColor: new THREE.Color('#b8f090') }), 0.8);
  const r = rng(77), im = new THREE.InstancedMesh(lg, leaf, 26), mm = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
  for (let i = 0; i < 26; i++) {
    e.set(-Math.PI / 2 + (r() - 0.5) * 1.6, r() * 6, (r() - 0.5) * 1.4); q.setFromEuler(e);
    mm.compose(new THREE.Vector3(0.04 + (r() - 0.5) * 0.07, 0.008 + r() * 0.025, 0.035 + (r() - 0.5) * 0.06), q, new THREE.Vector3(1, 1, 1).multiplyScalar(0.8 + r() * 0.5));
    im.setMatrixAt(i, mm);
    im.setColorAt(i, col.set(r() < 0.3 ? '#6a1e2a' : '#3f7a24').lerp(new THREE.Color('#2c5a18'), r() * 0.5));
  }
  g.add(im);
  const tom = reg(new THREE.MeshPhysicalMaterial({ color: '#d0260f', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 }), 1);
  const half = new THREE.SphereGeometry(0.012, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const cut = reg(new THREE.MeshPhysicalMaterial({ color: '#e8553a', roughness: 0.3, clearcoat: 0.8, emissive: '#5a0a00', emissiveIntensity: 0.2 }), 0.8);
  [[0.06, 0.06], [0.08, 0.02], [0.02, 0.075], [0.065, -0.01]].forEach(([tx, tz], i) => {
    const t = group(g, [tx, 0.008, tz], [Math.PI / 2 - 0.4 + i * 0.2, i, 0]);
    m(half, tom, { parent: t });
    m(new THREE.CircleGeometry(0.012, 16), cut, { r: [Math.PI / 2, 0, 0], parent: t });
  });
  // herb-butter coin melting on the slices
  m(cyl(0.012, 0.012, 0.004, 20), reg(new THREE.MeshPhysicalMaterial({ color: '#f0d890', roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 }), 0.8), { p: [-0.01, 0.028, -0.005], r: [0.2, 0, -0.3], parent: g });
  F.plated = g;
}
