/* brew · night kitchen — props: the pan, board and knife, hotel pans, bottles and mills,
   shelf crockery and jars, the espresso machine and grinder, pendants, chalk menu,
   pastry-case contents and the Replate stand on the pass. */
import * as THREE from 'three';
import { E } from './engine.js';
import { M, envMats } from './materials.js';
import { L, SET } from './set.js';
import { TX, canvas, tex, rng } from './textures.js';
import { rbox, box, cyl, sph, plane, tor, lathe, m, group } from './kit.js';
import { place, instance } from './assets.js';

export const P = {};

export async function buildProps() {
  const root = group(E.scene);
  root.name = 'props';
  P.root = root;
  pan(root);
  knife(root);
  hotelPans(root);
  condiments(root);
  plate(root);
  shelves(root);
  espresso(root);
  pendants(root);
  chalkMenu(root);
  replateStand(root);
  await Promise.all([
    place('wooden_cutting_board', root, { p: [L.board[0], L.top, L.board[1]], r: [0, 0.12, 0], width: 0.46 }).then((o) => (P.board = o)),
    pastryCase(root),
    shelfModels(),
  ]);
  return root;
}

/* ---------- the cast-iron grill skillet ---------- */
function pan(root) {
  const [bx, bz] = L.burner;
  const g = group(root, [bx, L.top + 0.066, bz]);
  g.userData.noMerge = true;
  const iron = M.iron();
  const prof = [[0, 0], [0.128, 0], [0.135, 0.004], [0.146, 0.04], [0.151, 0.047], [0.149, 0.05], [0.143, 0.047], [0.132, 0.014], [0.124, 0.009], [0, 0.009]];
  m(lathe(prof, 72), iron, { parent: g, cast: true });
  // grill ridges + an oil film that catches the key light
  const ridges = group(g, [0, 0.009, 0], [0, 0.6, 0]);
  for (let i = -5; i <= 5; i++) {
    const half = Math.sqrt(Math.max(0, 0.118 ** 2 - (i * 0.021) ** 2)) - 0.004;
    if (half > 0.01) m(rbox(0.007, 0.006, half * 2, 0.003, 2), iron, { p: [i * 0.021, 0.002, 0], parent: ridges });
  }
  const oil = new THREE.MeshPhysicalMaterial({ color: '#2a1a0c', roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.55, clearcoat: 1, clearcoatRoughness: 0.03, depthWrite: false });
  oil.userData.envBase = oil.envMapIntensity = 1.2; envMats.push(oil);
  m(new THREE.CircleGeometry(0.123, 64), oil, { p: [0, 0.0105, 0], r: [-Math.PI / 2, 0, 0], parent: g }).renderOrder = 1;
  // long handle toward the cook (front-left), helper loop opposite
  const ha = Math.PI * 0.78; // angle in xz plane (0 = +x)
  const hdir = new THREE.Vector3(Math.cos(ha), 0, Math.sin(ha));
  const handle = group(g, [hdir.x * 0.14, 0.04, hdir.z * 0.14], [0, -ha, 0]);
  handle.rotation.z = 0.16;
  const hShape = new THREE.Shape();
  hShape.moveTo(0, -0.011); hShape.lineTo(0.17, -0.008); hShape.quadraticCurveTo(0.2, 0, 0.17, 0.008); hShape.lineTo(0, 0.011); hShape.lineTo(0, -0.011);
  const hole = new THREE.Path(); hole.absarc(0.168, 0, 0.0045, 0, Math.PI * 2, true); hShape.holes.push(hole);
  const hg = new THREE.ExtrudeGeometry(hShape, { depth: 0.012, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 3, curveSegments: 16 });
  hg.translate(0, 0, -0.006); hg.rotateX(Math.PI / 2);
  m(hg, iron, { parent: handle, cast: true });
  const loop = group(g, [-hdir.x * 0.152, 0.042, -hdir.z * 0.152], [0, -ha, 0]);
  m(tor(0.022, 0.006, 10, 24, Math.PI), iron, { r: [Math.PI / 2, 0, Math.PI / 2], parent: loop });
  P.pan = g;
  P.panHandle = handle;
  P.panHandleTip = new THREE.Vector3(hdir.x * 0.3, 0.07, hdir.z * 0.3).add(g.position);
}

