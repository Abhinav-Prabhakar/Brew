/* brew · night kitchen — lighting. A handful of dynamic lights (warm key, pass wash, the blue
   flame, two LED area lights, the pastry case, two dining fills) on top of an image-based
   base: a dimmed restaurant HDRI first, then a reflection probe captured from our own set so
   the steel actually mirrors the LED strips, windows and sign. */
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { E } from './engine.js';
import { L, SET } from './set.js';
import { envMats } from './materials.js';

export const LT = {};
const K2700 = '#ffb46b', K3000 = '#ffc387', K2200 = '#ff9a4a';

export async function loadEnvironment() {
  const pmrem = new THREE.PMREMGenerator(E.renderer);
  LT.pmrem = pmrem;
  const hdr = await new HDRLoader().loadAsync('assets/hdri/warm_restaurant_night_1k.hdr');
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  LT.hdriEnv = pmrem.fromEquirectangular(hdr).texture;
  hdr.dispose();
  E.scene.environment = LT.hdriEnv;
  E.scene.environmentIntensity = 0.32;
  E.scene.environmentRotation.set(0, 1.2, 0);
}

export function buildLights() {
  RectAreaLightUniformsLib.init();
  const S = E.scene;
  const [bx, bz] = L.burner;

  // ambient floor: barely-there warm bounce so blacks never crush
  const hemi = new THREE.HemisphereLight('#3a2a1c', '#050403', 0.35);
  S.add(hemi);

  // key: a warm 2700 K downlight over the burner — the light that sells the food
  const key = new THREE.SpotLight(K2700, 9, 6, 0.7, 0.85, 2);
  key.position.set(bx + 0.35, L.ceil - 0.05, bz + 0.25);
  key.target.position.set(bx + 0.25, L.top, bz + 0.05);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.015;
  key.shadow.radius = 4;
  key.shadow.camera.near = 0.3;
  key.shadow.camera.far = 4;
  S.add(key, key.target);

  // pass wash: soft spill from the pendants onto the plates waiting at the pass
  const pass = new THREE.SpotLight(K3000, 7, 5, 0.95, 0.9, 2);
  pass.position.set(0.1, 2.35, (L.passZ0 + L.passZ1) / 2 + 0.25);
  pass.target.position.set(0.1, L.passTop, (L.passZ0 + L.passZ1) / 2);
  S.add(pass, pass.target);

  // under-shelf LEDs (left) and over the back bar (right) as real area lights
  const shelfL = new THREE.RectAreaLight(K2700, 9, 2.3, 0.05);
  shelfL.position.set(L.leftWall + 0.3, 1.42, -0.75);
  shelfL.lookAt(L.leftWall + 0.45, 0, -0.75);
  const shelfR = new THREE.RectAreaLight(K2700, 6, 1.5, 0.05);
  shelfR.position.set(L.rightWall - 0.28, 1.68, -0.6);
  shelfR.lookAt(L.rightWall - 0.45, 0, -0.6);
  S.add(shelfL, shelfR);

  // the only cool light in the room: the gas flame under the pan
  const flame = new THREE.PointLight('#3f74ff', 0.12, 0.2, 2);
  flame.position.set(bx, L.top + 0.03, bz);
  S.add(flame);

  // pastry cabinet glow
  const cab = new THREE.PointLight('#ffd09a', 1.6, 2.2, 2);
  cab.position.set(L.openR - 0.45, 1.45, L.din.z0 - 0.78);
  S.add(cab);

  // dining room: two broad warm fills (table lamps are emissive + these)
  const d1 = new THREE.PointLight(K2200, 9, 10, 2);
  d1.position.set(-2.6, 2.2, -6.5);
  const d2 = new THREE.PointLight(K2200, 9, 10, 2);
  d2.position.set(2.6, 2.2, -8.5);
  S.add(d1, d2);

  Object.assign(LT, { hemi, key, pass, shelfL, shelfR, flame, cab, d1, d2 });
  LT.base = { key: key.intensity, flame: flame.intensity, cab: cab.intensity };

  // flicker: the flame breathes, the key barely moves (hot pan shimmer)
  E.onFrame((dt, t) => {
    const f = Math.sin(t * 23.0) * 0.5 + Math.sin(t * 37.3 + 1.3) * 0.3 + Math.sin(t * 61.7) * 0.2;
    flame.intensity = LT.base.flame * (LT.flameOn ?? 1) * (0.85 + f * 0.15);
  });
}

/** capture a reflection probe from inside our own set (static: practicals, windows, sign) */
export function captureProbe(hide = []) {
  hide.forEach((o) => (o.visible = false));
  const prev = E.scene.environmentIntensity;
  const rt = LT.pmrem.fromScene(E.scene, 0.0, 0.05, 40, { size: 256, position: new THREE.Vector3(0.2, 1.35, -1.25) });
  hide.forEach((o) => (o.visible = true));
  LT.probe = rt.texture;
  E.scene.environment = LT.probe;
  E.scene.environmentIntensity = prev;
  E.scene.environmentRotation.set(0, 0, 0);
  envMats.forEach((mm) => (mm.needsUpdate = true));
}
