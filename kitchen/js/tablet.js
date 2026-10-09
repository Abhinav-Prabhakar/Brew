/* brew · night kitchen — the station tablet: a real screen in the scene (CanvasTexture on an
   angled mount, glowing onto the steel). Two tabs: Recipe (active ticket, steps with checks,
   temperature, a photo of the dish rendered from our own 3D food) and Replate (discounted
   pre-made food on offer tonight). Click it to switch tabs. */
import * as THREE from 'three';
import { E } from './engine.js';
import { M } from './materials.js';
import { L } from './set.js';
import { canvas, tex } from './textures.js';
import { rbox, cyl, plane, m, group } from './kit.js';
import { pool } from './dining.js';

export const TAB = { tab: 'recipe', dirty: true };
const W = 1024, H = 640;
const cv = canvas(W, H), x = cv.getContext('2d');
const AMBER = '#f5a623', GREEN = '#3ccf6e', INK = '#f4f2ee', INK2 = 'rgba(244,242,238,0.6)', INK3 = 'rgba(244,242,238,0.32)';

export function buildTablet() {
  const g = group(E.scene, [-0.56, L.top, -0.86], [0, 0.62, 0]);
  g.userData.noMerge = true;
  // weighted base + arm
  m(cyl(0.05, 0.058, 0.012, 32), M.blackMetal(), { p: [0, 0.006, 0], parent: g, cast: true });
  m(cyl(0.008, 0.008, 0.2, 12), M.darkSteel(), { p: [0, 0.11, 0.0], parent: g, cast: true });
  const head = group(g, [0, 0.22, 0.01], [-0.62, 0, 0]);
  m(rbox(0.29, 0.19, 0.012, 0.012, 4), M.matteBlack(), { p: [0, 0, -0.007], parent: head, cast: true });
  const t = tex(cv, { wrap: false });
  t.anisotropy = E.maxAniso;
  const screen = m(plane(0.272, 0.17), new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(1.15, 1.15, 1.15), toneMapped: true }), { p: [0, 0, 0.0], parent: head, recv: false });
  // the screen's glow on the steel
  pool(E.scene, -0.56 + 0.04, L.top + 0.002, -0.86 + 0.09, 0.55, '#9fb6ff', 0.05);
  TAB.tex = t;
  TAB.group = g;
  E.pickable(screen, { click: () => { TAB.tab = TAB.tab === 'recipe' ? 'replate' : 'recipe'; TAB.dirty = true; } });
  E.onFrame(() => { if (TAB.dirty && TAB.state) draw(TAB.state); });
  return TAB;
}

/* ------------------------------------------------------------------ */
const rr = (x0, y0, w, h, r) => { x.beginPath(); x.roundRect(x0, y0, w, h, r); };
function draw(s) {
  TAB.dirty = false;
  x.fillStyle = '#0c0c0e'; x.fillRect(0, 0, W, H);
  const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(255,255,255,0.04)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  if (TAB.tab === 'recipe') recipe(s); else replate(s);
  // tab bar
  const tabs = [['recipe', 'Recipe'], ['replate', `Replate · ${s.replate.length}`]];
  tabs.forEach(([k, label], i) => {
    const on = TAB.tab === k, x0 = 40 + i * 210;
    rr(x0, H - 74, 190, 46, 23); x.fillStyle = on ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)'; x.fill();
    x.font = '600 24px Inter'; x.fillStyle = on ? (k === 'replate' ? '#8fd7a6' : INK) : INK3; x.textAlign = 'center';
    x.fillText(label, x0 + 95, H - 43);
  });
  x.textAlign = 'right'; x.font = '500 22px Inter'; x.fillStyle = INK3;
  x.fillText('tap to switch', W - 40, H - 44);
  x.textAlign = 'left';
  TAB.tex.needsUpdate = true;
}