/* ---------- chef's knife on the board ---------- */
function knife(root) {
  const g = group(root, [L.board[0] + 0.13, L.top + 0.026, L.board[1] + 0.02], [0, -1.25, 0]);
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(0.2, 0); s.quadraticCurveTo(0.235, 0.004, 0.25, 0.022); s.quadraticCurveTo(0.17, 0.042, 0.0, 0.044); s.lineTo(0, 0);
  const bg = new THREE.ExtrudeGeometry(s, { depth: 0.0018, bevelEnabled: true, bevelSize: 0.0012, bevelThickness: 0.0006, bevelSegments: 2, curveSegments: 20 });
  bg.rotateX(-Math.PI / 2);
  const blade = new THREE.MeshPhysicalMaterial({ color: '#c9ccd1', metalness: 1, roughness: 0.16, anisotropy: 0.6, normalMap: TX.brushed.normal, normalScale: new THREE.Vector2(0.06, 0.06) });
  blade.userData.envBase = blade.envMapIntensity = 1.1; envMats.push(blade);
  m(bg, blade, { parent: g, cast: true });
  const hdl = new THREE.MeshPhysicalMaterial({ color: '#151110', roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2, normalMap: TX.grainN, normalScale: new THREE.Vector2(0.3, 0.3) });
  hdl.userData.envBase = hdl.envMapIntensity = 0.7; envMats.push(hdl);
  m(rbox(0.12, 0.022, 0.016, 0.007, 3), hdl, { p: [-0.062, 0.006, -0.02], parent: g, cast: true });
  m(rbox(0.012, 0.024, 0.018, 0.003), M.steel([0.2, 0.2]), { p: [-0.002, 0.006, -0.02], parent: g });
  for (const x of [-0.03, -0.065, -0.1]) m(cyl(0.0035, 0.0035, 0.018, 12), M.brass(), { p: [x, 0.006, -0.02], r: [0, 0, 0], parent: g });
  P.knife = g;
}

/* ---------- 1/6 hotel pans on the raised step ---------- */
function hotelPans(root) {
  P.bins = [];
  const y = L.top + 0.08, z = L.back + 0.2;
  const steel = M.steel([0.6, 0.6], { color: '#b5b8bd', roughness: 0.26 });
  [0.66, 0.83, 1.0, 1.17].forEach((x, i) => {
    const g = group(root, [x, y, z]);
    // inset body (only the rim and a little depth show)
    m(rbox(0.16, 0.012, 0.17, 0.004), steel, { p: [0, 0.004, 0], parent: g });
    const inner = M.matteBlack();
    m(box(0.14, 0.004, 0.15), inner, { p: [0, 0.008, 0], parent: g });
    P.bins.push({ g, x, y: y + 0.01, z, w: 0.14, d: 0.15 });
  });
}

