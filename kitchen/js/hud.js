/* brew · night kitchen — the dark-glass HUD (DOM). Pure view: game.js owns state and calls
   these renderers; GSAP keeps every move short and eased (no bouncy cartoon motion). */
import { STATIONS } from './camera.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const inr = (n) => Math.round(n).toLocaleString('en-IN');
export const mmss = (s) => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/* ---------- clock & phase ---------- */
const MOON = `<svg viewBox="0 0 34 34"><defs><radialGradient id="mg" cx="40%" cy="35%"><stop offset="0" stop-color="#ffe7a8"/><stop offset="1" stop-color="#f5a623"/></radialGradient></defs><circle cx="17" cy="17" r="15" fill="rgba(245,166,35,0.10)"/><path d="M21.5 6.5a11 11 0 1 0 6 18.6A9 9 0 0 1 21.5 6.5Z" fill="url(#mg)"/></svg>`;
const SUN = `<svg viewBox="0 0 34 34"><g stroke="#f5a623" stroke-width="2.4" stroke-linecap="round">${Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * Math.PI * 2; return `<line x1="${17 + Math.cos(a) * 11}" y1="${17 + Math.sin(a) * 11}" x2="${17 + Math.cos(a) * 15}" y2="${17 + Math.sin(a) * 15}"/>`; }).join('')}</g><circle cx="17" cy="17" r="7" fill="#f5a623"/></svg>`;
const PHASES = [[6, 11, 'Breakfast'], [11, 15, 'Lunch Rush'], [15, 18, 'Afternoon Lull'], [18, 19, 'Golden Hour'], [19, 22.5, 'Dinner Rush'], [22.5, 26, 'Late Night']];
let iconKind = '';
export function clock(day, hhmm) {
  const [h, mi] = hhmm.split(':').map(Number);
  const hf = h + mi / 60;
  const h12 = ((h + 11) % 12) + 1;
  $('#clock-day').textContent = `Day ${day}`;
  $('#clock-time').textContent = `${h12}:${String(mi).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  const ph = PHASES.find(([a, b]) => hf >= a && hf < b) || PHASES[PHASES.length - 1];
  $('#clock-phase').textContent = ph[2];
  $('#phase-fill').style.width = (((hf - ph[0]) / (ph[1] - ph[0])) * 100).toFixed(1) + '%';
  const kind = h >= 18 || h < 6 ? 'moon' : 'sun';
  if (kind !== iconKind) { iconKind = kind; $('#clock-icon').innerHTML = kind === 'moon' ? MOON : SUN; }
}

/* ---------- tickets ---------- */
const ticketEls = new Map();
export function tickets(list, { activeNo, onClick }) {
  const box = $('#tickets');
  const show = list.slice(0, 5);
  const keep = new Set(show.map((o) => o.order_no));
  // leaving: fade up and out
  for (const [no, el] of ticketEls) if (!keep.has(no)) {
    ticketEls.delete(no);
    const served = el.dataset.state === 'ready' || el.dataset.state === 'served';
    gsap.to(el, { y: served ? -14 : -6, opacity: 0, duration: 0.35, ease: 'power2.in', onComplete: () => el.remove() });
  }
  const before = new Map([...ticketEls].map(([no, el]) => [no, el.getBoundingClientRect().left]));
  show.forEach((o) => {
    let el = ticketEls.get(o.order_no);
    const fresh = !el;
    if (fresh) {
      el = document.createElement('section');
      el.className = 'card ticket';
      el.addEventListener('click', () => onClick(Number(el.dataset.no)));
      ticketEls.set(o.order_no, el);
    }
    el.dataset.no = o.order_no;
    el.dataset.state = o.view;
    el.classList.toggle('active', o.order_no === activeNo);
    const label = o.view === 'cooking' ? 'In Progress' : o.view === 'ready' ? 'Ready · tap to serve' : 'Queued';
    el.innerHTML = `<div class="t-head"><span class="t-no">#${o.order_no}</span><span class="t-time tnum ${o.late ? 'late' : ''}">${mmss(o.age)}</span></div>
      <ul>${o.items.map((it) => `<li class="${it.done ? 'done' : ''}">${it.qty > 1 ? `<span class="q">${it.qty}×</span>` : ''}${esc(it.name)}</li>`).join('')}</ul>
      <div class="t-status"><i></i>${label}</div><div class="t-prog" style="width:${(o.progress * 100).toFixed(0)}%"></div>`;
    if (fresh) {
      box.appendChild(el);
      gsap.fromTo(el, { y: -18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: 'power3.out' });
    }
  });
  // keep DOM order = list order, FLIP the shuffle
  show.forEach((o) => box.appendChild(ticketEls.get(o.order_no)));
  show.forEach((o) => {
    const el = ticketEls.get(o.order_no), b = before.get(o.order_no);
    if (b == null) return;
    const dx = b - el.getBoundingClientRect().left;
    if (Math.abs(dx) > 1) gsap.fromTo(el, { x: dx }, { x: 0, duration: 0.45, ease: 'power3.out' });
  });
}
/* timers tick every frame without rebuilding the cards */
export function ticketTimes(list) {
  list.forEach((o) => { const el = ticketEls.get(o.order_no); if (!el) return; const t = el.querySelector('.t-time'); t.textContent = mmss(o.age); t.classList.toggle('late', o.late); });
}

/* ---------- money, objective, stats ---------- */
const shown = { cash: 0 };
export function cash(v) {
  gsap.to(shown, { cash: v, duration: 0.9, ease: 'power2.out', overwrite: 'auto', onUpdate: () => ($('#cash').textContent = inr(shown.cash)) });
}
export function objective(ahead, target = 3) {
  const k = Math.min(1, ahead / target);
  $('#obj-ring').style.strokeDashoffset = (88 * (1 - k)).toFixed(1);
  $('#obj-sub').textContent = `Current: ${ahead} ahead`;
  $('#objective').classList.toggle('met', ahead >= target);
}
export function stats(s) {
  $('#st-rev').textContent = '₹' + inr(s.revenue);
  $('#st-served').textContent = s.served;
  $('#st-tt').textContent = s.avgTicket ? mmss(s.avgTicket) : '—';
  $('#st-rating').textContent = s.rating.toFixed(2) + ' ★';
  $('#st-load').textContent = s.load + '%';
  $('#st-replate').textContent = s.rescued;
}
export function toggleStats(force) {
  const el = $('#stats'), on = force ?? el.hidden;
  if (on) { el.hidden = false; gsap.fromTo(el, { y: -8, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: 'power2.out' }); }
  else gsap.to(el, { opacity: 0, y: -6, duration: 0.2, onComplete: () => (el.hidden = true) });
  $('#stats-btn').setAttribute('aria-pressed', on ? 'true' : 'false');
}

/* ---------- hot-bar & task ---------- */
export function hotbar(slots, onUse) {
  const box = $('#hotbar');
  box.innerHTML = '';
  slots.forEach((s) => {
    const b = document.createElement('button');
    b.className = 'slot';
    b.dataset.id = s.id;
    b.setAttribute('aria-label', s.label);
    b.innerHTML = `<span class="tip">${esc(s.label)}</span><kbd>${s.key}</kbd>`;
    if (s.icon) { const img = new Image(); img.src = s.icon; img.alt = ''; b.prepend(img); }
    b.addEventListener('click', () => onUse(s.id));
    box.appendChild(b);
  });
}
export function wantSlot(id) { document.querySelectorAll('.slot').forEach((el) => el.classList.toggle('want', el.dataset.id === id)); }
export function task(name, step, total, k) {
  $('#task-name').textContent = name;
  $('#task-step').textContent = total ? `${step}/${total}` : '';
  $('#task-count').textContent = '';
  $('#task-fill').style.width = (k * 100).toFixed(0) + '%';
}

/* ---------- stations & hints ---------- */
export function stations(current, mode, onPick) {
  const box = $('#stations');
  if (!box.childElementCount) {
    Object.entries(STATIONS).forEach(([id, s]) => {
      const b = document.createElement('button');
      b.dataset.id = id;
      b.innerHTML = `${s.label}<kbd>${s.key}</kbd>`;
      b.addEventListener('click', () => onPick(id));
      box.appendChild(b);
    });
    box.appendChild(Object.assign(document.createElement('span'), { className: 'sep' }));
    [['orbit', 'Orbit', 'O'], ['cinematic', 'Cinematic', 'C']].forEach(([id, label, k]) => {
      const b = document.createElement('button');
      b.dataset.id = id;
      b.innerHTML = `${label}<kbd>${k}</kbd>`;
      b.addEventListener('click', () => onPick(id));
      box.appendChild(b);
    });
  }
  box.querySelectorAll('button').forEach((b) => b.classList.toggle('on', mode === 'station' ? b.dataset.id === current : b.dataset.id === mode));
}
let hintT = 0;
export function hint(text) {
  const el = $('#hint');
  if (!text) { el.classList.remove('on'); return; }
  if (el.textContent !== text) el.textContent = text;
  el.classList.add('on');
  clearTimeout(hintT);
}

/* ---------- toasts ---------- */
export function toast(title, text, kind = '') {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'card toast ' + kind;
  el.innerHTML = `<div class="ti"></div><div><b>${esc(title)}</b><span>${esc(text)}</span></div>`;
  box.prepend(el);
  gsap.fromTo(el, { x: 16, opacity: 0 }, { x: 0, opacity: 1, duration: 0.4, ease: 'power3.out' });
  while (box.children.length > 3) box.lastElementChild.remove();
  gsap.to(el, { opacity: 0, x: 12, duration: 0.4, delay: 4.2, ease: 'power2.in', onComplete: () => el.remove() });
}
