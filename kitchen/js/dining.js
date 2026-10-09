/* brew · night kitchen — the dining room: instanced tables and chairs, cordless table lamps
   with fake light pools, a leather banquette, plants, pendants, and seated diners who
   breathe, turn and sip. Everything out here is defocused, so it is built for silhouette
   and glow rather than detail. */
import * as THREE from 'three';
import { E } from './engine.js';
import { M, envMats } from './materials.js';
import { L } from './set.js';
import { TX, rng } from './textures.js';
import { rbox, box, cyl, sph, plane, lathe, m, group } from './kit.js';
import { place, instance } from './assets.js';

export const DIN = { people: [], lamps: [] };

/* [x, z, seats] — seats are angles around the table (radians, 0 = +z) */
const TABLES = [
  [-3.6, -4.4, [0, Math.PI]], [-1.2, -4.9, [Math.PI / 2, -Math.PI / 2]], [1.5, -4.6, [0, Math.PI]], [3.9, -4.4, [0.3, Math.PI + 0.3]],
  [-2.6, -7.0, [0, Math.PI]], [0.2, -7.3, [Math.PI / 2, -Math.PI / 2, 0]], [2.8, -7.1, [0, Math.PI]],
  [-3.9, -9.6, [0, Math.PI]], [-1.1, -10.0, [0.4, Math.PI + 0.4]], [1.6, -9.8, [0, Math.PI]], [4.2, -9.7, [Math.PI / 2, -Math.PI / 2]],
];
/* which seats are taken: [table index, seat index, look] */
const DINERS = [[0, 0], [0, 1], [2, 1], [3, 0], [4, 0], [4, 1], [5, 2], [6, 1], [7, 0], [8, 0], [8, 1], [9, 1], [10, 0]];

export async function buildDining() {
  const g = group(E.scene);
  g.name = 'dining';
  DIN.root = g;
  const r = rng(17);

  // tables & chairs (instanced: one draw call per mesh of each model)
  const chairs = [];
  TABLES.forEach(([x, z, seats]) => seats.forEach((a) => chairs.push({ p: [x + Math.sin(a) * 0.58, 0, z + Math.cos(a) * 0.58], ry: a + Math.PI + (r() - 0.5) * 0.2 })));
  await Promise.all([
    instance('round_wooden_table_02', g, TABLES.map(([x, z]) => ({ p: [x, 0, z], ry: r() * 6 })), { height: 0.75 }),
    instance('dining_chair_02', g, chairs, { height: 0.88 }),
  ]);
  DIN.chairs = chairs;

  // table lamps + warm pools on tabletops and floor
  TABLES.forEach(([x, z], i) => tableLamp(g, x + 0.12, z - 0.1, i));
  // place settings: a glass and a plate or two per table
  TABLES.forEach(([x, z, seats]) => seats.forEach((a, k) => {
    const px = x + Math.sin(a) * 0.24, pz = z + Math.cos(a) * 0.24;
    m(lathe([[0, 0], [0.09, 0], [0.11, 0.012], [0.105, 0.014], [0, 0.008]], 24), M.ceramic('#ebe6de'), { p: [px, 0.752, pz], parent: g });
    if (k % 2 === 0) m(lathe([[0, 0], [0.03, 0], [0.032, 0.002], [0.004, 0.006], [0.004, 0.1], [0.035, 0.13], [0.04, 0.2], [0.036, 0.2], [0, 0.135]], 16), M.glass('#fff', 0.2), { p: [px + 0.12, 0.752, pz - 0.05], parent: g }).renderOrder = 2;
  }));

  banquette(g);
  diners(g, r);
  await plants(g);
  await pendants(g);
  // one gentle frame hook for everyone out there
  E.onFrame((dt, t) => animate(dt, t));
  return g;
}

