/* brew — shared doodle kit. Ink helpers every room uses (I, st, C, th, use, head, eyes, brows, mouth, blush, torso,
   arm, chair, shortHair, sidePart, bubble, bag, plate, tx) and the procedural people generator `Doodle.person`:
   persona + appearance seed → the same hand-drawn customer on every reload (backend `customer.arrived`). */
const th = {pink:'#f7c3a3', pinkD:'#e07e52', pinkL:'#fdeee4', floor:'#f6e0d4', lip:'#eeab88', sky:'#fde0cf'};
const I = '#1d1a1c';
const st = (w = 3) => `stroke="${I}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
const C = {pink:th.pink, pinkD:th.pinkD, pinkL:th.pinkL, sage:'#8fa585', olive:'#6f7a4c', terra:'#c0634f',
           mustard:'#e3b25a', navy:'#3d4556', kraft:'#c9a27a', paper:'#fbf7f1'};
let seed = 11;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
const use = (id, x, y, w, h = w) => `<use href="#${id}" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
const tx = (x, y, s, sz = 14, opt = '') => `<text x="${x}" y="${y}" ${opt} font-family="Patrick Hand" font-size="${sz}" fill="${I}">${s}</text>`;
const gtx = (x, y, s, sz = 18, opt = '') => `<text x="${x}" y="${y}" ${opt} font-family="Gochi Hand" font-size="${sz}" fill="${I}">${s}</text>`;
/** a paper tag hanging on a short string from (x, y): marks a delivered investment ("new ♡ · 2nd press") */
const hangTag = (x, y, label, rot = 4, fill = th.pinkL) => { const w = label.length * 6.6 + 30;
  return `<g transform="translate(${x} ${y}) rotate(${rot})"><path d="M0 0q5 9 0 18" fill="none" ${st(1.6)}/><circle cx="0" cy="0" r="2.4" fill="${I}"/>`
    + `<rect x="${-w / 2}" y="18" width="${w}" height="24" rx="4" fill="${fill}" ${st(2)}/><circle cx="${-w / 2 + 10}" cy="30" r="2.8" fill="#fbf7f1" ${st(1.4)}/>`
    + tx(6, 35, label, 13, 'text-anchor="middle"') + `</g>`; };

/* ---------- faces ---------- */
const eyes = (x, y, lx = 0, ly = 0) =>
  `<ellipse cx="${x-9+lx}" cy="${y+2+ly}" rx="2.8" ry="4.3" fill="${I}"/><ellipse cx="${x+9+lx}" cy="${y+2+ly}" rx="2.8" ry="4.3" fill="${I}"/>`;
