/* brew · night kitchen — glTF loading (meshopt + WebP), instancing helpers. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { E } from './engine.js';
import { envMats } from './materials.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = {};

/** load a model once; returns the (shared) gltf */
export function loadGLTF(name) {
  return cache[name] || (cache[name] = loader.loadAsync(`assets/models/${name}.glb`).then((g) => {
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false;
      o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((mm) => {
        if (mm.userData.envBase !== undefined) return;
        [mm.map, mm.emissiveMap].forEach((t) => t && (t.anisotropy = E.maxAniso));
        // never pay for a transmission pass in the live scene: glass becomes a warm-lit shell
        if (mm.transmission > 0) {
          mm.transmission = 0;
          mm.color.set('#2a1a0e');
          mm.roughness = 0.35;
          mm.emissive = new THREE.Color('#ffae62');
          mm.emissiveIntensity = 1.6;
        }
        mm.envMapIntensity = mm.metalness > 0.5 ? 1 : 0.55;
        mm.userData.envBase = mm.envMapIntensity;
        envMats.push(mm);
      });
    });
    return g;
  }));
}

/** a placed clone, scaled so its largest horizontal extent (or height) matches `size` metres */
export async function place(name, parent, { p = [0, 0, 0], r = [0, 0, 0], height, width, s, cast = false, tint } = {}) {
  const g = await loadGLTF(name);
  const obj = g.scene.clone(true);
  const bb = new THREE.Box3().setFromObject(obj), size = bb.getSize(new THREE.Vector3());
  const k = s ?? (height ? height / size.y : width ? width / Math.max(size.x, size.z) : 1);
  obj.scale.setScalar(k);
  obj.position.set(p[0], p[1] - bb.min.y * k, p[2]);
  obj.rotation.set(...r);
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = cast;
    if (tint) { o.material = o.material.clone(); o.material.color.multiply(new THREE.Color(tint)); o.material.userData.envBase = o.material.envMapIntensity; envMats.push(o.material); }
  });
  parent.add(obj);
  return obj;
}

/** instance every mesh of a model at a list of transforms: [{p, ry, s}] (one draw call per mesh) */
export async function instance(name, parent, list, { height, width, cast = false } = {}) {
  const g = await loadGLTF(name);
  const src = g.scene;
  src.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(src), size = bb.getSize(new THREE.Vector3());
  const k = height ? height / size.y : width ? width / Math.max(size.x, size.z) : 1;
  const out = [];
  const tmp = new THREE.Matrix4(), base = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  src.traverse((o) => {
    if (!o.isMesh) return;
    const im = new THREE.InstancedMesh(o.geometry, o.material, list.length);
    im.castShadow = cast;
    im.receiveShadow = true;
    list.forEach((it, i) => {
      const s = (it.s ?? 1) * k;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.ry ?? 0);
      sc.setScalar(s);
      base.compose(new THREE.Vector3(it.p[0], it.p[1] - bb.min.y * s, it.p[2]), q, sc);
      tmp.multiplyMatrices(base, o.matrixWorld);
      im.setMatrixAt(i, tmp);
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    parent.add(im);
    out.push(im);
  });
  return out;
}
