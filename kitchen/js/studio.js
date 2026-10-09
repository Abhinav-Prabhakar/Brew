/* brew · night kitchen — a tiny photo studio: renders our own 3D food (steak, herbs, garlic,
   tomatoes, the plated dish) into images for the hot-bar icons and the tablet thumbnail,
   so the UI shows the same photo-real food that sits on the line. */
import * as THREE from 'three';
import { E } from './engine.js';
import { LT } from './lights.js';

const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 10);
const key = new THREE.SpotLight('#ffc48a', 6, 3, 0.8, 0.7, 2);
key.position.set(0.25, 0.6, 0.3);
const rim = new THREE.DirectionalLight('#ffe2c0', 1.2);
rim.position.set(-0.5, 0.4, -0.6);
scene.add(key, key.target, rim, new THREE.HemisphereLight('#4a3524', '#0b0806', 0.8));

/** photograph `obj` (cloned) from above-front; returns a data URL */
export function photograph(obj, { size = 160, dist = 0.32, elev = 0.75, bg = '#141210', round = true, fit } = {}) {
  const c = obj.clone(true);
  c.position.set(0, 0, 0);
  c.rotation.set(obj.rotation.x, obj.rotation.y, obj.rotation.z);
  c.visible = true;
  c.traverse((o) => (o.visible = true));
  const bb = new THREE.Box3().setFromObject(c), ctr = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
  c.position.sub(ctr);
  scene.add(c);
  const r = fit ?? Math.max(sz.x, sz.z, sz.y) * 0.5;
  const d = dist ?? r * 3.2;
  cam.position.set(0, Math.sin(elev) * d, Math.cos(elev) * d);
  cam.lookAt(0, 0, 0);
  key.target.position.set(0, 0, 0);
  scene.environment = LT.probe || E.scene.environment;
  scene.environmentIntensity = 0.5;
  scene.background = new THREE.Color(bg);

  // render targets get neither tone mapping nor sRGB output: render linear float, grade on the CPU
  const rt = new THREE.WebGLRenderTarget(size, size, { samples: 4, type: THREE.FloatType });
  const r0 = E.renderer;
  r0.setRenderTarget(rt);
  r0.render(scene, cam);
  const px = new Float32Array(size * size * 4);
  r0.readRenderTargetPixels(rt, 0, 0, size, size, px);
  r0.setRenderTarget(null);
  rt.dispose();
  scene.remove(c);

  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const x = cv.getContext('2d'), img = x.createImageData(size, size);
  const aces = (v) => { v *= 1.6; return Math.min(1, Math.max(0, (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14))); };
  const srgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255;
  for (let y = 0; y < size; y++) for (let xx = 0; xx < size; xx++) {
    const si = ((size - 1 - y) * size + xx) * 4, di = (y * size + xx) * 4; // flip Y
    img.data[di] = srgb(aces(px[si])); img.data[di + 1] = srgb(aces(px[si + 1])); img.data[di + 2] = srgb(aces(px[si + 2])); img.data[di + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  if (round) { x.globalCompositeOperation = 'destination-in'; x.beginPath(); x.arc(size / 2, size / 2, size / 2, 0, 7); x.fill(); }
  return cv;
}