function brows(x, y, t){
  const d = {worried:`M${x-15} ${y-6}L${x-5} ${y-10}M${x+5} ${y-10}L${x+15} ${y-6}`,
             angry:`M${x-15} ${y-12}L${x-4} ${y-6}M${x+4} ${y-6}L${x+15} ${y-12}`,
             flat:`M${x-14} ${y-9}h9M${x+5} ${y-9}h9`}[t];
  return d ? `<path d="${d}" fill="none" ${st(2.5)}/>` : '';
}
function mouth(x, y, t){
  if (t === 'chew') return `<ellipse cx="${x+2}" cy="${y+15}" rx="3.6" ry="2.6" fill="${I}"/>`;
  if (t === 'o') return `<ellipse cx="${x}" cy="${y+15}" rx="3" ry="3.8" fill="none" ${st(2.2)}/>`;
  const d = {neutral:`M${x-4} ${y+15}h8`, smile:`M${x-6} ${y+13}q6 5 12 0`, frown:`M${x-6} ${y+17}q6-5 12 0`,
             grin:`M${x-7} ${y+12}q7 8 14 0z`}[t] || `M${x-4} ${y+15}h8`;
  return `<path d="${d}" fill="${t === 'grin' ? '#fff' : 'none'}" ${st(2.5)}/>`;
}
const blush = (x, y) => `<ellipse cx="${x-17}" cy="${y+11}" rx="5" ry="3" fill="${C.pink}"/><ellipse cx="${x+17}" cy="${y+11}" rx="5" ry="3" fill="${C.pink}"/>`;
const head = (x, y) => `<circle cx="${x}" cy="${y}" r="27" fill="#fff" ${st(3.2)}/>`;
const torso = (x, y, f) => `<path d="M${x-6} ${y+26}L${x+6} ${y+26}C${x+24} ${y+30} ${x+32} ${y+40} ${x+34} ${y+60}L${x+38} ${y+125}L${x-38} ${y+125}L${x-34} ${y+60}C${x-32} ${y+40} ${x-24} ${y+30} ${x-6} ${y+26}Z" fill="${f}" ${st(3)}/>`;
const arm = (sx, sy, cx, cy, ex, ey) => `<path d="M${sx} ${sy}Q${cx} ${cy} ${ex} ${ey}" fill="none" ${st(3.2)}/><circle cx="${ex}" cy="${ey}" r="4.6" fill="${I}"/>`;
const shortHair = (x, y, f) => `<path d="M${x-28} ${y-1}C${x-31} ${y-30} ${x-12} ${y-35} ${x} ${y-34}C${x+16} ${y-35} ${x+32} ${y-27} ${x+28} ${y-1}C${x+20} ${y-16} ${x+4} ${y-21} ${x-6} ${y-18}C${x-14} ${y-15} ${x-22} ${y-10} ${x-28} ${y-1}Z" fill="${f}" ${st(3)}/>`;
const sidePart = (x, y, f) => `<path d="M${x-28} ${y+4}C${x-32} ${y-28} ${x-6} ${y-36} ${x+6} ${y-33}C${x+24} ${y-30} ${x+32} ${y-14} ${x+28} ${y+4}C${x+22} ${y-12} ${x+10} ${y-18} ${x-2} ${y-16}C${x-10} ${y-6} ${x-20} ${y-2} ${x-28} ${y+4}Z" fill="${f}" ${st(3)}/>`;

/* ---------- furniture + props ---------- */
function chair(x, y = 500, h = 150){
  const b = y + h;
  return `<path d="M${x-46} ${b}V${y+40}Q${x-46} ${y} ${x} ${y}Q${x+46} ${y} ${x+46} ${y+40}V${b}" fill="${C.pink}" ${st(3)}/>
  <path d="M${x-34} ${b}V${y+46}Q${x-34} ${y+14} ${x} ${y+14}Q${x+34} ${y+14} ${x+34} ${y+46}V${b}" fill="none" ${st(1.6)}/>
  <circle cx="${x-20}" cy="${y+60}" r="2" fill="${I}"/><circle cx="${x+20}" cy="${y+60}" r="2" fill="${I}"/><circle cx="${x}" cy="${y+32}" r="2" fill="${I}"/>`;
}
function bubble(x, y, w, s, col = I){
  return `<rect x="${x-w/2}" y="${y}" width="${w}" height="32" rx="16" fill="#fff" ${st(2.4)}/>
  <path d="M${x-8} ${y+31}L${x-2} ${y+44}L${x+7} ${y+31}" fill="#fff" ${st(2.4)}/><path d="M${x-6.5} ${y+31}H${x+5.5}" stroke="#fff" stroke-width="3.5"/>
  ${tx(x, y + 22, s, 16, `text-anchor="middle" fill="${col}"`)}`;
}
const bubbleW = (s, min = 70) => Math.max(min, String(s).length * 7.4 + 28);
const B = 765;
function bag(x, col, base = B){
  let teeth = `M${x} ${base-96}`;
  for (let i = 0; i < 8; i++) teeth += `l7.75 ${i%2 ? 7 : -7}`;
  return `<path d="M${x} ${base-96}h62v96h-62z" fill="${C.kraft}" ${st(3)}/>
  <path d="${teeth}" fill="none" ${st(2)}/><path d="M${x} ${base-80}h62" ${st(1.6)} opacity=".5"/>
  <circle cx="${x+31}" cy="${base-50}" r="19" fill="none" stroke="${C.pinkD}" stroke-width="2.6" stroke-dasharray="40 4"/>
  <rect x="${x+5}" y="${base-22}" width="52" height="15" rx="3" fill="${col}" ${st(1.6)}/>`;
}
function plate(x, y, label, p, col){
  let s = `<rect x="${x-52}" y="${y}" width="104" height="${p == null ? 22 : 31}" rx="9" fill="#fffefb" ${st(2)} ${p == null ? 'stroke-dasharray="5 4"' : ''}/>`
    + tx(x, y + 16, label, 13.5, 'text-anchor="middle"');
  if (p != null) s += `<rect x="${x-42}" y="${y+20}" width="84" height="6" rx="3" fill="#eee" ${st(1.3)}/><rect x="${x-41.5}" y="${y+20.5}" width="${(83*Math.max(0, Math.min(1, p))).toFixed(1)}" height="5" rx="2.5" fill="${col}"/>`;
  return s;
}
const CHANNEL = {dine_in: {label: 'dine', col: C.pinkD}, takeaway: {label: 'takeaway', col: '#8a6a4a'},
                 zomato: {label: 'zomato', col: '#e23744'}, swiggy: {label: 'swiggy', col: '#fc8019'}};