/* ---------- squeeze bottle, pepper mill, salt cellar ---------- */
function condiments(root) {
  // olive-oil squeeze bottle (no transmission: a tinted, clear-coated shell + liquid core)
  const g = group(root, [1.15, L.top + 0.08, -1.18]);
  const shell = new THREE.MeshPhysicalMaterial({ color: '#f1e7c8', roughness: 0.18, transparent: true, opacity: 0.42, clearcoat: 1, clearcoatRoughness: 0.08, depthWrite: false });
  shell.userData.envBase = shell.envMapIntensity = 1.2; envMats.push(shell);
  const liquid = new THREE.MeshPhysicalMaterial({ color: '#b8860b', emissive: '#3a2400', emissiveIntensity: 0.4, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 });
  liquid.userData.envBase = liquid.envMapIntensity = 0.9; envMats.push(liquid);
  m(lathe([[0, 0], [0.032, 0], [0.034, 0.006], [0.034, 0.15], [0.03, 0.17], [0.012, 0.18], [0, 0.18]], 32), shell, { parent: g }).renderOrder = 2;
  m(lathe([[0, 0.003], [0.03, 0.003], [0.031, 0.008], [0.031, 0.12], [0, 0.12]], 32), liquid, { parent: g });
  m(lathe([[0, 0.17], [0.014, 0.17], [0.014, 0.19], [0.006, 0.2], [0.002, 0.24], [0, 0.24]], 20), M.ceramic('#f4f2ee'), { parent: g });
  // walnut pepper mill
  const pm = group(root, [1.24, L.top + 0.08, -1.36]);
  m(lathe([[0, 0], [0.026, 0], [0.028, 0.02], [0.022, 0.08], [0.026, 0.13], [0.02, 0.16], [0.008, 0.175], [0, 0.178]], 28), M.walnut([0.3, 0.6]), { parent: pm, cast: true });
  m(sph(0.007, 12, 8), M.chrome(), { p: [0, 0.18, 0], parent: pm });
  // flaky salt in a small black bowl
  const sb = group(root, [0.62, L.top + 0.08, -1.37]);
  m(lathe([[0, 0], [0.035, 0], [0.045, 0.03], [0.042, 0.032], [0.03, 0.006], [0, 0.006]], 32), M.ceramic('#1a1a1c'), { parent: sb });
  m(cyl(0.038, 0.038, 0.004, 24), new THREE.MeshStandardMaterial({ color: '#f2efe8', roughness: 0.6 }), { p: [0, 0.024, 0], parent: sb });
}

/* ---------- the finished plate (lower right) ---------- */
function plate(root) {
  const g = group(root, [0.98, L.top, -0.72]);
  g.userData.noMerge = true;
  m(lathe([[0, 0], [0.1, 0], [0.11, 0.004], [0.115, 0.012], [0.145, 0.02], [0.152, 0.022], [0.15, 0.024], [0.12, 0.016], [0.1, 0.012], [0, 0.012]], 64), M.ceramic('#1b1b1d'), { parent: g, cast: true });
  P.plate = g;
}

