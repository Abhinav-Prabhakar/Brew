/* brew · night kitchen — the static set: the steel line, the pass, shelving, the back bar,
   and the dining room shell (floors, walls, coffered ceiling, mullioned windows, sign, city). */
import * as THREE from 'three';
import { E } from './engine.js';
import { M } from './materials.js';
import { TX, signTexture } from './textures.js';
import { rbox, box, cyl, plane, m, group } from './kit.js';

/* layout (metres; −z looks from the line into the dining room) */
export const L = {
  eye: [0, 1.42, 0.0],
  look: [0.03, 1.04, -2.4],
  top: 0.92,                   // worktop height
  front: -0.42, back: -1.48,   // worktop depth
  burner: [-0.17, -1.1],       // x, z of the gas burner
  board: [0.46, -1.04],
  passTop: 1.1, passZ0: -1.62, passZ1: -2.16,
  leftWall: -1.06, rightWall: 1.95, openR: 3.4, // kitchen walls; the room opening runs to openR
  ceil: 2.72,
  din: { x0: -5.6, x1: 5.6, z0: -2.3, z1: -12, h: 3.7 },
};

export const SET = { practicals: [], windows: [] };

export function buildSet() {
  const root = group(E.scene);
  root.name = 'set';
  SET.root = root;
  kitchenLine(root);
  pass(root);
  leftWall(root);
  backBar(root);
  kitchenShell(root);
  dining(root);
  return root;
}

/* ------------------------------------------------------------------ */
function kitchenLine(root) {
  const g = group(root);
  const { top, front, back } = L;
  const steel = M.counter(), dark = M.darkSteel(), lacq = M.lacquer();
  const x0 = L.leftWall, x1 = L.rightWall - 0.62, d = back - front;
  // worktop slab with a rolled front edge
  m(rbox(x1 - x0, 0.04, -d, 0.006), steel, { p: [(x0 + x1) / 2, top - 0.02, (front + back) / 2], parent: g, recv: true });
  m(cyl(0.022, 0.022, x1 - x0, 20), steel, { p: [(x0 + x1) / 2, top - 0.012, front + 0.004], r: [0, 0, Math.PI / 2], parent: g });
  // apron + lacquer doors below
  m(rbox(x1 - x0, 0.16, 0.02, 0.004), dark, { p: [(x0 + x1) / 2, top - 0.11, front + 0.01], parent: g });
  m(box(x1 - x0, top - 0.2, 0.6), lacq, { p: [(x0 + x1) / 2, (top - 0.2) / 2, front - 0.3], parent: g });

  // gas range inset: drip tray, burner, cast-iron grate
  const [bx, bz] = L.burner;
  const tray = M.blackMetal(), iron = M.iron();
  m(rbox(0.62, 0.012, 0.6, 0.004), tray, { p: [bx, top + 0.002, bz], parent: g });
  m(cyl(0.085, 0.095, 0.03, 40), iron, { p: [bx, top + 0.018, bz], parent: g, cast: true });
  m(cyl(0.05, 0.05, 0.012, 32), M.brass(), { p: [bx, top + 0.036, bz], parent: g });
  // grate: four arms + outer ring
  const gr = group(g, [bx, top + 0.055, bz]);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    m(rbox(0.26, 0.018, 0.016, 0.004), iron, { p: [Math.cos(a) * 0.15, 0, Math.sin(a) * 0.15], r: [0, -a, 0], parent: gr, cast: true });
  }
  m(rbox(0.6, 0.02, 0.02, 0.004), iron, { p: [0, -0.005, 0.29], parent: gr });
  m(rbox(0.6, 0.02, 0.02, 0.004), iron, { p: [0, -0.005, -0.29], parent: gr });
  m(rbox(0.02, 0.02, 0.6, 0.004), iron, { p: [0.29, -0.005, 0], parent: gr });
  m(rbox(0.02, 0.02, 0.6, 0.004), iron, { p: [-0.29, -0.005, 0], parent: gr });
  // control knobs on the apron
  for (let i = 0; i < 3; i++) {
    const k = m(cyl(0.022, 0.024, 0.026, 28), M.blackMetal(), { p: [bx - 0.16 + i * 0.16, top - 0.1, front + 0.035], r: [Math.PI / 2, 0, 0], parent: g });
    m(rbox(0.006, 0.03, 0.012, 0.002), M.chrome(), { p: [0, -0.014, 0], parent: k });
  }
  // raised mise-en-place step on the right
  m(rbox(0.7, 0.08, 0.36, 0.008), steel, { p: [0.92, top + 0.04, back + 0.2], parent: g });
  // back splash between worktop and pass
  m(rbox(x1 - x0, L.passTop - top + 0.02, 0.025, 0.004), dark, { p: [(x0 + x1) / 2, (L.passTop + top) / 2, back - 0.012], parent: g });
  // left return along the wall (tablet lives here)
  m(rbox(0.42, 0.04, 1.0, 0.006), steel, { p: [L.leftWall + 0.21, top - 0.02, 0.05], parent: g });
  m(box(0.42, top - 0.04, 1.0), lacq, { p: [L.leftWall + 0.21, (top - 0.04) / 2, 0.05], parent: g });
  SET.line = g;
}

