/* brew · night kitchen — boot: load the set, light it, capture the probe, start the loop. */
import * as THREE from 'three';
import { E } from './engine.js';
import { buildSet, L, SET } from './set.js';
import { buildLights, loadEnvironment, captureProbe, LT } from './lights.js';
import { CAM } from './camera.js';
import { mergeDeep, trimCasters } from './kit.js';
import { M } from './materials.js';
import { buildProps, P } from './props.js';
import { buildDining, DIN } from './dining.js';
import { buildFood, F } from './food.js';

const B = (window.B = { E, L, SET, LT, CAM, M, P, DIN, F, THREE });
const $ = (s) => document.querySelector(s);
const loadMsg = (msg, k) => { $('#load-msg').textContent = msg; if (k != null) $('#load-fill').style.width = (k * 100).toFixed(0) + '%'; };

async function boot() {
  loadMsg('Lighting the pilot…', 0.05);
  await Promise.race([document.fonts.load('400 112px Oswald'), new Promise((r) => setTimeout(r, 2500))]);
  await loadEnvironment();
  loadMsg('Wiping down the steel…', 0.3);
  buildSet();
  buildLights();
  loadMsg('Setting the mise en place…', 0.45);
  await Promise.all([buildProps(), buildDining()]);
  loadMsg('Firing the grill…', 0.7);
  buildFood();
  CAM.snap('grill');
  trimCasters(E.scene);
  const saved = [SET.root, P.root, DIN.root, F.root].reduce((n, r) => n + mergeDeep(r), 0);
  console.info(`[kitchen] merged ${saved} static meshes`);
  loadMsg('Polishing reflections…', 0.85);
  await new Promise((r) => setTimeout(r, 300)); // let textures land before the probe
  captureProbe();
  E.start();
  loadMsg('Service.', 1);
  $('#loading').classList.add('out');
  setTimeout(() => $('#loading').remove(), 1000);
  $('#hud').classList.add('on');
}

/* dev hooks: capture frames without a visible window */
B.dev = {
  shot: E.shot,
  cam(pos, look) { CAM.set(pos, look); },
  info() { return { ...E.stats, dpr: E.renderer.getPixelRatio(), programs: E.renderer.info.programs.length, textures: E.renderer.info.memory.textures, geometries: E.renderer.info.memory.geometries }; },
};

boot().catch((e) => { console.error(e); loadMsg('Something went wrong: ' + e.message); });