/* ---------- left shelves: crockery, jars, tins ---------- */
function shelves(root) {
  const x = L.leftWall + 0.17;
  const r = rng(9);
  const plateGeo = lathe([[0, 0], [0.08, 0], [0.09, 0.003], [0.12, 0.014], [0.125, 0.017], [0.12, 0.018], [0.087, 0.008], [0, 0.008]], 40);
  const bowlGeo = lathe([[0, 0], [0.04, 0], [0.07, 0.03], [0.078, 0.06], [0.074, 0.061], [0.064, 0.034], [0.036, 0.008], [0, 0.008]], 36);
  const white = M.ceramic('#ece8e2'), black = M.ceramic('#1c1c1e');
  // stacks: [shelf index, z, count, kind]
  const stacks = [[0, -1.75, 9, 'w'], [0, -1.42, 6, 'b'], [1, -1.7, 7, 'w'], [1, -0.95, 4, 'bowl'], [2, -1.55, 8, 'w'], [0, 0.05, 5, 'b'], [1, 0.1, 6, 'w']];
  const sY = [1.46, 1.86, 2.26];
  stacks.forEach(([si, z, n, k]) => {
    const geo = k === 'bowl' ? bowlGeo : plateGeo, mat = k === 'b' ? black : white;
    const step = k === 'bowl' ? 0.034 : 0.0115;
    const im = new THREE.InstancedMesh(geo, mat, n);
    const mm = new THREE.Matrix4();
    for (let i = 0; i < n; i++) { mm.makeRotationY(r() * 6); mm.setPosition(x + 0.01 + (r() - 0.5) * 0.004, sY[si] + 0.014 + i * step, z + (r() - 0.5) * 0.004); im.setMatrixAt(i, mm); }
    im.castShadow = true; im.receiveShadow = true;
    root.add(im);
  });
  // glass jars with dry goods
  const jarGlass = M.glass('#e8efe9', 0.18);
  const fills = [['#d8b36a', 0.6], ['#c9a46b', 0.75], ['#5a3a22', 0.5], ['#e9dfc7', 0.7], ['#7a2f1d', 0.55], ['#a5864e', 0.8]];
  const jarZs = [[0, -1.05], [0, -0.82], [0, -0.6], [1, -0.4], [1, -0.18], [2, -0.9], [2, -0.65], [2, -0.4]];
  jarZs.forEach(([si, z], i) => {
    const [col, f] = fills[i % fills.length];
    const h = 0.16 + (i % 3) * 0.03, rr = 0.045 + (i % 2) * 0.01;
    const g = group(root, [x + 0.01, sY[si] + 0.014, z]);
    m(lathe([[0, 0], [rr, 0], [rr + 0.002, 0.004], [rr + 0.002, h - 0.02], [rr - 0.012, h - 0.004], [rr - 0.012, h + 0.012], [0, h + 0.012]], 28), jarGlass, { parent: g }).renderOrder = 2;
    m(cyl(rr - 0.004, rr - 0.004, (h - 0.03) * f, 24), new THREE.MeshStandardMaterial({ color: col, roughness: 0.85, normalMap: TX.ironN, normalScale: new THREE.Vector2(1.5, 1.5) }), { p: [0, ((h - 0.03) * f) / 2 + 0.004, 0], parent: g });
    m(cyl(rr - 0.01, rr - 0.01, 0.02, 24), i % 2 ? M.walnut([0.2, 0.2]) : M.blackMetal(), { p: [0, h + 0.016, 0], parent: g });
  });
  // tins
  [[1, -1.25], [1, -1.38], [2, -1.15]].forEach(([si, z], i) => {
    m(cyl(0.04, 0.04, 0.11, 24), i === 1 ? M.brass() : M.darkSteel(), { p: [x, sY[si] + 0.069, z], parent: root });
  });
}
async function shelfModels() {
  const x = L.leftWall + 0.17;
  await Promise.all([
    place('wine_bottles_01', P.root, { p: [x + 0.02, 2.274, -0.15], r: [0, Math.PI / 2, 0], width: 0.42 }),
    place('potted_plant_04', P.root, { p: [x + 0.02, 2.274, -1.98], height: 0.3 }),
    place('ceramic_vase_01', P.root, { p: [x + 0.03, 1.874, -1.3], height: 0.22, tint: '#555' }),
    place('lemon', P.root, { p: [x + 0.04, 1.474, -0.3], height: 0.07 }),
    place('lemon', P.root, { p: [x - 0.02, 1.474, -0.25], height: 0.068, r: [0, 1, 0.3] }),
    place('food_lime_01', P.root, { p: [x + 0.03, 1.474, -0.36], height: 0.055 }),
    place('yellow_onion', P.root, { p: [0.72, L.top + 0.08, -1.55 + 0.1], height: 0.07 }),
    place('metal_jug', P.root, { p: [L.rightWall - 0.42, 0.973, -0.62], height: 0.15 }),
  ]);
}

