/* brew — pantry room: walk-in fridge + dry store. The shelves are drawn once; what sits on them, how full it is,
   the lot tags (first expiry, first out), the hover card (lots, today's usage forecast P50/P90, cover, reorder,
   CO₂e, supplier) and the three panels (freshness by value, days of cover, next delivery + approve) all come from
   the live inventory read models (GET /inventory, /inventory/{key}/lots, /inventory/{key}/forecast,
   /purchasing/proposal, /impact). Reuses doodles.js + render.js and kitchen.js symbols (k-*). */
(() => {
const K = {steel:'#e4e7eb', steelD:'#c7cdd4', steelL:'#f2f4f6', wood:'#c99a6e', woodD:'#a87a52', glass:'#e6f1f4', brew:'#6b3f26', chrome:'#d9dee3'};
const FR = {fresh:'#bfe6cf', mid:'#f6c76a', bad:'#ef7d6d', none:'#ece4d8'};
const S = [318, 498, 678];                      // shelf deck heights, top to bottom
const t = tx, gt = gtx;
const covCol = c => c == null ? FR.none : c < 1 ? FR.bad : c < 2 ? FR.mid : FR.fresh;

/* ---------- shelf slots → real inventory keys (the art per slot stays hand-drawn) ---------- */
const SLOTS = [
  // walk-in · top shelf
  {id:'oat_milk', kind:'carton', s:0, x:218, w:112, h:84, col:'#e3c27a', unitsMax:4},
  {id:'milk', kind:'carton', s:0, x:338, w:104, h:84, col:'#8fb9de', unitsMax:3},
  {id:'almond_milk', kind:'carton', s:0, x:450, w:84, h:66, col:'#f2d78f', cw:24, ch:40, unitsMax:3},
  {id:'butter', kind:'blocks', s:0, x:545, w:80, h:52, col:'#f7e3a0', lab:'#fff', bw:30, bh:15, unitsMax:3},
  {id:'paneer', kind:'blocks', s:0, x:655, w:96, h:70, col:'#f8f4e8', lab:C.pink, unitsMax:5},
  {id:'strawberry_puree', kind:'jugs', s:0, x:785, w:134, h:64, jcol:'#e0554a'},
  {id:'avocado', kind:'crate', s:0, x:930, w:124, h:58, fruit:'avo', unitsMax:9},
  // walk-in · middle shelf
  {id:'croissant_dough', kind:'trays', s:1, x:232, w:140, h:96, unitsMax:4},
  {id:'cheddar', kind:'blocks', s:1, x:380, w:90, h:52, col:'#f3c94e', lab:'#fff', bw:36, bh:18, unitsMax:3},
  {id:'parmesan', kind:'blocks', s:1, x:494, w:96, h:52, col:'#f6ecc8', lab:C.sage, bw:30, bh:14, unitsMax:3},
  {id:'green_chilli', kind:'crate', s:1, x:660, w:116, h:58, fruit:'chilli', unitsMax:8},
  {id:'microgreens', kind:'greens', s:1, x:778, w:96, h:48},
  {id:'mint_chutney', kind:'deli', s:1, x:898, w:120, h:66, cupCol:'#9cbf7a'},
  {id:'tikka_masala', kind:'tubs', s:1, x:1002, w:62, h:76},
  // walk-in · bottom shelf
  {id:'coldbrew_concentrate', kind:'jugs', s:2, x:240, w:112, h:80, jcol:K.brew, nj:2},
  {id:'chai_base', kind:'jugs', s:2, x:425, w:150, h:78, jcol:'#c58b5e', nj:3},
  {id:'rescue', kind:'rescue', s:2, x:700, w:150, h:66},
  {id:'arrabbiata_sauce', kind:'cases', s:2, x:880, w:150, h:78, ccol:'#e0554a', unitsMax:3},
  // dry store
  {id:'coffee_beans', kind:'sacks', s:0, x:1190, w:172, h:88},
  {id:'decaf_beans', kind:'pouch', s:0, x:1330, w:70, h:68, unitsMax:2},
  {id:'matcha_powder', kind:'tins', s:0, x:1425, w:86, h:56, tcol:'#8fbf6a', unitsMax:3},
  {id:'dark_choc', kind:'tins', s:0, x:1526, w:86, h:56, tcol:'#8a5a3c', unitsMax:2},
  {id:'waffle_mix', kind:'bin', s:1, x:1162, w:104, h:98, bcol:'#fbf7ee', lid:C.pink},
  {id:'sugar', kind:'bin', s:1, x:1292, w:100, h:98, bcol:'#fffdf7', lid:'#b9cdb0', sparkle:true},
  {id:'rose_syrup', kind:'bottles', s:1, x:1460, w:170, h:92, c:['#f3b0c0', '#d08a3c', '#f3b0c0', '#8a5a3c']},
  {id:'cup_paper_m', kind:'cups', s:2, x:1160, w:120, h:110},
  {id:'lid', kind:'lids', s:2, x:1285, w:90, h:44},
  {id:'kraft_bag', kind:'bagstack', s:2, x:1400, w:110, h:74, unitsMax:9},
  {id:'straw', kind:'straws', s:2, x:1520, w:100, h:82},
];
const BY = Object.fromEntries(SLOTS.map((it) => [it.id, it]));
/* fill the drawing parameters from a fill fraction (on hand / par) */
function shaped(slot, frac){
  const f = Math.max(0, Math.min(1.15, frac ?? .5)), n = (m) => Math.max(f > .01 ? 1 : 0, Math.min(m, Math.round(m * Math.min(1, f) + .2)));
  const o = {...slot};
  switch (slot.kind) {
    case 'carton': o.n = Math.max(1, n(slot.unitsMax)); o.lvl = Math.min(1, f * slot.unitsMax - (o.n - 1)) || .15; o.open = f < .98; break;
    case 'blocks': case 'trays': case 'cases': case 'tins': case 'pouch': case 'bagstack': o.n = n(slot.unitsMax); o.open = f < .98; break;
    case 'crate': o.n = n(slot.unitsMax); break;
    case 'jugs': { const k = slot.nj || 2; o.lv = Array.from({length: k}, (_, i) => Math.max(0, Math.min(1, f * k - i))); o.col = slot.jcol; break; }
    case 'bin': o.lvl = Math.min(1, f); break;
    case 'sacks': o.f = [0, 1, 2].map((i) => Math.max(0, Math.min(1, f * 3 - i))).reverse(); o.open = 0; break;
    case 'bottles': o.lv = [0, 1, 2, 3].map((i) => Math.max(.08, Math.min(1, f * 4 - i))); break;
    case 'cups': o.hs = [100, 78, 56].map((h, i) => Math.max(0, Math.min(h, h * (f * 3 - i)))).filter((h) => h > 6); break;
    case 'lids': o.hs = [Math.round(6 * Math.min(1, f * 2)), Math.round(6 * Math.max(0, f * 2 - 1))].filter(Boolean); break;
    case 'deli': o.cups = Array.from({length: Math.max(1, n(5))}, (_, i) => i % 2 ? '#cfe0a8' : slot.cupCol); break;
    default: break;
  }
  return o;
}
/* ---------- item drawings (local: cx = centre, b = base line) ---------- */
function cartonUnit(x, b, w, h, col, open, lvl, back){
  const top = b - h, g = Math.round(w * .45);
  let s = `<path d="M${x+w} ${b}V${top}l7-4V${b-4}Z" fill="#e2ddd5" ${st(2.2)}/>
  <path d="M${x} ${b}V${top}L${x + w/2} ${top - g}L${x + w} ${top}V${b}Z" fill="${back ? '#f4f1ec' : '#fff'}" ${st(2.5)}/>
  <rect x="${x}" y="${top + h*.38}" width="${w}" height="${h*.28}" fill="${col}" ${st(1.8)}/>
  <rect x="${x + w/2 - 8}" y="${top - g - 5}" width="16" height="5" rx="1" fill="#fff" ${st(1.8)}/>`;
  if (open) s += `<path d="M${x+3} ${top-3}L${x-7} ${top-10}L${x+1} ${top-16}L${x+10} ${top-8}Z" fill="#fff" ${st(2)}/><path d="M${x-7} ${top-10}L${x+10} ${top-8}" ${st(1.4)}/>`;
  else s += `<circle cx="${x + w/2}" cy="${top - 3}" r="3.2" fill="${C.sage}" ${st(1.2)}/>`;
  if (!back) { const wy = top + 6, wh = h - 12, fy = wy + wh * (1 - lvl);
    s += `<rect x="${x + 4}" y="${wy}" width="7" height="${wh}" rx="3.5" fill="#f4f6f8" ${st(1.5)}/><rect x="${x + 5}" y="${fy}" width="5" height="${wy + wh - fy - 1}" rx="2.5" fill="${col}"/>`; }
  return s;
}
const fruit = (k, x, y) => k === 'chilli'
  ? `<path d="M${x-10} ${y-4}q8 14 22 4q-12 2-18-8z" fill="#6f9a5a" ${st(1.8)} transform="rotate(${(x * 11) % 40 - 20} ${x} ${y})"/><path d="M${x-10} ${y-4}l-4-3" ${st(1.6)}/>`
  : k === 'avo'
  ? `<ellipse cx="${x}" cy="${y}" rx="9" ry="11.5" fill="#5f7d3a" ${st(2)} transform="rotate(${(x * 7) % 30 - 15} ${x} ${y})"/><path d="M${x-3} ${y-5}q2-3 5-3" stroke="#a5c27a" stroke-width="2" fill="none" stroke-linecap="round"/>`
  : `<circle cx="${x}" cy="${y}" r="10" fill="#e0554a" ${st(2)}/><path d="M${x-5} ${y-9}l5 3l5-3l-2 4h-6z" fill="#6f9a5a" ${st(1.3)}/><path d="M${x-6} ${y-1}q1-4 4-5" stroke="#fff" stroke-width="2" fill="none" opacity=".7" stroke-linecap="round"/>`;

const DRAW = {
  carton(cx, b, o){ const cw = o.cw || 30, ch = o.ch || 56, x0 = cx - cw/2 - (o.n - 1) * 7; let s = '';
    for (let i = o.n - 1; i >= 1; i--) s += cartonUnit(x0 + i * 16, b - i * 3, cw, ch, o.col, false, 1, true);
    return s + cartonUnit(x0, b, cw, ch, o.col, o.open, o.lvl, false); },
  blocks(cx, b, o){ const bw = o.bw || 40, bh = o.bh || 18; let s = '';
    for (let i = 0; i < o.n; i++){ const row = Math.floor(i / 2), c = i % 2;
      if (row % 2 && c) continue;
      const x = cx - bw - 2 + c * (bw + 4) + (row % 2 ? bw / 2 + 2 : 0), y = b - (row + 1) * (bh + 2);
      s += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="5" fill="${o.col}" ${st(2.3)}/><path d="M${x+5} ${y+4}q4 3 0 6M${x+bw-6} ${y+5}q-4 3 0 7" fill="none" ${st(1.2)} opacity=".45"/>
      <rect x="${x + bw/2 - 7}" y="${y + bh/2 - 4}" width="14" height="8" rx="2" fill="${o.lab}" ${st(1.2)}/>`;
      if (o.open && i === 0) s += `<path d="M${x+bw} ${y}h-11l11 9z" fill="#fff" ${st(1.6)}/>`; }
    return s; },
  _punnets(cx, b, o){ const pw = 40, ph = 24; let s = '';
    for (let i = 0; i < o.n; i++){ const row = i < 3 ? 0 : 1, c = row ? i - 3 : i;
      const x = cx - 1.5 * pw - 3 + c * (pw + 3) + (row ? pw / 2 + 2 : 0), y = b - (row + 1) * (ph + 3), bc = o.berries[i];
      for (let k = 0; k < 4; k++) s += `<circle cx="${x + 7 + k * 9}" cy="${y + 3 - (k % 2) * 2}" r="5.5" fill="${bc}" ${st(1.6)}/>`;
      if (o.bad.includes(i)) s += `<g fill="#c7cfb4" ${st(1)}>${[0, 1, 2].map(k => `<circle cx="${x + 10 + k * 9}" cy="${y - 1}" r="2.6"/>`).join('')}</g>`;
      s += `<path d="M${x} ${y+2}h${pw}l-3 ${ph-2}h${-(pw-6)}z" fill="#e8f3f7" fill-opacity=".72" ${st(2.2)}/>
      <circle cx="${x+12}" cy="${y+15}" r="5" fill="${bc}" opacity=".8"/><circle cx="${x+26}" cy="${y+16}" r="5" fill="${bc}" opacity=".8"/>
      <path d="M${x+7} ${y+7}v${ph-9}M${x+20} ${y+7}v${ph-9}M${x+33} ${y+7}v${ph-9}" ${st(1)} opacity=".3"/>`; }
    return s; },
  crate(cx, b, o){ const cw = o.w - 14, ch = 32, x = cx - cw / 2, back = Math.ceil(o.n / 2), front = o.n - back;
    const row = (cnt, yy, off) => { let r = ''; for (let i = 0; i < cnt; i++) r += fruit(o.fruit, x + 14 + off + i * ((cw - 28 - off) / Math.max(1, cnt - 1)), yy); return r; };
    return row(back, b - ch - 8, 0) + row(front, b - ch + 1, 9)
      + `<rect x="${x}" y="${b-ch}" width="${cw}" height="${ch}" rx="3" fill="${o.fruit === 'avo' ? K.wood : o.fruit === 'chilli' ? '#d9b48a' : '#8fb3c9'}" ${st(2.5)}/><path d="M${x} ${b-ch+11}h${cw}M${x} ${b-ch+22}h${cw}" ${st(1.5)}/><rect x="${cx-11}" y="${b-ch+3}" width="22" height="6" rx="3" fill="${I}" opacity=".65"/>`; },
  trays(cx, b, o){ const tw = 130, x = cx - tw / 2; let s = `<path d="M${x+4} ${b}V${b - o.n * 22 - 6}M${x+tw-4} ${b}V${b - o.n * 22 - 6}" ${st(3)}/>`;
    for (let i = 0; i < o.n; i++){ const y = b - 6 - i * 22;
      s += `<rect x="${x}" y="${y}" width="${tw}" height="5" rx="2" fill="${K.steel}" ${st(2)}/>`;
      for (let k = 0; k < 5; k++) s += `<path d="M${x + 11 + k * 23} ${y}c2-10 15-10 17 0z" fill="#f3dfb5" ${st(1.6)}/><path d="M${x + 15 + k * 23} ${y - 2}q4-4 9 0" fill="none" ${st(1)} opacity=".5"/>`;
      if (i > 0) s += `<path d="M${x+2} ${y}q${tw/2 - 2} -17 ${tw - 4} 0" fill="#e6f1f4" fill-opacity=".5" ${st(1.4)}/>`; }
    return s; },
  eggs(cx, b, o){ const fw = 86, x = cx - fw / 2; let s = '';
    for (let i = 0; i < o.n; i++){ const y = b - i * 10; s += `<path d="M${x} ${y}v-8${' q5.4 -6 10.75 0'.repeat(8)}v8z" fill="#d9c7a8" ${st(2)}/>`; }
    const ty = b - o.n * 10 + 2;
    for (let k = 0; k < 7; k++) s += `<ellipse cx="${x + 8 + k * 11.7}" cy="${ty - 7}" rx="5.5" ry="7" fill="${k % 3 ? '#f6ecdc' : '#e7c9a2'}" ${st(1.6)}/>`;
    return s; },
  greens(cx, b){ const w = 84, x = cx - w / 2; let s = '';
    for (let k = 0; k < 6; k++) s += `<path d="M${x + 8 + k * 12} ${b-14}c-6-14 8-26 14-12c4 8-6 14-14 12z" fill="${k % 2 ? '#8fbf6a' : '#6f9a5a'}" ${st(1.6)}/>`;
    return s + `<path d="M${x} ${b-38}h${w}l-3 38h${-(w-6)}z" fill="#e8f3f7" fill-opacity=".55" ${st(2.3)}/><path d="M${x-2} ${b-38}h${w+4}" ${st(2.5)}/><path d="M${x+6} ${b-30}l6-4" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>`; },
  deli(cx, b, o){ const dw = 34; let s = '';
    o.cups.forEach((c, i) => { const col = i < 3 ? i : i - 3 + .5, row = i < 3 ? 0 : 1, x = cx - 56 + col * 38, y = b - (row + 1) * 30;
      s += `<path d="M${x} ${y+4}h${dw}l-2 26h${-(dw-4)}z" fill="#f4f8fa" fill-opacity=".85" ${st(2.2)}/><path d="M${x+2.2} ${y+12}h${dw-4.4}l-1.3 17.5h${-(dw-7)}z" fill="${c}"/>
      <rect x="${x-1}" y="${y}" width="${dw+2}" height="6" rx="2" fill="#eef3f6" ${st(2)}/><rect x="${x+6}" y="${y+14}" width="22" height="7" fill="#f3e2c8" ${st(1)}/>`; });
    return s; },
  tubs(cx, b){ const w = 46, x = cx - w / 2;
    return `<path d="M${x} ${b-34}h${w}l-3 34h${-(w-6)}z" fill="#fff" ${st(2.3)}/><rect x="${x+4}" y="${b-24}" width="${w-8}" height="10" fill="${C.pinkL}" ${st(1.2)}/><rect x="${x-2}" y="${b-38}" width="${w+4}" height="6" rx="2" fill="${C.pink}" ${st(2)}/>
    <path d="M${x} ${b-72}h${w}l-3 34h${-(w-6)}z" fill="#fff" ${st(2.3)}/><rect x="${x+4}" y="${b-62}" width="${w-8}" height="10" fill="${C.pinkL}" ${st(1.2)}/>
    <rect x="${x+4}" y="${b-82}" width="${w+4}" height="6" rx="2" fill="${C.pink}" ${st(2)} transform="rotate(-14 ${x+4} ${b-76})"/>
    <path d="M${x+28} ${b-70}l10-22" ${st(3)}/><ellipse cx="${x+39}" cy="${b-94}" rx="4" ry="6" fill="${K.steelL}" ${st(1.6)} transform="rotate(24 ${x+39} ${b-94})"/>`; },
  jugs(cx, b, o){ let s = ''; const sp = o.lv.length > 2 ? 46 : 54;
    o.lv.forEach((lv, i) => { const x = cx - (o.lv.length - 1) * sp / 2 - 22 + i * sp, w = 44, h = 66, top = b - h, ly = b - 4 - (h - 30) * lv;
      const body = `M${x+12} ${top}h20v8q12 4 12 16v${h-28}q0 4-4 4h-36q-4 0-4-4v${-(h-28)}q0-12 12-16z`;
      s += `<path d="${body}" fill="${K.glass}" ${st(2.5)}/><rect x="${x+3}" y="${ly}" width="${w-6}" height="${b - 3 - ly}" rx="3" fill="${o.col || K.brew}"/><path d="${body}" fill="none" ${st(2.5)}/>
      <path d="M${x+6} ${top+26}v16" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".7"/>
      <rect x="${x+11}" y="${top-7}" width="22" height="8" rx="2" fill="${C.navy}" ${st(2)}/><rect x="${x+9}" y="${b-30}" width="26" height="13" rx="2" fill="#fff" ${st(1.6)}/>`; });
    return s; },
  cases(cx, b, o){ const w = 66, h = 34; let s = '';
    for (let i = 0; i < o.n; i++){ const row = i < 2 ? 0 : 1, x = cx - w - 2 + (row ? w / 2 + 2 : i * (w + 4)), y = b - (row + 1) * (h + 2);
      s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="#d9b48a" ${st(2.4)}/><rect x="${x + w/2 - 7}" y="${y}" width="14" height="${h}" fill="#e9d2b4" opacity=".8"/>
      <path d="M${x+8} ${y+28}v-14l5-5l5 5v14z" fill="#fff" ${st(1.5)}/><rect x="${x+8}" y="${y+17}" width="10" height="5" fill="${o.ccol}"/>
      <path d="M${x+44} ${y+12}v14M${x+48} ${y+12}v14M${x+52} ${y+12}v14M${x+56} ${y+12}v14M${x+42} ${y+22}l16-6" ${st(1.4)}/>`; }
    return s; },
  rescue(cx, b){ const w = 132, x = cx - w / 2;
    return use('k-milk', x + 14, b - 66, 34) + `<path d="M${x+52} ${b-52}h36l-3 20h-30z" fill="#e8f3f7" ${st(2)}/>` + [0, 1, 2].map(k => `<circle cx="${x + 59 + k * 10}" cy="${b - 52}" r="5" fill="#e0554a" ${st(1.4)}/>`).join('')
      + `<path d="M${x+96} ${b-50}h24l-2 18h-20z" fill="#f4f8fa" ${st(2)}/><path d="M${x+98} ${b-44}h20l-1.4 11h-17z" fill="#d7e69a"/>`
      + `<rect x="${x}" y="${b-36}" width="${w}" height="36" rx="4" fill="#ef7d6d" ${st(2.6)}/><path d="M${x} ${b-24}h${w}M${x} ${b-12}h${w}" ${st(1.3)} opacity=".45"/>
      <rect x="${x + 22}" y="${b-31}" width="${w - 44}" height="18" rx="3" fill="#fff" ${st(1.8)}/>`; },
  sacks(cx, b, o){ let s = '';
    o.f.forEach((f, i) => { const w = 54, x = cx - 82 + i * 54, h = 40 + 42 * f, top = b - h, open = o.open === i;
      const neck = open ? `L${x+6} ${top+6}Q${x + w/2} ${top-4} ${x+w-6} ${top+6}` : `L${x + w/2 - 8} ${top}L${x + w/2 - 12} ${top - 12}L${x + w/2 + 12} ${top - 12}L${x + w/2 + 8} ${top}`;
      s += `<path d="M${x} ${b}Q${x-6} ${b - h * .55} ${x+6} ${top+8}${neck}L${x+w-6} ${top+8}Q${x+w+6} ${b - h * .55} ${x+w} ${b}Z" fill="#c8a477" ${st(2.5)}/>
      <path d="M${x+8} ${b-12}q${w/2-8} 5 ${w-16} 0M${x+6} ${b-26}q${w/2-6} 5 ${w-12} 0" fill="none" ${st(1)} opacity=".35"/>
      <circle cx="${x + w/2}" cy="${b - h * .42}" r="12" fill="none" stroke="${C.pinkD}" stroke-width="2.4"/>`;
      if (open) s += `<ellipse cx="${x + w/2}" cy="${top + 7}" rx="${w/2 - 7}" ry="5" fill="#5a3a26" ${st(2)}/>` + [-10, -2, 7].map(d => `<ellipse cx="${x + w/2 + d}" cy="${top + 6}" rx="3.2" ry="2" fill="#8a5a3c"/>`).join('') + `<path d="M${x + w/2 + 4} ${top + 6}l14-20" ${st(3)}/><rect x="${x + w/2 + 12}" y="${top - 22}" width="10" height="8" rx="2" fill="${K.steelL}" ${st(1.6)} transform="rotate(-35 ${x + w/2 + 17} ${top - 18})"/>`;
      else s += `<path d="M${x + w/2 - 9} ${top + 1}h18" stroke="${C.pinkD}" stroke-width="3"/>`; });
    return s; },
  pouch(cx, b, o){ let s = '';
    for (let i = o.n - 1; i >= 0; i--){ const x = cx - 24 + i * 12, top = b - 58 + i * 4;
      s += `<path d="M${x} ${b}L${x+2} ${top+6}h36l2 ${b - top - 6}z" fill="${i ? '#5a6478' : C.navy}" ${st(2.4)}/><path d="M${x+2} ${top+12}h36" ${st(1.4)} opacity=".6"/><circle cx="${x+20}" cy="${top+22}" r="3.5" fill="#fff" ${st(1.4)}/><rect x="${x+8}" y="${top+32}" width="24" height="12" rx="2" fill="${C.pinkL}" ${st(1.4)}/>`; }
    return s; },
  tins(cx, b, o){ let s = '';
    for (let i = 0; i < o.n; i++){ const x = cx - o.n * 15 + i * 30;
      s += `<rect x="${x}" y="${b-44}" width="26" height="44" rx="3" fill="${o.tcol}" ${st(2.3)}/><rect x="${x}" y="${b-30}" width="26" height="14" fill="#fff" ${st(1.4)}/><circle cx="${x+13}" cy="${b-23}" r="4" fill="${o.tcol}"/>`;
      s += o.open && i === 0 ? `<rect x="${x-4}" y="${b-56}" width="28" height="7" rx="2" fill="${o.tcol}" ${st(2)} transform="rotate(-22 ${x} ${b-50})"/><ellipse cx="${x+13}" cy="${b-44}" rx="11" ry="2.5" fill="#a9c98a"/>` : `<rect x="${x-2}" y="${b-50}" width="30" height="8" rx="2" fill="${o.tcol}" ${st(2)}/>`; }
    return s; },
  bin(cx, b, o){ const w = 92, h = 84, x = cx - w / 2, top = b - h, ly = b - 10 - (h - 28) * o.lvl;
    let s = `<rect x="${x}" y="${top+10}" width="${w}" height="${h-10}" rx="6" fill="#f4f8fa" ${st(2.8)}/><rect x="${x+5}" y="${ly}" width="${w-10}" height="${b - 7 - ly}" rx="3" fill="${o.bcol}" ${st(1.4)}/>`;
    if (o.sparkle) s += [[12, 8], [30, 14], [52, 6], [70, 12]].map(([dx, dy]) => `<path d="M${x+dx} ${ly+dy}h4M${x+dx+2} ${ly+dy-2}v4" ${st(1)} opacity=".45"/>`).join('');
    else s += [[14, 10], [34, 18], [58, 8], [76, 16]].map(([dx, dy]) => `<circle cx="${x+dx}" cy="${ly+dy}" r="1.4" fill="${I}" opacity=".25"/>`).join('');
    s += `<path d="M${x + w - 18} ${ly + 4}l10 -30" ${st(3)}/><path d="M${x+w-24} ${ly+4}q6 8 12 0" fill="${K.steelL}" ${st(1.8)}/>
    ${[.25, .5, .75].map(f => `<path d="M${x + w - 4} ${b - 10 - (h - 28) * f}h-6" ${st(1.4)}/>`).join('')}
    <path d="M${x-3} ${top+12}L${x+w+3} ${top+12}L${x+w-8} ${top-4}L${x+8} ${top-4}Z" fill="${o.lid}" ${st(2.6)}/>
    <circle cx="${x+14}" cy="${b+1}" r="4" fill="${I}"/><circle cx="${x+w-14}" cy="${b+1}" r="4" fill="${I}"/>`;
    return s; },
  bottles(cx, b, o){ let s = '';
    o.c.forEach((c, i) => { const x = cx - 74 + i * 38, w = 30, h = 76, top = b - h, ly = b - 4 - (h - 40) * o.lv[i];
      const body = `M${x+9} ${top+16}h12v8q9 4 9 12v${h-40}q0 4-4 4h-22q-4 0-4-4v${-(h-40)}q0-8 9-12z`;
      s += `<path d="${body}" fill="${K.glass}" fill-opacity=".8" ${st(2.3)}/><rect x="${x+3}" y="${ly}" width="${w-6}" height="${b - 3 - ly}" rx="3" fill="${c}"/><path d="${body}" fill="none" ${st(2.3)}/>
      <rect x="${x+11}" y="${top+6}" width="8" height="10" fill="${I}"/><rect x="${x+6}" y="${top}" width="18" height="7" rx="2" fill="${I}"/><path d="M${x+24} ${top+3}h8" ${st(2.5)}/>
      <rect x="${x+5}" y="${b-34}" width="20" height="14" rx="2" fill="#fff" ${st(1.4)}/>`; });
    return s; },
  cups(cx, b, o){ let s = '';
    o.hs.forEach((hh, i) => { const x = cx - 52 + i * 36, w = 30, top = b - hh;
      s += `<path d="M${x} ${top}h${w}l-4 ${hh}h${-(w-8)}z" fill="#fff" ${st(2.3)}/>`;
      for (let y = top + 14; y < b - 3; y += 6) s += `<path d="M${x+2} ${y}h${w-4}" ${st(1)} opacity=".3"/>`;
      s += `<rect x="${x+1}" y="${top}" width="${w-2}" height="10" fill="${C.pink}" ${st(1.4)}/>`;
      if (i) s += `<rect x="${x-2}" y="${top + 16}" width="${w+4}" height="${hh - 16}" rx="3" fill="#e6f1f4" fill-opacity=".45" ${st(1.4)}/>`; });
    return s; },
  lids(cx, b, o){ let s = '';
    o.hs.forEach((cnt, i) => { const x = cx - 36 + i * 38;
      for (let k = 0; k < cnt; k++) s += `<ellipse cx="${x + 15}" cy="${b - 4 - k * 4}" rx="15" ry="3.6" fill="#f4f6f8" ${st(1.6)}/>`;
      const ty = b - 4 - (cnt - 1) * 4;
      s += `<path d="M${x+3} ${ty-1}q12-11 24 0" fill="#f4f6f8" ${st(1.8)}/><rect x="${x+12}" y="${ty-9}" width="6" height="3" rx="1.5" fill="${I}" opacity=".6"/>`; });
    s += `<path d="M${cx + 40} ${b-4}h20" ${st(1.6)} stroke-dasharray="3 3" opacity=".5"/><ellipse cx="${cx + 50}" cy="${b-4}" rx="14" ry="3.5" fill="none" ${st(1.4)} stroke-dasharray="3 3" opacity=".5"/>`;
    return s; },
  bagstack(cx, b, o){ let s = '';
    for (let k = 0; k < o.n; k++) s += `<rect x="${cx - 52 + (k % 2) * 3}" y="${b - 6 - k * 5}" width="68" height="5" rx="1.5" fill="${k % 2 ? '#c9a27a' : '#d4b088'}" ${st(1.3)}/>`;
    let teeth = `M${cx+22} ${b-60}`; for (let i = 0; i < 6; i++) teeth += `l5 ${i % 2 ? 5 : -5}`;
    return s + `<path d="M${cx+22} ${b-60}h30v60h-30z" fill="#c9a27a" ${st(2.4)}/><path d="${teeth}" fill="none" ${st(1.8)}/><circle cx="${cx+37}" cy="${b-30}" r="10" fill="none" stroke="${C.pinkD}" stroke-width="2.2"/>`; },
  straws(cx, b){ let s = '';
    for (let k = 0; k < 7; k++) s += `<path d="M${cx - 40 + k * 6} ${b-40}l${(k - 3) * 1.5} -34" stroke="${k % 2 ? C.pink : '#fff'}" stroke-width="4.5" stroke-linecap="round"/><path d="M${cx - 40 + k * 6} ${b-40}l${(k - 3) * 1.5} -34" ${st(1)} opacity=".4"/>`;
    s += `<rect x="${cx-46}" y="${b-44}" width="48" height="44" rx="3" fill="#fff" ${st(2.4)}/><rect x="${cx-46}" y="${b-30}" width="48" height="12" fill="${C.pink}" ${st(1.4)}/>`;
    for (let k = 0; k < 7; k++) s += `<rect x="${cx + 8}" y="${b - 6 - k * 5}" width="40" height="5" rx="1" fill="${k % 2 ? '#fff' : '#f7f3ee'}" ${st(1.2)}/>`;
    return s; },
};
const draw = (it, cx, b) => DRAW[it.kind](cx, b, it);
const NONE = {crate: 1, trays: 1, blocks: 1, cases: 1, tins: 1, pouch: 1, bagstack: 1};
const art = (it, size) => `<svg class="art" viewBox="0 -14 ${it.w} ${it.h + 20}" width="${size}" height="${size}" aria-hidden="true">${draw(it, it.w / 2, it.h + 2)}</svg>`;
/* ---------- defs ---------- */
const DEFS = `<defs>
<linearGradient id="p-cold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1f8fb"/><stop offset="1" stop-color="#dcebf1"/></linearGradient>
<radialGradient id="p-led"><stop offset="0" stop-color="#ffffff" stop-opacity=".9"/><stop offset="1" stop-color="#eaf6ff" stop-opacity="0"/></radialGradient>
<symbol id="p-truck" viewBox="0 0 40 30"><rect x="2" y="6" width="22" height="16" rx="2" fill="${C.pink}" ${st(2.2)}/><path d="M24 11h8l6 6v5H24z" fill="#fff" ${st(2.2)}/><circle cx="10" cy="24" r="4" fill="#fff" ${st(2)}/><circle cx="31" cy="24" r="4" fill="#fff" ${st(2)}/></symbol>
<symbol id="p-leaf" viewBox="0 0 30 30"><path d="M6 24C4 12 12 4 26 4C26 18 18 26 6 24Z" fill="#8fbf6a" ${st(2)}/><path d="M6 24L18 12" ${st(1.8)}/></symbol>
<symbol id="p-open" viewBox="0 0 30 30"><path d="M6 28V12L15 5L24 12V28Z" fill="#fff" ${st(2)}/><path d="M7 11L1 6L7 2L13 6Z" fill="#fff" ${st(1.8)}/></symbol>
<symbol id="p-seal" viewBox="0 0 30 30"><path d="M6 28V12L15 5L24 12V28Z" fill="#fff" ${st(2)}/><rect x="11" y="1" width="8" height="5" fill="#fff" ${st(1.6)}/><circle cx="15" cy="16" r="4" fill="${C.sage}" ${st(1.4)}/></symbol>
<symbol id="p-plate" viewBox="0 0 30 30"><ellipse cx="15" cy="20" rx="13" ry="5" fill="#fff" ${st(2)}/><path d="M7 18q8-12 16 0z" fill="#e0554a" ${st(1.6)}/></symbol>
<symbol id="p-snow" viewBox="0 0 30 30"><g ${st(2.2)}><path d="M15 3v24M4.6 9l20.8 12M4.6 21l20.8-12"/><path d="M11 5l4 3l4-3M11 25l4-3l4 3"/></g></symbol>
<symbol id="p-drop" viewBox="0 0 30 30"><path d="M15 4C10 12 7 16 7 20a8 8 0 0 0 16 0c0-4-3-8-8-16z" fill="#9fd0e8" ${st(2)}/></symbol>
</defs>`;

/* ---------- room ---------- */
let M = `<rect width="1600" height="1000" fill="#fbf3ec"/>
<rect width="1600" height="70" fill="#f5ece2"/><path d="M0 70H1600M0 78H1600" fill="none" ${st(2.5)}/>`;
for (let x = 20; x < 1600; x += 40) M += `<path d="M${x} 80V762" ${st(1.2)} opacity=".12"/>`;

// walk-in shell
M += `<rect x="112" y="96" width="966" height="670" rx="6" fill="${K.steel}" ${st(3.2)}/>
<rect x="146" y="150" width="898" height="614" fill="url(#p-cold)" ${st(2.8)}/>`;
for (let x = 236; x < 1044; x += 90) M += `<path d="M${x} 152V700" stroke="#c9dbe3" stroke-width="2"/>`;
M += `<rect x="146" y="700" width="898" height="64" fill="#d6e2e8"/><path d="M146 700H1044" ${st(2)}/>`;
for (let x = 160; x < 1044; x += 60) M += `<path d="M${x} 700l-14 64" stroke="#bccdd6" stroke-width="2"/>`;
[[120, 104], [1070, 104], [120, 758], [1070, 758]].forEach(([x, y]) => M += `<circle cx="${x}" cy="${y}" r="2.6" fill="${I}"/>`);
// frost in the corners
M += `<path d="M146 150h70q-14 10-30 6q-10 12-24 6q-6 16-16 12z" fill="#fff" ${st(1.6)} opacity=".95"/>
<path d="M1044 150h-80q12 12 30 6q8 12 24 6q8 14 26 10z" fill="#fff" ${st(1.6)} opacity=".95"/>`;
// header with sensors
M += `<rect x="112" y="96" width="966" height="54" rx="6" fill="${K.steelL}" ${st(3)}/>
<rect x="128" y="106" width="118" height="34" rx="8" fill="#fff" ${st(2.4)}/>
<rect x="404" y="104" width="300" height="40" rx="7" fill="#24302b" ${st(2.6)}/>
`;
// evaporator + LED strip
M += `<rect x="470" y="152" width="260" height="44" rx="6" fill="${K.steelL}" ${st(2.6)}/>
<circle cx="560" cy="174" r="17" fill="#fff" ${st(2.2)}/><circle cx="640" cy="174" r="17" fill="#fff" ${st(2.2)}/>
<path d="M480 196h240" ${st(1.6)}/>`;
for (let x = 486; x < 720; x += 8) M += `<path d="M${x} 158v8" ${st(1)} opacity=".35"/>`;
M += `<ellipse cx="300" cy="166" rx="140" ry="22" fill="url(#p-led)"/><ellipse cx="890" cy="166" rx="140" ry="22" fill="url(#p-led)"/>
<rect x="190" y="153" width="230" height="6" rx="3" fill="#fff" ${st(1.6)}/><rect x="780" y="153" width="230" height="6" rx="3" fill="#fff" ${st(1.6)}/>`;

// wire shelves + posts
for (const b of S) {
  M += `<rect x="150" y="${b-6}" width="890" height="8" fill="${K.chrome}" ${st(2.2)}/>`;
  for (let x = 156; x < 1040; x += 9) M += `<path d="M${x} ${b-6}v8" ${st(1)} opacity=".3"/>`;
}
[150, 595, 1040].forEach(x => { M += `<rect x="${x-6}" y="162" width="12" height="602" fill="${K.chrome}" ${st(2.2)}/>`;
  for (let y = 176; y < 760; y += 16) M += `<path d="M${x-3} ${y}h6" ${st(1)} opacity=".4"/>`; });

// dry store shelving
M += `<rect x="1100" y="104" width="250" height="40" rx="8" fill="#fff" ${st(2.6)}/>
<rect x="1088" y="160" width="12" height="604" fill="${K.woodD}" ${st(2.4)}/><rect x="1578" y="160" width="12" height="604" fill="${K.woodD}" ${st(2.4)}/>
<rect x="1084" y="156" width="510" height="12" rx="3" fill="${K.wood}" ${st(2.4)}/>`;
for (const b of S) M += `<rect x="1094" y="${b-8}" width="490" height="10" fill="${K.wood}" ${st(2.4)}/><path d="M1100 ${b-4}h480" stroke="${K.woodD}" stroke-width="1.4"/>`;
M += `<path d="M1100 700q60-10 120 0t120 0t120 0t120 0" fill="none" ${st(1)} opacity=".2"/>`;

// shelf label channels (white, sit under each deck)
let CHAN = '';
for (const b of S) CHAN += `<rect x="150" y="${b+2}" width="890" height="20" fill="#fff" ${st(2.2)}/><rect x="1094" y="${b+2}" width="490" height="20" fill="#fffaf2" ${st(2.2)}/>`;

// stock on shelves
let STOCK = '';

// PVC strip curtain bunched at the right edge of the opening
let STRIPS = '';
[1008, 1018, 1028].forEach((x, i) => STRIPS += `<path d="M${x} 152Q${x - 8 + i * 4} 440 ${x + 2} 762" fill="none" stroke="#dcecf2" stroke-width="13" opacity=".7"/><path d="M${x} 152Q${x - 8 + i * 4} 440 ${x + 2} 762" fill="none" ${st(1.2)} opacity=".45"/>`);

// the open walk-in door, hinged on the left of the frame
const DOOR = `<g id="p-door" class="p-door">
<path d="M112 100L26 84V792L112 768Z" fill="${K.steelL}" ${st(3)}/>
<path d="M102 116L38 104V772L102 752Z" fill="none" stroke="#9aa3ab" stroke-width="5" stroke-linejoin="round"/>
<path d="M108 110v650" stroke="#c9ced5" stroke-width="6"/>
<circle cx="70" cy="430" r="14" fill="${C.terra}" ${st(2.5)}/><rect x="64" y="444" width="12" height="40" rx="3" fill="${K.steelD}" ${st(2)}/>
<path d="M40 250l56 10M40 600l56 6" ${st(1.2)} opacity=".3"/></g>`;

/* ---------- receiving bench (foreground) ---------- */
let BENCH = `<rect x="0" y="790" width="1600" height="210" fill="${C.pink}"/>`;
for (let x = 40; x < 1600; x += 80) BENCH += `<path d="M${x} 808V975" ${st(1.4)} opacity=".3"/>`;
BENCH += `<rect x="-5" y="975" width="1610" height="30" fill="${C.pinkD}" ${st(3)}/>
<rect x="0" y="800" width="1600" height="9" fill="${th.lip}"/>
<path d="M-10 762H1610V800H-10Z" fill="#dcb68c" ${st(3)}/><path d="M20 776q60-6 120 0t140 0M700 784q60-6 140 0M1200 774q80 6 160 0" fill="none" stroke="${K.woodD}" stroke-width="1.6"/>`;
// scale weighing an avocado delivery
BENCH += `<rect x="62" y="742" width="138" height="22" rx="4" fill="${K.steel}" ${st(2.6)}/><rect x="84" y="746" width="64" height="14" rx="3" fill="#24302b" ${st(1.8)}/>
<rect x="70" y="736" width="122" height="7" rx="2" fill="${K.steelL}" ${st(2.2)}/>` + DRAW.crate(131, 736, {w: 112, n: 8, fruit: 'avo'});
// label printer
BENCH += `<rect x="232" y="712" width="92" height="52" rx="8" fill="${C.navy}" ${st(2.8)}/><rect x="244" y="722" width="40" height="10" rx="2" fill="#24302b"/><circle cx="306" cy="727" r="5" fill="${C.pink}" ${st(1.6)}/><rect x="252" y="742" width="56" height="6" rx="3" fill="${I}"/>`;
// clipboard checklist
BENCH += `<g transform="rotate(-4 412 730)"><rect x="372" y="694" width="82" height="70" rx="5" fill="${K.wood}" ${st(2.6)}/><rect x="380" y="702" width="66" height="58" fill="#fffefb" ${st(1.8)}/><rect x="398" y="688" width="30" height="12" rx="3" fill="${K.steelD}" ${st(2)}/>
${[0, 1, 2, 3].map(k => `<rect x="386" y="${710 + k * 12}" width="8" height="8" rx="1.5" fill="#fff" ${st(1.4)}/><path d="M398 ${715 + k * 12}h${36 - k * 4}" ${st(1.4)} opacity=".45"/>${k < 3 ? `<path d="M386 ${713 + k * 12}l3 4l7-9" fill="none" stroke="#4f7a45" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>` : ''}`).join('')}</g>`;
// probe thermometer + incoming cup carton + cold bag
BENCH += `<path d="M1312 762l26-60" ${st(3)}/><circle cx="1342" cy="694" r="14" fill="#fff" ${st(2.4)}/><path d="M1342 694l7-6" ${st(2)}/><path d="M1334 686a12 12 0 0 1 16 0" stroke="${C.sage}" stroke-width="3" fill="none"/>`;
BENCH += DRAW.cups(1200, 724, {hs: [52, 52, 46]}) + `<path d="M1136 724h132l-6 40h-120z" fill="#d9b48a" ${st(2.6)}/><path d="M1136 724l-14-18h40l10 18M1268 724l14-18h-40l-10 18" fill="#e3c39c" ${st(2.2)}/><rect x="1186" y="738" width="34" height="14" rx="2" fill="#fff" ${st(1.4)}/>`;
BENCH += `<path d="M1412 764v-56q0-10 10-10h120q10 0 10 10v56z" fill="#7fa9c6" ${st(2.8)}/><path d="M1440 698q42-26 84 0" fill="none" ${st(3)}/><path d="M1412 730h142" ${st(1.6)}/><path d="M1452 744h60" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`;

/* ---------- assemble: static room + live layers ---------- */
const g = (id, extra = '') => `<g id="${id}" ${extra}></g>`;
const $ = (id) => document.getElementById(id);
document.getElementById('pantry-scene').innerHTML = DEFS
  + `<g filter="url(#wob)">${M}</g>` + g('p-fx') + `<g id="p-stock" filter="url(#wob)"></g><g filter="url(#wob)">${STRIPS}${CHAN}${DOOR}</g>`
  + g('p-feed') + `<g filter="url(#wob)">${BENCH}</g>` + g('p-tags') + g('p-head') + g('p-hits')
  + `<rect width="1600" height="1000" filter="url(#grain)" opacity=".22" pointer-events="none"/>`;
{ let FX = `<g transform="translate(560 174)"><g class="p-spin">${[0, 120, 240].map(a => `<path d="M0 0q-3-12 4-14q4 6-4 14z" fill="${K.steelD}" ${st(1.4)} transform="rotate(${a})"/>`).join('')}</g></g>
<g transform="translate(640 174)"><g class="p-spin" style="animation-delay:-.3s">${[0, 120, 240].map(a => `<path d="M0 0q-3-12 4-14q4 6-4 14z" fill="${K.steelD}" ${st(1.4)} transform="rotate(${a})"/>`).join('')}</g></g>
<circle class="k-drip" cx="600" cy="200" r="2.6" fill="#9fd0e8"/>`;
  [[160, 260, 0], [150, 420, -1.5], [170, 560, -3], [150, 690, -.8], [180, 340, -2.2]].forEach(([x, y, d]) =>
    FX += `<path class="p-wisp" style="animation-delay:${d}s" d="M${x} ${y}q-24-10-46 0t-46 0" fill="none" stroke="#cfe7f2" stroke-width="7" stroke-linecap="round" opacity=".8"/>`);
  [[182, 178], [1012, 176], [210, 166], [978, 170]].forEach(([x, y], i) =>
    FX += `<path class="p-tw" style="animation-delay:${-i * .6}s" d="M${x} ${y-6}L${x+1.5} ${y-1.5}L${x+6} ${y}L${x+1.5} ${y+1.5}L${x} ${y+6}L${x-1.5} ${y+1.5}L${x-6} ${y}L${x-1.5} ${y-1.5}Z" fill="#fff" ${st(1.2)}/>`);
  $('p-fx').innerHTML = FX; }
$('p-hits').innerHTML = SLOTS.map((it) => { const b = S[it.s];
  return `<rect class="p-hit" data-id="${it.id}" data-item="${it.id}" tabindex="0" role="button" aria-label="${R.human(it.id)}" x="${it.x - it.w / 2}" y="${b - it.h - 18}" width="${it.w}" height="${it.h + 62}" rx="10"/>`; }).join('');

const artS = (s, it, size) => { const row = s?.inventory?.[it.id]; return art(it.id === 'rescue' ? it : shaped(it, row ? row.on_hand / Math.max(1e-9, row.par || 1) : .6), size); };
/* ---------- reading the inventory ---------- */
const UNIT = {g: [1000, 'kg'], ml: [1000, 'L'], pc: [1, '']};
function qtyText(row){ if (!row) return '—'; const [k, u] = UNIT[row.uom] || [1, row.uom || ''];
  const v = row.on_hand / k; return (row.uom === 'pc' ? Math.round(v) : v >= 10 ? Math.round(v) : v.toFixed(1)) + (u ? ' ' + u : ''); }
const nameOf = (row, id) => String(row?.name || R.human(id)).replace(/\s*\((fictional|bakery|frozen|toned)\)/i, '').toLowerCase();
/* lot freshness, the same rule as the backend (backend.md §6.1 /inventory freshness_rules) */
function lotClass(l, now){
  if (l.expires_s == null) return 'none';
  const left = l.expires_s - now, life = Math.max(1, l.expires_s - (l.received_s ?? now)), share = left / life, h = left / 3600;
  if (h <= 24 || (share <= .1 && h <= 168)) return 'bad';
  if (h <= 72 || (share <= .3 && h <= 336)) return 'mid';
  return 'fresh';
}
const KL = {bad: 'bad', mid: 'soon', fresh: 'fresh', none: 'fresh'};
const fmtLeft = (sec) => sec == null ? '—' : sec < 0 ? 'past' : sec < 86400 ? Math.max(1, Math.round(sec / 3600)) + 'h' : sec < 45 * 86400 ? Math.round(sec / 86400) + 'd' : Math.round(sec / 2592000) + 'mo';
const DATE = (s0, st2) => { if (s0 == null || !st2?.clock?.date) return ''; const d = new Date(st2.clock.date + 'T00:00:00'); d.setDate(d.getDate() + Math.floor(s0 / 86400) - (st2.clock.day || 0));
  return `${d.getDate()} ${['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'][d.getMonth()]}`; };
function lotsOf(s, id){
  const L = s.lots?.[id];
  if (L && L.length) return [...L].sort((a, c) => a.expires_s - c.expires_s);
  const row = s.inventory?.[id];
  return row?.next_expiry_s ? [{lot_id: id + ':next', qty: row.on_hand, expires_s: row.next_expiry_s, received_s: null, status: 'sealed', approx: true}] : [];
}
function rescueItems(s, now){
  const out = [];
  for (const it of SLOTS) { if (it.id === 'rescue') continue; const l = lotsOf(s, it.id)[0]; if (l && lotClass(l, now) === 'bad') out.push({it, l}); }
  return out;
}

/* ---------- live layers ---------- */
const lStock = R.layer($('p-stock'), {
  key: (x) => x.it.id, sig: (x) => x.sig, html: (x) => x.html,
});
let tagSig = '', headSig = '';
function renderShelves(s, now){
  const rows = [], inv = s.inventory || {};
  for (const it of SLOTS) {
    if (it.id === 'rescue') { const r = rescueItems(s, now); rows.push({it, sig: 'r' + r.length, html: r.length ? draw(it, it.x, S[it.s] - 6) : `<path d="M${it.x - 66} ${S[it.s] - 42}h132v36h-132z" fill="none" ${st(2)} stroke-dasharray="6 5" opacity=".5"/>`}); continue; }
    const row = inv[it.id], frac = row ? row.on_hand / Math.max(1e-9, row.par || row.on_hand || 1) : null;
    const o = shaped(it, frac), sig = JSON.stringify([o.n, o.lvl && +o.lvl.toFixed(2), o.lv && o.lv.map((v) => +v.toFixed(2)), o.f, o.hs, o.cups && o.cups.length, !!row]);
    const empty = row && row.on_hand <= 0;
    rows.push({it, sig, html: empty || (NONE[it.kind] && !o.n) ? `<path d="M${it.x - it.w / 2 + 8} ${S[it.s] - 8}h${it.w - 16}" ${st(2)} stroke-dasharray="5 5" opacity=".6"/>${t(it.x, S[it.s] - 14, 'out', 13, `text-anchor="middle" fill="${C.terra}"`)}` : draw(o, it.x, S[it.s] - 6)});
  }
  lStock.sync(rows);
  // channel labels (par gauge + on hand) and lot tags in FEFO order
  let tags = '';
  for (const it of SLOTS) {
    const b = S[it.s], x0 = it.x - it.w / 2 + 4, w = it.w - 8, row = inv[it.id], bw = Math.min(42, w - 50);
    let lots = lotsOf(s, it.id), on = qtyText(row), par = row ? Math.min(1, row.on_hand / Math.max(1e-9, row.par || 1)) : 0, cov = row?.days_of_cover;
    if (it.id === 'rescue') { const r = rescueItems(s, now); lots = r.map((q) => q.l); on = `${r.length} to use`; par = r.length ? 1 : 0; cov = .3; }
    tags += `<g data-shelf="${it.id}"><rect x="${x0 + 2}" y="${b + 8}" width="${bw}" height="8" rx="4" fill="#f1ece5" ${st(1.3)}/><rect x="${x0 + 2.5}" y="${b + 8.5}" width="${((bw - 1) * par).toFixed(1)}" height="7" rx="3.5" fill="${covCol(cov)}"/>`
      + t(x0 + bw + 7, b + 17, esc(on), 12) + '</g>';
    lots = lots.slice(0, 3);
    if (!lots.length) continue;
    const tx0 = it.x - (lots.length * 30 + 14) / 2;
    tags += `<g class="p-fefo"><path d="M${tx0} ${b + 33}h9" stroke="${C.terra}" stroke-width="3" stroke-linecap="round"/><path d="M${tx0 + 6} ${b + 28}l6 5l-6 5" fill="none" stroke="${C.terra}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g>`;
    lots.forEach((l, i) => { const f = lotClass(l, now), x = tx0 + 16 + i * 30, y = b + 25;
      tags += `<g class="${f === 'bad' ? 'p-pulse ' : ''}lt ${KL[f]}" data-lot="${esc(l.lot_id)}"><path d="M${it.x} ${b + 22}L${x + 13} ${y}" ${st(1)} opacity=".35"/>
      <rect x="${x}" y="${y}" width="27" height="17" rx="4" fill="${FR[f]}" stroke="${I}" stroke-width="${i === 0 ? 2.6 : 1.6}"/>
      ${l.status === 'opened' ? `<path d="M${x + 19} ${y}h8v8z" fill="#fff" ${st(1.2)}/>` : ''}
      <text x="${x + 12}" y="${y + 13}" text-anchor="middle" font-family="Patrick Hand" font-size="11.5" fill="${I}">${fmtLeft(l.expires_s - now)}</text></g>`; });
  }
  if (tags !== tagSig) { tagSig = tags; $('p-tags').innerHTML = tags; }
  // header readouts: things the sim really knows (no fake sensors)
  const chilled = Object.values(inv).filter((r) => ['milk', 'oat_milk', 'almond_milk', 'butter', 'paneer', 'cheddar', 'parmesan', 'avocado', 'microgreens', 'mint_chutney', 'tikka_masala', 'strawberry_puree', 'croissant_dough', 'coldbrew_concentrate', 'chai_base', 'arrabbiata_sauce', 'green_chilli'].includes(r.key));
  const val = chilled.reduce((a, r) => a + (r.value_inr || 0), 0), exp = chilled.filter((r) => r.freshness === 'expiring').length;
  const co2 = Object.values(inv).reduce((a, r) => a + (r.co2e_kg_per_kg || 0) * ((r.uom === 'g' || r.uom === 'ml') ? r.on_hand / 1000 : 0), 0);
  const nextPo = Object.values(s.pos || {}).filter((p) => p.status === 'open').sort((a, c) => a.eta_s - c.eta_s)[0] || (s.rest?.purchasing?.next_delivery_s ? {eta_s: s.rest.purchasing.next_delivery_s} : null);
  const head = gt(187, 131, 'walk-in', 21, 'text-anchor="middle"') + `<use href="#p-snow" class="p-spin" x="216" y="114" width="20" height="20"/>`
    + `<text x="420" y="132" font-family="Courier Prime" font-weight="700" font-size="20" fill="#8ff0a4">${val ? R.rsk(val) : '—'}</text>`
    + `<text x="694" y="122" text-anchor="end" font-family="Courier Prime" font-size="10.5" fill="#8ff0a4" opacity=".8">chilled stock</text>`
    + `<text x="694" y="137" text-anchor="end" font-family="Courier Prime" font-size="10.5" fill="${exp ? '#f6c76a' : '#8ff0a4'}">${chilled.length} keys · ${exp} expiring</text>`
    + `<circle cx="745" cy="124" r="12" fill="#fff" ${st(2)}/><path d="M745 124v-7M745 124l5 3" ${st(2)}/>`
    + t(764, 120, 'next truck', 12.5, 'opacity=".7"') + `<text x="764" y="141" font-family="Gochi Hand" font-size="19" fill="${C.terra}">${nextPo ? R.hm(nextPo.eta_s) : '—'}</text>`
    + `<use href="#p-leaf" x="864" y="110" width="22" height="22"/>` + gt(890, 132, co2 ? Math.round(co2) + ' kg' : '—', 17) + t(944, 131, 'CO₂e', 12, 'opacity=".6"')
    + `<rect x="968" y="110" width="96" height="26" rx="13" fill="#e4efd9" ${st(2)}/>` + t(1016, 128, 'FEFO ✓', 12.5, 'text-anchor="middle"')
    + gt(1225, 132, 'dry store', 22, 'text-anchor="middle"') + t(1306, 131, 'FIFO', 12.5, 'opacity=".6"');
  if (head !== headSig) { headSig = head; $('p-head').innerHTML = head; }
}

/* ---------- hover card ---------- */
const tipEl = document.getElementById('p-tip');
const icon = (id, w = 18, h = 14) => `<svg width="${w}" height="${h}" aria-hidden="true"><use href="#${id}" width="${w}" height="${h}"/></svg>`;
const proposal = (s, id) => { const P = s.rest?.purchasing; if (!P) return null;
  for (const o of P.orders || [P]) for (const ln of o.lines || []) if (ln.ingredient === id) return {...ln, eta_s: o.eta_s, supplier: o.supplier}; return null; };
function tipHTML(s, id, now){
  const it = BY[id], row = s.inventory?.[id], u = UNIT[row?.uom] || [1, ''];
  if (id === 'rescue') { const r = rescueItems(s, now), L = Object.values(s.replate?.listings || {}).filter((x) => !x.outcome);
    return `<div class="th">${artS(s, it, 50)}<div class="tn"><b>use-today bin</b><span class="sup">first expiry, first out</span></div><span class="onhand">${r.length}</span></div>
      <div class="lots">${r.map(({it: i2, l}) => `<div class="lot first"><span class="lq">${esc(nameOf(s.inventory?.[i2.id], i2.id))}</span><span class="tl"><small></small><span></span><small></small></span><span class="dl" style="background:${FR.bad}">${fmtLeft(l.expires_s - now)}</span><span></span></div>`).join('') || '<div class="lot"><span class="lq">nothing expiring today ♡</span></div>'}</div>
      <div class="meta">${L.length ? L.slice(0, 3).map((x) => `<span class="dish">${icon('p-plate', 18, 18)}${esc(R.human(x.sku))} −${Math.round(x.discount_pct)}%</span>`).join('') : '<span class="re ok">✓ nothing on the rescue shelf</span>'}</div>`; }
  if (!row) return `<div class="th">${artS(s, it, 50)}<div class="tn"><b>${esc(R.human(id))}</b></div></div><div class="more">loading…</div>`;
  const lots = lotsOf(s, id);
  const rows = lots.slice(0, 4).map((l, i) => { const f = lotClass(l, now), life = l.received_s != null ? l.expires_s - l.received_s : null;
    const el = life ? Math.min(1, Math.max(0, 1 - (l.expires_s - now) / life)) : null;
    return `<div class="lot${i === 0 ? ' first' : ''}"><span class="lq">${i === 0 ? '<b class="fefo">➜</b>' : ''}${l.approx ? 'next lot' : (row.uom === 'pc' ? Math.round(l.qty) : (l.qty / u[0]).toFixed(1)) + (u[1] ? ' ' + u[1] : '')}</span>
      <span class="tl"><small>${DATE(l.received_s, s)}</small><span class="tb"><i style="width:${el == null ? 100 : (el * 100).toFixed(0)}%;background:${FR[f]}"></i>${el != null ? `<em style="left:${(el * 100).toFixed(0)}%"></em>` : ''}</span><small>${DATE(l.expires_s, s)}</small></span>
      <span class="dl" style="background:${FR[f]}">${fmtLeft(l.expires_s - now)}</span>
      ${l.status === 'opened' ? `<span class="op" title="opened ${l.opened_s ? R.hm(l.opened_s) : ''}">${icon('p-open', 16, 16)}${l.opened_s ? R.hm(l.opened_s) : ''}</span>` : `<span class="op sealed" title="sealed">${icon('p-seal', 16, 16)}</span>`}</div>`; }).join('');
  const fc = s.rest?.usage?.[id];
  let fcH = '';
  if (fc && fc.p50 != null) { const max = Math.max(fc.p90, row.on_hand) * 1.15 || 1, pc = (v) => (v / max * 100).toFixed(1) + '%', fmt = (v) => row.uom === 'pc' ? Math.round(v) : (v / u[0]).toFixed(1);
    fcH = `<div class="fc"><span>today</span><span class="bul"><i class="stock" style="width:${pc(row.on_hand)};background:${covCol(row.days_of_cover)}"></i>
      <b style="left:${pc(fc.p50)}"><small>p50 ${fmt(fc.p50)}</small></b><b class="p90" style="left:${pc(fc.p90)}"><small>p90 ${fmt(fc.p90)}</small></b></span><span>${u[1]}</span></div>`; }
  else fcH = `<div class="more">today’s usage forecast loading…</div>`;
  const c = row.days_of_cover, cov = [0, 1, 2, 3, 4].map((d) => { const f = c == null ? 0 : Math.min(1, Math.max(0, c - d)) * 100;
    return `<i style="background:linear-gradient(90deg,${covCol(c)} ${f}%,#fff ${f}%)"></i>`; }).join('');
  const p = proposal(s, id);
  const re = p ? `<span class="re">${icon('p-truck')}+${row.uom === 'pc' ? Math.round(p.qty) : (p.qty / u[0]).toFixed(1)}${u[1] ? ' ' + u[1] : ''} · ${R.hm(p.eta_s)}</span>`
    : row.on_order > 0 ? `<span class="re">${icon('p-truck')}on order</span>` : `<span class="re ok">✓ stocked</span>`;
  const co2 = row.co2e_kg_per_kg;
  return `<div class="th">${art(shaped(it, row.on_hand / Math.max(1e-9, row.par || 1)), 50)}<div class="tn"><b>${esc(nameOf(row, id))}</b><span class="sup">${icon('p-truck')}${esc(String(row.supplier || '').replace(/\s*\(fictional\)/, ''))}</span></div><span class="onhand">${qtyText(row)}</span></div>
    <div class="lots">${rows || '<div class="lot"><span class="lq">no lots</span></div>'}</div>${fcH}
    <div class="meta"><span class="cov" title="days of cover">${cov}<b>${c == null ? '—' : c.toFixed(1) + 'd'}</b></span>${re}
    ${co2 != null ? `<span class="co2" title="kg CO₂e per kg">${icon('p-leaf', 16, 16)}${co2}<small>CO₂e/kg</small><i style="--w:${Math.min(1, co2 / 20).toFixed(2)}"></i></span>` : ''}</div>`;
}
let current = 'oat_milk', tipSig = '';
function placeTip(id){ const it = BY[id]; if (!it) return;
  const W = 336, Hh = tipEl.offsetHeight || 230, b = S[it.s];
  let left = it.x < 800 ? it.x + it.w / 2 + 16 : it.x - it.w / 2 - 16 - W;
  left = Math.max(12, Math.min(1588 - W, left));
  const top = Math.max(158, Math.min(796 - Hh, b - it.h - 24));
  tipEl.style.left = left + 'px'; tipEl.style.top = top + 'px'; }
function renderTip(s, now){
  const html = tipHTML(s, current, now);
  if (html === tipSig) return; tipSig = html; tipEl.innerHTML = html; placeTip(current);
}
function show(id){
  if (!BY[id]) return; current = id; tipSig = '';
  document.querySelectorAll('.p-hit').forEach(h => h.classList.toggle('on', h.dataset.id === id));
  const s = R.S(); if (s) renderTip(s, R.now());
  window.BrewLive?.refresh?.('usage', id);
}
const scene = document.getElementById('pantry-scene');
scene.addEventListener('pointerover', e => { const h = e.target.closest('.p-hit'); if (h && h.dataset.id !== current) show(h.dataset.id); });
scene.addEventListener('focusin', e => { const h = e.target.closest('.p-hit'); if (h) show(h.dataset.id); });
scene.addEventListener('click', e => { const h = e.target.closest('.p-hit'); if (h) show(h.dataset.id); });

/* ---------- bottom panels ---------- */
const room = document.getElementById('pantry');
room.addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (b) show(b.dataset.pick); });
let freshSig = '';
function renderFresh(s, now){
  const el = room.querySelector('.pfresh'); if (!el) return;
  const rows = Object.values(s.inventory || {});
  let fr = s.rest?.inventory_summary?.freshness;
  if (!fr && rows.length) { const v = {fresh: 0, soon: 0, expiring: 0}; let tot = 0; for (const r of rows) { v[r.freshness || 'fresh'] += r.value_inr || 0; tot += r.value_inr || 0; }
    fr = tot ? {fresh: v.fresh / tot, soon: v.soon / tot, expiring: v.expiring / tot} : null; }
  const rescue = rescueItems(s, now).slice(0, 4);
  const L = Object.values(s.replate?.listings || {}).filter((x) => !x.outcome).slice(0, 2);
  const imp = s.rest?.impact, days = imp?.waste_kg_by_day || [];
  const A = s.rest?.comparison?.policies?.A || s.rest?.comparison?.baseline, me = s.rest?.comparison?.policies?.[s.policy?.policy || 'D'];
  const vs = A && me ? Math.round((me.mean_waste_kg / A.mean_waste_kg - 1) * 100) : null;
  const max = Math.max(...days.map((d) => d.waste_kg), A?.mean_waste_kg || 0, 1) * 1.1;
  const pct = (x) => Math.round((x || 0) * 100);
  const html = `<h3>freshness <small>stock value · first expiry, first out</small></h3>`
    + (fr ? `<div class="stack"><span style="width:${pct(fr.fresh)}%;background:#bfe6cf">${fr.fresh > .18 ? 'fresh ' + pct(fr.fresh) + '%' : ''}</span><span style="width:${pct(fr.soon)}%;background:#f6c76a">${fr.soon > .14 ? 'soon ' + pct(fr.soon) + '%' : ''}</span><span style="width:${Math.max(0, 100 - pct(fr.fresh) - pct(fr.soon))}%;background:#ef7d6d">${fr.expiring > .05 ? pct(fr.expiring) + '%' : ''}</span></div>` : `<div class="stack"><span style="width:100%;background:#ece4d8">loading the walk-in…</span></div>`)
    + `<div class="prow"><span>use today</span><div id="p-today">${rescue.map(({it, l}) => `<button class="it" data-pick="${it.id}" title="${esc(nameOf(s.inventory?.[it.id], it.id))}">${artS(s, it, 38)}<b>${fmtLeft(l.expires_s - now)}</b></button>`).join('') || '<small style="opacity:.6">nothing expiring ♡</small>'}</div><span style="font-size:20px">→</span>`
    + (L.length ? L.map((x) => `<span class="dish" data-listing="${esc(x.listing_id)}"><svg><use href="#p-plate"/></svg>${esc(R.human(s.menu?.[x.sku]?.name || x.sku).toLowerCase())} −${Math.round(x.discount_pct)}%</span>`).join('') : `<span class="dish"><svg><use href="#p-plate"/></svg>rescue shelf empty</span>`) + `</div>`
    + `<div class="prow"><span>waste / day</span><div id="p-waste">${days.map((d) => `<i style="height:${Math.max(4, d.waste_kg / max * 100).toFixed(0)}%${d.partial ? ';opacity:.55' : ''}" title="${d.date || 'day ' + d.day} · ${d.waste_kg.toFixed(1)} kg${d.partial ? ' so far' : ''}"></i>`).join('')}${A ? `<em style="bottom:${(A.mean_waste_kg / max * 100).toFixed(0)}%"></em>` : ''}</div>`
    + (vs != null ? `<span class="chip" style="background:${vs <= 0 ? '#e4efd9' : '#fbe1d9'}">${vs <= 0 ? '−' : '+'}${Math.abs(vs)}% vs naive</span><small style="opacity:.65">dashed = policy A</small>` : `<small style="opacity:.65">${imp ? (imp.waste_kg_today ?? 0).toFixed(1) + ' kg today' : ''}</small>`) + `</div>`;
  if (html !== freshSig) { freshSig = html; el.innerHTML = html; }
}
let coverSig = '';
function renderCover(s){
  const el = room.querySelector('.pboard'); if (!el) return;
  const ids = SLOTS.filter((it) => it.id !== 'rescue' && s.inventory?.[it.id]?.days_of_cover != null).sort((a, b) => s.inventory[a.id].days_of_cover - s.inventory[b.id].days_of_cover).slice(0, 9);
  const cells = ids.map((it) => { const c = s.inventory[it.id].days_of_cover;
    return `<button class="cell" data-pick="${it.id}" title="${esc(nameOf(s.inventory[it.id], it.id))}">${artS(s, it, 28)}<span class="cb"><i style="width:${Math.min(100, c / 5 * 100)}%;background:${covCol(c)}"></i></span><span>${c.toFixed(1)}d</span></button>`; }).join('');
  const html = `<div class="bh">days of cover <small><i class="led r"></i>&lt;1d <i class="led a"></i>&lt;2d <i class="led g"></i>ok</small></div><div class="cells" id="p-cover">${cells}</div>`;
  if (html !== coverSig) { coverSig = html; el.innerHTML = html; }
}
let orderSig = '', approving = false, approved = '';
function renderOrder(s){
  const el = room.querySelector('.porder'); if (!el) return;
  const P = s.rest?.purchasing, orders = P ? (P.orders || (P.lines ? [P] : [])) : null;
  const lines = (orders || []).flatMap((o) => (o.lines || []).map((l) => ({...l, eta_s: o.eta_s, supplier: o.supplier})));
  lines.sort((a, b) => (s.inventory?.[a.ingredient]?.days_of_cover ?? 9) - (s.inventory?.[b.ingredient]?.days_of_cover ?? 9));
  const key = orders ? orders.map((o) => o.supplier + (o.lines || []).map((l) => l.ingredient + l.qty).join()).join('|') : '';
  const when = P?.next_delivery_s ?? orders?.[0]?.eta_s;
  const head = `<h3><svg><use href="#p-truck"/></svg>next delivery <span class="chip dark">${when != null ? (Math.floor(when / 86400) > (s.clock?.day ?? 0) ? 'tomorrow ' : 'today ') + R.hm(when) : '—'}</span></h3>`;
  let body;
  if (!P) body = `<div class="more">asking policy ${s.policy?.policy || 'D'} what it would order…</div>`;
  else if (!lines.length) body = `<div class="or"><span></span><span>nothing to order: every shelf is above its reorder point</span><span></span><small></small></div>`;
  else body = lines.slice(0, 3).map((l) => { const row = s.inventory?.[l.ingredient], u = UNIT[row?.uom || l.uom] || [1, ''], it = BY[l.ingredient];
    return `<button class="or" data-pick="${BY[l.ingredient] ? l.ingredient : ''}">${it ? artS(s, it, 30) : `<svg class="art" width="30" height="30"><use href="#p-truck" width="30" height="24"/></svg>`}<span>${esc(nameOf(row, l.ingredient))}</span><span class="re">+${(row?.uom || l.uom) === 'pc' ? Math.round(l.qty) : (l.qty / u[0]).toFixed(1)}${u[1] ? ' ' + u[1] : ''}</span><small>${esc(String(l.supplier || '').split('_')[0])} · ${R.hm(l.eta_s)}</small></button>`; }).join('')
    + (lines.length > 3 ? `<div class="more">+${lines.length - 3} more · ${lines.slice(3).map((l) => esc(nameOf(s.inventory?.[l.ingredient], l.ingredient))).join(', ')}</div>` : '');
  const done = approved && approved === key;
  const foot = `<div class="foot"><span>${P && lines.length ? `<b>${R.rs(P.total_inr || 0)}</b> · ${Math.round(P.co2e_kg || 0)} kg CO₂e · ${esc(P.service_level || 'sized to forecast')}` : ''}</span>`
    + `<button class="btn" data-action="place_po" ${!lines.length || approving || done ? 'disabled' : ''}>${done ? 'ordered ✓' : approving ? 'ordering…' : 'approve order'}</button></div>`;
  const html = head + body + foot + (orderSig ? '' : '');
  if (html !== orderSig) { orderSig = html; el.innerHTML = html; el.dataset.key = key; }
}
room.querySelector('.porder')?.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-action="place_po"]'); if (!b || b.disabled || !window.BrewApi) return;
  const s = R.S(), P = s?.rest?.purchasing; if (!P) return;
  approving = true; orderSig = ''; renderOrder(s);
  try { for (const o of (P.orders || [P])) if (o.lines?.length) await BrewApi.act('place_po', {supplier: o.supplier_key || o.supplier, lines: o.lines});
    approved = b.closest('.porder').dataset.key; window.BrewToast?.('order placed ♡ watch for the truck'); window.BrewLive?.refresh?.('purchasing'); }
  catch (err) { window.BrewToast?.(err.message || 'order refused', true); }
  finally { approving = false; orderSig = ''; renderOrder(R.S()); }
});

/* ---------- frame ---------- */
let lastRefresh = 0;
function render(s){
  if (!s) return;
  const now = R.now();
  renderShelves(s, now); renderTip(s, now); renderFresh(s, now); renderCover(s); renderOrder(s);
  if (document.body.dataset.room === 'pantry' && performance.now() - lastRefresh > 60000) { lastRefresh = performance.now(); window.BrewLive?.refresh?.('pantry', SLOTS.map((x) => x.id).filter((x) => x !== 'rescue')); }
}
R.onState(render);
setInterval(() => { if (document.body.dataset.room === 'pantry') render(R.S()); }, 5000);
window.BrewPantry = {render, show, SLOTS};
})();
