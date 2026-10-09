/* brew — the shared HUD: live clock + weather + forecast chip, connection dot, today's profit (rolling odometer),
   "vs naive", rating, and the profit card that expands into the policy comparison (D vs A/B/C, committed arena:
   GET /api/v1/policies/comparison). Room tabs + fit-to-width live in brew.html. */
(() => {
const hud = document.getElementById('hud');
const $ = (s) => hud.querySelector(s);
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const POL = {A: 'naive', B: 'heuristic', C: 'optimiser', D: 'learned', E: 'oracle'};

/* ---------- weather icon ---------- */
const sun = (cx, cy, r) => `<g stroke="${I}" stroke-width="2.4" stroke-linecap="round"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#f6d58e"/>`
  + [0, 45, 90, 135, 180, 225, 270, 315].map((a) => { const k = a * Math.PI / 180, r1 = r + 3, r2 = r + 7;
    return `<path d="M${(cx + r1 * Math.cos(k)).toFixed(1)} ${(cy + r1 * Math.sin(k)).toFixed(1)}L${(cx + r2 * Math.cos(k)).toFixed(1)} ${(cy + r2 * Math.sin(k)).toFixed(1)}"/>`; }).join('') + '</g>';
const cloud = (x, y, col = '#fff') => `<path transform="translate(${x} ${y})" d="M0 10q0-7 7-7q3-6 10-5q7 1 8 7q6 0 6 6q0 5-6 5h-20q-5 0-5-6z" fill="${col}" stroke="${I}" stroke-width="2.2" stroke-linejoin="round"/>`;
const drops = (n) => Array.from({length: n}, (_, i) => `<path d="M${9 + i * 7} 27l-2 5" stroke="#5b8fb0" stroke-width="2.2" stroke-linecap="round"/>`).join('');
const moon = `<path d="M22 6a11 11 0 1 0 6 18a9 9 0 1 1-6-18z" fill="#fff6d8" stroke="${I}" stroke-width="2.4" stroke-linejoin="round"/>`;
function weatherIcon(state, night){
  if (night && (state === 'sunny' || state === 'partly')) return moon;
  switch (state) {
    case 'sunny': return sun(17, 17, 7.5);
    case 'partly': return sun(13, 12, 6) + cloud(6, 12);
    case 'cloudy': return cloud(2, 5, '#eef0f4') + cloud(8, 12);
    case 'drizzle': return cloud(4, 6, '#eef0f4') + drops(3);
    case 'rain': return cloud(4, 5, '#dfe3e8') + drops(4);
    default: return sun(17, 17, 7.5);
  }
}

/* ---------- daypart + forecast ---------- */
function daypart(tod, open){
  if (!open) return 'closed';
  const h = tod / 3600;
  return h < 8 ? 'opening' : h < 10.5 ? 'morning rush' : h < 12 ? 'late morning' : h < 14.5 ? 'lunch rush' : h < 17 ? 'afternoon lull' : h < 20 ? 'evening' : 'closing up';
}
function perHour(fc, t){
  const b = fc?.buckets; if (!b || !b.length) return null;
  const slot = Math.floor(R.tod(t) / 900);
  const next = b.filter((x) => x.slot >= slot && x.slot < slot + 4);
  if (!next.length) return null;
  return Math.round(next.reduce((a, x) => a + (x.p50 || 0), 0) * 4 / Math.max(1, new Set(next.map((x) => x.slot)).size));
}

/* ---------- connection status: no pill on screen any more (the clock card carries it in data-status for tests and
   assistive tech; the "be right back" / "offline replay" cards below speak up when it matters) ---------- */
function liveDot(){
  const el = $('[data-live]'), L = window.BrewLive || {};
  let st2 = L.status || 'connecting';
  if (st2 === 'booting' || st2 === 'reconnecting') st2 = st2 === 'booting' ? 'connecting' : 'reconnecting';
  if (st2 === 'live' && (L.state?.world?.lagging || L.lagging)) st2 = 'lagging';
  const txt = {live: 'live', connecting: 'connecting…', booting: 'connecting…', reconnecting: 'reconnecting…', closed: 'disconnected', lagging: 'catching up', 'offline-demo': 'offline demo', offline: 'offline', replay: `replay${L.speed && L.speed !== Infinity ? ' ×' + L.speed : ''}`, dev: 'dev replay'}[st2] || st2;
  if (el.dataset.status !== st2) { el.dataset.status = st2; el.dataset.conn = txt; clockTitle(); }
}

/* ---------- profit + rating ---------- */
const money = (n) => (n < 0 ? '−' : '') + '₹' + Math.abs(Math.round(n)).toLocaleString('en-IN');
function stars(r){
  const full = Math.floor(r + .25), half = r - full >= .25 && r - full < .75;
  return `<span>${'★'.repeat(Math.min(5, full))}</span>${half ? '<span style="opacity:.5">★</span>' : ''}${'☆'.repeat(Math.max(0, 5 - full - (half ? 1 : 0)))}`;
}
function comparison(s){
  const c = s.rest?.comparison; if (!c) return null;
  const P = c.policies || c;
  const get = (k) => Array.isArray(P) ? P.find((x) => (x.policy || x.code) === k) : P[k];
  return {get, c};
}
let hudSig = '';
const card = $('.money');
function render(s){
  if (!s) return;
  const t = R.now(), tod = R.tod(t), open = !!s.clock?.is_open, night = tod < 6.2 * 3600 || tod > 19.4 * 3600;
  $('.clock .time').textContent = `${s.clock?.weekday || ''} · ${R.hm12(t)}`;
  liveDot(); paintRate(s);
  const date = s.clock?.date ? new Date(s.clock.date + 'T00:00:00') : null;
  const fcN = perHour(s.rest?.forecast, t);
  const sig = [s.weather?.state, night, s.clock?.date, open, fcN, daypart(tod, open), s.kpis?.profit_today, s.kpis?.rating, s.kpis?.rating_n, s.policy?.policy, !!s.rest?.comparison].join('|');
  if (sig === hudSig) return; hudSig = sig;
  $('.clock .wx').innerHTML = weatherIcon(s.weather?.state, night);
  $('.clock .wx').setAttribute('aria-label', `${s.weather?.state || ''} ${s.weather?.temp_c != null ? Math.round(s.weather.temp_c) + '°C' : ''}`);
  const fc = $('.clock .fcst');
  fc.hidden = false; fc.textContent = daypart(tod, open) + (fcN != null && open ? ` · ~${fcN}/hr` : s.weather?.temp_c != null ? ` · ${Math.round(s.weather.temp_c)}°C` : '');
  fc.title = fcN != null && open ? `forecast: about ${fcN} items in the next hour (P50)` : '';
  hud.querySelector('[data-date]').textContent = date ? `${s.clock.weekday} ${date.getDate()} ${MON[date.getMonth()]}` : '—';
  const k = s.kpis || {}, amt = $('.money .amt');
  R.roll(amt, k.profit_today ?? 0, money); amt.classList.toggle('neg', (k.profit_today ?? 0) < 0);
  $('.money .stars').innerHTML = k.rating != null ? `${stars(k.rating)} ${k.rating.toFixed(1)} · ${k.rating_n ?? 0} reviews` : '';
  const vs = $('.money [data-vs]'), cmp = comparison(s), me = s.policy?.policy || s.world?.policy || 'D';
  if (cmp && cmp.get(me) && cmp.get('A') && me !== 'A') {
    const d = cmp.get(me).mean_profit / cmp.get('A').mean_profit - 1;
    vs.hidden = false; vs.classList.toggle('down', d < 0);
    vs.textContent = `${d >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(d * 100))}% vs naive`;
    vs.title = `policy ${me} averages ${money(cmp.get(me).mean_profit)}/day vs ${money(cmp.get('A').mean_profit)} for naive (arena, ${(cmp.c.seeds || []).length || 10} seeds × ${cmp.c.days || 7} days)`;
  } else vs.hidden = true;
  if (!$('#cmp').hidden) drawCmp(s);
  milestone(k.profit_today, s.clock?.date);
}

/* ---------- the clock fast-forwards: tap it (or press f) → 1× → 5× → 20× → 60× → 1×. Once it runs fast the café
   leaves the real wall clock behind for good (sim time never goes back); 1× after that just runs on from there. ---------- */
const RATES = [1, 5, 20, 60], clockEl = $('.clock'), ffEl = $('.clock .ff');
let shownRate = 1;
function paintRate(s){
  const rate = s?.world?.rate ?? 1, ahead = !!(s?.world?.detached || rate > 1);
  clockEl.toggleAttribute('data-ahead', ahead);
  if (rate === shownRate && ffEl.hidden === (rate <= 1)) return;
  const was = shownRate; shownRate = rate;
  ffEl.hidden = rate <= 1; ffEl.innerHTML = `<i>»</i>${rate}×`;
  if (rate > 1 && rate !== was) R.bump(ffEl, 'pop');
  clockTitle();
}
function clockTitle(){
  const s = R.S() || {}, rate = s.world?.rate ?? 1, next = RATES[(RATES.indexOf(rate) + 1) % RATES.length] ?? 1;
  const ahead = s.world?.detached || rate > 1;
  clockEl.title = `${rate > 1 ? `fast-forwarding at ${rate}×` : ahead ? 'running ahead of the real clock' : 'the café, in real time'} · tap for ${next === 1 ? 'real-time pace' : next + '×'}`
    + (clockEl.dataset.conn && clockEl.dataset.status !== 'live' ? ` · ${clockEl.dataset.conn}` : '');
  clockEl.setAttribute('aria-label', `${rate > 1 ? `fast-forwarding at ${rate} times` : 'normal speed'}; press to change to ${next === 1 ? 'normal speed' : next + ' times'}`);
  const hint = clockEl.querySelector('.hint'); if (hint) hint.textContent = next === 1 ? 'tap to slow back down' : rate > 1 ? `tap for ${next}× »»` : 'tap to fast-forward »';
}
let ffBusy = false;
async function fastForward(){
  const L = window.BrewLive || {}, s = R.S() || {};
  if (ffBusy) return;
  if (L.status !== 'live' || L.mode !== 'ws' || !window.BrewApi?.speed) {
    R.bump(clockEl, 'nope'); window.BrewToast?.(L.status === 'replay' || L.status === 'offline-demo' ? 'this is a replay · fast-forward needs the live café' : 'fast-forward needs the live café', 'bad'); return; }
  const rate = s.world?.rate ?? 1, next = RATES[(RATES.indexOf(rate) + 1) % RATES.length] ?? 1;
  ffBusy = true; window.BREW_LIVE?.emit?.('ui.ff', {rate: next});
  try { const r = await BrewApi.speed(next); const w = r?.world || r;
    if (w && w.rate != null && R.S()?.world) { R.S().world.rate = w.rate; if (w.detached != null) R.S().world.detached = w.detached; }
    paintRate(R.S()); if (!s.world?.detached && next > 1) window.BrewToast?.(`»» ${next}× · the café runs ahead of real time now`); }
  catch (e) { R.bump(clockEl, 'nope'); window.BrewToast?.(e.message || 'could not change speed', 'bad'); }
  finally { ffBusy = false; }
}
clockEl.addEventListener('click', fastForward);
clockEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fastForward(); } });
clockEl.addEventListener('animationend', () => clockEl.classList.remove('nope'));
addEventListener('keydown', (e) => { if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.target.closest?.('input, textarea, select, [contenteditable]')) fastForward(); });

