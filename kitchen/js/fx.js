/* brew · night kitchen — atmosphere: steam/smoke rising off the pan (lit warm by the key),
   wisps off the cappuccino, blue flame tongues under the pan, falling herb flakes, dust in
   the light, and a soft WebAudio sizzle that follows the heat. */
import * as THREE from 'three';
import { E } from './engine.js';
import { L } from './set.js';
import { P } from './props.js';
import { F } from './food.js';
import { TX } from './textures.js';

export const FX = { heat: 0.6, sizzle: 0 };

/* ------------------------------------------------------------------ */
/* soft particle system (one Points draw per system)                   */
/* ------------------------------------------------------------------ */
const VERT = `
  attribute float aSize; attribute float aAlpha; attribute float aRot;
  varying float vAlpha; varying float vRot;
  uniform float uScale;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
    vAlpha = aAlpha; vRot = aRot;
  }`;
const FRAG = `
  uniform sampler2D map; uniform vec3 color;
  varying float vAlpha; varying float vRot;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float c = cos(vRot), s = sin(vRot);
    p = mat2(c, -s, s, c) * p + 0.5;
    float a = texture2D(map, p).a * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(color * a, a);
  }`;
class Puffs {
  constructor(n, color, { additive = false } = {}) {
    this.n = n;
    this.p = Array.from({ length: n }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s0: 0, s1: 0, a: 0, rot: 0, vr: 0 }));
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3); this.size = new Float32Array(n); this.alpha = new Float32Array(n); this.rot = new Float32Array(n);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, // premultiplied
      uniforms: { map: { value: TX.puff }, color: { value: new THREE.Color(color) }, uScale: { value: 600 } },
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.g = g;
    this.i = 0;
    E.scene.add(this.points);
  }
  spawn(o) {
    const q = this.p[this.i = (this.i + 1) % this.n];
    Object.assign(q, { life: 0, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.6 }, o);
  }
  update(dt, wind = 0) {
    E.renderer.getDrawingBufferSize(_v2);
    this.mat.uniforms.uScale.value = _v2.y * 0.62;
    for (let i = 0; i < this.n; i++) {
      const q = this.p[i];
      if (q.life >= q.max) { this.alpha[i] = 0; continue; }
      q.life += dt;
      const t = q.life / q.max;
      q.vx += (Math.sin(q.life * 2.3 + i) * 0.006 + wind) * dt;
      q.vy *= 1 - dt * 0.15;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      q.rot += q.vr * dt;
      this.pos[i * 3] = q.x; this.pos[i * 3 + 1] = q.y; this.pos[i * 3 + 2] = q.z;
      this.size[i] = q.s0 + (q.s1 - q.s0) * t;
      this.alpha[i] = q.a * Math.min(1, t * 6) * (1 - t) * (1 - t);
      this.rot[i] = q.rot;
    }
    ['position', 'aSize', 'aAlpha', 'aRot'].forEach((k) => (this.g.attributes[k].needsUpdate = true));
  }
}
const _v2 = new THREE.Vector2();