/* the pass: the dining-side counter where finished plates wait */
function pass(root) {
  const g = group(root);
  const z0 = L.passZ0, z1 = L.passZ1, t = L.passTop;
  const px0 = L.leftWall, px1 = L.rightWall, pw = px1 - px0, pcx = (px0 + px1) / 2;
  m(rbox(pw, 0.05, z0 - z1, 0.01), M.steel([2.5, 1], { color: '#7d8186', roughness: 0.26, aniso: 0.8, env: 0.9 }), { p: [pcx, t - 0.025, (z0 + z1) / 2], parent: g });
  m(box(pw, t - 0.05, 0.5), M.lacquer(), { p: [pcx, (t - 0.05) / 2, z1 + 0.25], parent: g });
  // dining-side kick and brass foot rail
  m(cyl(0.018, 0.018, pw - 0.1, 20), M.brass(), { p: [pcx, 0.22, z1 - 0.16], r: [0, 0, Math.PI / 2], parent: g });
  for (const x of [px0 + 0.2, pcx, px1 - 0.2]) m(cyl(0.012, 0.012, 0.16, 12), M.brass(), { p: [x, 0.22, z1 - 0.08], r: [Math.PI / 2, 0, 0], parent: g });
  // warm LED washing down the dining face of the pass
  m(box(pw - 0.1, 0.012, 0.012), M.led('#ffae5c', 5), { p: [pcx, t - 0.06, z1 - 0.012], parent: g });
  SET.pass = g;
}

/* left wall: dark tile, open black-steel shelving with under-shelf LEDs */
function leftWall(root) {
  const g = group(root);
  const x = L.leftWall;
  m(plane(3.2, 1.0), M.tile([3, 1]), { p: [x, L.top + 0.5, -0.6], r: [0, Math.PI / 2, 0], parent: g });
  m(plane(3.2, L.ceil - 1.42), M.plaster([3, 1.5], '#24211e'), { p: [x - 0.001, 1.42 + (L.ceil - 1.42) / 2, -0.6], r: [0, Math.PI / 2, 0], parent: g });
  m(plane(3.2, L.top), M.matteBlack(), { p: [x, L.top / 2, -0.6], r: [0, Math.PI / 2, 0], parent: g });
  const shelves = [1.46, 1.86, 2.26];
  SET.shelves = [];
  shelves.forEach((y, i) => {
    const s = group(g, [x + 0.17, y, -0.75]);
    m(rbox(0.34, 0.028, 2.4, 0.004), M.blackMetal(), { parent: s, cast: true });
    m(box(0.008, 0.006, 2.36), M.led('#ffb46a', 2.6), { p: [0.155, -0.018, 0], parent: s });
    // brackets
    for (const z of [-1.0, 0, 1.0]) m(rbox(0.3, 0.05, 0.012, 0.002), M.blackMetal(), { p: [-0.02, -0.035, z], parent: s });
    SET.shelves.push(s);
    SET.practicals.push({ kind: 'shelf', pos: [x + 0.32, y - 0.03, -0.75], len: 2.36, i });
  });
}

/* right side: a low back counter (grinder, jug, cups) and, just past the pass on a short
   return wall, the tall glowing pastry cabinet under the chalk menu */
