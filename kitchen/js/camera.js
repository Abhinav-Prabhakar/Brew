/* brew · night kitchen — camera: first-person station rig (look within limits, scroll dolly,
   eased moves between stations), free orbit/overview mode, and an idle cinematic. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { E } from './engine.js';
import { L } from './set.js';

export const CAM = {};
const v = (a) => new THREE.Vector3(...a);

export const STATIONS = {
  grill: { label: 'Grill', key: '1', pos: L.eye, look: L.look },
  pass: { label: 'Pass', key: '2', pos: [0.06, 1.62, -0.72], look: [0.06, 1.02, -2.1] },
  espresso: { label: 'Espresso', key: '3', pos: [0.95, 1.58, -0.35], look: [2.15, 1.12, -1.35] },
  pastry: { label: 'Pastry', key: '4', pos: [1.05, 1.6, -1.55], look: [2.25, 1.38, -2.8] },
};

/* cinematic shots: [pos, look, seconds] */
const SHOTS = [
  [[-0.55, 1.12, -0.45], [-0.12, 1.0, -1.0], 9],      // low across the steel to the pan
  [[0.9, 1.3, -0.6], [-0.2, 1.0, -1.05], 9],          // over the shoulder of the mise
  [[0.05, 1.55, -1.25], [0.0, 1.6, -11.0], 10],       // over the pass into the room
  [[-3.6, 1.5, -10.5], [0.6, 1.2, -2.0], 11],         // from the window table back to the kitchen
  [[3.5, 2.4, -4.2], [-0.3, 1.0, -1.4], 10],          // high, from the room
];

const rig = {
  pos: v(L.eye), look: v(L.look),
  yaw: 0, pitch: 0, yawT: 0, pitchT: 0, // drag look (radians)
  dolly: 0, dollyT: 0,
  par: new THREE.Vector2(), parT: new THREE.Vector2(),
};
CAM.rig = rig;
CAM.station = 'grill';
CAM.mode = 'station'; // station | orbit | cinematic

const camera = E.camera;
const dom = E.renderer.domElement;
const orbit = new OrbitControls(camera, dom);
orbit.enabled = false;
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;
orbit.target.set(0, 1.1, -3.5);
orbit.minDistance = 0.4;
orbit.maxDistance = 14;
orbit.maxPolarAngle = Math.PI * 0.92;
CAM.orbit = orbit;

/* ---------- moves ---------- */
CAM.moveTo = (pos, look, dur = 1.3, ease = 'power3.inOut') => new Promise((res) => {
  gsap.to(rig.pos, { x: pos[0], y: pos[1], z: pos[2], duration: dur, ease, overwrite: 'auto' });
  gsap.to(rig.look, { x: look[0], y: look[1], z: look[2], duration: dur, ease, overwrite: 'auto', onComplete: res });
  gsap.to(rig, { yawT: 0, pitchT: 0, dollyT: 0, duration: dur * 0.6, ease: 'power2.out', overwrite: 'auto' });
});
CAM.goStation = (name, dur = 1.25) => {
  const s = STATIONS[name];
  if (!s) return Promise.resolve();
  if (CAM.mode !== 'station') CAM.setMode('station', true);
  CAM.station = name;
  CAM.onStation && CAM.onStation(name);
  return CAM.moveTo(s.pos, s.look, dur);
};

CAM.setMode = (mode, quiet) => {
  if (mode === CAM.mode) return;
  const prev = CAM.mode;
  CAM.mode = mode;
  cine.kill && cine.kill();
  orbit.enabled = mode === 'orbit';
  if (mode === 'orbit') {
    // start orbiting from wherever we are, around a point ahead of us
    const dir = new THREE.Vector3().subVectors(rig.look, rig.pos).normalize();
    orbit.target.copy(camera.position).addScaledVector(dir, 2.6);
    orbit.update();
  } else if (mode === 'cinematic') {
    runCinematic();
  } else if (mode === 'station' && prev !== 'station') {
    // glide back from wherever the free camera is
    rig.pos.copy(camera.position);
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    rig.look.copy(camera.position).addScaledVector(dir, 2);
    if (!quiet) CAM.goStation(CAM.station, 1.6);
  }
  CAM.onMode && CAM.onMode(mode);
};