/* ---------- espresso machine + grinder on the back bar ---------- */
function espresso(root) {
  // on the right end of the pass, turned toward the line
  const x = 1.42, y = L.passTop, z = (L.passZ0 + L.passZ1) / 2 - 0.02;
  const g = group(root, [x, y, z], [0, -0.62, 0]);
  const chrome = M.chrome(), steel = M.steel([0.5, 0.5], { color: '#c4c7cb', roughness: 0.18 }), black = M.lacquer();
  const W = 0.78, H = 0.42, D = 0.52;
  m(rbox(W, 0.1, D, 0.012), black, { p: [0, 0.05, 0], parent: g, cast: true });          // base
  m(rbox(W, H - 0.16, D * 0.72, 0.02), steel, { p: [0, 0.1 + (H - 0.16) / 2, -D * 0.14], parent: g, cast: true }); // body
  m(rbox(W + 0.01, 0.05, D * 0.78, 0.015), chrome, { p: [0, H - 0.04, -D * 0.12], parent: g }); // cup tray lip
  m(rbox(W - 0.06, 0.012, D * 0.7, 0.004), M.blackMetal(), { p: [0, H - 0.008, -D * 0.12], parent: g });
  // drip tray grate
  m(rbox(W - 0.08, 0.018, 0.16, 0.004), chrome, { p: [0, 0.11, D * 0.32], parent: g });
  for (let i = 0; i < 14; i++) m(box(0.004, 0.004, 0.15), M.blackMetal(), { p: [-W / 2 + 0.06 + i * 0.05, 0.121, D * 0.32], parent: g });
  // group heads + portafilters
  [-0.18, 0.18].forEach((gx) => {
    m(cyl(0.045, 0.05, 0.05, 32), chrome, { p: [gx, H - 0.14, D * 0.2], parent: g });
    m(cyl(0.04, 0.036, 0.03, 32), chrome, { p: [gx, H - 0.18, D * 0.22], parent: g });
    const pf = group(g, [gx, H - 0.2, D * 0.22]);
    m(cyl(0.038, 0.034, 0.03, 28), steel, { parent: pf });
    m(rbox(0.026, 0.024, 0.15, 0.011, 3), black, { p: [0, -0.01, 0.1], r: [0.15, 0, 0], parent: pf });
    // a shot glass under the left group
    if (gx < 0) m(lathe([[0, 0], [0.025, 0], [0.03, 0.06], [0.027, 0.06], [0.022, 0.003], [0, 0.003]], 24), M.glass('#ffffff', 0.25), { p: [gx, 0.125, D * 0.22], parent: g });
  });
  // steam wand + hot-water tap
  const wand = group(g, [W / 2 - 0.06, H - 0.12, D * 0.12]);
  m(cyl(0.006, 0.006, 0.24, 12), chrome, { p: [0.03, -0.11, 0.03], r: [0.2, 0, -0.22], parent: wand });
  m(sph(0.012, 16, 12), chrome, { parent: wand });
  // pressure gauges (glowing faces)
  const gaugeTex = (() => { const c = canvas(128), x2 = c.getContext('2d'); x2.fillStyle = '#f3ead8'; x2.beginPath(); x2.arc(64, 64, 62, 0, 7); x2.fill(); x2.strokeStyle = '#222'; x2.lineWidth = 2; for (let i = 0; i < 12; i++) { const a = Math.PI * 0.75 + (i / 11) * Math.PI * 1.5; x2.beginPath(); x2.moveTo(64 + Math.cos(a) * 50, 64 + Math.sin(a) * 50); x2.lineTo(64 + Math.cos(a) * 58, 64 + Math.sin(a) * 58); x2.stroke(); } x2.strokeStyle = '#b5281c'; x2.lineWidth = 3; x2.beginPath(); x2.moveTo(64, 64); x2.lineTo(64 + Math.cos(-0.5) * 46, 64 + Math.sin(-0.5) * 46); x2.stroke(); return tex(c, { wrap: false }); })();
  [-0.06, 0.06].forEach((gx) => {
    m(cyl(0.035, 0.035, 0.012, 32), chrome, { p: [gx, H - 0.09, D * 0.225], r: [Math.PI / 2, 0, 0], parent: g });
    m(new THREE.CircleGeometry(0.03, 32), new THREE.MeshStandardMaterial({ map: gaugeTex, emissive: '#ffd8a0', emissiveMap: gaugeTex, emissiveIntensity: 0.25, roughness: 0.2 }), { p: [gx, H - 0.09, D * 0.232], parent: g });
  });
  // cups warming on top
  const cupGeo = lathe([[0, 0], [0.03, 0], [0.038, 0.012], [0.042, 0.06], [0.039, 0.06], [0.035, 0.014], [0, 0.01]], 28);
  const cupIm = new THREE.InstancedMesh(cupGeo, M.ceramic('#f1ede6'), 10);
  const mm = new THREE.Matrix4();
  for (let i = 0; i < 10; i++) { mm.makeRotationX(Math.PI); mm.setPosition(-0.3 + (i % 5) * 0.15, H + 0.062, -D * 0.22 + Math.floor(i / 5) * 0.11); cupIm.setMatrixAt(i, mm); }
  g.add(cupIm);
  // grinder beside it: black body, clear hopper of beans
  const gr = group(root, [L.rightWall - 0.34, 0.973, -1.12]);
  m(rbox(0.16, 0.36, 0.22, 0.02), black, { p: [0, 0.18, 0], parent: gr, cast: true });
  m(lathe([[0, 0], [0.04, 0], [0.085, 0.18], [0.08, 0.18], [0, 0.005]], 32), M.glass('#f0f0f0', 0.22), { p: [0, 0.36, 0], parent: gr }).renderOrder = 2;
  m(lathe([[0, 0], [0.038, 0], [0.07, 0.12], [0, 0.12]], 28), new THREE.MeshStandardMaterial({ color: '#2b170c', roughness: 0.55, normalMap: TX.ironN, normalScale: new THREE.Vector2(2.5, 2.5) }), { p: [0, 0.362, 0], parent: gr });
  // cups on the walnut shelf above
  const shelfCups = new THREE.InstancedMesh(cupGeo, M.ceramic('#efebe5'), 14);
  for (let i = 0; i < 14; i++) { mm.makeRotationY(i); mm.setPosition(L.rightWall - 0.17 + (i % 2) * 0.05 - 0.03, 1.735, -1.32 + Math.floor(i / 2) * 0.2 + (i % 2) * 0.08); shelfCups.setMatrixAt(i, mm); }
  root.add(shelfCups);
  P.espresso = g;
}