function backBar(root) {
  const g = group(root);
  const x = L.rightWall;
  m(rbox(0.62, 0.045, 1.8, 0.008), M.counter(), { p: [x - 0.32, 0.95, -0.55], parent: g });
  m(box(0.58, 0.93, 1.8), M.lacquer(), { p: [x - 0.32, 0.465, -0.55], parent: g });
  m(plane(3.0, L.ceil), M.plaster([3, 2], '#211e1b'), { p: [x, L.ceil / 2, -0.8], r: [0, -Math.PI / 2, 0], parent: g });
  m(plane(1.8, 0.75), M.tile([1.8, 0.75]), { p: [x - 0.002, 0.97 + 0.375, -0.55], r: [0, -Math.PI / 2, 0], parent: g });
  // open walnut shelf with cups
  const sh = group(g, [x - 0.15, 1.72, -0.6]);
  m(rbox(0.28, 0.03, 1.6, 0.004), M.walnut([1, 4]), { parent: sh, cast: true });
  m(box(0.01, 0.008, 1.56), M.led('#ffb46a', 5), { p: [-0.13, -0.018, 0], parent: sh });
  SET.cupShelf = sh;

  // return wall at the right edge of the room opening
  const D = L.din, rx = L.openR;
  m(plane(1.6, D.h), M.plaster([1.5, 3], '#1d1a17'), { p: [rx, D.h / 2, D.z0 - 0.8], r: [0, -Math.PI / 2, 0], parent: g });
  // tall pastry cabinet against it, glass facing the line
  const cab = group(g, [rx - 0.32, 0, D.z0 - 0.78]);
  const cw = 0.62, cd = 1.1, ch = 2.15;
  m(rbox(cw, 0.06, cd, 0.006), M.blackMetal(), { p: [0, ch, 0], parent: cab });
  m(rbox(cw, 0.9, cd, 0.006), M.lacquer(), { p: [0, 0.45, 0], parent: cab });
  m(plane(cd, ch - 0.9), M.emissive('#ffcf98', 0.22, '#16110c'), { p: [cw / 2 - 0.02, 0.9 + (ch - 0.9) / 2, 0], r: [0, -Math.PI / 2, 0], parent: cab });
  for (const zz of [-cd / 2, cd / 2]) m(rbox(cw, ch - 0.9, 0.025, 0.004), M.blackMetal(), { p: [0, 0.9 + (ch - 0.9) / 2, zz], parent: cab });
  SET.caseShelves = [];
  [1.04, 1.4, 1.76].forEach((y) => {
    m(rbox(cw - 0.08, 0.012, cd - 0.06, 0.003), M.glass('#ffffff', 0.35), { p: [0, y, 0], parent: cab });
    m(box(0.01, 0.006, cd - 0.08), M.led('#ffd9a8', 6), { p: [-cw / 2 + 0.06, y + 0.33, 0], parent: cab });
    SET.caseShelves.push([rx - 0.32, y, D.z0 - 0.78]);
  });
  m(plane(cd - 0.04, ch - 0.92), M.glass('#ffffff', 0.08), { p: [-cw / 2 + 0.01, 0.9 + (ch - 0.92) / 2, 0], r: [0, -Math.PI / 2, 0], parent: cab });
  SET.practicals.push({ kind: 'case', pos: [rx - 0.4, 1.5, D.z0 - 0.78] });
  SET.cabinet = cab;
  SET.menuBoard = { pos: [rx - 0.02, 2.62, D.z0 - 0.78] };
}