const chan = (c) => CHANNEL[c] || {label: String(c || '').replace('_', ' '), col: C.navy};

/* ---------- procedural people ---------- */
/* Everyone is the same hand: white paper face, ink outline, flat token fills. The appearance seed picks hair,
   colours and accessories; the persona picks the outfit and props. Coordinates: head centre at (0, 0); a standing
   person's feet are at y = +190, a seated person's hips at y = +125. Scale and place with a transform. */
const Doodle = (() => {
  const mul = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
  const HAIR = ['#2b2a2e', '#3a2a22', '#5a3e2b', '#6b4a32', '#2f3647', '#3d4a3c', '#1d1a1c'];
  const GREY = '#8d8a90';
  const OUTFIT = {
    commuter:      {tops: [C.navy, '#4a5d7e', '#5e5f66'], kind: 'blazer'},
    student:       {tops: ['#9db592', C.mustard, C.pinkD, '#7fa9c6'], kind: 'hoodie'},
    leisurely:     {tops: ['#b5604c', C.terra, '#d08a3c', '#9b6fa8'], kind: 'drape'},
    remote_worker: {tops: [C.olive, '#8a7a5a', '#5d6740', C.sage], kind: 'cardigan'},
    family:        {tops: [C.mustard, '#e0554a', '#7fa9c6', C.pink], kind: 'tee'},
    office_bulk:   {tops: ['#fffdf9', '#dce6f0', '#f4e9d8'], kind: 'shirt'},
    tourist:       {tops: ['#f6d58e', '#9fd0e8', '#f4a7b9'], kind: 'tee'},
    regular:       {tops: ['#6d6f78', '#7a6a5a', '#5e5f66'], kind: 'cardigan'},
    delivery_home: {tops: ['#d6453d'], kind: 'tee'},
  };
  const hairShapes = {
    short: shortHair,
    side: sidePart,
    spiky: (x, y, f) => `<path d="M${x-27} ${y}L${x-30} ${y-18}L${x-20} ${y-16}L${x-22} ${y-32}L${x-8} ${y-24}L${x-2} ${y-38}L${x+8} ${y-26}L${x+20} ${y-34}L${x+18} ${y-20}L${x+30} ${y-20}L${x+27} ${y}C${x+16} ${y-14} ${x-12} ${y-14} ${x-27} ${y}Z" fill="${f}" ${st(3)}/>`,
    bun: (x, y, f) => `<circle cx="${x+3}" cy="${y-33}" r="11" fill="${f}" ${st(3)}/>` + `<path d="M${x-28} ${y+2}C${x-30} ${y-28} ${x-10} ${y-34} ${x+4} ${y-33}C${x+20} ${y-32} ${x+30} ${y-20} ${x+28} ${y}C${x+16} ${y-16} ${x-4} ${y-20} ${x-28} ${y+2}Z" fill="${f}" ${st(3)}/>`,
    long: (x, y, f) => `<path d="M${x-26} ${y-12}C${x-46} ${y+18} ${x-30} ${y+40} ${x-42} ${y+66}L${x-24} ${y+62}C${x-26} ${y+40} ${x-24} ${y+20} ${x-20} ${y+4}M${x+26} ${y-12}C${x+46} ${y+18} ${x+30} ${y+40} ${x+42} ${y+66}L${x+24} ${y+62}C${x+26} ${y+40} ${x+24} ${y+20} ${x+20} ${y+4}" fill="${f}" ${st(3)}/>` + sidePart(x, y, f),
    curly: (x, y, f) => { let d = `M${x-28} ${y+2}`; [[-32, -14], [-26, -28], [-14, -36], [0, -38], [14, -36], [26, -28], [32, -14], [28, 2]].forEach(([dx, dy]) => d += `A8 8 0 0 1 ${x+dx} ${y+dy}`);
      return `<path d="${d}C${x+14} ${y-12} ${x-14} ${y-12} ${x-28} ${y+2}Z" fill="${f}" ${st(3)}/>`; },
    bob: (x, y, f) => `<path d="M${x-30} ${y+20}C${x-36} ${y-30} ${x+36} ${y-30} ${x+30} ${y+20}L${x+22} ${y+20}C${x+24} ${y-2} ${x+10} ${y-14} ${x-2} ${y-14}C${x-14} ${y-6} ${x-22} ${y+4} ${x-22} ${y+20}Z" fill="${f}" ${st(3)}/>`,
    scarf: (x, y, f) => `<path d="M${x-31} ${y+30}C${x-40} ${y-36} ${x+40} ${y-36} ${x+31} ${y+30}C${x+24} ${y+38} ${x-24} ${y+38} ${x-31} ${y+30}Z" fill="${f}" ${st(3)}/>`,
    bald: (x, y) => `<path d="M${x-26} ${y-4}q-4 -6 0 -10M${x+26} ${y-4}q4 -6 0 -10" fill="none" ${st(2)} opacity=".5"/>`,
  };
  const STYLES = {
    commuter: ['short', 'side', 'side', 'bob', 'bald'],
    student: ['spiky', 'curly', 'short', 'bob', 'long'],
    leisurely: ['bun', 'long', 'scarf', 'bob'],
    remote_worker: ['side', 'curly', 'long', 'short'],
    family: ['short', 'bun', 'curly', 'long', 'bob'],
    office_bulk: ['side', 'short', 'bob', 'bald'],
    tourist: ['curly', 'long', 'short', 'bob'],
    regular: ['short', 'bald', 'side'],
    delivery_home: ['short'],
  };

  /** Stable look for one person: {hair, hairCol, top, kind, acc[], glasses, blush, persona}. */
  function look(seedN, persona){
    const r = mul(Number(seedN) || 1);
    const o = OUTFIT[persona] || OUTFIT.tee || OUTFIT.family;
    const hair = pick(r, STYLES[persona] || STYLES.family);
    const old = persona === 'regular' ? r() < .7 : r() < .12;
    const acc = [];
    if (persona === 'student' && r() < .6) acc.push('headphones');
    if (persona === 'commuter') acc.push(r() < .5 ? 'tie' : 'watch');
    if (persona === 'regular' && r() < .65) acc.push('beard');
    if (persona === 'regular' && r() < .4) acc.push('cap');
    if (persona === 'tourist') acc.push(r() < .5 ? 'sunhat' : 'camera');
    if (persona === 'office_bulk') acc.push('lanyard');
    if (persona === 'leisurely' && r() < .5) acc.push('flowers');
    if (persona === 'family' && r() < .3) acc.push('bow');
    return {hair, hairCol: old ? GREY : pick(r, HAIR), top: pick(r, o.tops), kind: o.kind, acc,
            glasses: persona === 'remote_worker' ? r() < .7 : r() < .15, blush: r() < .55, persona, lx: Math.round(r() * 4 - 2)};
  }

  function outfitDetail(L, y){
    switch (L.kind) {
      case 'blazer': return `<path d="M-9 ${y+29}L0 ${y+54}L9 ${y+29}Z" fill="#fff" ${st(2)}/>` + (L.acc.includes('tie') ? `<path d="M-3 ${y+33}l3 24l3-24z" fill="${C.terra}" ${st(1.6)}/>` : '');
      case 'hoodie': return `<path d="M-20 ${y+29}Q0 ${y+52} 20 ${y+29}" fill="${shade(L.top)}" ${st(2.5)}/><path d="M-6 ${y+42}l-1 22M6 ${y+42}l1 22" ${st(2)}/>`;
      case 'drape': return `<path d="M-34 ${y+88}L18 ${y+30}L27 ${y+37}L-28 ${y+98}Z" fill="${C.mustard}" ${st(2)}/><circle cx="20" cy="${y+32}" r="5" fill="${C.mustard}" ${st(2)}/>`;
      case 'cardigan': return `<path d="M-14 ${y+30}L-4 ${y+118}M14 ${y+30}L4 ${y+118}" ${st(2)}/>` + [56, 76, 96].map((d) => `<circle cx="-7" cy="${y+d}" r="2" fill="${I}"/>`).join('');
      case 'shirt': return `<path d="M-10 ${y+28}L0 ${y+40}L10 ${y+28}" fill="none" ${st(2)}/><path d="M0 ${y+40}V${y+118}" ${st(1.6)} opacity=".6"/>`;
      default: return `<path d="M-10 ${y+29}Q0 ${y+38} 10 ${y+29}" fill="none" ${st(2)}/>`;
    }
  }
  function shade(hex){ const n = parseInt(hex.slice(1), 16), k = .82;
    return '#' + [16, 8, 0].map((s) => Math.round(((n >> s) & 255) * k).toString(16).padStart(2, '0')).join(''); }

  function headTop(L, y){
    let s = '';
    if (L.hair === 'scarf') s += hairShapes.scarf(0, y, L.hairCol === GREY ? C.sage : shade(L.top));
    s += head(0, y);
    return s;
  }
  function face(L, y, mood){
    const m = {happy: ['smile', null], neutral: ['neutral', null], worried: ['frown', 'worried'], angry: ['frown', 'angry'],
               chew: ['chew', null], focused: ['neutral', 'flat'], delighted: ['grin', null], o: ['o', 'worried']}[mood] || ['neutral', null];
    let s = eyes(0, y, L.lx, mood === 'focused' ? 4 : 2) + (m[1] ? brows(0, y, m[1]) : '') + mouth(0, y, m[0]);
    if (L.blush || mood === 'happy' || mood === 'delighted') s += blush(0, y);
    if (L.glasses) s += `<circle cx="${-9+L.lx}" cy="${y+3}" r="7.5" fill="none" ${st(2)}/><circle cx="${9+L.lx}" cy="${y+3}" r="7.5" fill="none" ${st(2)}/><path d="M${-1.5+L.lx} ${y+3}h3" ${st(2)}/>`;
    return s;
  }
  function hairOn(L, y){
    let s = '';
    if (L.acc.includes('beard')) s += `<path d="M-22 ${y+8}C-20 ${y+40} -8 ${y+56} 0 ${y+62}C8 ${y+56} 20 ${y+40} 22 ${y+8}C14 ${y+18} 6 ${y+20} 0 ${y+18}C-6 ${y+20} -14 ${y+18} -22 ${y+8}Z" fill="${L.hairCol}" ${st(3)}/>`;
    if (L.hair === 'long') s += sidePart(0, y, L.hairCol);
    else if (L.hair !== 'scarf') s += hairShapes[L.hair](0, y, L.hairCol);
    if (L.acc.includes('headphones')) s += `<path d="M-30 ${y}C-34 ${y-46} 34 ${y-46} 30 ${y}" fill="none" stroke="${C.pinkD}" stroke-width="6" stroke-linecap="round"/><rect x="-37" y="${y-8}" width="12" height="20" rx="5" fill="${C.pinkD}" ${st(2)}/><rect x="25" y="${y-8}" width="12" height="20" rx="5" fill="${C.pinkD}" ${st(2)}/>`;
    if (L.acc.includes('cap')) s += `<path d="M-28 ${y-4}C-30 ${y-36} 30 ${y-36} 28 ${y-4}C14 ${y-12} -14 ${y-12} -28 ${y-4}Z" fill="#5e5f66" ${st(3)}/><path d="M26 ${y-8}L44 ${y-4}L42 ${y+2}L25 ${y-2}Z" fill="#5e5f66" ${st(2.5)}/>`;
    if (L.acc.includes('sunhat')) s += `<ellipse cx="0" cy="${y-16}" rx="44" ry="9" fill="#f6d58e" ${st(2.8)}/><path d="M-22 ${y-18}C-22 ${y-44} 22 ${y-44} 22 ${y-18}Z" fill="#f6d58e" ${st(2.8)}/><path d="M-22 ${y-22}H22" stroke="${C.pinkD}" stroke-width="4"/>`;
    if (L.acc.includes('flowers')) for (let a = -160; a <= -20; a += 23) { const r = a * Math.PI / 180;
      s += `<circle cx="${(29 * Math.cos(r)).toFixed(1)}" cy="${(y - 4 + 29 * Math.sin(r)).toFixed(1)}" r="4" fill="${(a / 23 | 0) % 2 ? C.mustard : C.pinkL}" ${st(1.5)}/>`; }
    if (L.acc.includes('bow')) s += `<path d="M14 ${y-26}l10-8v16zM14 ${y-26}l-10-8v16z" fill="${C.pinkD}" ${st(2)}/>`;
    return s;
  }
  const legs = (y, walking) => `<g class="leg leg-l"><path d="M-10 ${y+120}L-12 ${y+188}" fill="none" ${st(3.2)}/><ellipse cx="-16" cy="${y+190}" rx="8" ry="4" fill="${I}"/></g>
    <g class="leg leg-r"><path d="M10 ${y+120}L12 ${y+188}" fill="none" ${st(3.2)}/><ellipse cx="16" cy="${y+190}" rx="8" ry="4" fill="${I}"/></g>`;

  /** One person. opts: {seed, persona, pose: 'stand'|'sit'|'walk', mood, laptop, holding: sku|null, phone, bag}.
      Returns {body, front}: `front` goes over the table (arms, laptop, cup) when seated, '' when standing. */
  function person(opts){
    const L = look(opts.seed, opts.persona), y = 0, pose = opts.pose || 'stand', mood = opts.mood || 'neutral';
    let body = '', front = '';
    if (L.hair === 'long') body += `<path d="M-26 ${y-12}C-46 ${y+18} -30 ${y+40} -42 ${y+66}L-24 ${y+62}C-26 ${y+40} -24 ${y+20} -20 ${y+4}ZM26 ${y-12}C46 ${y+18} 30 ${y+40} 42 ${y+66}L24 ${y+62}C26 ${y+40} 24 ${y+20} 20 ${y+4}Z" fill="${L.hairCol}" ${st(3)}/>`;
    if (pose !== 'sit') body += legs(y);
    if (L.acc.includes('camera') || opts.persona === 'student' && !L.acc.includes('headphones')) body += `<rect x="-44" y="${y+40}" width="26" height="56" rx="8" fill="${shade(L.top)}" ${st(2.5)}/>`;
    body += torso(0, y, L.top) + outfitDetail(L, y);
    if (L.acc.includes('lanyard')) body += `<path d="M-12 ${y+30}L0 ${y+62}L12 ${y+30}" fill="none" stroke="${C.pinkD}" stroke-width="2.5"/><rect x="-7" y="${y+60}" width="14" height="18" rx="2" fill="#fff" ${st(1.8)}/>`;
    if (L.acc.includes('camera')) body += `<rect x="-12" y="${y+52}" width="24" height="16" rx="3" fill="${C.navy}" ${st(2)}/><circle cx="0" cy="${y+60}" r="4.5" fill="#cfe7f5" ${st(1.5)}/>`;
    body += headTop(L, y) + face(L, y, mood) + hairOn(L, y);
    const cup = opts.holding ? use(opts.holding, -17, y + 62, 34) : '';
    if (pose === 'sit') {
      if (opts.laptop) front += `<path d="M-36 ${y+120}L-31 ${y+76}L31 ${y+76}L36 ${y+120}Z" fill="#e8e2dc" ${st(3)}/><circle cx="0" cy="${y+97}" r="7" fill="${C.pink}" ${st(1.8)}/>`
        + arm(-28, y+46, -46, y+96, -24, y+112) + arm(28, y+46, 46, y+96, 24, y+112);
      else if (mood === 'chew' || opts.holding) front += arm(-28, y+46, -46, y+100, -24, y+116) + arm(28, y+46, 52, y+92, 22, y+66) + (opts.holding ? use(opts.holding, 4, y + 42, 34) : '');
      else front += arm(-28, y+46, -48, y+88, -26, y+104) + arm(28, y+46, 48, y+88, 26, y+104);
    } else if (opts.phone) {
      body += arm(-28, y+46, -48, y+98, -14, y+84) + `<rect x="-24" y="${y+66}" width="13" height="22" rx="3" fill="${C.navy}" ${st(2)} transform="rotate(-12 -18 ${y+77})"/>` + arm(28, y+46, 40, y+92, 34, y+120);
    } else if (cup) {
      body += arm(-28, y+46, -40, y+92, -34, y+116) + arm(28, y+46, 40, y+86, 4, y+80) + use(opts.holding, -8, y + 52, 32);
    } else {
      body += arm(-28, y+46, -40, y+92, -34, y+116) + arm(28, y+46, 40, y+92, 34, y+116);
    }
    return {body, front};
  }
  return {person, look, shade};
})();

/* sku → doodle symbol (lobby/kitchen/pantry <symbol>s) */
const SKU_ICON = { cappuccino: 'latte', latte: 'latte', flatwhite: 'latte', roselatte: 'latte', espresso: 'k-cup', filtercoffee: 'k-cup',
  icedlatte: 'coldbrew', coldbrew: 'coldbrew', matcha: 'matcha', chai: 'k-cup', hotchoc: 'k-cup', rosemilk: 'k-smoothie',
  strawberryshake: 'k-smoothie', croissant: 'croissant', cinnamon: 'croissant', muffin: 'cake', cheesecake: 'cake', waffle: 'toast',
  avotoast: 'k-avo', sandwich: 'k-panini', cheesetoast: 'toast', fries: 'k-fries', pasta: 'p-plate' };
const skuIcon = (sku) => SKU_ICON[sku] || 'p-plate';
const PERSONA = { commuter: 'commuter', student: 'student', leisurely: 'leisurely', remote_worker: 'laptop camper', family: 'family',
  office_bulk: 'office order', tourist: 'tourist', regular: 'the regular', delivery_home: 'delivery' };
