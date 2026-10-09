/* brew · night kitchen — renderer, post-processing stack, frame loop, picking, dev capture.
   Pipeline (pmndrs): MSAA HalfFloat render → N8AO (half-res, Low) → DoF → bloom on
   practicals → exposure → AgX → grade → vignette → grain. */
import * as THREE from 'three';
import * as PP from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export const E = {};

/* ------------------------------------------------------------------ */
/* renderer                                                            */
/* ------------------------------------------------------------------ */
const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
E.maxDpr = Math.min(window.devicePixelRatio || 1, 1.5);
renderer.setPixelRatio(E.maxDpr);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.info.autoReset = false;
renderer.toneMapping = THREE.NoToneMapping; // tone mapping happens in the composer
stage.appendChild(renderer.domElement);
E.renderer = renderer;
E.maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
scene.background = new THREE.Color('#020203');
E.scene = scene;

/* 35 mm-ish lens. The reference frame is wider than a true 35 mm, so the base vertical
   FOV is a touch wide (≈ 30 mm equiv. on 16:9) and the scroll dolly narrows it. */
const camera = new THREE.PerspectiveCamera(44, 16 / 9, 0.03, 80);
camera.position.set(0, 1.6, 0);
E.camera = camera;
E.baseFov = 44;

/* ------------------------------------------------------------------ */
/* post-processing                                                     */
/* ------------------------------------------------------------------ */
const composer = new PP.EffectComposer(renderer, {
  frameBufferType: THREE.HalfFloatType,
  multisampling: Math.min(4, renderer.capabilities.maxSamples || 4),
});
composer.addPass(new PP.RenderPass(scene, camera));

let ao = null;
try {
  ao = new N8AOPostPass(scene, camera, 1, 1);
  Object.assign(ao.configuration, {
    aoRadius: 0.42, distanceFalloff: 0.6, intensity: 2.2, color: new THREE.Color('#000000'),
    gammaCorrection: false, halfRes: true, depthAwareUpsampling: true, screenSpaceRadius: false,
  });
  ao.setQualityMode('Low');
  composer.addPass(ao);
} catch (e) { console.warn('[kitchen] N8AO unavailable', e); }
E.ao = ao;

/* exposure + a gentle split-tone grade, written as pmndrs effects so they chain in one pass */
class ExposureEffect extends PP.Effect {
  constructor(exposure = 1) {
    super('Exposure', `uniform float exposure;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        outputColor = vec4(inputColor.rgb * exposure, inputColor.a);
      }`, { uniforms: new Map([['exposure', new THREE.Uniform(exposure)]]) });
  }
  get exposure() { return this.uniforms.get('exposure').value; }
  set exposure(v) { this.uniforms.get('exposure').value = v; }
}
class GradeEffect extends PP.Effect {
  constructor() {
    super('Grade', `uniform vec3 shadowTint; uniform vec3 highTint; uniform float contrast; uniform float sat; uniform float lift;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        // split tone: cool, deep shadows; warm highlights
        c *= mix(shadowTint, vec3(1.0), smoothstep(0.0, 0.35, l));
        c *= mix(vec3(1.0), highTint, smoothstep(0.35, 1.0, l));
        // soft S-curve around mid grey, never crushing true black
        c = mix(c, smoothstep(0.0, 1.0, c), contrast);
        c += vec3(lift) * (1.0 - smoothstep(0.0, 0.12, l)); // keep blacks off the floor
        float l2 = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l2), c, sat);
        outputColor = vec4(c, inputColor.a);
      }`, {
      uniforms: new Map([
        ['shadowTint', new THREE.Uniform(new THREE.Vector3(0.92, 0.97, 1.06))],
        ['highTint', new THREE.Uniform(new THREE.Vector3(1.04, 1.0, 0.94))],
        ['contrast', new THREE.Uniform(0.18)],
        ['sat', new THREE.Uniform(1.06)],
        ['lift', new THREE.Uniform(0.012)],
      ]),
    });
  }
}

const dof = new PP.DepthOfFieldEffect(camera, { focusDistance: 1.6, focusRange: 9, bokehScale: 1.1, resolutionScale: 0.5 });
const bloom = new PP.BloomEffect({ intensity: 0.85, luminanceThreshold: 1.0, luminanceSmoothing: 0.35, mipmapBlur: true, radius: 0.78, resolutionScale: 0.5, levels: 7 });
const exposure = new ExposureEffect(1.35);
const tone = new PP.ToneMappingEffect({ mode: PP.ToneMappingMode.AGX });
const grade = new GradeEffect();
const vignette = new PP.VignetteEffect({ offset: 0.28, darkness: 0.62 });
const noise = new PP.NoiseEffect({ premultiply: true, blendFunction: PP.BlendFunction.SCREEN });
noise.blendMode.opacity.value = 0.045;
composer.addPass(new PP.EffectPass(camera, dof));
composer.addPass(new PP.EffectPass(camera, bloom, exposure, tone, grade, vignette, noise));
Object.assign(E, { composer, dof, bloom, exposure, tone, grade, vignette, noise });

