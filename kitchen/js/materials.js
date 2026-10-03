/* brew · night kitchen — PBR material library. Values are physically plausible and
   envMapIntensity is normalised per family so the reflection probe never blows out. */
import * as THREE from 'three';
import { TX, loadSet } from './textures.js';

export const M = {};
const cache = {};
const once = (k, fn) => cache[k] || (cache[k] = fn());
const v2 = (s) => new THREE.Vector2(s, s);

/* every material registers its base env intensity so lighting can scale it globally */
export const envMats = [];
const reg = (m, env = 1) => { m.envMapIntensity = env; m.userData.envBase = env; envMats.push(m); return m; };

/* ---------- metals ---------- */
M.steel = (rep = [2, 2], o = {}) => once('steel' + rep + JSON.stringify(o), () => {
  const n = TX.brushed.normal.clone(), r = TX.brushed.rough.clone();
  [n, r].forEach((t) => { t.repeat.set(...rep); t.needsUpdate = true; });
  return reg(new THREE.MeshPhysicalMaterial({
    color: o.color || '#a7abb0', metalness: 1, roughness: o.roughness ?? 0.34, roughnessMap: r,
    normalMap: n, normalScale: v2(o.ns ?? 0.18), anisotropy: o.aniso ?? 0.7, anisotropyRotation: o.rot ?? 0,
  }), o.env ?? 1);
});
/* the glossy line counter: practicals smear into long streaks */
M.counter = () => M.steel([1.4, 6], { color: '#9a9ea4', roughness: 0.22, aniso: 0.85, ns: 0.12, env: 1.1 });
M.darkSteel = () => M.steel([2, 2], { color: '#4a4d52', roughness: 0.3, aniso: 0.5, env: 0.9 });
M.chrome = () => once('chrome', () => reg(new THREE.MeshStandardMaterial({ color: '#f2f3f5', metalness: 1, roughness: 0.07 }), 1.15));
M.brass = () => once('brass', () => reg(new THREE.MeshStandardMaterial({ color: '#c99a55', metalness: 1, roughness: 0.32, normalMap: TX.grainN, normalScale: v2(0.15) }), 1));
M.blackMetal = () => once('blackMetal', () => reg(new THREE.MeshStandardMaterial({ color: '#141416', metalness: 0.85, roughness: 0.42, normalMap: TX.grainN, normalScale: v2(0.1) }), 0.8));
M.iron = () => once('iron', () => reg(new THREE.MeshPhysicalMaterial({
  color: '#1b1b1c', metalness: 0.75, roughness: 0.52, normalMap: TX.ironN, normalScale: v2(0.5),
  clearcoat: 0.35, clearcoatRoughness: 0.35, // seasoning / oil film
}), 0.9));

/* ---------- lacquer, ceramics, glass ---------- */
M.lacquer = () => once('lacquer', () => reg(new THREE.MeshPhysicalMaterial({
  color: '#0a0a0b', roughness: 0.55, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.12, clearcoatRoughnessMap: null,
  roughnessMap: TX.smudge,
}), 0.9));
M.matteBlack = () => once('matteBlack', () => reg(new THREE.MeshStandardMaterial({ color: '#0d0d0e', roughness: 0.8, normalMap: TX.grainN, normalScale: v2(0.2) }), 0.5));
M.ceramic = (color = '#efebe4') => once('ceramic' + color, () => reg(new THREE.MeshPhysicalMaterial({
  color, roughness: 0.32, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.06, normalMap: TX.grainN, normalScale: v2(0.05),
}), 0.8));
M.glass = (tint = '#ffffff', opacity = 0.14) => once('glass' + tint + opacity, () => reg(new THREE.MeshPhysicalMaterial({
  color: tint, roughness: 0.03, metalness: 0, transparent: true, opacity, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1,
}), 1.4));
M.windowGlass = () => once('windowGlass', () => reg(new THREE.MeshPhysicalMaterial({
  color: '#0b0e14', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, specularIntensity: 1,
}), 0.8));

/* ---------- woods, leather, stone (CC0 sets) ---------- */
const setMat = (name, rep, o = {}) => once(name + rep + JSON.stringify(o), () => {
  const s = loadSet(name, { repeat: rep });
  const m = new THREE.MeshStandardMaterial({
    map: s.map, normalMap: s.normalMap, normalScale: v2(o.ns ?? 1), roughnessMap: s.arm, aoMap: s.arm, aoMapIntensity: o.ao ?? 0.7,
    color: o.color || '#ffffff', roughness: o.roughness ?? 1, metalness: 0,
  });
  return reg(m, o.env ?? 0.6);
});
M.walnut = (rep = [1, 1]) => setMat('black_walnut_veneer_01', rep, { roughness: 0.85, color: '#c9b4a2' });
M.darkWood = (rep = [2, 2]) => setMat('dark_wooden_planks', rep, { roughness: 1, color: '#8a7a6c' });
M.parquet = (rep = [6, 6]) => setMat('herringbone_parquet', rep, { roughness: 0.9, color: '#6a5446', env: 0.7 });
M.leather = (rep = [2, 2]) => setMat('brown_leather', rep, { roughness: 1, color: '#7a4e34' });
M.plaster = (rep = [3, 3], color = '#2a2622') => setMat('grey_plaster', rep, { color, roughness: 1, env: 0.4 });
M.concrete = (rep = [3, 3]) => setMat('concrete_floor_worn_001', rep, { color: '#5b5753', roughness: 1, env: 0.5 });
M.tile = (rep = [3, 3]) => once('tile' + rep, () => {
  const s = loadSet('long_white_tiles', { repeat: rep });
  return reg(new THREE.MeshPhysicalMaterial({ color: '#141416', normalMap: s.normalMap, roughnessMap: s.arm, roughness: 0.6, clearcoat: 0.9, clearcoatRoughness: 0.1 }), 0.9);
});

/* ---------- emissive practicals (bloom only picks up these) ---------- */
M.led = (color = '#ffb36a', intensity = 8) => once('led' + color + intensity, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), toneMapped: true }));
M.emissive = (color, intensity = 3, base = '#000000') => once('em' + color + intensity + base, () => reg(new THREE.MeshStandardMaterial({ color: base, emissive: color, emissiveIntensity: intensity, roughness: 0.5 }), 0.3));

/** scale env reflections globally (night looks like night) */
export function setEnvScale(k) { envMats.forEach((m) => (m.envMapIntensity = m.userData.envBase * k)); }
