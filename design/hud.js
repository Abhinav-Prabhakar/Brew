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

/* ---------- connection dot ---------- */
function liveDot(){
  const el = $('[data-live]'), L = window.BrewLive || {};
  let st2 = L.status || 'connecting';
  if (st2 === 'booting' || st2 === 'reconnecting') st2 = st2 === 'booting' ? 'connecting' : 'reconnecting';
  if (st2 === 'live' && (L.state?.world?.lagging || L.lagging)) st2 = 'lagging';
  const txt = {live: 'live', connecting: 'connecting…', booting: 'connecting…', reconnecting: 'reconnecting…', closed: 'disconnected', lagging: 'catching up', 'offline-demo': 'offline demo', offline: 'offline', replay: `replay${L.speed && L.speed !== Infinity ? ' ×' + L.speed : ''}`, dev: 'dev replay'}[st2] || st2;
  if (el.dataset.status !== st2) { el.dataset.status = st2; el.querySelector('b').textContent = txt;
    el.title = {live: 'streaming the café as it is right now', 'offline-demo': 'backend unreachable: replaying a recorded morning', lagging: 'the simulation is catching up with the wall clock'}[st2] || txt; }
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
function render(s){
  if (!s) return;
  const t = R.now(), tod = R.tod(t), open = !!s.clock?.is_open, night = tod < 6.2 * 3600 || tod > 19.4 * 3600;
  $('.clock .time').textContent = `${s.clock?.weekday || ''} · ${R.hm12(t)}`;
  liveDot();
  const date = s.clock?.date ? new Date(s.clock.date + 'T00:00:00') : null;
  const fcN = perHour(s.rest?.forecast, t);
  const sig = [s.weather?.state, night, s.clock?.date, open, fcN, daypart(tod, open), s.kpis?.profit_today, s.kpis?.rating, s.kpis?.rating_n, s.policy?.policy, !!s.rest?.comparison].join('|');
  if (sig === hudSig) return; hudSig = sig;
  $('.clock .wx').innerHTML = weatherIcon(s.weather?.state, night);
  $('.clock .wx').setAttribute('aria-label', `${s.weather?.state || ''} ${s.weather?.temp_c != null ? Math.round(s.weather.temp_c) + '°C' : ''}`);
  const fc = $('.clock .fc');
  fc.hidden = false; fc.textContent = daypart(tod, open) + (fcN != null && open ? ` · ~${fcN} items/hr forecast` : s.weather?.temp_c != null ? ` · ${Math.round(s.weather.temp_c)}°C` : '');
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
}

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
const card = $('.money');
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