function resize(w = window.innerWidth, h = window.innerHeight) {
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  // hold the horizontal field of view on tall/narrow screens
  const base = E.baseFov, baseAspect = 16 / 9;
  camera.fov = camera.aspect >= baseAspect ? base : (2 * Math.atan(Math.tan((base * Math.PI) / 360) * (baseAspect / camera.aspect)) * 180) / Math.PI;
  camera.updateProjectionMatrix();
}
E.resize = resize;
window.addEventListener('resize', () => resize());
resize();

/* ------------------------------------------------------------------ */
/* frame loop                                                          */
/* ------------------------------------------------------------------ */
const frameFns = [];
E.onFrame = (fn) => { frameFns.push(fn); return () => frameFns.splice(frameFns.indexOf(fn), 1); };
E.time = 0;
E.frame = 0;
E.stats = { ms: 0, fps: 60, calls: 0, tris: 0 };
let last = performance.now();
let acc = 0, frames = 0, cool = 3, msAcc = 0;

/* adaptive resolution: trade pixels for frame rate, capped at 1.5 */
function adapt(dt) {
  acc += dt; frames++;
  if (acc < 1) return;
  const fps = frames / acc;
  E.stats.fps = fps;
  E.stats.ms = msAcc / frames;
  acc = 0; frames = 0; msAcc = 0;
  if (E.lockDpr || cool-- > 0) return;
  const pr = renderer.getPixelRatio();
  if (fps < 48 && pr > 0.75) { renderer.setPixelRatio(Math.max(0.75, pr - 0.15)); resize(); cool = 2; }
  else if (fps > 58 && pr < E.maxDpr) { renderer.setPixelRatio(Math.min(E.maxDpr, pr + 0.1)); resize(); cool = 4; }
}

E.renderOnce = (dt = 1 / 60) => {
  E.time += dt;
  E.frame++;
  for (const fn of frameFns) fn(dt, E.time);
  // shadows refresh every other frame (steam and the pan move slowly enough)
  renderer.shadowMap.needsUpdate = E.frame % 2 === 0 || E.frame < 4;
  renderer.info.reset();
  composer.render(dt);
  E.stats.calls = renderer.info.render.calls;
  E.stats.tris = renderer.info.render.triangles;
};
function loop() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t0 = performance.now();
  E.renderOnce(dt);
  msAcc += performance.now() - t0;
  adapt(dt);
}
E.start = () => renderer.setAnimationLoop(loop);
E.stop = () => renderer.setAnimationLoop(null);

/* ------------------------------------------------------------------ */
/* picking                                                             */
/* ------------------------------------------------------------------ */
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const pickables = [];
let hovered = null;
E.pickable = (obj, handlers) => { obj.userData.pick = handlers; pickables.push(obj); return obj; };
E.hit = (clientX, clientY) => {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(pickables, true);
  for (const h of hits) {
    let o = h.object;
    while (o && !o.userData.pick) o = o.parent;
    if (o && o.visible !== false && !o.userData.pick.disabled) return { obj: o, point: h.point };
  }
  return null;
};
E.hover = (clientX, clientY) => {
  const h = E.hit(clientX, clientY);
  const o = h && h.obj;
  if (o !== hovered) {
    if (hovered && hovered.userData.pick.hover) hovered.userData.pick.hover(false);
    hovered = o;
    if (o && o.userData.pick.hover) o.userData.pick.hover(true, h);
  }
  return o;
};

/* ------------------------------------------------------------------ */
/* dev: offscreen capture → POST /__shot (works with the pane hidden)  */
/* ------------------------------------------------------------------ */
E.shot = async (name = 'shot', w = 1536, h = 864) => {
  const pr = renderer.getPixelRatio();
  renderer.setPixelRatio(1);
  resize(w, h);
  // a few frames so temporal bits (AO, shadows, DoF) settle at the new size
  for (let i = 0; i < 3; i++) E.renderOnce(1 / 60);
  const url = renderer.domElement.toDataURL('image/jpeg', 0.9);
  renderer.setPixelRatio(pr);
  resize();
  await fetch('/__shot?name=' + encodeURIComponent(name), { method: 'POST', body: url });
  return { name, bytes: url.length, calls: E.stats.calls, tris: E.stats.tris };
};