const cine = {};
function runCinematic() {
  const tl = gsap.timeline({ repeat: -1 });
  SHOTS.forEach(([p, l, d], i) => {
    const n = SHOTS[(i + 1) % SHOTS.length];
    tl.set(rig.pos, { x: p[0], y: p[1], z: p[2] }).set(rig.look, { x: l[0], y: l[1], z: l[2] })
      .to(rig.pos, { x: p[0] + (n[0][0] - p[0]) * 0.18, y: p[1] + (n[0][1] - p[1]) * 0.12, z: p[2] + (n[0][2] - p[2]) * 0.18, duration: d, ease: 'sine.inOut' }, '<')
      .to(rig.look, { x: l[0] + 0.25, duration: d, ease: 'sine.inOut' }, '<');
  });
  cine.kill = () => { tl.kill(); cine.kill = null; };
}

/* ---------- input: drag to look, wheel to dolly, gentle pointer parallax ---------- */
let drag = null, idleT = 0;
CAM.idle = () => idleT;
const poke = () => { idleT = 0; if (CAM.mode === 'cinematic') CAM.setMode('station'); };
dom.addEventListener('pointerdown', (e) => { poke(); if (CAM.mode !== 'station') return; drag = { x: e.clientX, y: e.clientY, yaw: rig.yawT, pitch: rig.pitchT, moved: false }; });
window.addEventListener('pointermove', (e) => {
  rig.parT.set((e.clientX / window.innerWidth - 0.5) * 2, (e.clientY / window.innerHeight - 0.5) * 2);
  idleT = 0;
  if (!drag || !e.buttons) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.hypot(dx, dy) > 5) drag.moved = true;
  if (drag.moved) {
    rig.yawT = THREE.MathUtils.clamp(drag.yaw - dx * 0.0022, -0.62, 0.62);
    rig.pitchT = THREE.MathUtils.clamp(drag.pitch - dy * 0.0018, -0.28, 0.36);
  }
});
window.addEventListener('pointerup', () => { CAM.dragged = drag && drag.moved; drag = null; });
dom.addEventListener('wheel', (e) => {
  poke();
  if (CAM.mode !== 'station') return;
  e.preventDefault();
  rig.dollyT = THREE.MathUtils.clamp(rig.dollyT - e.deltaY * 0.0012, -0.25, 0.42);
}, { passive: false });
window.addEventListener('keydown', poke);

/* ---------- per frame ---------- */
const look = new THREE.Vector3(), dir = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
E.onFrame((dt, t) => {
  idleT += dt;
  if (CAM.mode === 'orbit') { orbit.update(); return; }
  const k = 1 - Math.exp(-dt * 7);
  rig.yaw += (rig.yawT - rig.yaw) * k;
  rig.pitch += (rig.pitchT - rig.pitch) * k;
  rig.dolly += (rig.dollyT - rig.dolly) * (1 - Math.exp(-dt * 5));
  rig.par.lerp(rig.parT, 1 - Math.exp(-dt * 2.2));
  // a released drag drifts home after a beat
  if (!drag && CAM.mode === 'station' && idleT > 2.5) { rig.yawT *= 1 - dt * 0.8; rig.pitchT *= 1 - dt * 0.8; }

  dir.subVectors(rig.look, rig.pos);
  const dist = dir.length();
  dir.normalize();
  right.crossVectors(dir, up).normalize();
  const pm = CAM.mode === 'station' ? 1 : 0;
  camera.position.copy(rig.pos).addScaledVector(dir, rig.dolly * pm);
  // breathing + pointer parallax (tiny: this is a head, not a drone)
  camera.position.y += Math.sin(t * 1.15) * 0.0035 * pm - rig.par.y * 0.012 * pm;
  camera.position.addScaledVector(right, rig.par.x * 0.02 * pm);
  // yaw/pitch around the eye
  const yaw = Math.atan2(dir.x, -dir.z) + rig.yaw + rig.par.x * 0.025 * pm;
  const pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)) + rig.pitch - rig.par.y * 0.015 * pm;
  look.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist).add(camera.position);
  camera.lookAt(look);
  // focus the lens on what we're looking at (station work vs the room)
  if (E.dof) {
    const target = CAM.mode === 'cinematic' ? Math.min(6, dist) : CAM.focus ?? 1.6;
    E.dof.cocMaterial.focusDistance += (target - E.dof.cocMaterial.focusDistance) * (1 - Math.exp(-dt * 3));
  }
});

CAM.snap = (name = CAM.station) => {
  const s = STATIONS[name];
  rig.pos.set(...s.pos); rig.look.set(...s.look);
  rig.yaw = rig.yawT = rig.pitch = rig.pitchT = rig.dolly = rig.dollyT = 0;
  rig.par.set(0, 0); rig.parT.set(0, 0);
  CAM.station = name;
};
CAM.set = (pos, look) => { rig.pos.set(...pos); rig.look.set(...look); };