/* ---------- money in: each bill's total floats up into today's profit when the printer cuts it ---------- */
let floatSum = 0, floatT = null;
window.BREW_LIVE?.on?.('payment.received', (d, ev) => {
  const L = window.BrewLive || {};
  if (!d?.amount || (ev?.sim_s != null && Math.abs(R.now() - ev.sim_s) > 45 * Math.max(1, (R.S()?.world?.rate ?? 1) / 10))) return;  // catch-up: no confetti
  if (!['live', 'replay', 'offline-demo', 'dev'].includes(L.status)) return;
  floatSum += d.amount;
  if (floatT) return;   // a rush: several bills ride up together
  const wait = window.BrewAudio?.billLeft?.() ?? 1.4;
  floatT = setTimeout(() => { floatT = null; const n = floatSum; floatSum = 0; floatMoney(n); }, Math.min(2.2, wait + .1) * 1000);
});
function floatMoney(n){
  if (R.reduced) return;
  const el = document.createElement('span'); el.className = 'plus'; el.textContent = '+' + money(n);
  el.style.setProperty('--r', ((Math.random() * 10) - 5).toFixed(1) + 'deg');
  card.appendChild(el); setTimeout(() => el.remove(), 1700);
  R.bump($('.money .amt'), 'tick');
}
/* little milestones: the first time today's profit crosses ₹10k / 25k / 50k / 1L, the card throws a handful of confetti */
const MILES = [10000, 25000, 50000, 100000];
let mileDate = null, mileTop = null;
function milestone(p, date){
  if (p == null) return;
  if (date !== mileDate || mileTop == null) { mileDate = date; mileTop = MILES.filter((m) => p >= m).pop() ?? 0; return; }  // no confetti for what was already true
  const hit = MILES.filter((m) => p >= m && m > mileTop).pop(); if (!hit) return;
  mileTop = hit; window.BREW_LIVE?.emit?.('ui.milestone', {amount: hit});
  confetti(card, 18); window.BrewToast?.(`₹${hit >= 1e5 ? hit / 1e5 + 'L' : hit / 1000 + 'k'} profit today ♡`);
}
/** a handful of paper confetti from an element (shared with eggs.js) */
function confetti(from, n = 16, glyphs){
  if (R.reduced || !from) return;
  const v = document.getElementById('viewport'), vr = v.getBoundingClientRect(), k = vr.width / 1600, r = from.getBoundingClientRect();
  const x0 = (r.left + r.width / 2 - vr.left) / k, y0 = (r.top + r.height / 2 - vr.top) / k;
  const cols = ['#f7c3a3', '#e07e52', '#8fa585', '#e3b25a', '#fdeee4'];
  for (let i = 0; i < n; i++) { const c = document.createElement('i'); c.className = 'confetti';
    if (glyphs) { c.textContent = glyphs[i % glyphs.length]; c.classList.add('g'); } else c.style.background = cols[i % cols.length];
    const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 120;
    c.style.cssText += `;left:${x0}px;top:${y0}px;--dx:${(Math.cos(a) * d).toFixed(0)}px;--dy:${(Math.sin(a) * d * .6 + 90).toFixed(0)}px;--rot:${(Math.random() * 720 - 360).toFixed(0)}deg;animation-delay:${(Math.random() * .12).toFixed(2)}s`;
    v.appendChild(c); setTimeout(() => c.remove(), 1700); }
}
window.BrewHUD = {fastForward, confetti, floatMoney};