/* kitchen ceiling, floor and the bulkhead that frames the dining room */
function kitchenShell(root) {
  const g = group(root);
  const kx = (L.leftWall + L.rightWall) / 2, kw = L.rightWall - L.leftWall;
  m(plane(kw, 3.0), M.concrete([3, 2]), { p: [kx, 0, -0.9], r: [-Math.PI / 2, 0, 0], parent: g });
  m(plane(kw, 3.6), M.plaster([3, 3], '#141312'), { p: [kx, L.ceil, -0.6], r: [Math.PI / 2, 0, 0], parent: g });
  // linear LED channels running into the room
  for (const x of [L.leftWall + 0.32, L.rightWall - 0.3]) {
    m(rbox(0.07, 0.04, 3.2, 0.006), M.blackMetal(), { p: [x, L.ceil - 0.02, -0.7], parent: g });
    m(box(0.016, 0.004, 3.1), M.led('#ffbf80', 3.2), { p: [x, L.ceil - 0.042, -0.7], parent: g });
  }
  // bulkhead over the pass
  const bz = L.passZ1 - 0.2;
  const bx0 = L.leftWall, bx1 = L.openR, bcx = (bx0 + bx1) / 2;
  m(rbox(bx1 - bx0, L.ceil + 0.3 - 2.42, 0.4, 0.01), M.matteBlack(), { p: [bcx, (L.ceil + 0.3 + 2.42) / 2, bz], parent: g });
  m(box(bx1 - bx0 - 0.1, 0.01, 0.014), M.led('#ffb26a', 5), { p: [bcx, 2.415, bz + 0.19], parent: g });
  SET.practicals.push({ kind: 'strip', pos: [bcx, 2.4, bz + 0.2], len: bx1 - bx0 });
  // the dining room's front wall, open where the kitchen looks through
  const D = L.din, fw = M.plaster([2, 2], '#1b1815'), zf = D.z0 + 0.001;
  const front = group(g, [0, 0, zf], [0, Math.PI, 0]);
  const piece = (xa, xb, ya, yb) => m(plane(xb - xa, yb - ya), fw, { p: [-(xa + xb) / 2, (ya + yb) / 2, 0], parent: front });
  piece(D.x0, L.leftWall, 0, D.h);
  piece(L.openR, D.x1, 0, D.h);
  piece(L.leftWall, L.openR, 2.42, D.h);
}