/* ---------- pendants over the pass ---------- */
function pendants(root) {
  P.pendants = [];
  const bulb = M.led('#ffc27a', 22);
  [-0.72, 0.62].forEach((x) => {
    const g = group(root, [x, 2.1, -1.95]);
    m(cyl(0.003, 0.003, L.ceil - 2.1 - 0.16, 6), M.matteBlack(), { p: [0, (L.ceil - 2.1 + 0.16) / 2, 0], parent: g });
    const shade = lathe([[0.02, 0.17], [0.03, 0.15], [0.04, 0.12], [0.11, 0.02], [0.115, 0], [0.11, 0.0], [0.035, 0.115], [0.025, 0.145], [0.016, 0.165]], 48);
    m(shade, M.blackMetal(), { parent: g, cast: false });
    m(tor(0.112, 0.004, 8, 48), M.brass(), { r: [Math.PI / 2, 0, 0], parent: g });
    m(sph(0.03, 20, 14), bulb, { p: [0, 0.04, 0], parent: g });
    P.pendants.push(g);
  });
}

/* ---------- chalk menu on the right wall ---------- */
function chalkMenu(root) {
  const W = 1024, H = 640, c = canvas(W, H), x = c.getContext('2d');
  x.fillStyle = '#16171a'; x.fillRect(0, 0, W, H);
  const n = TX.smudge.image; x.globalAlpha = 0.25; x.drawImage(n, 0, 0, W, H); x.globalAlpha = 1;
  x.fillStyle = 'rgba(240,236,226,0.9)'; x.textAlign = 'left';
  x.font = '500 54px Oswald'; x.fillText('TONIGHT', 60, 96);
  x.font = '300 34px Oswald';
  const items = [['Ribeye, herb butter', '890'], ['Margherita', '540'], ['Penne arrabbiata', '330'], ['Avocado toast', '380'], ['Basque cheesecake', '290'], ['Cappuccino', '220']];
  items.forEach(([n2, p], i) => { x.fillText(n2.toUpperCase(), 60, 170 + i * 66); x.textAlign = 'right'; x.fillText(p, W - 60, 170 + i * 66); x.textAlign = 'left'; });
  x.strokeStyle = 'rgba(240,236,226,0.5)'; x.lineWidth = 2; x.beginPath(); x.moveTo(60, 118); x.lineTo(300, 118); x.stroke();
  const t = tex(c, { wrap: false });
  const g = group(root, SET.menuBoard.pos, [0, -Math.PI / 2, 0]);
  m(rbox(1.22, 0.78, 0.03, 0.006), M.walnut([1, 1]), { parent: g });
  m(plane(1.14, 0.7), new THREE.MeshStandardMaterial({ map: t, roughness: 0.95, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0.06 }), { p: [0, 0, 0.017], parent: g });
}