/* ---------- policy comparison (click the profit card) ---------- */
function drawCmp(s){
  const box = $('#cmp'), cmp = comparison(s), me = s.policy?.policy || s.world?.policy || 'D';
  if (!cmp) { box.innerHTML = `<h3>what you’d otherwise make <small>loading the arena…</small></h3>`; return; }
  const rows = ['A', 'B', 'C', 'D'].map((k) => ({k, p: cmp.get(k)})).filter((r) => r.p);
  const all = rows.flatMap((r) => r.p.profit_by_seed || [r.p.mean_profit]);
  const lo = Math.floor(Math.min(...all) / 10000) * 10000, hi = Math.ceil(Math.max(...all) / 10000) * 10000;
  const W = 520, L = 112, Rr = 18, X = (v) => L + (v - lo) / (hi - lo) * (W - L - Rr), rowH = 46, H = rows.length * rowH + 34;
  let g = '';
  for (let v = lo; v <= hi; v += 10000) g += `<path d="M${X(v).toFixed(1)} 6V${H - 26}" stroke="${I}" stroke-width="1" opacity=".12"/><text x="${X(v).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-family="Patrick Hand" font-size="12" fill="${I}" opacity=".6">₹${v / 1000}k</text>`;
  rows.forEach((r, i) => {
    const y = 22 + i * rowH, p = r.p, seeds = p.profit_by_seed || [], mine = r.k === me, d = `style="--d:${(.15 + i * .12).toFixed(2)}s"`;
    const ci = p.ci95 || (p.vs_A?.ci95 ? null : null), col = mine ? C.pinkD : {A: '#b9b3ad', B: C.mustard, C: C.sage}[r.k] || C.navy;
    if (mine) g += `<rect x="4" y="${y - 19}" width="${W - 8}" height="${rowH - 6}" rx="12" fill="${C.pinkL}" stroke="${C.pinkD}" stroke-width="2" stroke-dasharray="6 5"/>`;
    g += `<text x="14" y="${y + 2}" font-family="Gochi Hand" font-size="19" fill="${I}">${r.k} · ${POL[r.k]}</text>`
      + `<text x="14" y="${y + 18}" font-family="Patrick Hand" font-size="12.5" fill="${I}" opacity=".6">${money(p.mean_profit)}/day</text>`;
    // range, CI and mean are inked in (pathLength=1 → .ink draws them on unfold), the seed dots follow
    if (seeds.length) g += `<path class="ink" ${d} pathLength="1" d="M${X(Math.min(...seeds)).toFixed(1)} ${y}H${X(Math.max(...seeds)).toFixed(1)}" stroke="${I}" stroke-width="2" stroke-linecap="round"/>`
      + seeds.map((v, j) => `<circle class="dot" ${d} cx="${X(v).toFixed(1)}" cy="${(y + ((j % 3) - 1) * 4).toFixed(1)}" r="3" fill="#fff" stroke="${I}" stroke-width="1.4"/>`).join('');
    if (ci && ci.length === 2) g += `<rect class="ink" ${d} pathLength="1" x="${X(ci[0]).toFixed(1)}" y="${y - 7}" width="${Math.max(3, X(ci[1]) - X(ci[0])).toFixed(1)}" height="14" rx="5" fill="${col}" stroke="${I}" stroke-width="2.2"/>`;
    g += `<path class="ink" ${d} pathLength="1" d="M${X(p.mean_profit).toFixed(1)} ${y - 12}V${y + 12}" stroke="${I}" stroke-width="3.4" stroke-linecap="round"/>`;
  });
  const D = cmp.get(me), A = cmp.get('A'), Cc = cmp.get('C');
  const note = D && A ? `policy ${me} makes ${money(D.mean_profit - A.mean_profit)} more a day than running it naive${Cc && me !== 'C' ? `, ${money(D.mean_profit - Cc.mean_profit)} more than the optimiser` : ''}` : '';
  box.innerHTML = `<h3>what you’d otherwise make <small>profit per day · ${(cmp.c.seeds || []).length || 10} seeds × ${cmp.c.days || 7} days · same customers (CRN)</small></h3>
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc('profit per day by policy: ' + rows.map((r) => `${r.k} ${POL[r.k]} ${money(r.p.mean_profit)}${r.k === me ? ' (running now)' : ''}`).join(', '))}">${g}</svg>
    <div class="note">${note}${note ? ' · ' : ''}today so far: ${money(s.kpis?.profit_today ?? 0)}</div>
    <div style="font-size:12.5px;opacity:.6;margin-top:2px">dots = one simulated week each · bar = 95% CI of the mean · tick = mean</div>`;
}
// unfold: the card grows from the profit chip and its chart is inked in once; fold: it shrinks back, then hides
function toggle(){ const box = $('#cmp'), opening = box.hidden || box.classList.contains('folding');
  clearTimeout(box._t); card.setAttribute('aria-expanded', String(opening));
  if (opening) { box.classList.remove('folding'); box.hidden = false; drawCmp(R.S() || {}); R.bump(box, 'unfold');
    box._t = setTimeout(() => box.classList.remove('unfold'), 1600); window.BrewLive?.refresh?.('comparison'); }
  else if (R.reduced) box.hidden = true;
  else { box.classList.remove('unfold'); box.classList.add('folding'); box._t = setTimeout(() => { box.hidden = true; box.classList.remove('folding'); }, 260); } }