/* cordless brass mushroom lamp */
const shadeGeo = lathe([[0, 0.25], [0.06, 0.245], [0.1, 0.225], [0.115, 0.205], [0.112, 0.2], [0.07, 0.21], [0, 0.215]], 32);
function tableLamp(g, x, z, i) {
  const lg = group(g, [x, 0.752, z]);
  m(cyl(0.05, 0.055, 0.012, 24), M.brass(), { parent: lg });
  m(cyl(0.008, 0.008, 0.2, 10), M.brass(), { p: [0, 0.1, 0], parent: lg });
  m(shadeGeo, M.brass(), { parent: lg });
  m(new THREE.CircleGeometry(0.068, 24), M.led('#ffb873', 9), { p: [0, 0.207, 0], r: [Math.PI / 2, 0, 0], parent: lg });
  // halo + pools (additive decals: cheap, and they read as light through the bokeh)
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.glow, color: new THREE.Color('#ff9c48').multiplyScalar(0.55), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  halo.scale.set(0.5, 0.5, 1); halo.position.set(0, 0.2, 0); lg.add(halo);
  pool(g, x, 0.756, z, 0.95, '#ff9f55', 0.5);
  pool(g, x, 0.004, z, 2.4, '#ff8e3c', 0.16);
  DIN.lamps.push({ lg, halo, phase: i * 1.7 });
}
export function pool(parent, x, y, z, size, color, k) {
  const mat = new THREE.MeshBasicMaterial({ map: TX.glow, color: new THREE.Color(color).multiplyScalar(k), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 });
  const p = m(plane(size, size), mat, { p: [x, y, z], r: [-Math.PI / 2, 0, 0], parent, recv: false });
  p.renderOrder = 1;
  return p;
}

/* leather banquette along the left wall */
function banquette(g) {
  const x = L.din.x0 + 0.35, z0 = -3.4, z1 = -11.2, len = z0 - z1, cz = (z0 + z1) / 2;
  const leather = M.leather([len / 1.2, 1]);
  m(rbox(0.6, 0.42, len, 0.04), M.darkWood([len / 1.5, 0.3]), { p: [x, 0.21, cz], parent: g });
  m(rbox(0.56, 0.1, len - 0.04, 0.045, 4), leather, { p: [x, 0.47, cz], parent: g });
  m(rbox(0.16, 0.62, len - 0.04, 0.06, 4), leather, { p: [x - 0.24, 0.8, cz], r: [0, 0, 0.08], parent: g });
}