/* ------------------------------------------------------------------ */
export function buildFX() {
  const [bx, bz] = L.burner;
  const steam = new Puffs(90, '#ffd9b0');   // warm-lit steam
  const smoke = new Puffs(40, '#8a7a6c');   // a little grey smoke when it's really searing
  const cup = new Puffs(18, '#ffe6cc');
  FX.steam = steam; FX.smoke = smoke;

  // blue flame tongues under the pan: a ring of small additive cones that flicker
  const flame = new THREE.Group();
  flame.position.set(bx, L.top + 0.046, bz);
  const tongue = new THREE.ConeGeometry(0.006, 0.026, 6, 1, true);
  tongue.translate(0, 0.013, 0);
  const fm = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { t: { value: 0 }, k: { value: 1 } },
    vertexShader: `varying float vY; uniform float t; uniform float k; attribute float aPh;
      void main(){ vec3 p = position; float f = 0.75 + 0.25 * sin(t * 31.0 + aPh * 7.0) + 0.1 * sin(t * 53.0 + aPh * 3.0);
        p.y *= f * k; vY = position.y / 0.026; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0); }`,
    fragmentShader: `varying float vY; uniform float k;
      void main(){ vec3 core = vec3(0.35, 0.55, 1.8); vec3 tip = vec3(0.25, 0.3, 1.2);
        float a = (1.0 - vY) * 0.85 * k; gl_FragColor = vec4(mix(core, tip, vY) * a, a); }`,
  });
  const N = 28, im = new THREE.InstancedMesh(tongue, fm, N);
  const ph = new Float32Array(N), mm = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    q.setFromEuler(new THREE.Euler(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5));
    mm.compose(new THREE.Vector3(Math.cos(a) * 0.052, 0, Math.sin(a) * 0.052), q, new THREE.Vector3(1, 1, 1));
    im.setMatrixAt(i, mm);
    ph[i] = Math.random();
  }
  tongue.setAttribute('aPh', new THREE.InstancedBufferAttribute(ph, 1));
  flame.add(im);
  E.scene.add(flame);
  FX.flame = fm;

  // herb flakes falling into the pan
  const flakeG = new THREE.PlaneGeometry(0.006, 0.0045);
  const flakeM = new THREE.MeshStandardMaterial({ color: '#3f6e28', roughness: 0.5, side: THREE.DoubleSide });
  const flakes = new THREE.InstancedMesh(flakeG, flakeM, 80);
  flakes.count = 0;
  flakes.frustumCulled = false;
  E.scene.add(flakes);
  const fl = [];
  FX.sprinkle = (n = 24) => {
    const p = F.steak.position;
    for (let i = 0; i < n; i++) fl.push({ x: p.x + (Math.random() - 0.5) * 0.06, y: p.y + 0.22 + Math.random() * 0.05, z: p.z + (Math.random() - 0.5) * 0.05, vx: (Math.random() - 0.5) * 0.05, vy: -0.1 - Math.random() * 0.1, vz: (Math.random() - 0.5) * 0.05, r: Math.random() * 6, delay: i * 0.035, floor: p.y + 0.018 + Math.random() * 0.004 });
    if (fl.length > 80) fl.splice(0, fl.length - 80);
  };

  // dust motes drifting in the key light
  const dust = new Puffs(60, '#ffcf96', { additive: true });
  dust.mat.uniforms.map.value = TX.glow;
  for (let i = 0; i < 60; i++) dust.spawn({ x: bx + (Math.random() - 0.5) * 1.2, y: L.top + 0.3 + Math.random() * 1.2, z: bz + (Math.random() - 0.3) * 1.0, vx: 0, vy: (Math.random() - 0.5) * 0.01, vz: 0, s0: 0.003, s1: 0.003, a: 0.35, max: 8 + Math.random() * 10, life: Math.random() * 8 });

  let acc = 0, cupAcc = 0;
  const e = new THREE.Euler(), s1 = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
  E.onFrame((dt, t) => {
    fm.uniforms.t.value = t;
    fm.uniforms.k.value += ((FX.flameOn ?? 1) - fm.uniforms.k.value) * Math.min(1, dt * 4);
    // steam rate follows heat + whether there's meat in the pan
    const heat = FX.heat * (FX.flameOn ?? 1);
    const onPan = F.steak.visible && F.steak.position.distanceTo(P.pan.position) < 0.1;
    acc += dt * (onPan ? 22 * heat : 4 * heat);
    while (acc > 1) {
      acc -= 1;
      const src = onPan ? F.steak.position : P.pan.position;
      steam.spawn({ x: src.x + (Math.random() - 0.5) * 0.12, y: src.y + 0.02, z: src.z + (Math.random() - 0.5) * 0.08, vx: (Math.random() - 0.5) * 0.02, vy: 0.08 + Math.random() * 0.08, vz: (Math.random() - 0.5) * 0.02, s0: 0.03, s1: 0.18 + Math.random() * 0.12, a: 0.1 + heat * 0.06, max: 2.2 + Math.random() * 1.6 });
      if (onPan && Math.random() < 0.25 * FX.sizzle) smoke.spawn({ x: src.x + (Math.random() - 0.5) * 0.08, y: src.y + 0.02, z: src.z, vx: 0, vy: 0.12, vz: 0, s0: 0.04, s1: 0.26, a: 0.12, max: 3 });
    }
    cupAcc += dt * 3;
    while (cupAcc > 1 && F.cappuccino && F.cappuccino.visible) {
      cupAcc -= 1;
      cup.spawn({ x: F.cupTop.x + (Math.random() - 0.5) * 0.03, y: F.cupTop.y, z: F.cupTop.z + (Math.random() - 0.5) * 0.03, vx: 0, vy: 0.035, vz: 0, s0: 0.02, s1: 0.07, a: 0.08, max: 2.5 });
    }
    steam.update(dt, 0.004); smoke.update(dt, 0.004); cup.update(dt); dust.update(dt);
    // flakes
    let n = 0;
    for (const f of fl) {
      if (f.delay > 0) { f.delay -= dt; continue; }
      if (f.y > f.floor) { f.vy -= 2.2 * dt; f.vy = Math.max(f.vy, -0.9); f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt; f.r += dt * 8; }
      else f.y = f.floor;
      e.set(f.y > f.floor ? f.r : -Math.PI / 2, f.r * 0.7, 0);
      mm.compose(v.set(f.x, f.y, f.z), q.setFromEuler(e), s1);
      flakes.setMatrixAt(n++, mm);
    }
    flakes.count = n;
    flakes.instanceMatrix.needsUpdate = true;
    audio.update(dt);
  });
  FX.clearFlakes = () => (fl.length = 0);
  return FX;
}

/* ------------------------------------------------------------------ */
/* sizzle: filtered noise with crackle, gain follows FX.sizzle         */
/* ------------------------------------------------------------------ */
const audio = {
  ctx: null, gain: null,
  init() {
    if (this.ctx) return;
    try {
      const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
      const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) { const crackle = Math.random() < 0.0015 ? (Math.random() - 0.5) * 6 : 0; d[i] = (Math.random() - 0.5) * 0.6 + crackle; }
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3800; bp.Q.value = 0.6;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
      this.gain = ctx.createGain(); this.gain.gain.value = 0;
      src.connect(bp).connect(hp).connect(this.gain).connect(ctx.destination);
      src.start();
    } catch (e) { this.ctx = null; }
  },
  update() {
    if (!this.gain) return;
    const target = FX.muted ? 0 : FX.sizzle * 0.11;
    this.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.15);
  },
};
window.addEventListener('pointerdown', () => audio.init(), { once: true });
window.addEventListener('keydown', () => audio.init(), { once: true });