function recipe(s) {
  const a = s.active;
  if (!a) { x.font = '600 40px Inter'; x.fillStyle = INK2; x.fillText('No grill tickets — nice.', 48, 120); return; }
  // header
  x.font = '700 52px Inter'; x.fillStyle = INK; x.fillText(`#${a.order_no}`, 44, 84);
  x.font = '600 44px Inter'; x.fillText(a.title, 44 + x.measureText(`#${a.order_no}`).width + 120, 84);
  x.font = '500 34px Inter'; x.fillStyle = a.late ? '#ff5a4e' : INK3; x.textAlign = 'right'; x.fillText(a.timer, W - 44, 80); x.textAlign = 'left';
  x.fillStyle = 'rgba(255,255,255,0.08)'; x.fillRect(44, 112, W - 88, 2);
  // steps
  a.steps.forEach((st, i) => {
    const y = 172 + i * 62, cx = 66;
    x.beginPath(); x.arc(cx, y - 10, 17, 0, Math.PI * 2);
    if (st.done) { x.fillStyle = GREEN; x.fill(); x.strokeStyle = '#0c0c0e'; x.lineWidth = 4.5; x.beginPath(); x.moveTo(cx - 8, y - 10); x.lineTo(cx - 2, y - 3); x.lineTo(cx + 9, y - 17); x.stroke(); }
    else if (st.current) { x.strokeStyle = AMBER; x.lineWidth = 4; x.stroke(); x.beginPath(); x.arc(cx, y - 10, 7, 0, 7); x.fillStyle = AMBER; x.fill(); }
    else { x.strokeStyle = 'rgba(255,255,255,0.22)'; x.lineWidth = 3; x.stroke(); }
    x.font = st.current ? '600 32px Inter' : '500 32px Inter';
    x.fillStyle = st.done ? INK2 : st.current ? INK : INK3;
    x.fillText(st.label, 104, y);
    if (st.current && st.progress != null) {
      rr(104, y + 12, 300, 6, 3); x.fillStyle = 'rgba(255,255,255,0.1)'; x.fill();
      rr(104, y + 12, 300 * st.progress, 6, 3); x.fillStyle = AMBER; x.fill();
    }
  });
  // photo of the dish + specs
  if (s.photo) {
    x.save(); rr(590, 140, 390, 290, 22); x.clip(); x.drawImage(s.photo, 590, 85, 390, 390); x.restore();
    rr(590, 140, 390, 290, 22); x.strokeStyle = 'rgba(255,255,255,0.08)'; x.lineWidth = 2; x.stroke();
  }
  x.font = '500 28px Inter'; x.fillStyle = INK2;
  x.fillText(a.spec, 592, 476);
  x.fillStyle = AMBER; x.font = '600 28px Inter'; x.fillText(a.temp, 592, 516);
}

function replate(s) {
  x.font = '700 44px Inter'; x.fillStyle = '#8fd7a6'; x.fillText('Replate', 44, 84);
  x.font = '500 28px Inter'; x.fillStyle = INK3; x.fillText('pre-made, discounted, still lovely', 230, 82);
  x.fillStyle = 'rgba(255,255,255,0.08)'; x.fillRect(44, 112, W - 88, 2);
  s.replate.slice(0, 4).forEach((l, i) => {
    const y = 140 + i * 92;
    rr(44, y, W - 88, 78, 16); x.fillStyle = 'rgba(255,255,255,0.04)'; x.fill();
    x.font = '600 32px Inter'; x.fillStyle = INK; x.fillText(`${l.name}`, 70, y + 36);
    x.font = '500 24px Inter'; x.fillStyle = INK3; x.fillText(`${l.units} left · use by ${l.useBy}`, 70, y + 66);
    x.textAlign = 'right';
    x.font = '700 34px Inter'; x.fillStyle = INK; x.fillText(`₹${l.price}`, W - 70, y + 36);
    x.font = '600 24px Inter'; x.fillStyle = '#8fd7a6'; x.fillText(`−${l.discount_pct}%`, W - 70, y + 66);
    x.textAlign = 'left';
  });
  x.font = '500 26px Inter'; x.fillStyle = INK2;
  x.fillText(`Rescued tonight: ${s.rescued}`, 44, H - 100);
}
