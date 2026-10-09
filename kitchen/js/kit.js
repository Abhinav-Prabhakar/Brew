/* brew · night kitchen — geometry kit: cached primitives, mesh helper, static merging. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const GEO = {};
const key = (...a) => a.join(',');
export const rbox = (w, h, d, r = 0.01, s = 3) => GEO['rb' + key(w, h, d, r, s)] || (GEO['rb' + key(w, h, d, r, s)] = new RoundedBoxGeometry(w, h, d, s, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)));
export const box = (w, h, d) => GEO['b' + key(w, h, d)] || (GEO['b' + key(w, h, d)] = new THREE.BoxGeometry(w, h, d));
export const cyl = (rt, rb, h, seg = 32, open = false) => GEO['c' + key(rt, rb, h, seg, open)] || (GEO['c' + key(rt, rb, h, seg, open)] = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open));
export const sph = (r, ws = 24, hs = 16) => GEO['s' + key(r, ws, hs)] || (GEO['s' + key(r, ws, hs)] = new THREE.SphereGeometry(r, ws, hs));
export const plane = (w, h) => GEO['p' + key(w, h)] || (GEO['p' + key(w, h)] = new THREE.PlaneGeometry(w, h));
export const tor = (R, r, ts = 12, rs = 48, arc = Math.PI * 2) => GEO['t' + key(R, r, ts, rs, arc)] || (GEO['t' + key(R, r, ts, rs, arc)] = new THREE.TorusGeometry(R, r, ts, rs, arc));
export const lathe = (pts, seg = 48) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(Math.max(0, x), y)), seg);

/** m(geo, mat, {p, r, s, cast, recv, parent, name}) */
export function m(geo, mat, o = {}) {
  const mesh = new THREE.Mesh(geo, mat);
  if (o.p) mesh.position.set(...o.p);
  if (o.r) mesh.rotation.set(...o.r);
  if (o.s != null) Array.isArray(o.s) ? mesh.scale.set(...o.s) : mesh.scale.setScalar(o.s);
  mesh.castShadow = o.cast ?? false;
  mesh.receiveShadow = o.recv ?? true;
  if (o.name) mesh.name = o.name;
  if (o.parent) o.parent.add(mesh);
  return mesh;
}
export function group(parent, p, r) {
  const g = new THREE.Group();
  if (p) g.position.set(...p);
  if (r) g.rotation.set(...r);
  if (parent) parent.add(g);
  return g;
}

/** batch sibling meshes that share a material into one draw call (recursively).
    Groups keep their transforms so anything that animates stays separate. */
export function mergeStatic(root) {
  let saved = 0;
  const visit = (node) => {
    if (node.userData.noMerge) return;
    const buckets = new Map();
    for (const c of node.children) {
      if (!c.isMesh || c.isInstancedMesh || c.isSkinnedMesh || Array.isArray(c.material) || c.userData.noMerge || c.userData.pick || !c.visible || c.children.length) continue;
      const a = c.geometry.attributes;
      if (!a.position || !a.normal || !a.uv) continue;
      const k = c.material.uuid + (c.castShadow ? 'c' : '') + (c.receiveShadow ? 'r' : '') + c.renderOrder + (a.color ? 'v' : '');
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(c);
    }
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      const vc = !!list[0].geometry.attributes.color;
      const geos = list.map((mesh) => {
        mesh.updateMatrix();
        const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        g.applyMatrix4(mesh.matrix);
        const keep = vc ? ['position', 'normal', 'uv', 'color'] : ['position', 'normal', 'uv'];
        Object.keys(g.attributes).forEach((n) => { if (!keep.includes(n)) g.deleteAttribute(n); });
        g.morphAttributes = {};
        g.clearGroups();
        return g;
      });
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, list[0].material);
      mesh.castShadow = list[0].castShadow;
      mesh.receiveShadow = list[0].receiveShadow;
      mesh.renderOrder = list[0].renderOrder;
      node.add(mesh);
      list.forEach((x) => node.remove(x));
      saved += list.length - 1;
    }
    node.children.forEach((c) => { if (!c.isMesh || c.children.length) visit(c); });
  };
  visit(root);
  return saved;
}

/** de-quantize (meshopt / KHR_mesh_quantization stores normalized ints) so transforms can be baked in */
function toFloat(attr) {
  if (attr.array instanceof Float32Array && !attr.isInterleavedBufferAttribute) return attr;
  const n = attr.count, s = attr.itemSize, out = new Float32Array(n * s);
  for (let i = 0; i < n; i++) for (let k = 0; k < s; k++) out[i * s + k] = attr.getComponent(i, k);
  return new THREE.BufferAttribute(out, s);
}

/** flatten every static mesh under `root` (any depth) into one mesh per material.
    Skips anything under a `noMerge` node, pickables, instanced/skinned meshes. */
export function mergeDeep(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map();
  const visit = (node) => {
    if (node.userData.noMerge || node.userData.pick) return;
    for (const c of node.children) {
      if (c.isMesh && !c.isInstancedMesh && !c.isSkinnedMesh && !Array.isArray(c.material) && !c.userData.noMerge && !c.userData.pick && c.visible) {
        const a = c.geometry.attributes;
        if (a.position && a.normal && a.uv) {
          const k = c.material.uuid + (c.castShadow ? 'c' : '') + (c.receiveShadow ? 'r' : '') + c.renderOrder + (a.color ? 'v' : '');
          if (!buckets.has(k)) buckets.set(k, []);
          buckets.get(k).push(c);
        }
      }
      if (c.children.length) visit(c);
    }
  };
  visit(root);
  let saved = 0;
  const mtx = new THREE.Matrix4();
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const vc = !!list[0].geometry.attributes.color;
    const geos = list.map((mesh) => {
      mtx.multiplyMatrices(inv, mesh.matrixWorld);
      const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      const keep = vc ? ['position', 'normal', 'uv', 'color'] : ['position', 'normal', 'uv'];
      Object.keys(g.attributes).forEach((n) => { if (!keep.includes(n)) g.deleteAttribute(n); else g.setAttribute(n, toFloat(g.attributes[n])); });
      g.applyMatrix4(mtx);
      g.morphAttributes = {};
      g.clearGroups();
      return g;
    });
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, list[0].material);
    mesh.castShadow = list[0].castShadow;
    mesh.receiveShadow = list[0].receiveShadow;
    mesh.renderOrder = list[0].renderOrder;
    root.add(mesh);
    list.forEach((x) => x.parent.remove(x));
    saved += list.length - 1;
  }
  // drop groups that are now empty
  const prune = (node) => { node.children.slice().forEach((c) => { prune(c); if (!c.isMesh && !c.isSprite && !c.isLight && !c.isInstancedMesh && c.children.length === 0 && c.type === 'Group' && !c.userData.keep) node.remove(c); }); };
  prune(root);
  return saved;
}

/** tiny things don't need to cast shadows */
export function trimCasters(root, minR = 0.04) {
  let n = 0;
  const s = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || !o.castShadow || o.isInstancedMesh) return;
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    o.getWorldScale(s);
    if (o.geometry.boundingSphere.radius * Math.max(s.x, s.y, s.z) < minR) { o.castShadow = false; n++; }
  });
  return n;
}