/* ------------------------------------------------------------------ */
/* dining room shell                                                   */
/* ------------------------------------------------------------------ */
function dining(root) {
  const g = group(root);
  const D = L.din, w = D.x1 - D.x0, dep = D.z0 - D.z1, cx = (D.x0 + D.x1) / 2, cz = (D.z0 + D.z1) / 2;
  m(plane(w, dep), M.parquet([w / 1.4, dep / 1.4]), { p: [cx, 0, cz], r: [-Math.PI / 2, 0, 0], parent: g });
  // ceiling + coffers with LED edges
  m(plane(w, dep), M.plaster([4, 4], '#0f0e0d'), { p: [cx, D.h, cz], r: [Math.PI / 2, 0, 0], parent: g });
  const beam = M.matteBlack(), led = M.led('#ffb468', 3.5);
  for (let x = D.x0 + 2.2; x < D.x1 - 0.5; x += 2.25) {
    m(box(0.22, 0.26, dep), beam, { p: [x, D.h - 0.13, cz], parent: g });
    m(box(0.012, 0.012, dep - 0.2), led, { p: [x - 0.115, D.h - 0.25, cz], parent: g });
    m(box(0.012, 0.012, dep - 0.2), led, { p: [x + 0.115, D.h - 0.25, cz], parent: g });
  }
  for (let z = D.z0 - 2.4; z > D.z1 + 0.5; z -= 2.4) m(box(w, 0.26, 0.22), beam, { p: [cx, D.h - 0.13, z], parent: g });

  const wall = M.plaster([4, 2], '#1b1815');
  const wains = M.darkWood([4, 0.5]);
  // back wall: windows flanking a dark panel with the backlit sign
  const back = group(g, [0, 0, D.z1]);
  const winXs = [-4.35, -2.25, 2.25, 4.35];
  const ww = 1.8, wh = 2.9, sill = 0.55;
  // solid wall pieces around the openings
  wallWithOpenings(back, D.x0, D.x1, D.h, winXs.map((x) => [x - ww / 2, x + ww / 2]), sill, sill + wh, wall);
  winXs.forEach((x) => windowUnit(back, x, sill, ww, wh, 0));
  // pillars between windows
  for (const x of [-5.4, -3.3, -1.2, 1.2, 3.3, 5.4]) m(rbox(0.36, D.h, 0.36, 0.01), M.matteBlack(), { p: [x, D.h / 2, 0.16], parent: back });
  // sign panel
  const sp = group(back, [0, 2.15, 0.06]);
  m(rbox(2.6, 1.4, 0.06, 0.01), M.lacquer(), { parent: sp });
  const st = signTexture(['SLOW FOOD', 'LATE NIGHTS']);
  const sign = m(plane(2.3, 1.15), new THREE.MeshBasicMaterial({ map: st, color: new THREE.Color(2.4, 2.4, 2.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), { p: [0, 0, 0.035], parent: sp, recv: false });
  sign.renderOrder = 2;
  SET.sign = sign;
  SET.practicals.push({ kind: 'sign', pos: [0, 2.15, D.z1 + 0.5] });
  // wainscot on the back wall
  m(box(w, 0.9, 0.04), wains, { p: [cx, 0.45, 0.04], parent: back });

  // side walls with tall windows toward the back
  [[D.x0, 1], [D.x1, -1]].forEach(([x, s]) => {
    const side = group(g, [x, 0, 0], [0, (s * Math.PI) / 2, 0]);
    const zs = [-6.2, -8.6, -10.8];
    // local x runs along −z for the left wall (rotated +90°), along +z for the right
    const toLocal = (z) => -s * z;
    const spans = zs.map((z) => [toLocal(z) - ww / 2, toLocal(z) + ww / 2]).sort((a, b) => a[0] - b[0]);
    const [lx0, lx1] = [Math.min(toLocal(D.z0), toLocal(D.z1)), Math.max(toLocal(D.z0), toLocal(D.z1))];
    wallWithOpenings(side, lx0, lx1, D.h, spans, sill, sill + wh, wall);
    zs.forEach((z) => windowUnit(side, toLocal(z), sill, ww, wh, 0));
    m(box(lx1 - lx0, 0.9, 0.04), wains, { p: [(lx0 + lx1) / 2, 0.45, 0.04], parent: side });
  });

  // the city: big defocused planes outside each wall of glass
  const cityMat = new THREE.MeshBasicMaterial({ map: TX.city, color: new THREE.Color(1.15, 1.1, 1.05), fog: false });
  m(plane(26, 10), cityMat, { p: [0, 2.6, D.z1 - 3.5], parent: g, recv: false });
  const cityL = TX.city.clone(); cityL.offset.x = 0.37; cityL.needsUpdate = true;
  const cityR = TX.city.clone(); cityR.offset.x = 0.71; cityR.needsUpdate = true;
  m(plane(16, 10), new THREE.MeshBasicMaterial({ map: cityL, color: cityMat.color, fog: false }), { p: [D.x0 - 3.5, 2.6, -8], r: [0, Math.PI / 2, 0], parent: g, recv: false });
  m(plane(16, 10), new THREE.MeshBasicMaterial({ map: cityR, color: cityMat.color, fog: false }), { p: [D.x1 + 3.5, 2.6, -8], r: [0, -Math.PI / 2, 0], parent: g, recv: false });
  SET.dining = g;
}

/** a wall plane with rectangular window openings, built from strips */
function wallWithOpenings(parent, x0, x1, h, spans, y0, y1, mat) {
  let cur = x0;
  const piece = (a, b, ya, yb) => { if (b - a > 0.001 && yb - ya > 0.001) m(plane(b - a, yb - ya), mat, { p: [(a + b) / 2, (ya + yb) / 2, 0], parent }); };
  for (const [a, b] of spans) {
    piece(cur, a, 0, h);
    piece(a, b, 0, y0);
    piece(a, b, y1, h);
    cur = b;
  }
  piece(cur, x1, 0, h);
}

/** steel-framed mullioned window: frame, grid, glass and a sill */
function windowUnit(parent, x, sill, w, h, z) {
  const g = group(parent, [x, sill, z]);
  const fm = M.blackMetal();
  const t = 0.05;
  m(box(w, t, 0.08), fm, { p: [0, 0, 0], parent: g });
  m(box(w, t, 0.08), fm, { p: [0, h, 0], parent: g });
  m(box(t, h, 0.08), fm, { p: [-w / 2, h / 2, 0], parent: g });
  m(box(t, h, 0.08), fm, { p: [w / 2, h / 2, 0], parent: g });
  for (let i = 1; i < 3; i++) m(box(0.022, h, 0.04), fm, { p: [-w / 2 + (w * i) / 3, h / 2, 0], parent: g });
  for (let j = 1; j < 5; j++) m(box(w, 0.022, 0.04), fm, { p: [0, (h * j) / 5, 0], parent: g });
  m(plane(w, h), M.windowGlass(), { p: [0, h / 2, -0.01], parent: g, recv: false });
  m(rbox(w + 0.12, 0.04, 0.22, 0.006), M.darkWood([1, 0.2]), { p: [0, -0.02, 0.08], parent: g });
  SET.windows.push(g);
}