/* seated diners: low-poly but well-proportioned silhouettes */
const CLOTH = ['#1d1f24', '#2b2320', '#3a2b25', '#1b2433', '#6b5a45', '#262626', '#4a2a26', '#d8d0c2'];
const SKIN = ['#8d5a3f', '#c58e6b', '#e0b493', '#6b4330', '#a8714f'];
const HAIR = ['#0f0c0a', '#2a1c14', '#3b2a1e', '#151515', '#5a3d27'];
function diners(g, r) {
  const torsoG = new THREE.CapsuleGeometry(0.15, 0.26, 4, 10);
  const armG = new THREE.CapsuleGeometry(0.045, 0.24, 3, 8);
  const headG = new THREE.SphereGeometry(0.095, 14, 10);
  const hairG = new THREE.SphereGeometry(0.1, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const legG = new THREE.CapsuleGeometry(0.06, 0.32, 3, 8);
  const mats = new Map();
  const mat = (c, rough = 0.85) => mats.get(c + rough) || (mats.set(c + rough, (() => { const mm = new THREE.MeshStandardMaterial({ color: c, roughness: rough }); mm.userData.envBase = mm.envMapIntensity = 0.5; envMats.push(mm); return mm; })()), mats.get(c + rough));
  DINERS.forEach(([ti, si], n) => {
    const [x, z, seats] = TABLES[ti];
    const a = seats[si];
    const px = x + Math.sin(a) * 0.62, pz = z + Math.cos(a) * 0.62;
    const p = group(g, [px, 0.47, pz], [0, a + Math.PI, 0]);
    p.userData.noMerge = true;
    const cloth = mat(CLOTH[(n * 3) % CLOTH.length]), skin = mat(SKIN[(n * 7) % SKIN.length], 0.6), hair = mat(HAIR[n % HAIR.length], 0.7);
    const torso = m(torsoG, cloth, { p: [0, 0.32, 0.02], parent: p, cast: false });
    torso.scale.set(1.05, 1, 0.72);
    const neck = group(p, [0, 0.62, 0.05]);
    const head = group(neck, [0, 0.11, 0]);
    m(headG, skin, { s: [0.92, 1.08, 1], parent: head });
    m(hairG, hair, { p: [0, 0.015, -0.01], s: [0.98, 1.05, 1.05], parent: head });
    // arms: upper arms down, forearms forward onto the table
    const arms = [];
    [-1, 1].forEach((sx) => {
      const sh = group(p, [sx * 0.17, 0.5, 0.03]);
      m(armG, cloth, { p: [0, -0.13, 0.02], r: [0.25, 0, sx * 0.08], parent: sh });
      const el = group(sh, [0, -0.25, 0.08]);
      m(armG, cloth, { p: [0, 0, 0.14], r: [Math.PI / 2 - 0.15, 0, 0], parent: el });
      m(sph(0.04, 12, 10), skin, { p: [0, 0.02, 0.29], parent: el });
      arms.push({ sh, el });
    });
    // legs under the table
    [-1, 1].forEach((sx) => m(legG, mat('#141414'), { p: [sx * 0.09, 0.0, 0.2], r: [Math.PI / 2, 0, 0], parent: p }));
    DIN.people.push({ p, head, neck, arms, phase: r() * 10, talk: r() < 0.5, sip: r() < 0.4, nextSip: 3 + r() * 10 });
  });
}

async function plants(g) {
  const D = L.din;
  await Promise.all([
    place('pachira_aquatica_01', g, { p: [-5.0, 0, -11.3], height: 2.1 }),
    place('pachira_aquatica_01', g, { p: [5.1, 0, -11.2], r: [0, 2, 0], height: 1.9 }),
    place('potted_plant_02', g, { p: [1.7, 0, -11.5], height: 1.1 }),
    place('potted_plant_02', g, { p: [5.15, 0, -3.0], r: [0, 1.2, 0], height: 1.3 }),
    place('calathea_orbifolia_01', g, { p: [-5.15, 0.0, -2.9], height: 0.9 }),
    place('fern_02', g, { p: [2.9, 0.0, -11.5], height: 0.7 }),
    place('anthurium_botany_01', g, { p: [-2.9, 0.0, -11.55], height: 0.8 }),
  ]);
}

async function pendants(g) {
  const list = [];
  TABLES.forEach(([x, z], i) => { if (i % 2 === 0) list.push({ p: [x, L.din.h - 0.9, z], ry: i }); });
  const ims = await instance('hanging_industrial_lamp', g, list, { height: 0.9 });
  // darken the model to a black-and-brass pendant
  ims.forEach((im) => { im.material = im.material.clone(); im.material.color.set('#1a1816'); im.material.metalness = 0.6; im.material.roughness = 0.62; im.material.userData.envBase = 0.8; envMats.push(im.material); });
  // a warm glow at each bulb (the model's bulb sits ~ at the bottom of the shade)
  list.forEach(({ p }) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.glow, color: new THREE.Color('#ffa758').multiplyScalar(0.9), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.scale.set(0.55, 0.55, 1);
    s.position.set(p[0], p[1] + 0.06, p[2]);
    g.add(s);
    pool(g, p[0], 0.757, p[2] + 0.05, 1.2, '#ffa050', 0.22);
  });
}

function animate(dt, t) {
  for (const d of DIN.people) {
    const k = t + d.phase;
    d.p.position.y = 0.47 + Math.sin(k * 1.4) * 0.003;
    d.neck.rotation.y = Math.sin(k * 0.35) * (d.talk ? 0.45 : 0.2);
    d.neck.rotation.x = 0.12 + Math.sin(k * 0.6) * 0.06 + (d.talk ? Math.max(0, Math.sin(k * 3.1)) * 0.04 : 0);
    if (d.sip) {
      d.nextSip -= dt;
      const arm = d.arms[1];
      if (d.nextSip < 0) {
        const s = Math.min(1, -d.nextSip / 1.2), e = d.nextSip < -4 ? Math.max(0, 1 + (d.nextSip + 4) / 1.2) : s;
        arm.el.rotation.x = -e * 1.1;
        arm.sh.rotation.x = -e * 0.5;
        if (d.nextSip < -5.2) d.nextSip = 8 + Math.random() * 14;
      }
    }
  }
  for (const l of DIN.lamps) l.halo.material.opacity = 0.92 + Math.sin(t * 2.3 + l.phase) * 0.04;
}