/* ---------- pastry cabinet contents ---------- */
async function pastryCase() {
  const [x, , z] = SET.caseShelves[0];
  const ys = SET.caseShelves.map((s) => s[1] + 0.008);
  const muffinGeo = lathe([[0, 0], [0.028, 0], [0.032, 0.04], [0.042, 0.048], [0.04, 0.062], [0.02, 0.074], [0, 0.076]], 24);
  const muffin = new THREE.MeshStandardMaterial({ color: '#7a4422', roughness: 0.8, normalMap: TX.ironN, normalScale: new THREE.Vector2(2, 2) });
  const mi = new THREE.InstancedMesh(muffinGeo, muffin, 6);
  const mm = new THREE.Matrix4();
  for (let i = 0; i < 6; i++) { mm.makeRotationY(i * 1.3); mm.setPosition(x - 0.05 + (i % 2) * 0.1, ys[2], z - 0.35 + Math.floor(i / 2) * 0.12); mi.setMatrixAt(i, mm); }
  P.root.add(mi);
  await Promise.all([
    instance('croissant', P.root, [0, 1, 2, 3, 4, 5].map((i) => ({ p: [x - 0.06 + (i % 2) * 0.11, ys[0], z - 0.36 + Math.floor(i / 2) * 0.14], ry: i * 0.9 })), { width: 0.13 }),
    place('carrot_cake', P.root, { p: [x, ys[1], z + 0.2], width: 0.2 }),
    place('strawberry_chocolate_cake', P.root, { p: [x, ys[1], z - 0.22], width: 0.2 }),
    instance('croissant', P.root, [0, 1, 2].map((i) => ({ p: [x - 0.04 + (i % 2) * 0.08, ys[2], z + 0.2 + i * 0.07], ry: i * 2 })), { width: 0.12 }),
  ]);
}

/* ---------- Replate stand: discounted pre-made food, tagged, on the pass ---------- */
function replateStand(root) {
  const g = group(root, [0.82, L.passTop, -1.84], [0, -0.25, 0]);
  m(rbox(0.3, 0.012, 0.2, 0.004), M.walnut([0.4, 0.3]), { p: [0, 0.006, 0], parent: g });
  // kraft boxes with green bands
  const kraft = new THREE.MeshStandardMaterial({ color: '#b48a5a', roughness: 0.9, normalMap: TX.grainN });
  const band = new THREE.MeshStandardMaterial({ color: '#2f6b4a', roughness: 0.7 });
  [[-0.07, 0], [0.07, 0]].forEach(([bx], i) => {
    m(rbox(0.12, 0.055, 0.12, 0.005), kraft, { p: [bx, 0.04, 0], parent: g, cast: true });
    m(box(0.121, 0.012, 0.121), band, { p: [bx, 0.042, 0], parent: g });
  });
  // tag card
  const c = canvas(256, 128), x = c.getContext('2d');
  x.fillStyle = '#f1ece2'; x.fillRect(0, 0, 256, 128);
  x.fillStyle = '#2f6b4a'; x.fillRect(0, 0, 256, 34);
  x.fillStyle = '#fff'; x.font = '600 22px Inter'; x.fillText('REPLATE', 14, 25);
  x.fillStyle = '#1c1c1c'; x.font = '700 40px Inter'; x.fillText('−30%', 14, 82);
  x.font = '500 16px Inter'; x.fillStyle = '#555'; x.fillText('made 7:10 · use by 10', 14, 112);
  const tag = group(g, [0, 0.0, 0.11]);
  m(plane(0.09, 0.045), new THREE.MeshStandardMaterial({ map: tex(c, { wrap: false }), roughness: 0.8, emissive: '#fff', emissiveMap: tex(c, { wrap: false }), emissiveIntensity: 0.03 }), { p: [0, 0.045, 0], r: [-0.35, 0, 0], parent: tag });
  m(rbox(0.012, 0.03, 0.01, 0.002), M.brass(), { p: [0, 0.015, -0.01], parent: tag });
  P.replate = g;
  P.replateTag = { canvas: c, ctx: x };
}