card.addEventListener('click', () => toggle());
card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
document.addEventListener('click', (e) => { const box = $('#cmp'); if (!box.hidden && !box.classList.contains('folding') && !e.target.closest('#cmp, .money')) toggle(); });

/* ---------- connection states: the "be right back" card, and actions paused while not live ---------- */
const down = document.createElement('div');
down.id = 'brb'; down.className = 'card'; down.hidden = true; down.setAttribute('role', 'status');
document.getElementById('viewport').appendChild(down);
let downSince = null;
function connection(){
  liveDot();  // the dot follows status changes immediately, not on the next 1 s tick
  const L = window.BrewLive || {}, st = L.status || 'booting', live = st === 'live';
  const canAct = live && L.mode === 'ws';
  if (document.body.dataset.actions !== (canAct ? 'on' : 'off')) document.body.dataset.actions = canAct ? 'on' : 'off';
  if (st === 'reconnecting' || st === 'closed') downSince ??= performance.now(); else downSince = null;
  const brb = downSince != null && performance.now() - downSince > 6000, demo = st === 'offline-demo';
  const html = brb ? `<span class="spin" aria-hidden="true"></span><div><b>we'll be right back ♡</b><br>lost the café's connection · retrying on its own, nothing is lost</div>`
    : demo ? `<b>offline · replay</b><div>the café server is asleep, so this is a recorded morning. it switches to live the moment the server wakes.</div>` : '';
  down.hidden = !html; down.classList.toggle('demo', demo && !brb);
  if (html && down._h !== html) { down._h = html; down.innerHTML = html; }
}
// a click on anything that would call the API while we're not live: explain instead of failing
const ACT = '[data-ticket],[data-chaos],[data-action="invest"],[data-action="place_po"]';
document.addEventListener('click', (e) => {
  if (document.body.dataset.actions !== 'off' || !e.target.closest(ACT)) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const st = window.BrewLive?.status;
  window.BrewToast?.(st === 'offline-demo' || st === 'replay' ? 'this is a replay · actions need the live café' : 'reconnecting · actions are paused until the café is back', 'bad');
}, true);
window.BREW_LIVE?.on?.('status', connection);

R.onState(render);
setInterval(() => { render(R.S()); connection(); }, 1000);
connection();
})();
