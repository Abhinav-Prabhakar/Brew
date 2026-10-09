/* brew — pantry room: walk-in fridge + dry store. Draws into #pantry-scene, fills the pantry panels, drives the hover card.
   Every visual is generated from ITEMS below. Reuses lobby.js helpers (I, st, C, th, use) and kitchen.js symbols (k-*). */
(() => {
const K = {steel:'#e4e7eb', steelD:'#c7cdd4', steelL:'#f2f4f6', wood:'#c99a6e', woodD:'#a87a52', glass:'#e6f1f4', brew:'#6b3f26', chrome:'#d9dee3'};
const FR = {fresh:'#bfe6cf', mid:'#f6c76a', bad:'#ef7d6d', none:'#ece4d8'};
const S = [318, 498, 678];                      // shelf deck heights, top to bottom
const t = (x, y, s, sz = 14, opt = '') => `<text x="${x}" y="${y}" ${opt} font-family="Patrick Hand" font-size="${sz}" fill="${I}">${s}</text>`;
const gt = (x, y, s, sz = 18, opt = '') => `<text x="${x}" y="${y}" ${opt} font-family="Gochi Hand" font-size="${sz}" fill="${I}">${s}</text>`;
const fresh = l => l.dl == null ? 'none' : l.life <= 1 ? (l.dl / l.life > .6 ? 'fresh' : l.dl / l.life > .3 ? 'mid' : 'bad') : l.dl <= .5 ? 'bad' : l.dl <= 1.5 ? 'mid' : 'fresh';
const fmtDl = d => d == null ? '—' : d < 1 ? Math.max(1, Math.round(d * 24)) + 'h' : d < 45 ? Math.round(d) + 'd' : Math.round(d / 30) + 'mo';
const covCol = c => c < 1 ? FR.bad : c < 2 ? FR.mid : FR.fresh;
const L = (q, rec, exp, dl, life, op) => ({q, rec, exp, dl, life, op});

/* ---------- stock ---------- */
const ITEMS = [
  // walk-in · top shelf
  {id:'oat', name:'oat milk', kind:'carton', s:0, x:218, w:112, h:84, n:4, lvl:.45, col:'#e3c27a', open:true, on:'9.4 L', par:.59, u:'L', onN:9.4, p50:7.2, p90:9.8, cover:1.1, re:'+12 L', by:'14:00', co2:.9, sup:'GreenLeaf Oats',
    lots:[L('1.4 L','4 Oct','7 Oct',1.1,10,'06:50'), L('4 L','5 Oct','12 Oct',6,10), L('4 L','6 Oct','15 Oct',9,10)]},
  {id:'milk', name:'whole milk', kind:'carton', s:0, x:338, w:104, h:84, n:3, lvl:.18, col:'#8fb9de', open:true, on:'5.2 L', par:.35, u:'L', onN:5.2, p50:5.8, p90:7.4, cover:.8, re:'+8 L', by:'12:00', co2:3.2, sup:'Nandi Dairy Co-op',
    lots:[L('0.4 L','3 Oct','6 Oct',.3,5,'07:15'), L('2 L','5 Oct','9 Oct',3,5), L('3 L','6 Oct','10 Oct',4,5)]},
  {id:'cream', name:'cream', kind:'carton', s:0, x:450, w:84, h:66, n:3, lvl:.7, col:'#f2d78f', cw:24, ch:40, on:'1.5 L', par:.75, u:'L', onN:1.5, p50:.6, p90:.9, cover:2.5, co2:7.6, sup:'Nandi Dairy Co-op',
    lots:[L('0.5 L','4 Oct','10 Oct',4,8), L('1 L','6 Oct','14 Oct',8,8)]},
  {id:'butter', name:'butter', kind:'blocks', s:0, x:545, w:80, h:52, n:3, col:'#f7e3a0', lab:'#fff', bw:30, bh:15, on:'1.5 kg', par:.6, u:'kg', onN:1.5, p50:.4, p90:.6, cover:3.4, co2:9, sup:'Nandi Dairy Co-op',
    lots:[L('3 × 500 g','1 Oct','29 Oct',23,28)]},
  {id:'paneer', name:'paneer', kind:'blocks', s:0, x:655, w:96, h:70, n:5, col:'#f8f4e8', lab:C.pink, open:true, on:'2 kg', par:.5, u:'kg', onN:2, p50:.9, p90:1.4, cover:2.8, re:'+2 kg', by:'tmrw', co2:8, sup:'Nandi Dairy Co-op',
    lots:[L('2 × 400 g','4 Oct','8 Oct',2,5,'08:05'), L('3 × 400 g','6 Oct','11 Oct',5,5)]},
  {id:'berry', name:'berries', kind:'punnets', s:0, x:785, w:134, h:64, n:5, berries:['#e0554a','#5b6fa8','#e0554a','#5b6fa8','#e0554a'], bad:[0], on:'5 punnets', par:.42, u:'', onN:5, p50:3, p90:5, cover:1.2, re:'+6', by:'tmrw', co2:1.5, sup:'Hosur Berry Farm',
    lots:[L('1 punnet','3 Oct','6 Oct',.25,4), L('4 punnets','5 Oct','9 Oct',3,4)]},
  {id:'avo', name:'avocados', kind:'crate', s:0, x:930, w:124, h:58, n:9, fruit:'avo', on:'9', par:.45, u:'', onN:9, p50:6, p90:9, cover:1, re:'+12', by:'tmrw', co2:2.5, sup:'GreenLeaf Farms',
    lots:[L('4 ripe','4 Oct','7 Oct',1.2,4), L('5 firm','6 Oct','11 Oct',5,6)]},
  // walk-in · middle shelf
  {id:'dough', name:'croissant dough', kind:'trays', s:1, x:232, w:140, h:96, n:4, on:'40 pcs', par:.66, u:'', onN:40, p50:28, p90:40, cover:1.6, re:'bake 2 trays', by:'09:00', co2:2.8, sup:'Bengaluru Bakehouse',
    lots:[L('1 tray','5 Oct','7 Oct',1,3,'07:30'), L('3 trays','6 Oct','9 Oct',2.8,3)]},
  {id:'cheese', name:'cheddar', kind:'blocks', s:1, x:380, w:90, h:52, n:3, col:'#f3c94e', lab:'#fff', bw:36, bh:18, open:true, on:'1.8 kg', par:.6, u:'kg', onN:1.8, p50:.3, p90:.5, cover:6, co2:13.5, sup:'Kodai Cheese Co',
    lots:[L('0.6 kg','28 Sep','12 Oct',6,21,'5 Oct'), L('1.2 kg','4 Oct','2 Nov',27,29)]},
  {id:'eggs', name:'eggs', kind:'eggs', s:1, x:494, w:96, h:52, n:3, on:'72', par:.6, u:'', onN:72, p50:18, p90:26, cover:4, co2:4.5, sup:'Happy Hens',
    lots:[L('30','2 Oct','16 Oct',10,14), L('42','5 Oct','19 Oct',13,14)]},
  {id:'tom', name:'tomatoes', kind:'crate', s:1, x:660, w:116, h:58, n:8, fruit:'tom', on:'2.4 kg', par:.5, u:'kg', onN:2.4, p50:1.1, p90:1.6, cover:2.1, co2:1.4, sup:'GreenLeaf Farms',
    lots:[L('1 kg','3 Oct','7 Oct',1.4,4), L('1.4 kg','5 Oct','10 Oct',4,5)]},
  {id:'greens', name:'greens', kind:'greens', s:1, x:778, w:96, h:48, on:'2 boxes', par:.5, u:'', onN:2, p50:1, p90:1.5, cover:1.5, re:'+3', by:'tmrw', co2:1.1, sup:'Hosur Greens',
    lots:[L('1 box','4 Oct','7 Oct',.8,3,'07:40'), L('1 box','6 Oct','9 Oct',2.8,3)]},
  {id:'mise', name:'prepped mise', kind:'deli', s:1, x:898, w:120, h:66, cups:['#d7e69a','#f08a7e','#d7e69a','#f6e3a0','#f4a7b9'], on:'5 tubs', par:.7, u:'', onN:5, p50:4, p90:6, cover:.8, re:'prep 3', by:'10:30', co2:1.2, sup:'made in-house',
    lots:[L('2 tubs','06:30','14:30',.1,.33,'06:30'), L('3 tubs','08:10','16:10',.25,.33,'08:10')]},
  {id:'yog', name:'yogurt', kind:'tubs', s:1, x:1002, w:62, h:76, on:'2 tubs', par:.5, u:'kg', onN:2, p50:.8, p90:1.2, cover:2.4, co2:3, sup:'Nandi Dairy Co-op',
    lots:[L('1 kg','3 Oct','9 Oct',3,6,'5 Oct'), L('1 kg','6 Oct','13 Oct',7,7)]},
  // walk-in · bottom shelf
  {id:'cbc', name:'cold brew concentrate', kind:'jugs', s:2, x:240, w:112, h:80, lv:[.35, .9], on:'5 L', par:.62, u:'L', onN:5, p50:2.2, p90:3.4, cover:2.3, re:'brew 4 L', by:'tonight', co2:4, sup:'made in-house',
    lots:[L('1.4 L','3 Oct','10 Oct',4,7,'4 Oct'), L('3.6 L','5 Oct','12 Oct',6,7)]},
  {id:'oatcase', name:'oat milk · backstock', kind:'cases', s:2, x:425, w:150, h:78, n:3, ccol:'#e3c27a', on:'36 L', par:.5, u:'L', onN:36, p50:7.2, p90:9.8, cover:4.9, co2:.9, sup:'GreenLeaf Oats',
    lots:[L('2 cases','5 Oct','2 Nov',27,28), L('1 case','6 Oct','4 Nov',29,28)]},
  {id:'rescue', name:'use-today bin', kind:'rescue', s:2, x:700, w:150, h:66, on:'4 items', par:1, cover:.3, re:'→ rescue menu', co2:2.1, sup:'FEFO pick · 08:00',
    lots:[L('milk 0.4 L','3 Oct','6 Oct',.3,5,'07:15'), L('berries ×1','3 Oct','6 Oct',.25,4), L('mise ×2','06:30','14:30',.1,.33,'06:30')]},
  {id:'milkcase', name:'milk · backstock', kind:'cases', s:2, x:880, w:150, h:78, n:3, ccol:'#8fb9de', on:'24 L', par:.4, u:'L', onN:24, p50:5.8, p90:7.4, cover:3.2, co2:3.2, sup:'Nandi Dairy Co-op',
    lots:[L('1 case','4 Oct','10 Oct',4,6), L('2 cases','6 Oct','12 Oct',6,6)]},
  // dry store
  {id:'beans', name:'house blend beans', kind:'sacks', s:0, x:1190, w:172, h:88, f:[.45, .9, .85], open:0, on:'8.6 kg', par:.72, u:'kg', onN:8.6, p50:1.9, p90:2.6, cover:3.4, re:'+6 kg', by:'Thu', co2:17, sup:'Chikmagalur Estates',
    lots:[L('1.6 kg','28 Sep','28 Oct',22,30,'5 Oct'), L('2 × 3 kg','3 Oct','2 Nov',27,30)]},
  {id:'decaf', name:'decaf beans', kind:'pouch', s:0, x:1330, w:70, h:68, n:2, on:'1.5 kg', par:.5, u:'kg', onN:1.5, p50:.2, p90:.3, cover:6, co2:17, sup:'Chikmagalur Estates',
    lots:[L('2 × 750 g','25 Sep','25 Nov',50,60)]},
  {id:'matcha', name:'matcha', kind:'tins', s:0, x:1425, w:86, h:56, n:3, tcol:'#8fbf6a', open:true, on:'300 g', par:.6, u:'g', onN:300, p50:40, p90:70, cover:5.2, co2:9, sup:'Kyoto Leaf Co',
    lots:[L('1 tin','2 Sep','2 Dec',57,90,'1 Oct'), L('2 tins','30 Sep','30 Jan',116,120)]},
  {id:'cocoa', name:'cocoa', kind:'tins', s:0, x:1526, w:86, h:56, n:2, tcol:'#8a5a3c', on:'500 g', par:.5, u:'g', onN:500, p50:30, p90:55, cover:9, co2:19, sup:'Kerala Cocoa',
    lots:[L('2 tins','20 Sep','20 Mar',165,180)]},
  {id:'flour', name:'flour', kind:'bin', s:1, x:1162, w:104, h:98, lvl:.62, bcol:'#fbf7ee', lid:C.pink, on:'14 kg', par:.62, u:'kg', onN:14, p50:2.1, p90:3, cover:6.7, co2:.8, sup:'Mysore Mills',
    lots:[L('14 kg','30 Sep','30 Dec',85,91,'2 Oct')]},
  {id:'sugar', name:'sugar', kind:'bin', s:1, x:1292, w:100, h:98, lvl:.28, bcol:'#fffdf7', lid:'#b9cdb0', sparkle:true, on:'5 kg', par:.28, u:'kg', onN:5, p50:1.4, p90:2.1, cover:2.4, re:'+10 kg', by:'Thu', co2:1.8, sup:'Mandya Sugars',
    lots:[L('5 kg','26 Sep','26 Sep +1y',355,365,'1 Oct')]},
  {id:'syrup', name:'syrups', kind:'bottles', s:1, x:1460, w:170, h:92, c:['#f3e2b0','#d08a3c','#8a5a3c','#b9a3dc'], lv:[.8, .35, .6, .9], on:'4 bottles', par:.66, u:'L', onN:2.6, p50:.3, p90:.5, cover:8, co2:2, sup:'Sweet Drop Syrups',
    lots:[L('caramel','12 Sep','12 Nov',37,60,'20 Sep'), L('3 bottles','1 Oct','1 Dec',56,60)]},
  {id:'cups', name:'paper cups', kind:'cups', s:2, x:1160, w:120, h:110, hs:[100, 78, 56], on:'640', par:.64, u:'', onN:640, p50:150, p90:210, cover:4.2, co2:.9, sup:'PaperLeaf Packaging',
    lots:[L('640','1 Oct','—',null)]},
  {id:'lids', name:'lids', kind:'lids', s:2, x:1285, w:90, h:44, hs:[6, 3], on:'120', par:.12, u:'', onN:120, p50:150, p90:210, cover:.4, re:'+1,000', by:'today', co2:3.5, sup:'PaperLeaf Packaging',
    lots:[L('120','29 Sep','—',null)]},
  {id:'bags', name:'kraft bags', kind:'bagstack', s:2, x:1400, w:110, h:74, n:9, on:'260', par:.52, u:'', onN:260, p50:40, p90:60, cover:4.5, co2:1.1, sup:'PaperLeaf Packaging',
    lots:[L('260','2 Oct','—',null)]},
  {id:'straws', name:'straws + napkins', kind:'straws', s:2, x:1520, w:100, h:82, on:'2 boxes', par:.7, u:'', onN:2, cover:9, co2:1, sup:'PaperLeaf Packaging',
    lots:[L('2 boxes','25 Sep','—',null)]},
];
const BY = Object.fromEntries(ITEMS.map(it => [it.id, it]));

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
const fruit = (k, x, y) => k === 'avo'
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
  punnets(cx, b, o){ const pw = 40, ph = 24; let s = '';
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
      + `<rect x="${x}" y="${b-ch}" width="${cw}" height="${ch}" rx="3" fill="${o.fruit === 'avo' ? K.wood : '#8fb3c9'}" ${st(2.5)}/><path d="M${x} ${b-ch+11}h${cw}M${x} ${b-ch+22}h${cw}" ${st(1.5)}/><rect x="${cx-11}" y="${b-ch+3}" width="22" height="6" rx="3" fill="${I}" opacity=".65"/>`; },
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
  jugs(cx, b, o){ let s = '';
    o.lv.forEach((lv, i) => { const x = cx - 50 + i * 54, w = 44, h = 66, top = b - h, ly = b - 4 - (h - 30) * lv;
      const body = `M${x+12} ${top}h20v8q12 4 12 16v${h-28}q0 4-4 4h-36q-4 0-4-4v${-(h-28)}q0-12 12-16z`;
      s += `<path d="${body}" fill="${K.glass}" ${st(2.5)}/><rect x="${x+3}" y="${ly}" width="${w-6}" height="${b - 3 - ly}" rx="3" fill="${K.brew}"/><path d="${body}" fill="none" ${st(2.5)}/>
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
<rect x="514" y="112" width="180" height="24" rx="3" fill="#2f3d36"/>
<rect x="514" y="117" width="180" height="11" fill="#3e5a4a" opacity=".7"/>`;
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
for (const it of ITEMS) STOCK += draw(it, it.x, S[it.s] - 6);

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

/* ---------- labels, lot tags, FEFO arrows (crisp, unfiltered) ---------- */
let TAGS = '';
for (const it of ITEMS) {
  const b = S[it.s], x0 = it.x - it.w / 2 + 4, w = it.w - 8;
  // channel label: par gauge + on-hand
  const bw = Math.min(42, w - 50);
  TAGS += `<rect x="${x0 + 2}" y="${b + 8}" width="${bw}" height="8" rx="4" fill="#f1ece5" ${st(1.3)}/><rect x="${x0 + 2.5}" y="${b + 8.5}" width="${((bw - 1) * Math.min(1, it.par)).toFixed(1)}" height="7" rx="3.5" fill="${covCol(it.cover)}"/>`
    + t(x0 + bw + 7, b + 17, it.on, 12);
  // lot tags in use order (soonest expiry first) with a FEFO arrow
  const lots = [...it.lots].sort((a, c) => (a.dl ?? 1e9) - (c.dl ?? 1e9));
  const tx = it.x - (lots.length * 30 + 14) / 2;
  TAGS += `<g class="p-fefo"><path d="M${tx} ${b + 33}h9" stroke="${C.terra}" stroke-width="3" stroke-linecap="round"/><path d="M${tx + 6} ${b + 28}l6 5l-6 5" fill="none" stroke="${C.terra}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g>`;
  lots.forEach((l, i) => { const f = fresh(l), x = tx + 16 + i * 30, y = b + 25;
    TAGS += `<g class="${f === 'bad' ? 'p-pulse' : ''}"><path d="M${it.x} ${b + 22}L${x + 13} ${y}" ${st(1)} opacity=".35"/>
    <rect x="${x}" y="${y}" width="27" height="17" rx="4" fill="${FR[f]}" stroke="${I}" stroke-width="${i === 0 ? 2.6 : 1.6}"/>
    ${l.op ? `<path d="M${x + 19} ${y}h8v8z" fill="#fff" ${st(1.2)}/>` : ''}
    <text x="${x + 12}" y="${y + 13}" text-anchor="middle" font-family="Patrick Hand" font-size="11.5" fill="${I}">${fmtDl(l.dl)}</text></g>`; });
}
// header readouts
TAGS += gt(187, 131, 'walk-in', 21, 'text-anchor="middle"') + `<use href="#p-snow" class="p-spin" x="216" y="114" width="20" height="20"/>`
  + `<text id="p-temp" x="460" y="133" text-anchor="middle" font-family="Courier Prime" font-weight="700" font-size="22" fill="#8ff0a4">3.2°C</text>`;
{ const temps = [3.1, 3.0, 3.2, 3.1, 3.0, 2.9, 3.0, 3.6, 3.9, 3.4, 3.1, 3.0, 3.2, 3.5, 3.3, 3.2];
  const pts = temps.map((v, i) => `${516 + i * 11.7},${136 - (v - 1) / 4 * 24}`).join(' ');
  TAGS += `<polyline points="${pts}" fill="none" stroke="#8ff0a4" stroke-width="2.2" stroke-linejoin="round"/><circle cx="${516 + 15 * 11.7}" cy="${136 - 2.2 / 4 * 24}" r="3" fill="#8ff0a4"/>`
    + `<text x="690" y="142" text-anchor="end" font-family="Courier Prime" font-size="8.5" fill="#8ff0a4" opacity=".7">6h · 1–5°C</text>`; }
TAGS += `<circle cx="745" cy="124" r="12" fill="#fff" ${st(2)}/><path d="M745 124v-7M745 124l5 3" ${st(2)}/>`
  + t(764, 120, 'door open', 12.5, 'opacity=".7"') + `<text id="p-door-t" x="764" y="141" font-family="Gochi Hand" font-size="19" fill="${C.terra}">0:42</text>`
  + `<use href="#p-drop" x="866" y="110" width="22" height="22"/>` + gt(892, 132, '86%', 18) + t(934, 131, 'RH', 12, 'opacity=".6"')
  + `<rect x="968" y="110" width="96" height="26" rx="13" fill="#e4efd9" ${st(2)}/>` + t(1016, 128, 'compressor', 12.5, 'text-anchor="middle"');
TAGS += gt(1225, 132, 'dry store', 22, 'text-anchor="middle"') + t(1306, 131, 'FIFO', 12.5, 'opacity=".6"');
TAGS += `<text x="116" y="758" text-anchor="middle" font-family="Courier Prime" font-weight="700" font-size="11" fill="#8ff0a4">4.20kg</text>`
  + `<rect x="1188" y="738" width="30" height="12" fill="none"/>` + t(1203, 749, '×1000', 10, 'text-anchor="middle"')
  + t(1483, 756, 'cold chain', 12, 'text-anchor="middle" fill="#fff"');
// the label printer feeding a lot label
const FEED = `<g class="p-feed"><rect x="256" y="680" width="48" height="32" rx="3" fill="#fffefb" ${st(1.8)}/><rect x="256" y="680" width="48" height="8" fill="${FR.fresh}" ${st(1.4)}/>
${[0, 1, 2, 3, 4, 5, 6, 7].map(k => `<rect x="${262 + k * 5}" y="${694}" width="${k % 3 ? 1.6 : 3}" height="10" fill="${I}"/>`).join('')}</g>`;

/* ---------- cold air, fans, sparkle ---------- */
let FX = `<g transform="translate(560 174)"><g class="p-spin">${[0, 120, 240].map(a => `<path d="M0 0q-3-12 4-14q4 6-4 14z" fill="${K.steelD}" ${st(1.4)} transform="rotate(${a})"/>`).join('')}</g></g>
<g transform="translate(640 174)"><g class="p-spin" style="animation-delay:-.3s">${[0, 120, 240].map(a => `<path d="M0 0q-3-12 4-14q4 6-4 14z" fill="${K.steelD}" ${st(1.4)} transform="rotate(${a})"/>`).join('')}</g></g>
<circle class="k-drip" cx="600" cy="200" r="2.6" fill="#9fd0e8"/>`;
[[160, 260, 0], [150, 420, -1.5], [170, 560, -3], [150, 690, -.8], [180, 340, -2.2]].forEach(([x, y, d]) =>
  FX += `<path class="p-wisp" style="animation-delay:${d}s" d="M${x} ${y}q-24-10-46 0t-46 0" fill="none" stroke="#cfe7f2" stroke-width="7" stroke-linecap="round" opacity=".8"/>`);
[[182, 178], [1012, 176], [210, 166], [978, 170]].forEach(([x, y], i) =>
  FX += `<path class="p-tw" style="animation-delay:${-i * .6}s" d="M${x} ${y-6}L${x+1.5} ${y-1.5}L${x+6} ${y}L${x+1.5} ${y+1.5}L${x} ${y+6}L${x-1.5} ${y+1.5}L${x-6} ${y}L${x-1.5} ${y-1.5}Z" fill="#fff" ${st(1.2)}/>`);

/* ---------- hover targets ---------- */
let HIT = '';
for (const it of ITEMS) { const b = S[it.s];
  HIT += `<rect class="p-hit" data-id="${it.id}" tabindex="0" role="button" aria-label="${it.name}: ${it.on}" x="${it.x - it.w / 2}" y="${b - it.h - 18}" width="${it.w}" height="${it.h + 62}" rx="10"/>`; }

document.getElementById('pantry-scene').innerHTML = DEFS
  + `<g filter="url(#wob)">${M}</g>` + FX + `<g filter="url(#wob)">${STOCK}${STRIPS}${CHAN}${DOOR}</g>`
  + FEED + `<g filter="url(#wob)">${BENCH}</g>` + TAGS + HIT
  + `<rect width="1600" height="1000" filter="url(#grain)" opacity=".22" pointer-events="none"/>`;

/* ---------- hover card ---------- */
const tipEl = document.getElementById('p-tip');
const icon = (id, w = 18, h = 14) => `<svg width="${w}" height="${h}" aria-hidden="true"><use href="#${id}" width="${w}" height="${h}"/></svg>`;
function tipHTML(it){
  const lots = [...it.lots].sort((a, c) => (a.dl ?? 1e9) - (c.dl ?? 1e9));
  const rows = lots.map((l, i) => { const f = fresh(l), el = l.dl == null ? 0 : Math.min(1, Math.max(0, 1 - l.dl / l.life));
    return `<div class="lot${i === 0 ? ' first' : ''}"><span class="lq">${i === 0 ? '<b class="fefo">➜</b>' : ''}${l.q}</span>
      <span class="tl"><small>${l.rec}</small><span class="tb"><i style="width:${(l.dl == null ? 100 : el * 100).toFixed(0)}%;background:${FR[f]}"></i>${l.dl != null ? `<em style="left:${(el * 100).toFixed(0)}%"></em>` : ''}</span><small>${l.exp}</small></span>
      <span class="dl" style="background:${FR[f]}">${fmtDl(l.dl)}</span>
      ${l.op ? `<span class="op" title="opened ${l.op}">${icon('p-open', 16, 16)}${l.op}</span>` : `<span class="op sealed" title="sealed">${icon('p-seal', 16, 16)}</span>`}</div>`; }).join('');
  let fc = '';
  if (it.p50 != null) { const max = Math.max(it.p90, it.onN) * 1.15, pc = v => (v / max * 100).toFixed(1) + '%';
    fc = `<div class="fc"><span>today</span><span class="bul"><i class="stock" style="width:${pc(it.onN)};background:${covCol(it.cover)}"></i>
      <b style="left:${pc(it.p50)}"><small>p50 ${it.p50}</small></b><b class="p90" style="left:${pc(it.p90)}"><small>p90 ${it.p90}</small></b></span><span>${it.u}</span></div>`; }
  const cov = [0, 1, 2, 3, 4].map(d => { const f = Math.min(1, Math.max(0, it.cover - d)) * 100;
    return `<i style="background:linear-gradient(90deg,${covCol(it.cover)} ${f}%,#fff ${f}%)"></i>`; }).join('');
  const re = it.re ? `<span class="re">${icon('p-truck')}${it.re}${it.by ? ' · ' + it.by : ''}</span>` : `<span class="re ok">✓ stocked</span>`;
  return `<div class="th">${art(it, 50)}<div class="tn"><b>${it.name}</b><span class="sup">${icon('p-truck')}${it.sup}</span></div><span class="onhand">${it.on}</span></div>
    <div class="lots">${rows}</div>${fc}
    <div class="meta"><span class="cov" title="days of cover">${cov}<b>${it.cover}d</b></span>${re}
    <span class="co2" title="kg CO₂e per kg">${icon('p-leaf', 16, 16)}${it.co2}<small>CO₂e/kg</small><i style="--w:${Math.min(1, it.co2 / 20).toFixed(2)}"></i></span></div>`;
}
let current = null;
function show(id){
  const it = BY[id]; if (!it || current === id) return; current = id;
  document.querySelectorAll('.p-hit').forEach(h => h.classList.toggle('on', h.dataset.id === id));
  tipEl.innerHTML = tipHTML(it);
  const W = 336, Hh = tipEl.offsetHeight || 230, b = S[it.s];
  let left = it.x < 800 ? it.x + it.w / 2 + 16 : it.x - it.w / 2 - 16 - W;
  left = Math.max(12, Math.min(1588 - W, left));
  const top = Math.max(158, Math.min(796 - Hh, b - it.h - 24));
  tipEl.style.left = left + 'px'; tipEl.style.top = top + 'px';
}
document.getElementById('pantry-scene').addEventListener('pointerover', e => { const h = e.target.closest('.p-hit'); if (h) show(h.dataset.id); });
document.getElementById('pantry-scene').addEventListener('focusin', e => { const h = e.target.closest('.p-hit'); if (h) show(h.dataset.id); });
document.getElementById('pantry-scene').addEventListener('click', e => { const h = e.target.closest('.p-hit'); if (h) show(h.dataset.id); });
show('oat');

/* ---------- bottom panels ---------- */
const urgent = ITEMS.filter(it => it.kind !== 'rescue' && it.lots.some(l => fresh(l) === 'bad'));
document.getElementById('p-today').innerHTML = urgent.map(it => {
  const l = it.lots.find(x => fresh(x) === 'bad');
  return `<button class="it" data-pick="${it.id}" title="${it.name} · ${l.q}">${art(it, 38)}<b>${fmtDl(l.dl)}</b></button>`; }).join('');
const waste = [3.1, 2.4, 2.8, 1.6, 1.2, .9, .7];
document.getElementById('p-waste').innerHTML = waste.map((v, i) => `<i style="height:${(v / 3.6 * 100).toFixed(0)}%" title="${['wed','thu','fri','sat','sun','mon','tue'][i]} · ${v} kg"></i>`).join('') + `<em style="bottom:${(3.4 / 3.6 * 100).toFixed(0)}%"></em>`;
document.getElementById('p-cover').innerHTML = ['lids', 'milk', 'avo', 'oat', 'berry', 'dough', 'beans', 'cups', 'flour'].map(id => { const it = BY[id];
  return `<button class="cell" data-pick="${id}" title="${it.name}">${art(it, 28)}<span class="cb"><i style="width:${Math.min(100, it.cover / 5 * 100)}%;background:${covCol(it.cover)}"></i></span><span>${it.cover}d</span></button>`; }).join('');
const orders = ITEMS.filter(it => it.re && it.re.startsWith('+')).sort((a, c) => a.cover - c.cover);
document.getElementById('p-order').innerHTML = orders.slice(0, 3).map(it =>
  `<button class="or" data-pick="${it.id}">${art(it, 30)}<span>${it.name}</span><span class="re">${it.re}</span><small>${it.sup.split(' ')[0]} · ${it.by}</small></button>`).join('')
  + `<div class="more">+${orders.length - 3} more · ${orders.slice(3).map(it => it.name).join(', ')}</div>`;
document.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => show(b.dataset.pick)));

/* ---------- live: door-open timer + temperature drift ---------- */
if (document.body.classList.contains('still') || /[?&]still\b/.test(location.search) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
let open = 42;
setInterval(() => {
  open++;
  document.getElementById('p-door-t').textContent = `${Math.floor(open / 60)}:${String(open % 60).padStart(2, '0')}`;
  const temp = Math.min(4.6, 3.2 + open / 400 + Math.sin(open / 3) * .05);
  const el = document.getElementById('p-temp');
  el.textContent = temp.toFixed(1) + '°C';
  el.setAttribute('fill', temp > 4 ? '#f6c76a' : '#8ff0a4');
  if (open > 300) open = 20;
}, 1000);
})();
