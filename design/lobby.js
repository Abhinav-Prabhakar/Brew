/* brew — lobby room. A static hand-inked backdrop (walls, window, door, lectern, counter, machines) drawn once, and
   live layers rendered from window.BrewLive.state with keyed diffing: tickets on the rail, the customers (queue,
   pickup, tables), tables, the pastry dome, ready plates on the pass, delivery bags + riders, the receipt printer,
   the wall clock, the sky — plus the three cards under the counter (policy decisions, now brewing, bottlenecks).
   Uses doodles.js (ink kit + people) and render.js (keyed layers). */
(() => {
const scene = document.getElementById('lobby-scene');
seed = 11;

/* ================================================================ static backdrop */
const defs = `
<defs>
  <filter id="wob" x="-1%" y="-1%" width="102%" height="102%">
    <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="7" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="3.2" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
  <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch"/>
    <feColorMatrix values="0 0 0 0 .12  0 0 0 0 .08  0 0 0 0 .08  0 0 0 .55 0"/></filter>
  <radialGradient id="glow"><stop offset="0" stop-color="#ffe2a6" stop-opacity=".75"/><stop offset="1" stop-color="#ffe2a6" stop-opacity="0"/></radialGradient>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${th.sky}"/><stop offset="1" stop-color="#fff6ec"/></linearGradient>
  <clipPath id="win"><rect x="470" y="185" width="660" height="275"/></clipPath>

  <symbol id="latte" viewBox="0 0 60 60">
    <path d="M22 15q-3-3 0-6t0-6M33 15q-3-3 0-6t0-6" fill="none" ${st(2)} opacity=".45"/>
    <ellipse cx="30" cy="53" rx="25" ry="5" fill="#fff" ${st(2.5)}/>
    <path d="M47 26q11-1 10 9q-1 9-12 8" fill="none" ${st(2.5)}/>
    <path d="M11 22h38l-4 24q-1 6-8 6h-14q-7 0-8-6z" fill="#fff" ${st(2.5)}/>
    <ellipse cx="30" cy="22" rx="19" ry="4.5" fill="#c58b5e" ${st(2)}/>
    <path d="M30 25c-4-2-6-4-4-5.5c1.5-1 3.5 0 4 1c.5-1 2.5-2 4-1c2 1.5 0 3.5-4 5.5z" fill="${C.pinkL}"/>
  </symbol>
  <symbol id="matcha" viewBox="0 0 60 60">
    <path d="M22 15q-3-3 0-6t0-6M33 15q-3-3 0-6t0-6" fill="none" ${st(2)} opacity=".45"/>
    <ellipse cx="30" cy="53" rx="25" ry="5" fill="#fff" ${st(2.5)}/>
    <path d="M47 26q11-1 10 9q-1 9-12 8" fill="none" ${st(2.5)}/>
    <path d="M11 22h38l-4 24q-1 6-8 6h-14q-7 0-8-6z" fill="${C.pink}" ${st(2.5)}/>
    <ellipse cx="30" cy="22" rx="19" ry="4.5" fill="#a9c98a" ${st(2)}/>
    <path d="M24 22q6 4 12 0" fill="none" stroke="#fff" stroke-width="2"/>
  </symbol>
  <symbol id="croissant" viewBox="0 0 60 60">
    <path d="M6 44C8 28 18 18 30 18s22 10 24 26c-6-4-10-4-14-1c-2-8-6-11-10-11s-8 3-10 11c-4-3-8-3-14 1z" fill="#e8b66a" ${st(2.5)}/>
    <path d="M20 43c1-11 5-18 10-19M40 43c-1-11-5-18-10-19M13 32l4 6M47 32l-4 6" fill="none" ${st(2)}/>
  </symbol>
  <symbol id="coldbrew" viewBox="0 0 60 60">
    <path d="M36 2l-5 30" ${st(1)} stroke="${C.pinkD}" stroke-width="4"/>
    <path d="M16 10h28l-4 46h-20z" fill="#fff" ${st(2.5)}/>
    <path d="M17.6 22h24.8l-3.1 32h-18.6z" fill="#6b3f26"/>
    <rect x="21" y="25" width="9" height="9" rx="1.5" fill="#fff" fill-opacity=".85" ${st(1.5)} transform="rotate(12 25 29)"/>
    <rect x="30" y="31" width="9" height="9" rx="1.5" fill="#fff" fill-opacity=".85" ${st(1.5)} transform="rotate(-14 34 35)"/>
    <path d="M16 10h28l-4 46h-20z" fill="none" ${st(2.5)}/>
  </symbol>
  <symbol id="toast" viewBox="0 0 60 60">
    <ellipse cx="30" cy="51" rx="27" ry="5.5" fill="#fff" ${st(2.5)}/>
    <path d="M10 47V25q0-13 20-13t20 13v22z" fill="#d9a066" ${st(2.5)}/>
    <path d="M14 45V27q0-10 16-10t16 10v18z" fill="#f3d9a4"/>
    <ellipse cx="23" cy="32" rx="6" ry="10" fill="#9cbf7a" ${st(2)} transform="rotate(-20 23 32)"/>
    <ellipse cx="36" cy="34" rx="6" ry="10" fill="#9cbf7a" ${st(2)} transform="rotate(18 36 34)"/>
    <circle cx="41" cy="24" r="1.5" fill="${I}"/><circle cx="18" cy="41" r="1.5" fill="${I}"/><circle cx="29" cy="43" r="1.5" fill="${I}"/>
  </symbol>
  <symbol id="cake" viewBox="0 0 60 60">
    <ellipse cx="30" cy="52" rx="27" ry="5.5" fill="#fff" ${st(2.5)}/>
    <path d="M8 48h44V24L8 36z" fill="#fff8ef" ${st(2.5)}/>
    <path d="M8 42h44v-8L8 40z" fill="${C.pink}"/>
    <path d="M8 36L52 24" ${st(5)} stroke="${C.pinkD}"/>
    <path d="M8 48h44V24L8 36z" fill="none" ${st(2.5)}/>
    <circle cx="44" cy="20" r="5" fill="${C.terra}" ${st(2)}/><path d="M44 15q2-6 7-7" fill="none" ${st(2)}/>
  </symbol>
</defs>`;

function vine(a, b, y){
  let d = `M${a} ${y}`, s = '';
  for (let x = a; x < b - 80; x += 80){
    d += ' q20 -16 40 0 t40 0';
    s += `<path d="M${x+20} ${y-8}q-7-12 4-15q9 0 6 8" fill="none" ${st(1.6)}/>`;
    s += `<ellipse cx="${x+60}" cy="${y+11}" rx="7" ry="3.4" fill="none" ${st(1.5)} transform="rotate(30 ${x+60} ${y+11})"/>`;
    s += `<circle cx="${x+40}" cy="${y}" r="2.5" fill="${I}"/>`;
  }
  return `<path d="${d}" fill="none" ${st(1.8)}/>` + s;
}

let W = `<rect width="1600" height="1000" fill="${C.paper}"/>
<rect width="1600" height="70" fill="#f5ece2"/>
<path d="M0 70H1600M0 78H1600" fill="none" ${st(2.5)}/>`;
[[20,385],[400,1200],[1215,1580]].forEach(([a,b]) => {
  W += `<rect x="${a}" y="92" width="${b-a}" height="74" rx="6" fill="none" ${st(2)}/>`;
  W += vine(a + 22, b - 4, 129);
});
// window + skyline (the sky + weather live in #l-sky)
const wx = 470, wy = 185, ww = 660, wh = 275;
let SKYLINE = `<path d="M540 410L690 262L840 410z" fill="#eef0f4" ${st(2.5)}/>
  <path d="M652 300L690 262L728 300L714 294L702 306L690 292L678 306L666 294z" fill="#fff" ${st(2)}/>`;
const WINDOWS = [];
let bx = wx - 10;
while (bx < wx + ww){
  const bw = 40 + rnd() * 46, bh = 60 + rnd() * 140, dark = rnd() < .3, pinkB = !dark && rnd() < .3;
  const top = wy + wh - bh;
  SKYLINE += `<rect x="${bx}" y="${top}" width="${bw}" height="${bh+4}" fill="${dark ? C.navy : pinkB ? C.pinkL : '#fff'}" ${st(2.2)}/>`;
  for (let yy = top + 10; yy < wy + wh - 8; yy += 13)
    for (let xx = bx + 7; xx < bx + bw - 8; xx += 11)
      if (rnd() < .78) { SKYLINE += `<rect x="${xx}" y="${yy}" width="5" height="7" fill="${dark ? '#f6e9d0' : I}" opacity="${dark ? .9 : .7}"/>`; if (!dark && rnd() < .35) WINDOWS.push([xx, yy]); }
  if (rnd() < .3) SKYLINE += `<path d="M${bx+bw/2} ${top}v-16" ${st(2)}/>`;
  bx += bw + (rnd() < .3 ? 6 : 0);
}
let FRAME = `<rect x="${wx}" y="${wy}" width="${ww}" height="${wh}" fill="none" ${st(4)}/>
<rect x="${wx+7}" y="${wy+7}" width="${ww-14}" height="${wh-14}" fill="none" ${st(1.6)}/>`;
for (let k = 1; k < 6; k++) FRAME += `<path d="M${wx + ww*k/6} ${wy}V${wy+wh}" ${st(3)}/>`;
FRAME += `<path d="M${wx} ${wy+58}H${wx+ww}" ${st(3)}/>
<rect x="${wx-16}" y="${wy+wh}" width="${ww+32}" height="12" rx="3" fill="#fff" ${st(2.5)}/>
<path d="M405 178H1195" ${st(4)}/><circle cx="403" cy="178" r="7" fill="${C.mustard}" ${st(2.5)}/><circle cx="1197" cy="178" r="7" fill="${C.mustard}" ${st(2.5)}/>`;
const curtain = `<path d="M430 180H505C500 260 520 330 492 360C520 400 500 440 512 472H440C450 430 428 400 452 360C430 330 440 260 430 180Z" fill="${C.pinkL}" ${st(3)}/>
<path d="M455 190C458 260 470 320 470 356M482 190C484 260 488 320 484 356M462 372C458 410 466 440 462 468M486 372C490 410 484 440 490 468" fill="none" ${st(1.6)}/>
<ellipse cx="472" cy="360" rx="27" ry="7" fill="${C.mustard}" ${st(2.5)}/>`;
FRAME += curtain + `<g transform="translate(1600 0) scale(-1 1)">${curtain}</g>`;

let ROOM = `<rect x="0" y="470" width="1600" height="140" fill="${C.pinkL}"/>
<path d="M0 470H1600M0 478H1600" fill="none" ${st(2.5)}/>`;
for (let x = 14; x < 1600; x += 156) ROOM += `<rect x="${x}" y="494" width="132" height="100" rx="8" fill="none" ${st(1.8)}/>`;
ROOM += `<rect x="0" y="610" width="1600" height="160" fill="${th.floor}"/><path d="M0 610H1600" ${st(3)}/>`;
[640, 680, 730].forEach(y => ROOM += `<path d="M0 ${y}H1600" ${st(1.4)} opacity=".3"/>`);
for (let x = -400; x <= 2000; x += 120){ const x2 = 800 + (x - 800) * 1.6; ROOM += `<path d="M${x} 610L${x2} 770" ${st(1.4)} opacity=".25"/>`; }
// door (the sign is live: #l-sign)
ROOM += `<rect x="1355" y="290" width="170" height="320" fill="none" ${st(3)}/>
<rect x="1365" y="300" width="150" height="310" rx="4" fill="${C.pink}" ${st(3)}/>
<rect x="1385" y="320" width="110" height="130" rx="4" fill="#fff" ${st(2.5)}/>
<path d="M1400 340l20-12M1404 354l34-22" ${st(2)} opacity=".35"/>
<rect x="1385" y="470" width="110" height="120" rx="4" fill="none" ${st(2)}/>
<circle cx="1502" cy="470" r="6" fill="${C.mustard}" ${st(2)}/>
<path d="M1412 345L1440 326L1468 345" fill="none" ${st(1.8)}/>`;
// wall clock face (hands are live)
const CX = 1300, CY = 210;
ROOM += `<circle cx="${CX}" cy="${CY}" r="34" fill="#fff" ${st(3)}/><circle cx="${CX}" cy="${CY}" r="27" fill="none" ${st(1.4)}/>`;
for (let i = 0; i < 12; i++){ const a = i * Math.PI/6; ROOM += `<path d="M${CX+22*Math.sin(a)} ${CY-22*Math.cos(a)}L${CX+26*Math.sin(a)} ${CY-26*Math.cos(a)}" ${st(2)}/>`; }
// hanging plant + rattan lamp
ROOM += `<path d="M1548 80L1562 150M1590 80L1576 150" ${st(1.8)}/><path d="M1540 150h60l-8 34h-44z" fill="${C.terra}" ${st(3)}/>`;
[[1548,190,9],[1544,212,8],[1550,234,7],[1592,192,9],[1596,214,8]].forEach(([x,y,r],i) =>
  ROOM += `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r*0.55}" fill="${C.sage}" ${st(1.8)} transform="rotate(${i%2?40:-40} ${x} ${y})"/>`);
ROOM += `<path d="M1552 184q-6 20-4 50M1588 184q6 16 6 32" fill="none" ${st(1.8)}/>`;
ROOM += `<ellipse cx="220" cy="240" rx="170" ry="150" fill="url(#glow)"/><path d="M220 0V102" ${st(2)}/>
<path d="M165 152Q165 102 220 102Q275 102 275 152Z" fill="#f3d9a4" ${st(3)}/>`;
for (let x = 176; x <= 266; x += 11){ const yt = 152 - 50 * Math.sqrt(Math.max(0, 1 - ((x - 220) / 55) ** 2)); ROOM += `<path d="M${x} ${yt+3}V150" ${st(1.2)} opacity=".55"/>`; }
[120, 135].forEach(y => ROOM += `<path d="M168 ${y+8}Q220 ${y-12} 272 ${y+8}" fill="none" ${st(1.2)} opacity=".55"/>`);
ROOM += `<ellipse cx="220" cy="154" rx="16" ry="6" fill="#fff6d8" ${st(2)}/>`;

const BOOK = `<rect x="162" y="568" width="16" height="180" fill="#b07f55" ${st(2.5)}/>
<path d="M120 752h100l-12-12h-76z" fill="#b07f55" ${st(2.5)}/>
<path d="M44 576H296L284 562H56Z" fill="#b07f55" ${st(2.5)}/>
<path d="M48 428Q110 410 170 428Q230 410 292 428V570Q230 554 170 570Q110 554 48 570Z" fill="${C.pinkD}" ${st(3)}/>
<path d="M56 434Q112 418 168 434V560Q112 546 56 560Z" fill="#fffdf8" ${st(2)}/>
<path d="M172 434Q228 418 284 434V560Q228 546 172 560Z" fill="#fffdf8" ${st(2)}/>
<path d="M178 560l3 26l4-7l4 7l-1-27" fill="${C.mustard}" ${st(2)}/>
<path d="M284 540l-18 20q10-2 18-2z" fill="#f0e6da" ${st(1.6)}/>`;

/* ---------- floor plan: six 2-tops on three long tables (T1+T2 can be pushed together) ---------- */
const TABLE_X = {T1: 370, T2: 535, T3: 700, T4: 865, T5: 1030, T6: 1195};
const SEAT_DX = 41, SEAT_Y = 536, SC_SEAT = .78;
const seatX = (tid, i) => (TABLE_X[tid] ?? 700) + (i % 2 ? SEAT_DX : -SEAT_DX);
let CHAIRS = '';
for (const tid in TABLE_X) for (const i of [0, 1]) CHAIRS += `<g transform="translate(${seatX(tid, i)} ${SEAT_Y}) scale(${SC_SEAT})">${chair(0, -20, 150)}</g>`;
function twoTop(cx, state, mergeDx){
  const x = cx + mergeDx;
  let s = `<ellipse cx="${x}" cy="760" rx="60" ry="6" fill="${I}" opacity=".1"/>
  <path d="M${x-6} 654L${x-8} 750L${x+8} 750L${x+6} 654Z" fill="#fff" ${st(2.5)}/>
  <path d="M${x-40} 760Q${x} 742 ${x+40} 760Z" fill="#fff" ${st(2.5)}/>
  <rect x="${x-80}" y="638" width="160" height="16" rx="4" fill="#fff" ${st(3)}/>
  <path d="M${x-62} 645q12-4 18 2t16 0" fill="none" ${st(1)} opacity=".45"/>`;
  if (state === 'dirty') s += `<ellipse cx="${x-24}" cy="636" rx="22" ry="4.5" fill="#fff" ${st(2.3)}/><circle cx="${x-30}" cy="632" r="2" fill="${I}"/><circle cx="${x-18}" cy="633" r="2.2" fill="${I}"/>
    <path d="M${x+16} 636l7-20h14l-3 20z" fill="#efe4d6" ${st(2.3)} transform="rotate(-8 ${x+26} 626)"/><path d="M${x+20} 624q4 3 8 0" stroke="#a5805e" stroke-width="2" fill="none"/>`;
  return s;
}

/* ---------- counter ---------- */
const CT = (() => {
  let s = `<rect x="0" y="790" width="1600" height="210" fill="${C.pink}"/>`;
  for (let x = 22; x < 1600; x += 44) s += `<path d="M${x} 808V975" ${st(1.4)} opacity=".3"/>`;
  return s + `<rect x="-5" y="975" width="1610" height="30" fill="${C.pinkD}" ${st(3)}/>
  <rect x="0" y="800" width="1600" height="9" fill="${th.lip}"/>
  <path d="M-10 762H1610V800H-10Z" fill="#fffaf6" ${st(3)}/>
  <path d="M40 778q30-6 60 2t50 0M620 784q40-8 70 0M1180 776q30 6 64-2" fill="none" ${st(1)} opacity=".4"/>`;
})();
let ITEMS = `<rect x="60" y="${B-76}" width="180" height="76" rx="10" fill="#fffdf9" ${st(3)}/>
<rect x="70" y="${B-86}" width="160" height="24" rx="8" fill="${C.navy}" ${st(3)}/>
<rect x="84" y="${B-37}" width="132" height="7" rx="3" fill="${I}"/>
<circle cx="224" cy="${B-52}" r="4.5" fill="#9cbf7a" ${st(1.5)}/><rect x="74" y="${B-58}" width="22" height="9" rx="3" fill="${C.pink}" ${st(1.5)}/>`;
// espresso machine (its busy tag + bottleneck ring are live)
ITEMS += `<path d="M300 ${B-120}q-6-10 2-16q8-6 2-14M318 ${B-122}q-6-10 2-16q8-6 2-14" fill="none" ${st(2)} opacity=".4"/>
<rect x="290" y="${B-104}" width="160" height="104" rx="10" fill="#b9cdb0" ${st(3)}/>
<rect x="290" y="${B-104}" width="160" height="22" rx="8" fill="${C.sage}" ${st(3)}/>
<circle cx="322" cy="${B-60}" r="14" fill="#fff" ${st(2.5)}/><path d="M322 ${B-60}l9-5" ${st(2.2)}/><path d="M331 ${B-70}a14 14 0 0 1 4 8" stroke="${C.terra}" stroke-width="3" fill="none"/>
<rect x="372" y="${B-70}" width="44" height="12" rx="3" fill="#ddd" ${st(2.5)}/><path d="M416 ${B-62}L454 ${B-54}" ${st(6)}/>
<path d="M382 ${B-26}h26l-3 22h-20z" fill="#fff" ${st(2.5)}/>
<path d="M302 ${B-60}q-10 20-8 46" fill="none" ${st(3)}/>`;
// pastry dome base (bakes inside are live), pass bell, tip jar, radio
ITEMS += `<ellipse cx="590" cy="${B-2}" rx="76" ry="8" fill="#fff" ${st(2.5)}/>`;
const BELL = `<ellipse cx="870" cy="${B-3}" rx="32" ry="6" fill="#ddd" ${st(2.5)}/><g id="l-bell" class="l-bell"><path d="M842 ${B-6}Q842 ${B-40} 870 ${B-40}Q898 ${B-40} 898 ${B-6}Z" fill="${C.mustard}" ${st(3)}/>
<rect x="865" y="${B-50}" width="10" height="10" rx="2" fill="${I}"/><path d="M852 ${B-30}q4-6 10-6" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/></g>
<g id="l-ding" class="l-ding"><path d="M906 ${B-52}l12-8M910 ${B-38}l14-2M832 ${B-52}l-12-8" ${st(2.2)}/></g>`;
ITEMS += `<path d="M1352 ${B-58}h44v6q4 4 4 12v40h-52v-40q0-8 4-12z" fill="#eef6f7" fill-opacity=".7" ${st(2.5)}/>
<circle cx="1366" cy="${B-12}" r="6" fill="${C.mustard}" ${st(1.6)}/><circle cx="1382" cy="${B-9}" r="6" fill="${C.mustard}" ${st(1.6)}/>
<path d="M1500 ${B-64}L1540 ${B-110}" ${st(2.2)}/><circle cx="1541" cy="${B-111}" r="3.5" fill="${I}"/>
<rect x="1450" y="${B-66}" width="126" height="66" rx="14" fill="${C.mustard}" ${st(3)}/>
<circle cx="1484" cy="${B-33}" r="20" fill="#fff8e6" ${st(2.5)}/>`;
for (let i = -12; i <= 12; i += 6) for (let j = -12; j <= 12; j += 6)
  if (i*i + j*j < 190) ITEMS += `<circle cx="${1484+i}" cy="${B-33+j}" r="1.6" fill="${I}"/>`;
ITEMS += `<rect x="1516" y="${B-52}" width="48" height="14" rx="4" fill="#fff8e6" ${st(2)}/><path d="M1530 ${B-52}v14" stroke="${C.terra}" stroke-width="2.5"/>
<circle cx="1528" cy="${B-20}" r="7" fill="${C.pinkD}" ${st(2)}/><circle cx="1552" cy="${B-20}" r="7" fill="${C.pinkD}" ${st(2)}/>`;
const DOME_GLASS = `<path d="M520 ${B-4}Q520 ${B-94} 590 ${B-94}Q660 ${B-94} 660 ${B-4}" fill="#e8f2f4" fill-opacity=".45" ${st(3)}/>
<path d="M538 ${B-40}q2-30 26-40" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
<circle cx="590" cy="${B-100}" r="7" fill="${C.pink}" ${st(2.5)}/>`;

/* ---------- crisp static labels ---------- */
let TXT = '';
{ const row = (x1, x2, y, a, sku) => tx(x1, y, a, 13.5) + tx(x2, y, '', 13.5, `text-anchor="end" data-lsku="${sku}"`);
  TXT += tx(112, 456, '~ coffee ~', 17, 'text-anchor="middle" font-family="Gochi Hand"') + tx(228, 456, '~ bakes ~', 17, 'text-anchor="middle" font-family="Gochi Hand"');
  TXT += row(64, 162, 480, 'latte', 'latte') + row(64, 162, 499, 'cold brew', 'coldbrew') + row(64, 162, 518, 'matcha', 'matcha') + row(64, 162, 537, 'espresso', 'espresso');
  TXT += row(180, 278, 480, 'croissant', 'croissant') + row(180, 278, 499, 'avo toast', 'avotoast') + row(180, 278, 518, 'cheesecake', 'cheesecake') + row(180, 278, 537, 'muffin', 'muffin');
}
TXT += `<text x="1374" y="${B-64}" text-anchor="middle" font-family="Gochi Hand" font-size="14" fill="${I}">tips ♡</text>`;
TXT += `<text x="1440" y="${B-110}" font-family="Gochi Hand" font-size="22" fill="${C.pinkD}" opacity=".7">♪</text><text x="1470" y="${B-128}" font-family="Gochi Hand" font-size="17" fill="${C.pinkD}" opacity=".5">♫</text>`;

/* ---------- assemble: static groups + empty live layers (z-order matters) ---------- */
const g = (id, extra = '') => `<g id="${id}" ${extra}></g>`;
scene.innerHTML = defs
  + `<g filter="url(#wob)">${W}</g>`
  + `<g clip-path="url(#win)"><rect x="${wx}" y="${wy}" width="${ww}" height="${wh}" fill="url(#sky)"/>${g('l-sky')}<g filter="url(#wob)">${SKYLINE}</g>${g('l-lights')}${g('l-rain')}</g>`
  + `<g filter="url(#wob)">${FRAME}${ROOM}${BOOK}</g>` + g('l-hands') + g('l-sign') + g('l-decor', 'filter="url(#wob)"')
  + `<g filter="url(#wob)">${CHAIRS}</g>` + g('l-seated', 'filter="url(#wob)"') + g('l-tables', 'filter="url(#wob)"') + g('l-front', 'filter="url(#wob)"')
  + g('l-stand', 'filter="url(#wob)"')
  + `<g filter="url(#wob)">${CT}${ITEMS}</g>` + g('l-bakes') + `<g filter="url(#wob)">${DOME_GLASS}</g>` + g('l-esp')
  + g('l-pass') + `<g filter="url(#wob)">${BELL}</g>` + g('l-bags', 'filter="url(#wob)"') + g('l-receipt')
  + g('l-rail') + g('l-tags') + TXT + g('l-flash')
  + `<rect width="1600" height="1000" filter="url(#grain)" opacity=".22" pointer-events="none"/>`;

const $ = (id) => document.getElementById(id);
const MENU = (window.BREW_MENU && BREW_MENU.menu) ? Object.fromEntries(BREW_MENU.menu.map((m) => [m.sku, m])) : {};
const MODS = (window.BREW_MENU && BREW_MENU.modifiers) || {};
const nm = (sku, s) => (s?.menu?.[sku]?.name || MENU[sku]?.name || R.human(sku)).toLowerCase();

/* ================================================================ live: clock, sky, door */
function renderClock(t){
  const tod = R.tod(t), h = (tod / 3600) % 12, m = (tod % 3600) / 60;
  const ha = h * 30 * Math.PI / 180, ma = m * 6 * Math.PI / 180;
  $('l-hands').innerHTML = `<g filter="url(#wob)"><path d="M${CX} ${CY}L${(CX+14*Math.sin(ha)).toFixed(1)} ${(CY-14*Math.cos(ha)).toFixed(1)}" ${st(3.2)}/><path d="M${CX} ${CY}L${(CX+21*Math.sin(ma)).toFixed(1)} ${(CY-21*Math.cos(ma)).toFixed(1)}" ${st(2.2)}/></g><circle cx="${CX}" cy="${CY}" r="3" fill="${C.pinkD}"/>`;
}
let skySig = '';
function renderSky(s, t){
  const w = s.weather || {}, tod = R.tod(t) / 3600;
  const night = tod < 6.2 || tod > 19.4 ? 1 : tod < 7 ? (7 - tod) / .8 : tod > 18.2 ? (tod - 18.2) / 1.2 : 0;
  const state = w.state || 'partly', rain = (w.rain_mm_h || 0) > .1;
  const sig = `${state}|${rain}|${night.toFixed(2)}`;
  if (sig === skySig) return; skySig = sig;
  let k = '';
  if (night > 0) k += `<rect x="${wx}" y="${wy}" width="${ww}" height="${wh}" fill="#2f3647" opacity="${(Math.min(1, night) * .78).toFixed(2)}"/>`;
  if (state === 'sunny' || state === 'partly') k += night > .6
    ? `<circle cx="1052" cy="250" r="20" fill="#fff6d8" ${st(2.5)}/><circle cx="1060" cy="244" r="17" fill="#2f3647" opacity="${night*.78}"/>`
    : `<circle cx="1052" cy="250" r="24" fill="#f6d58e" ${st(2.5)}/>`;
  const cloud = (x, y, s2, col) => `<path transform="translate(${x} ${y}) scale(${s2})" d="M0 0q8-16 24-8q10-14 26 0q16-2 14 12h-60q-10 0-4-4z" fill="${col}" ${st(2)}/>`;
  const grey = rain ? '#dfe3e8' : '#fff';
  if (state !== 'sunny') k += cloud(560, 250, 1, grey) + cloud(880, 222, .9, grey);
  if (state === 'cloudy' || rain) k += cloud(700, 214, 1.3, grey) + cloud(990, 262, 1.1, grey) + cloud(500, 206, .8, grey);
  $('l-sky').innerHTML = `<g filter="url(#wob)">${k}</g>`;
  $('l-lights').innerHTML = night > .4 ? WINDOWS.map(([x, y]) => `<rect x="${x}" y="${y}" width="5" height="7" fill="#f6d58e"/>`).join('') : '';
  let r = '';
  if (rain) for (let i = 0; i < (state === 'rain' ? 46 : 20); i++) { const x = wx + (i * 53.7) % ww, y = wy + (i * 97.3) % wh;
    r += `<path class="l-rainy" style="animation-delay:${(-(i % 7) * .13).toFixed(2)}s" d="M${x.toFixed(0)} ${y.toFixed(0)}l-6 16" stroke="#7fa9c6" stroke-width="2" stroke-linecap="round" opacity=".7"/>`; }
  $('l-rain').innerHTML = r;
}
let signSig = '';
function renderSign(s){
  const open = !!s.clock?.is_open, sig = String(open);
  if (sig === signSig) return; signSig = sig;
  $('l-sign').innerHTML = `<g filter="url(#wob)"><rect x="1402" y="345" width="76" height="30" rx="6" fill="${open ? '#fff' : C.navy}" ${st(2.5)}/></g>`
    + `<text x="1440" y="367" text-anchor="middle" font-family="Gochi Hand" font-size="19" fill="${open ? C.pinkD : '#fff'}">${open ? 'open ♡' : 'closed'}</text>`
    + (open ? '' : tx(1440, 398, `opens ${R.hm((s.clock?.open_s ?? 25200) % 86400)}`, 13, 'text-anchor="middle"'));
}

/* ================================================================ live: people */
/* Where everyone stands. Standing people are drawn at a smaller scale in two rows by the door:
   back row = queue to order (front of the queue nearest the tables), front row = waiting for pickup. */
const SC_Q = .72, SC_W = .78, DOOR = [1440, 548];
const Q_SLOT = (i) => [1318 + i * 60, 548 - (i % 2) * 5];
const W_SLOT = (i) => [1300 + i * 64, 594 + (i % 2) * 6];
const RIDER_SLOT = (i) => [1566 - i * 46, 584];
const STAND = new Set(['arrived', 'queued', 'ordering', 'waiting', 'seat_wait', 'balked', 'reneged', 'left']);
const SEATED = new Set(['seated', 'eating', 'lingering', 'paying']);
const memo = new Map();   // party → {x, y, sc, seated, walkUntil}

function seatsOf(c){
  const tids = c.tables || [], seats = c.seats || [];
  const out = [];
  for (let m = 0; m < Math.max(1, c.party_size || 1); m++) {
    const si = seats[m] ?? m, tid = tids[Math.min(tids.length - 1, Math.floor(si / 2))] || tids[0];
    if (tid) out.push([seatX(tid, si), SEAT_Y]);
  }
  return out;
}
function orderOf(s, c){ return c.order_no != null ? s.orders?.[c.order_no] : null; }
function holding(s, c){ const o = orderOf(s, c); const it = o?.items?.find((x) => ['latte', 'matcha', 'coldbrew', 'cake', 'croissant', 'toast'].includes(skuIcon(x.sku)));
  return it ? skuIcon(it.sku) : 'latte'; }
function moodOf(s, c, t){
  if (c.state === 'reneged' || c.state === 'balked') return 'angry';
  if (c.state === 'left') return c.happy === false ? 'worried' : 'happy';
  if (c.state === 'eating') return 'chew';
  if (c.state === 'lingering') return c.laptop ? 'focused' : 'happy';
  if (c.state === 'paying') return 'happy';
  const f = patienceFrac(c, t);
  if (f != null) return f < .2 ? 'angry' : f < .45 ? 'worried' : 'neutral';
  return c.persona === 'regular' ? 'happy' : 'neutral';
}
function patienceFrac(c, t){
  if (c.state === 'waiting' && c.patience_deadline_s && c.patience_s) return Math.max(0, Math.min(1, (c.patience_deadline_s - t) / c.patience_s));
  return c.patience_frac ?? null;
}
function members(c){ const seeds = (c.appearance_seeds && c.appearance_seeds.length) ? c.appearance_seeds : [R.hash(c.party_id)];
  return Array.from({length: Math.max(1, c.party_size || 1)}, (_, m) => seeds[m] ?? (seeds[0] + 7919 * m)); }

function standingDrawing(c, mood, walking){
  const ms = members(c);
  let s = '';
  ms.slice(0, 4).reverse().forEach((sd, k) => { const m = ms.length - 1 - k; const kid = c.persona === 'family' && m >= 2;
    const p = Doodle.person({seed: sd, persona: c.persona, pose: 'stand', mood, phone: c.persona === 'commuter' && m === 0 && !walking,
                             holding: c.state === 'left' && c.channel === 'takeaway' && m === 0 ? 'latte' : null});
    s += `<g transform="translate(${m * 30} ${m * 6 + (kid ? 40 : 0)}) scale(${kid ? .72 : 1})">${p.body}</g>`; });
  return s;
}
const lPeople = R.layer($('l-stand'), {
  key: (it) => it.c.party_id,
  sig: (it) => `${it.c.state}|${it.mood}|${it.c.party_size}|${it.walking}`,
  html: (it) => `<g class="who${it.walking ? ' walking' : ''}" data-party="${it.c.party_id}" data-state="${it.c.state}"><g class="bob">${standingDrawing(it.c, it.mood, it.walking)}</g></g>`,
  place: (r, it, isNew) => {
    if (isNew) { const from = it.from || DOOR; R.moveTo(r.el, from[0], from[1], {instant: true, scale: it.fromSc || SC_Q}); void r.el.getBoundingClientRect(); }
    const ms = R.moveTo(r.el, it.x, it.y, {dur: it.dur || 1.2, scale: it.sc, ease: 'linear'});
    const who = r.el.firstElementChild; if (ms && who) { who.classList.add('walking'); clearTimeout(r.data.w); r.data.w = setTimeout(() => who.classList.remove('walking'), ms); }
    r.el.style.opacity = it.fade ? '0' : '1';
    r.el.style.transitionProperty = 'transform, opacity';
  },
  exit: (r) => { r.el.style.transition = 'opacity .6s ease'; r.el.style.opacity = '0'; return 650; },
});
const seatDrawing = (c, m, sd, mood, s) => Doodle.person({seed: sd, persona: c.persona, pose: 'sit', mood,
  laptop: c.state === 'lingering' && c.laptop && m === 0, holding: c.state === 'eating' || (c.state === 'lingering' && !c.laptop) ? holding(s, c) : null});
const lSeated = R.layer($('l-seated'), {
  key: (it) => `${it.c.party_id}:${it.m}`, sig: (it) => `${it.c.state}|${it.mood}|${it.c.laptop}`,
  html: (it) => `<g data-party="${it.c.party_id}" data-state="${it.c.state}" transform="translate(${it.x} ${it.y}) scale(${SC_SEAT})">${it.p.body}</g>`,
  exit: (r) => { r.el.style.transition = 'opacity .35s ease'; r.el.style.opacity = '0'; return 350; },
});
const lFront = R.layer($('l-front'), {
  key: (it) => `${it.c.party_id}:${it.m}`, sig: (it) => `${it.c.state}|${it.mood}|${it.c.laptop}`,
  html: (it) => `<g transform="translate(${it.x} ${it.y}) scale(${SC_SEAT})">${it.p.front}</g>`, exit: (r) => { r.el.style.transition = 'opacity .35s ease'; r.el.style.opacity = '0'; return 350; },
});
const lTables = R.layer($('l-tables'), {
  key: (it) => it.id, sig: (it) => `${it.state}|${it.dx}`,
  html: (it) => twoTop(TABLE_X[it.id], it.state, it.dx),
  place: (r, it, isNew) => { if (r.changed && !isNew) R.bump(r.el, 'settle'); },
});
function renderPeople(s, t){
  const cs = Object.values(s.customers || {}).filter((c) => c.channel !== 'zomato' && c.channel !== 'swiggy' && c.channel !== 'delivery');
  cs.sort((a, b) => (a.arrived_s || 0) - (b.arrived_s || 0));
  const now = performance.now();
  const queue = cs.filter((c) => c.state === 'ordering').concat(cs.filter((c) => c.state === 'queued' || c.state === 'arrived'));
  const waiting = cs.filter((c) => (c.state === 'waiting' || c.state === 'seat_wait') && !(c.tables && c.tables.length));
  const standing = [], seated = [], front = [];
  const put = (c, x, y, sc, extra = {}) => {
    const mm = memo.get(c.party_id), d = mm ? Math.hypot(x - mm.x, y - mm.y) : Math.hypot(x - DOOR[0], y - DOOR[1]);
    const walkMs = mm && mm.x === x && mm.y === y ? 0 : Math.min(3200, 300 + d * 4.2);
    const it = {c, x, y, sc, mood: moodOf(s, c, t), from: mm ? [mm.x, mm.y] : DOOR, fromSc: mm ? mm.sc : SC_Q, dur: walkMs / 1000, walking: false, ...extra};
    standing.push(it); return walkMs;
  };
  queue.forEach((c, i) => { const [x, y] = Q_SLOT(Math.min(i, 4) + (i > 4 ? .3 * (i - 4) : 0)); put(c, x, y, SC_Q); memo.set(c.party_id, {x, y, sc: SC_Q}); });
  waiting.forEach((c, i) => { const [x, y] = W_SLOT(Math.min(i, 4) + (i > 4 ? .3 * (i - 4) : 0)); put(c, x, y, SC_W); memo.set(c.party_id, {x, y, sc: SC_W}); });
  for (const c of cs) {
    if (SEATED.has(c.state) || (c.state === 'waiting' && c.tables && c.tables.length)) {
      const seats = seatsOf(c); if (!seats.length) continue;
      const mm = memo.get(c.party_id);
      if (!mm || !mm.seated) {             // walk from wherever they were to the seat, then sit
        const [x0] = seats[0], ms = put(c, x0, SEAT_Y + 12, SC_SEAT);
        memo.set(c.party_id, {x: x0, y: SEAT_Y + 12, sc: SC_SEAT, seated: true, walkUntil: now + ms});
        if (ms) { setTimeout(() => render(R.S(), false), ms + 30); continue; }
      } else if (mm.walkUntil > now) { put(c, mm.x, mm.y, SC_SEAT); continue; }
      const mood = moodOf(s, c, t);
      members(c).forEach((sd, m) => { const [x, y] = seats[Math.min(m, seats.length - 1)];
        const p = seatDrawing(c, m, sd, mood, s); seated.push({c, m, x, y, p, mood}); front.push({c, m, x, y, p, mood}); });
    } else if (c.state === 'left' || c.state === 'balked' || c.state === 'reneged') {
      const mm = memo.get(c.party_id);
      if (mm && mm.gone) { standing.push(mm.gone); continue; }
      const it = {c, x: DOOR[0] + 30, y: DOOR[1], sc: SC_Q, mood: moodOf(s, c, t), from: mm ? [mm.x, mm.y] : DOOR, fromSc: mm ? mm.sc : SC_Q,
                  dur: mm ? Math.min(3.5, .4 + Math.hypot(DOOR[0] - mm.x, DOOR[1] - mm.y) * .0042) : .8};
      if (c.state === 'balked' && !mm) { it.from = DOOR; it.x = DOOR[0] - 70; it.dur = .9; }
      it.fade = false; standing.push(it);
      const goneIt = {...it, from: [it.x, it.y], fromSc: it.sc, fade: true, dur: .01};
      memo.set(c.party_id, {x: it.x, y: it.y, sc: it.sc, gone: null});
      setTimeout(() => { const m2 = memo.get(c.party_id); if (m2) { m2.gone = goneIt; render(R.S(), false); } }, it.dur * 1000 + (c.state === 'balked' ? 1600 : 200));
    } else if (c.state === 'arrived' && !memo.has(c.party_id)) { put(c, DOOR[0], DOOR[1], SC_Q); }
  }
  // delivery riders waiting at the door for their bags
  const riders = Object.values(s.shelf?.bags || {}).filter((b) => b.rider === 'arrived').slice(0, 3);
  riders.forEach((b, i) => { const [x, y] = RIDER_SLOT(i);
    standing.push({c: {party_id: 'rider-' + b.order_no, persona: 'delivery_home', state: 'rider', party_size: 1, appearance_seeds: [R.hash(b.order_no)]}, rider: b, x, y, sc: .8, mood: 'neutral', from: DOOR, fromSc: .8, dur: 1}); });
  lPeople.sync(standing.map((it) => it.rider ? {...it, c: {...it.c}} : it));
  // riders get a helmet + insulated bag (not a generated customer)
  for (const it of standing) if (it.rider) { const r = lPeople.map.get(it.c.party_id); if (r && !r.el.dataset.rider) { r.el.dataset.rider = 1; r.el.firstElementChild.innerHTML = riderDrawing(it.rider); } }
  lSeated.sync(seated); lFront.sync(front);
  for (const k of memo.keys()) if (!s.customers?.[k]) memo.delete(k);
  const tabs = Object.values(s.tables || {}).filter((x) => TABLE_X[x.id] != null);
  const merged = new Set(tabs.filter((x) => x.merged).map((x) => x.id));
  lTables.sync(tabs.map((x) => ({id: x.id, state: x.state, dx: merged.has('T1') && merged.has('T2') ? (x.id === 'T1' ? 3 : x.id === 'T2' ? -3 : 0) : 0})));
  renderTags(s, t, standing, seated);
}
function riderDrawing(b){
  const col = chan(b.channel).col;
  return `<rect x="8" y="32" width="54" height="66" rx="5" fill="${col}" ${st(3)}/><path d="M8 46h54" ${st(2)}/>
    <path d="M-10 120L-13 190M10 120L13 190" ${st(3.2)}/><ellipse cx="-17" cy="192" rx="8" ry="4" fill="${I}"/><ellipse cx="17" cy="192" rx="8" ry="4" fill="${I}"/>
    ${torso(0, 0, col)}<path d="M0 30V122" ${st(1.8)}/>${head(0, 0)}${eyes(0, 0, -4, 4)}${brows(0, 0, 'flat')}${mouth(0, 0, 'neutral')}
    <path d="M-31 4C-35 -42 35 -42 31 4C20 -6 -20 -6 -31 4Z" fill="${col}" ${st(3)}/><path d="M-18 -24q10-8 22-6" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
    ${arm(-28, 46, -48, 98, -14, 84)}<rect x="-24" y="66" width="13" height="22" rx="3" fill="${C.navy}" ${st(2)} transform="rotate(-12 -18 77)"/>${arm(28, 46, 40, 92, 34, 120)}`;
}

/* plates (persona + patience) and speech bubbles — crisp, above everything */
const lTags = R.layer($('l-tags'), {
  key: (it) => it.k, sig: (it) => it.html, html: (it) => it.html,
  place: (r, it) => { r.el.style.opacity = it.hide ? '0' : '1'; r.el.style.transition = 'opacity .3s ease'; },
  exit: (r) => { r.el.style.opacity = '0'; return 300; },
});
function bubbleFor(s, c, t){
  const f = patienceFrac(c, t), o = orderOf(s, c);
  if (c.state === 'balked') return ['queue’s too long…', C.terra];
  if (c.state === 'reneged') return ['forget it. huff', C.terra];
  if (c.state === 'paying') return [c.pay_method === 'cash' ? 'cash, keep the change' : 'paid · UPI ✓', I];
  if (c.state === 'ordering') { const it = o?.items?.[0]; return [it ? `${nm(it.sku, s)}, please!` : 'one sec…', I]; }
  if (c.state === 'waiting' && f != null && f < .35) {
    const left = Math.max(0, (c.patience_deadline_s || t) - t);
    return [c.persona === 'commuter' ? `⏱ ${R.mmss(left)} … my train!` : c.persona === 'student' ? `class in ${R.mmss(left)}…` : `#${c.order_no} ready?`, C.terra];
  }
  if (c.state === 'left' && c.happy && c.persona === 'regular') return ['see you tomorrow ♡', C.pinkD];
  return null;
}
const miniPlate = (x, y, label, p, col) => `<rect x="${x-34}" y="${y}" width="68" height="${p == null ? 22 : 29}" rx="9" fill="#fffefb" ${st(2)}/>`
  + tx(x, y + 15, label, 13, 'text-anchor="middle"')
  + (p == null ? '' : `<rect x="${x-26}" y="${y+19}" width="52" height="6" rx="3" fill="#eee" ${st(1.2)}/><rect x="${x-25.5}" y="${y+19.5}" width="${(51*Math.max(0, Math.min(1, p))).toFixed(1)}" height="5" rx="2.5" fill="${col}"/>`);
/* speech bubbles never overlap: lay them out left→right, lifting any that would collide */
function layoutBubbles(list){
  const placed = [];
  for (const b of list.sort((a, c) => a.x - c.x)) {
    const w = bubbleW(b.text); let y = b.y, x = Math.min(1592 - w / 2, Math.max(8 + w / 2, b.x));
    for (let k = 0; k < 4; k++) { const hit = placed.find((p) => Math.abs(p.y - y) < 40 && Math.abs(p.x - x) < (p.w + w) / 2 + 6); if (!hit) break; y = hit.y - 42; }
    placed.push({x, y, w});
    b.html = bubble(x, y, w, esc(b.text), b.col) + (Math.abs(x - b.x) > 4 ? '' : '');
  }
  return list;
}
function renderTags(s, t, standing, seated){
  const tags = [], pending = [];
  const seenSeat = new Set();
  for (const it of seated) { if (seenSeat.has(it.c.party_id)) continue; seenSeat.add(it.c.party_id);
    const c = it.c, xs = seated.filter((q) => q.c.party_id === c.party_id).map((q) => q.x), x = (Math.min(...xs) + Math.max(...xs)) / 2;
    const lab = PERSONA[c.persona] || c.persona;
    tags.push({k: 'p:' + c.party_id, html: plate(x, 452, c.party_size > 1 ? `${lab} ×${c.party_size}` : lab, null)
      + (c.state === 'lingering' && c.laptop ? tx(x, 444, '💻 lingering', 11, 'text-anchor="middle" opacity=".6"') : '')});
    const b = bubbleFor(s, c, t); if (b) pending.push({k: 'b:' + c.party_id, x, y: 404, text: b[0], col: b[1]});
  }
  let bubbles = 0;
  const st2 = standing.filter((it) => !it.fade && it.c.state !== 'rider').sort((a, b) => (patienceFrac(a.c, t) ?? 1) - (patienceFrac(b.c, t) ?? 1));
  for (const it of st2) {
    const c = it.c, f = patienceFrac(c, t), head = it.y - 27 * it.sc;
    const walking = it.dur > .05 && memo.get(c.party_id)?.walkUntil > performance.now();
    if (c.state === 'waiting' || c.state === 'ordering') {
      const col = f == null ? C.sage : f < .25 ? C.terra : f < .5 ? C.mustard : C.sage;
      tags.push({k: 'p:' + c.party_id, hide: walking, html: miniPlate(it.x, head - 46, c.state === 'waiting' ? `#${c.order_no ?? '…'}` : 'ordering', c.state === 'waiting' ? (f ?? 1) : null, col)});
    }
    const b = bubbleFor(s, c, t);
    if (b && bubbles < 3) { bubbles++; pending.push({k: 'b:' + c.party_id, hide: walking, x: it.x, y: head - 92, text: b[0], col: b[1]}); }
  }
  for (const it of standing.filter((q) => q.rider)) {
    const head = it.y - 27 * it.sc;
    tags.push({k: 'p:' + it.c.party_id, html: plate(it.x, head - 50, `${chan(it.rider.channel).label} rider`, null)});
    if (bubbles < 4) { bubbles++; pending.push({k: 'b:' + it.c.party_id, x: it.x - 10, y: head - 96, text: `#${it.rider.order_no} ready?`, col: I}); }
  }
  for (const b of layoutBubbles(pending)) tags.push({k: b.k, hide: b.hide, html: b.html});
  const extra = Object.values(s.customers || {}).filter((c) => ['queued', 'arrived'].includes(c.state)).length - 5;
  if (extra > 0) tags.push({k: 'more', html: `<rect x="1520" y="440" width="64" height="24" rx="12" fill="${C.pinkL}" ${st(2)}/>` + tx(1552, 457, `+${extra} more`, 13, 'text-anchor="middle"')});
  lTags.sync(tags);
}

/* ================================================================ live: rail tickets */
const RAIL_L = 310, RAIL_R = 1290, TW = 132;
const railY = (x) => { const u = (x - RAIL_L) / (RAIL_R - RAIL_L); return 92 + 13 * 4 * u * (1 - u); };
let TEETH = 'M0 0H132V172'; for (let j = 0; j < 12; j++) TEETH += `l-11 ${j%2 ? -7 : 7}`; TEETH += 'Z';
function tableOf(s, o){ const c = o.party_id && s.customers?.[o.party_id]; return c && c.tables && c.tables.length ? c.tables.join('+') : null; }
function ticketLines(s, o){
  const lines = [];
  for (const it of o.items || []) {
    for (const m of it.mods || []) lines.push((MODS[m]?.allergy ? '⚠ ' : '') + (MODS[m]?.long || R.human(m)));
    if (it.combo) lines.push(`combo ♡ ${R.human(String(it.combo).replace('combo:', ''))}`);
    if (it.replate) lines.push(`rescue ♻ ${nm(it.sku, s)}`);
  }
  if (o.note) lines.push(`"${o.note}"`);
  for (const f of o.note_flags || []) if (!lines.some((l) => l.includes(f))) lines.push(f === 'allergy' ? '⚠ allergy' : f);
  if (!lines.length) { const it = (o.items || []).filter((x) => !x.mods?.length).slice(0, 2);
    it.forEach((x) => lines.push(`${nm(x.sku, s)}${x.qty > 1 ? ' ×' + x.qty : ''}`)); }
  return lines.slice(0, 2).map((l) => l.length > 22 ? l.slice(0, 21) + '…' : l);
}
function ticketSVG(s, o, t){
  const ch = chan(o.channel), tbl = o.channel === 'dine_in' ? tableOf(s, o) : null;
  const label = o.channel === 'dine_in' ? (tbl ? `dine·${tbl}` : 'dine-in') : ch.label;
  const cw = Math.max(46, label.length * 5.9 + 14);
  const skus = []; for (const it of o.items || []) if (!skus.includes(it.sku)) skus.push(it.sku);
  const qty = (o.items || []).reduce((a, x) => a + (x.qty || 1), 0);
  let g = `<path d="${TEETH}" transform="translate(4 4)" fill="${I}" opacity=".15"/><path d="${TEETH}" fill="#fffefb" ${st(2.5)}/>
    <text x="10" y="30" font-family="Gochi Hand" font-size="23" fill="${I}">#${String(o.order_no).padStart(3, '0')}</text>
    <rect x="${126-cw}" y="14" width="${cw}" height="19" rx="9.5" fill="${ch.col}" ${st(1.8)}/>
    <text x="${126-cw/2}" y="28" text-anchor="middle" font-family="Patrick Hand" font-size="12.5" fill="#fff">${esc(label)}</text>
    <path d="M8 40H124" ${st(1.4)} stroke-dasharray="4 4" opacity=".5"/>`;
  if (skus.length >= 2) g += use(skuIcon(skus[0]), 6, 42, 58) + use(skuIcon(skus[1]), 68, 42, 58);
  else if (skus.length) g += use(skuIcon(skus[0]), 37, 42, 58);
  const badge = skus.length > 2 ? `+${skus.length - 2}` : qty > skus.length ? `×${qty}` : '';
  if (badge) g += `<circle cx="${skus.length >= 2 ? 56 : 92}" cy="90" r="11" fill="${I}"/><text x="${skus.length >= 2 ? 56 : 92}" y="94.5" text-anchor="middle" font-family="Patrick Hand" font-size="13" fill="#fff">${badge}</text>`;
  if (o.items?.some((x) => x.replate)) g += `<g transform="translate(104 48) rotate(12)"><rect x="-16" y="-9" width="32" height="18" rx="5" fill="#e4efd9" ${st(1.6)}/>${tx(0, 4, '♻', 12, 'text-anchor="middle"')}</g>`;
  if (o.bumped || o.priority > 0) g += `<path d="M118 44v22M118 44l10 4l-10 4" fill="${C.terra}" ${st(1.8)}/>`;
  ticketLines(s, o).forEach((nt, j) => g += `<text x="10" y="${118 + j * 15}" font-family="Patrick Hand" font-size="13.5" fill="${I}">• ${esc(nt)}</text>`);
  g += `<text x="10" y="152" font-family="Patrick Hand" font-size="11.5" fill="${I}" opacity=".6">wait</text>
    <text class="tk-wait" x="122" y="152" text-anchor="end" font-family="Patrick Hand" font-size="12.5" fill="${I}"></text>
    <rect x="10" y="156" width="112" height="9" rx="4.5" fill="#fff" ${st(1.8)}/><rect class="tk-bar" x="11" y="157" width="0" height="7" rx="3.5" fill="${C.sage}"/>`;
  if (o.status === 'ready') g += `<g class="tk-stamp" transform="translate(66 92) rotate(-14)" opacity=".88"><rect x="-50" y="-17" width="100" height="34" rx="6" fill="#fffefb" fill-opacity=".6" stroke="${C.pinkD}" stroke-width="3"/><text y="8" text-anchor="middle" font-family="Gochi Hand" font-size="22" fill="${C.pinkD}">READY ✓</text></g>`;
  if (o.status === 'voided' || o.status === 'rejected') g += `<g class="tk-stamp" transform="translate(66 92) rotate(10)"><rect x="-44" y="-17" width="88" height="34" rx="6" fill="#fffefb" fill-opacity=".7" stroke="${C.terra}" stroke-width="3"/><text y="8" text-anchor="middle" font-family="Gochi Hand" font-size="22" fill="${C.terra}">VOID</text></g>`;
  g += `<rect x="58" y="-12" width="16" height="30" rx="4" fill="#e0b98a" ${st(2.5)}/><path d="M66 -9V15" ${st(1.4)}/><circle cx="66" cy="4" r="2.4" fill="${I}"/>`;
  return g;
}
const lRail = R.layer($('l-rail'), {
  key: (it) => it.o.order_no,
  sig: (it) => `${it.o.status}|${it.tbl}|${(it.o.items || []).length}|${it.o.bumped}`,
  html: (it) => `<g class="tk" data-ticket="${it.o.order_no}" data-status="${it.o.status}" tabindex="0" role="button" aria-label="order ${it.o.order_no}, ${it.o.status}${it.o.status === 'ready' ? ': serve it' : ': bump priority'}">${it.o.status === 'ready' ? '<title>ready: click to serve</title>' : '<title>click to bump to the front</title>'}${ticketSVG(it.s, it.o, it.t)}</g>`,
  place: (r, it, isNew) => {
    if (isNew) { R.moveTo(r.el, RAIL_R + 60, it.y - 30, {instant: true, rot: 8}); r.el.style.opacity = '0'; void r.el.getBoundingClientRect(); }
    R.moveTo(r.el, it.x, it.y, {dur: .7, rot: it.rot, ease: 'cubic-bezier(.2,.9,.3,1.1)'});
    r.el.style.opacity = '1';
    r.data.o = it.o;
  },
  exit: (r) => {
    const o = r.data.o || {}, xy = R.xyOf(r.el) || [800, 100];
    if (o.status === 'served') { R.moveTo(r.el, xy[0] + 10, xy[1] + 260, {dur: .9, rot: 24, ease: 'cubic-bezier(.5,0,.9,.4)'}); r.el.classList.add('torn'); }
    else R.moveTo(r.el, xy[0], xy[1] + 180, {dur: .8, rot: -18, ease: 'cubic-bezier(.5,0,.9,.4)'});
    r.el.style.transition += ', opacity .5s ease .45s'; r.el.style.opacity = '0';
    return 1000;
  },
});
let railStatic = false;
function renderRail(s, t){
  if (!railStatic) { railStatic = true; $('l-rail').insertAdjacentHTML('beforebegin', `<g id="l-railstring"><path d="M${RAIL_L} 92Q800 118 ${RAIL_R} 92" fill="none" ${st(2.5)}/><circle cx="${RAIL_L}" cy="92" r="7" fill="${C.mustard}" ${st(2.5)}/><circle cx="${RAIL_R}" cy="92" r="7" fill="${C.mustard}" ${st(2.5)}/></g><g id="l-batch"></g>`); }
  const orders = s.orders || {};
  const open = (s.rail?.order_nos || []).map((n) => orders[n]).filter((o) => o && !['served', 'voided', 'rejected'].includes(o.status));
  for (const o of Object.values(orders)) if (o.status === 'ready' && !open.includes(o) && o.channel !== 'zomato' && o.channel !== 'swiggy') open.push(o);
  const show = open.slice(0, 9), n = show.length;
  const step = n <= 6 ? 152 : (RAIL_R - RAIL_L - TW - 40) / (n - 1);
  const items = show.map((o, i) => { const x = 345 + i * step;
    return {o, s, t, tbl: tableOf(s, o), x, y: railY(x + 66) - 4, rot: ((R.hash(o.order_no) % 70) - 35) / 10}; });
  lRail.sync(items);
  // live wait timers + bars without re-rendering the ticket
  for (const it of items) { const r = lRail.map.get(String(it.o.order_no)); if (!r) continue;
    const o = it.o, wait = (o.status === 'ready' ? (o.ready_s || t) : t) - (o.placed_s || t);
    const late = o.promised_s ? (t - o.placed_s) / Math.max(60, o.promised_s - o.placed_s) : 0;
    const w = r.el.querySelector('.tk-wait'); if (w) w.textContent = o.status === 'ready' ? 'done' : R.mmss(wait);
    const bar = r.el.querySelector('.tk-bar'); if (bar) { bar.setAttribute('width', (110 * Math.max(.02, Math.min(1, o.status === 'ready' ? 1 : o.progress || 0))).toFixed(1));
      bar.setAttribute('fill', o.status === 'ready' ? C.sage : late > 1 ? C.terra : late > .7 ? C.mustard : C.sage); } }
  // batch paperclips + ribbon
  let bh = '';
  for (const b of s.rail?.batches || []) {
    const xs = items.filter((it) => b.order_nos.includes(it.o.order_no)).map((it) => it.x + 66);
    if (xs.length < 2) continue;
    const yb = 278, meta = s.batches?.[b.id] || Object.values(s.batches || {}).find((q) => q.order_nos?.join() === b.order_nos.join());
    let d = `M${xs[0]} ${yb}`; for (let k = 1; k < xs.length; k++) d += `Q${(xs[k-1] + xs[k]) / 2} ${yb + 30} ${xs[k]} ${yb}`;
    bh += `<path d="${d}" fill="none" stroke="${C.pinkD}" stroke-width="4" stroke-linecap="round"/>` + xs.map((x) => `<path d="M${x} ${yb}l-9-6v12zM${x} ${yb}l9-6v12z" fill="${C.pink}" ${st(1.8)}/>`).join('');
    const mid = (xs[0] + xs[xs.length - 1]) / 2;
    const what = meta?.step ? ` ${R.human(meta.step)}` : '';
    const label = `batched ×${b.order_nos.length}${what}${meta?.saves_s ? ' · saves ' + R.dur(meta.saves_s) : ''}`;
    const w = label.length * 6.6 + 24;
    bh += `<rect x="${mid - w/2}" y="${yb + 18}" width="${w}" height="26" rx="13" fill="#fff" ${st(2.2)}/>` + tx(mid, yb + 36, esc(label), 15, 'text-anchor="middle"');
  }
  if (open.length > n) bh += `<g transform="translate(1250 70)"><rect x="-6" y="0" width="64" height="26" rx="13" fill="${C.pinkL}" ${st(2)}/>${tx(26, 18, `+${open.length - n}`, 15, 'text-anchor="middle"')}</g>`;
  if (!n) bh += tx(800, 150, s.clock?.is_open ? 'rail’s clear ♡' : 'closed for the night · see you at opening', 18, `text-anchor="middle" font-family="Caveat" font-weight="700" opacity=".55"`);
  const el = $('l-batch'); if (el.innerHTML !== bh) el.innerHTML = bh;
}

/* tickets are buttons: a READY ticket is served (hand it over now), any other ticket toggles its priority bump */
$('l-rail').addEventListener('click', async (e) => {
  const tk = e.target.closest('[data-ticket]'); if (!tk || !window.BrewApi) return;
  const n = +tk.dataset.ticket, o = R.S()?.orders?.[n]; if (!o) return;
  R.bump(tk, 'tk-tap');
  try {
    if (o.status === 'ready') { await BrewApi.act('serve_order', {order_no: n}); }
    else { await BrewApi.act('bump_order', {order_no: n, on: !o.bumped}); window.BrewToast?.(o.bumped ? `#${n} back in line` : `#${n} bumped to the front ⚑`); }
  } catch (err) { window.BrewToast?.(err.message || 'not possible right now', true); }
});
$('l-rail').addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-ticket]')) { e.preventDefault(); e.target.closest('[data-ticket]').dispatchEvent(new MouseEvent('click', {bubbles: true})); } });

/* ================================================================ live: counter */
let bakesSig = '';
function renderBakes(s){
  const f = Array.isArray(s.fridge) ? Object.fromEntries(s.fridge.map((r) => [r.sku, r])) : (s.fridge || {}), cro = f.croissant?.qty ?? 0, muf = f.muffin?.qty ?? 0, cin = f.cinnamon?.qty ?? 0;
  const sig = `${Math.min(5, Math.ceil(cro / 6))}|${Math.min(2, Math.ceil(muf / 10))}|${Math.min(2, Math.ceil(cin / 10))}|${cro}|${f.croissant?.low}`;
  if (sig === bakesSig) return; bakesSig = sig;
  const nC = Math.min(5, Math.ceil(cro / 6)), pos = [[528, B-46], [568, B-46], [608, B-46], [548, B-74], [588, B-74]];
  let k = '';
  for (let i = 0; i < nC; i++) k += use('croissant', pos[i][0], pos[i][1], 44);
  const low = f.croissant?.low;
  const label = cro > 0 ? `bakes · croissant ×${Math.round(cro)}${muf ? ' · muffin ×' + Math.round(muf) : ''}` : 'bakes sold out';
  const w = label.length * 6.4 + 22;
  $('l-bakes').innerHTML = `<g filter="url(#wob)">${k}</g><g transform="translate(590 ${B-128}) rotate(-3)"><rect x="${-w/2}" y="-14" width="${w}" height="22" rx="5" fill="${low || !cro ? '#fbeec6' : C.pinkL}" ${st(2)}/>${tx(0, 3, label, 13.5, 'text-anchor="middle"')}</g>`;
}
let espSig = '';
function renderEsp(s){
  const stn = s.stations?.espresso || {}, util = stn.util, down = stn.status === 'down';
  const hot = (s.bottleneck?.resource === 'espresso') || (s.rest?.bottlenecks?.primary === 'espresso');
  const sig = `${down}|${hot}|${util == null ? '' : Math.round(util * 100)}`;
  if (sig === espSig) return; espSig = sig;
  let k = '';
  if (hot || down) k += `<rect x="280" y="${B-115}" width="180" height="123" rx="16" fill="none" stroke="${C.terra}" stroke-width="3" stroke-dasharray="7 6"/>`;
  const label = down ? 'out of order' : util != null ? `${Math.round(util * 100)}% busy` : hot ? 'bottleneck' : '';
  if (label) k += `<rect x="280" y="${B-126}" width="${Math.max(92, label.length * 7 + 20)}" height="24" rx="12" fill="${down ? I : hot ? C.terra : C.sage}" ${st(2.5)}/>`
    + `<text x="${280 + Math.max(92, label.length * 7 + 20) / 2}" y="${B-109}" text-anchor="middle" font-family="Patrick Hand" font-size="14" fill="#fff">${label}</text>`;
  if (down) k += `<g transform="rotate(-8 370 ${B-50})"><rect x="296" y="${B-62}" width="150" height="14" fill="#f6d04d" ${st(2)}/><path d="M306 ${B-62}l-10 14M326 ${B-62}l-14 14M346 ${B-62}l-14 14M366 ${B-62}l-14 14M386 ${B-62}l-14 14M406 ${B-62}l-14 14M426 ${B-62}l-14 14M446 ${B-62}l-14 14" ${st(4)}/></g>`;
  $('l-esp').innerHTML = k;
}
let passSig = '';
function renderPass(s){
  const ready = Object.values(s.orders || {}).filter((o) => o.status === 'ready' && o.channel !== 'zomato' && o.channel !== 'swiggy').sort((a, b) => (a.ready_s || 0) - (b.ready_s || 0)).slice(0, 3);
  const sig = ready.map((o) => o.order_no).join(',');
  if (sig === passSig) return; passSig = sig;
  $('l-pass').innerHTML = ready.map((o, i) => { const x = 690 + i * 52, sku = o.items?.[0]?.sku;
    return `<g filter="url(#wob)"><ellipse cx="${x + 22}" cy="${B - 3}" rx="25" ry="5" fill="#fff" ${st(2.2)}/>${use(skuIcon(sku), x, B - 46, 44)}</g>`
      + `<g transform="translate(${x + 22} ${B - 54}) rotate(${i % 2 ? 6 : -5})"><rect x="-20" y="-9" width="40" height="17" rx="4" fill="#fffefb" ${st(1.6)}/>${tx(0, 4, '#' + o.order_no, 11.5, 'text-anchor="middle"')}</g>`; }).join('');
}
const BAG_X = (slot) => 930 + (slot % 6) * 64;
const lBags = R.layer($('l-bags'), {
  key: (it) => it.b.order_no, sig: (it) => `${it.b.rider}|${it.b.slot}`,
  html: (it) => it.b.rider === 'picked_up'
    ? `<g opacity=".38"><path d="M${BAG_X(it.b.slot)} ${B-96}h58v92h-58z" fill="none" stroke="${I}" stroke-width="2.5" stroke-dasharray="6 5"/></g>`
    : bag(BAG_X(it.b.slot), chan(it.b.channel).col),
  place: (r, it, isNew) => { if (isNew) { r.el.style.transform = 'translateY(-40px)'; r.el.style.opacity = '0'; void r.el.getBoundingClientRect(); }
    r.el.style.transition = 'transform .5s cubic-bezier(.3,1.4,.5,1), opacity .3s'; r.el.style.transform = 'none'; r.el.style.opacity = '1'; },
  exit: (r) => { r.el.style.opacity = '0'; return 400; },
});
function renderBags(s){
  const bags = Object.values(s.shelf?.bags || {}).filter((b) => b.slot != null);
  lBags.sync(bags.map((b) => ({b})));
  let lab = '';
  for (const b of bags) { const x = BAG_X(b.slot);
    lab += b.rider === 'picked_up' ? tx(x + 29, B - 34, 'picked up ✓', 12, 'text-anchor="middle" opacity=".55"')
      : `<text x="${x + 31}" y="${B - 11}" text-anchor="middle" font-family="Patrick Hand" font-size="10.5" fill="#fff">${chan(b.channel).label}·${b.order_no}</text><text x="${x + 31}" y="${B - 45}" text-anchor="middle" font-family="Gochi Hand" font-size="15" fill="${C.pinkD}">brew</text>`; }
  const el = $('l-flash'); if (el.innerHTML !== lab) el.innerHTML = lab;
}
let rcSig = '';
function renderReceipt(s){
  const r = (s.receipts || [])[s.receipts.length - 1];
  const sig = r ? r.order_no + '|' + r.total : '';
  if (sig === rcSig) return; const first = !rcSig; rcSig = sig;
  if (!r) { $('l-receipt').innerHTML = ''; return; }
  const lines = [['brew café ♡', '', 1], [`#${String(r.order_no).padStart(3, '0')} · ${R.hm(r.sim_s ?? R.now())}`, ''], ['- - - - - - - - - -', '']];
  for (const ln of (r.lines || []).slice(0, 4)) { lines.push([`${(ln.name || ln.sku).toLowerCase().slice(0, 14)}${ln.qty > 1 ? ' ×' + ln.qty : ''}`, String(Math.round(ln.amount))]);
    for (const m of (ln.mods || []).slice(0, 1)) lines.push([' + ' + (MODS[m]?.label || m), '']); }
  if ((r.lines || []).length > 4) lines.push([`+${r.lines.length - 4} more`, '']);
  lines.push(['- - - - - - - - - -', ''], ['subtotal', String(Math.round(r.subtotal))]);
  if (r.discount) lines.push(['discount', '−' + Math.round(r.discount)]);
  lines.push(['cgst 2.5%', r.cgst.toFixed(2)], ['sgst 2.5%', r.sgst.toFixed(2)], ['TOTAL', '₹' + Math.round(r.total), 2]);
  const h = 22 + lines.length * 13.5 + 92;
  let z = `M92 732H208V${732 + h}`; for (let i = 0; i < 12; i++) z += `l${-116/12} ${i%2 ? -8 : 8}`; z += 'Z';
  let k = `<path d="${z}" transform="translate(5 5)" fill="${I}" opacity=".14"/><path d="${z}" fill="#fffefb" ${st(2)}/>`;
  lines.forEach(([a, b2, f], i) => { const y = 752 + i * 13.5, fw = f === 2 ? 700 : 400;
    k += f === 1 ? `<text x="150" y="${y}" text-anchor="middle" font-family="Courier Prime" font-weight="700" font-size="11" fill="${I}">${esc(a)}</text>`
      : `<text x="98" y="${y}" font-family="Courier Prime" font-weight="${fw}" font-size="9.8" fill="${I}">${esc(a)}</text><text x="202" y="${y}" text-anchor="end" font-family="Courier Prime" font-weight="${fw}" font-size="9.8" fill="${I}">${esc(b2)}</text>`; });
  // QR from the receipt's payload (deterministic pixels)
  const qy = 752 + lines.length * 13.5, hq = R.hash(r.qr || r.order_no);
  let q = `<rect x="126" y="${qy}" width="48" height="48" fill="#fff" ${st(1.4)}/>`;
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { const corner = (i < 2 && j < 2) || (i > 5 && j < 2) || (i < 2 && j > 5);
    if (corner || ((hq >>> ((i * 8 + j) % 31)) ^ (i * 7 + j * 3)) & 1) q += `<rect x="${128 + i * 5.5}" y="${qy + 2 + j * 5.5}" width="5.5" height="5.5" fill="${I}"/>`; }
  k += q + `<text x="150" y="${qy + 62}" text-anchor="middle" font-family="Courier Prime" font-size="9.5" fill="${I}">${esc(r.payment || 'upi')} · thank u ♡</text>`;
  $('l-receipt').innerHTML = `<g class="${first ? '' : 'l-print'}" data-receipt="${r.order_no}">${k}</g>`;
}
let lectSig = '';
function renderLectern(s){
  const sig = ['latte', 'coldbrew', 'matcha', 'espresso', 'croissant', 'avotoast', 'cheesecake', 'muffin'].map((k) => `${s.menu?.[k]?.price}${s.menu?.[k]?.dir}${s.menu?.[k]?.hidden}`).join('|');
  if (sig === lectSig) return; const first = !lectSig; lectSig = sig;
  for (const el of scene.querySelectorAll('[data-lsku]')) {
    const m = s.menu?.[el.dataset.lsku]; if (!m) continue;
    const old = el.textContent, arrow = m.hidden ? '' : m.dir === 'up' ? ' ▲' : m.dir === 'down' ? ' ▼' : '';
    el.innerHTML = m.hidden ? `<tspan fill="${C.terra}">86’d</tspan>` : `${Math.round(m.price)}<tspan fill="${m.dir === 'up' ? '#c0634f' : '#5f7d55'}">${arrow}</tspan>`;
    if (!first && old !== el.textContent) R.bump(el, 'lpop');
  }
}

/* ================================================================ overlay cards */
const card = (sel) => document.querySelector('#lobby ' + sel);
function decisionText(d){
  if (d.headline) return d.headline;
  let t = String(d.summary || d.type || '').replace(/^RL manager:\s*/i, '').replace(/^[A-Z][a-z]+ policy:\s*/, '');
  t = t.split(/\s*\(drivers:|;\s*/)[0];
  t = t.replace(/_concentrate/g, '').replace(/_baked|_fg|_slice/g, '').replace(/_/g, ' ').replace(/\bP(\d\d)\b/g, 'p$1');
  return t.length > 52 ? t.slice(0, 50).trim() + '…' : t;
}
let rlSig = '';
function renderDecisions(s){
  const ds = (s.decisions || []).slice(-4).reverse();
  const pol = s.policy?.policy || s.world?.policy || 'D';
  const sig = pol + ds.map((d) => d.decision_id).join();
  if (sig === rlSig) return; rlSig = sig;
  const el = card('.rl'); if (!el) return;
  const name = {A: 'naive', B: 'heuristic', C: 'optimiser', D: 'learned', E: 'oracle'}[pol] || '';
  el.innerHTML = `<h3>policy ${pol} · ${name} <span class="chip">${pol === 'D' ? 'RL' : pol}</span></h3>`
    + (ds.length ? `<ul>${ds.map((d) => `<li data-decision="${esc(d.decision_id)}" title="${esc(d.summary)}">${esc(decisionText(d))} <small>${R.hm(d.sim_s ?? 0)}</small></li>`).join('')}</ul>`
      : `<ul><li>watching the room… first call soon</li></ul>`);
}
let kdsSig = '';
function renderKDS(s, t){
  const el = card('.kds'); if (!el) return;
  const orders = Object.values(s.orders || {}).filter((o) => ['queued', 'brewing', 'almost'].includes(o.status));
  orders.sort((a, b) => (s.rail?.order_nos || []).indexOf(a.order_no) - (s.rail?.order_nos || []).indexOf(b.order_no));
  const rows = [], used = new Set();
  for (const b of s.rail?.batches || []) { const os = orders.filter((o) => b.order_nos.includes(o.order_no)); if (os.length < 2) continue;
    os.forEach((o) => used.add(o.order_no)); rows.push(os); }
  for (const o of orders) if (!used.has(o.order_no)) rows.push([o]);
  // who is really on each ticket: the active tasks (staff_id <-> order_no) of the kitchen slice. Only when nobody is on any
  // of the tickets shown yet does the header fall back to the baristas on shift (it used to be the only "who" there was).
  const workers = {};
  for (const tk of Object.values(s.tasks || {})) if (tk.order_no != null && tk.staff_id) (workers[tk.order_no] = workers[tk.order_no] || new Set()).add(tk.staff_id);
  const who = (os) => { const ids = new Set(); for (const o of os) for (const id of workers[o.order_no] || []) ids.add(id);
    return [...ids].map((id) => String(s.staff?.[id]?.name || R.human(id)).toLowerCase()); };
  const shown = rows.slice(0, 2), assigned = shown.map(who), anyOn = assigned.some((n) => n.length);
  const staff = Object.values(s.staff || {}).filter((x) => x.role === 'barista');
  const on = staff.filter((x) => x.present && !x.on_break).map((x) => x.name.toLowerCase()), off = staff.filter((x) => !x.present || x.on_break).map((x) => x.name.toLowerCase());
  const head = `now brewing <small>${anyOn ? `${new Set(assigned.flat()).size} on it` : `${on.join(' · ') || 'no barista on'}${off.length ? ` · (${off.join(', ')} off)` : ''}`}</small>`;
  const body = shown.map((os, i) => {
    const skus = {}; os.forEach((o) => (o.items || []).forEach((it) => skus[it.sku] = (skus[it.sku] || 0) + it.qty));
    const what = Object.entries(skus).slice(0, 2).map(([k, q]) => `${nm(k, s)}${q > 1 ? ' ×' + q : ''}`).join(' + ');
    const prog = os.reduce((a, o) => a + (o.progress || 0), 0) / os.length, eta = Math.max(...os.map((o) => (o.promised_s || t) - t));
    const names = assigned[i].slice(0, 2).join(' + ');
    return `<div class="row" data-kds="${os.map((o) => o.order_no).join(',')}"${names ? ` data-on="${esc(assigned[i].join(','))}"` : ''}><span style="display:flex;gap:6px;min-width:0"><span style="overflow:hidden;text-overflow:ellipsis">${os.map((o) => '#' + o.order_no).join(' ')} · ${esc(what)}</span>${names ? `<small class="on" style="flex:none;opacity:.75">· ${esc(names)}</small>` : ''}</span><span class="bar"><i style="width:${Math.round(prog * 100)}%"></i></span><span>${eta > 0 ? R.mmss(eta) : 'late'}</span></div>`; }).join('');
  const html = `<h4>${head}</h4>${body || `<div class="row"><span>${s.clock?.is_open ? 'nothing on the machine' : 'machines off · closed'}</span><span></span><span></span></div>`}${rows.length > 2 ? `<div class="more">+${rows.length - 2} more queued</div>` : ''}`;
  if (html !== kdsSig) { kdsSig = html; el.innerHTML = html; }
}
const RES_LABEL = {espresso: 'espresso machine', grinder: 'grinder', bar: 'bar', blender: 'blender', cold: 'cold-brew tower', oven: 'oven',
  press: 'panini press', fryer: 'fryer', stove: 'stove', griddle: 'waffle iron', display: 'pastry fridge', pass: 'the pass', dishpit: 'dish pit',
  register: 'register', seats: 'seats', tables: 'seats', staff: 'baristas', baristas: 'baristas', prep: 'prep board', riders: 'riders', shelf: 'delivery shelf'};
let bnSig = '';
function renderBottleneck(s){
  const el = card('.bn'); if (!el) return;
  // ranking + primary come from the analyzer; a station's % is the streamed station.load util (the same number as the
  // espresso tag and the kitchen pills: slot occupancy, 15 sim-min). Tables / shelf / dish pool only exist in the analyzer.
  const rows = (s.rest?.bottlenecks?.resources || []).slice(0, 3).map((r) => ({res: r.resource, rho: s.stations?.[r.resource]?.util ?? r.rho ?? r.utilization ?? 0}));
  if (!rows.length && s.stations) for (const x of Object.values(s.stations).filter((x) => x.util != null).sort((a, b) => b.util - a.util).slice(0, 3)) rows.push({res: x.station, rho: x.util});
  if (!rows.length && s.bottleneck) rows.push({res: s.bottleneck.resource, rho: s.bottleneck.rho});
  const inv = Object.values(s.inventory || {}).filter((x) => x.days_of_cover != null && x.kind === 'ingredient').sort((a, b) => a.days_of_cover - b.days_of_cover)[0];
  const adv = (s.rest?.advisor?.recommendations || [])[0];
  const cash = s.kpis?.cash ?? 0;
  const primary = s.rest?.bottlenecks?.primary || s.bottleneck?.resource || rows[0]?.res;
  const sig = JSON.stringify([rows.map((r) => [r.res, Math.round(r.rho * 100)]), inv?.key, inv && Math.round(inv.days_of_cover * 10), adv?.catalog_key, adv && Math.round(adv.delta_profit_per_day || 0), Math.floor(cash / 1000), s.rest?.advisor?.status, primary, (s.investments || []).length, el.dataset.busy]);
  if (sig === bnSig) return; bnSig = sig;
  const col = (r) => r >= .85 ? 'var(--terra)' : r >= .6 ? 'var(--mustard)' : 'var(--sage)';
  let h = `<h3>what's limiting throughput? <small>live · last 15 min</small></h3>`;
  h += rows.map((r) => `<div class="r" data-resource="${esc(r.res)}"><span>${esc(RES_LABEL[r.res] || (/^ingredient:/.test(r.res) ? R.human(r.res.slice(11)) + ' stock' : R.human(r.res)))}</span><span class="bar2"><i style="width:${Math.round(Math.min(1, r.rho) * 100)}%;background:${col(r.rho)}"></i></span><span class="${r.res === primary && r.rho >= .6 ? 'hot' : ''}">${Math.round(r.rho * 100)}%${r.res === primary && r.rho >= .6 ? ' ← bottleneck' : ' busy'}</span></div>`).join('')
    || `<div class="r"><span>${s.clock?.is_open ? 'measuring…' : 'closed · nothing queued'}</span><span></span><span></span></div>`;
  if (inv) { const day = inv.days_of_cover, lowc = day < 1; h += `<div class="r" data-resource="stock:${esc(inv.key)}"><span>${esc(String(inv.name || R.human(inv.key)).replace(/\s*\([^)]*\)/g, '').toLowerCase().slice(0, 22))}</span><span class="bar2"><i style="width:${Math.round(Math.min(1, day / 3) * 100)}%;background:${lowc ? 'var(--terra)' : day < 2 ? 'var(--mustard)' : 'var(--sage)'}"></i></span><span class="${lowc ? 'hot' : ''}">${day < 1 ? `~${Math.max(1, Math.round(day * 24))} h left` : day.toFixed(1) + ' days'}</span></div>`; }
  const bought = new Set((s.investments || []).map((x) => x.catalog_key));
  if (adv) {
    const cost = adv.capex ?? adv.cost ?? 0, gain = adv.delta_profit_per_day ?? adv.profit_delta_per_day ?? 0, pay = adv.payback_days ?? (gain > 0 ? cost / gain : null);
    const can = cash >= cost && !bought.has(adv.catalog_key);
    h += `<div class="foot"><span><b>best next buy:</b> ${esc((adv.name || R.human(adv.catalog_key)).toLowerCase())}<br>${gain >= 0 ? '+' : ''}${R.rs(gain)}/day${pay ? ` · pays back in ${Math.round(pay)} days` : ''}</span>`
      + `<button class="btn" data-action="invest" data-catalog="${esc(adv.catalog_key)}" ${can && !el.dataset.busy ? '' : 'disabled'} title="${can ? 'spends café cash now; delivered after the lead time' : bought.has(adv.catalog_key) ? 'on its way' : 'not enough cash yet'}">${bought.has(adv.catalog_key) ? 'ordered ✓' : el.dataset.busy ? 'ordering…' : 'invest ' + R.rsk(cost)}</button></div>`;
  } else h += `<div class="foot"><span>${s.rest?.advisor?.status === 'running' ? 'simulating what to buy next…' : 'investment advisor warming up'}</span><span class="btn" aria-disabled="true">invest</span></div>`;
  el.innerHTML = h;
}
document.querySelector('#lobby .bn')?.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-action="invest"]'); if (!b || b.disabled || !window.BrewApi) return;
  const el = b.closest('.bn'); el.dataset.busy = '1'; render(R.S(), false);
  try { await BrewApi.invest(b.dataset.catalog); toast(`ordered: ${R.human(b.dataset.catalog)} ♡`); }
  catch (err) { toast(err.message || 'could not invest', true); }
  finally { delete el.dataset.busy; bnSig = ''; render(R.S(), false); }
});
// toasts stack downward instead of landing on top of each other (and the same message twice in a row is one toast)
function toast(msg, bad){ const v = document.getElementById('viewport');
  const live = [...v.querySelectorAll(':scope > .toast')]; if (live.some((x) => x.textContent === msg)) return;
  const tEl = document.createElement('div'); tEl.className = 'toast' + (bad ? ' bad' : ''); tEl.textContent = msg;
  tEl.style.top = (104 + live.length * 46) + 'px'; v.appendChild(tEl); setTimeout(() => tEl.remove(), 3200); }
window.BrewToast = window.BrewToast || toast;

/* investments delivered show up in the room */
let decorSig = '';
function renderDecor(s){
  const keys = (s.investments || []).map((x) => x.catalog_key), sig = keys.join();
  if (sig === decorSig) return; decorSig = sig;
  let k = '';
  if (keys.includes('marketing_push')) k += `<g transform="rotate(-4 120 300)"><rect x="40" y="226" width="150" height="110" rx="6" fill="#fffdf8" ${st(2.6)}/><rect x="52" y="238" width="126" height="40" fill="${C.pink}" ${st(1.8)}/>${gtx(115, 266, 'brew ♡', 24, `text-anchor="middle" fill="${C.pinkD}"`)}${tx(115, 300, 'now open · koramangala', 12.5, 'text-anchor="middle"')}${tx(115, 320, 'first latte on us', 12, 'text-anchor="middle" opacity=".7"')}</g>`;
  if (keys.includes('espresso_2nd')) k += `<rect x="460" y="${B-88}" width="56" height="88" rx="8" fill="#b9cdb0" ${st(3)}/><rect x="460" y="${B-88}" width="56" height="18" rx="6" fill="${C.sage}" ${st(2.6)}/><circle cx="488" cy="${B-50}" r="10" fill="#fff" ${st(2.2)}/><path d="M480 ${B-22}h16l-2 16h-12z" fill="#fff" ${st(2)}/>`;
  if (keys.includes('bar_stools') || keys.includes('table_2top')) k += `<rect x="560" y="${wy+wh+12}" width="480" height="10" rx="3" fill="#e0b98a" ${st(2.2)}/>` + [610, 720, 830, 940].map((x) => `<path d="M${x-16} ${wy+wh+40}h32M${x} ${wy+wh+40}V${wy+wh+92}M${x-14} ${wy+wh+92}h28" fill="none" ${st(2.6)}/><ellipse cx="${x}" cy="${wy+wh+38}" rx="18" ry="5" fill="${C.pink}" ${st(2.2)}/>`).join('');
  if (keys.includes('fridge_bigger')) k += hangTag(676, B - 104, 'new ♡ · bigger fridge', 6);
  $('l-decor').innerHTML = k;
}

/* ================================================================ frame */
function render(s, hydrate){
  if (!s) return;
  const t = R.now();
  renderSky(s, t); renderSign(s); renderLectern(s); renderPeople(s, t); renderRail(s, t);
  renderBakes(s); renderEsp(s); renderPass(s); renderBags(s); renderReceipt(s); renderDecor(s);
  renderDecisions(s); renderKDS(s, t); renderBottleneck(s);
  if (hydrate) renderClock(t);
}
R.onState(render);
// the clock hands, wait timers and patience bars tick every second between events
setInterval(() => { const s = R.S(); if (!s) return; const t = R.now(); renderClock(t); renderSky(s, t); renderRail(s, t); renderKDS(s, t);
  if (document.body.dataset.room === 'lobby') renderPeople(s, t); }, 1000);
window.BREW_LIVE?.on('order.ready', () => { R.bump($('l-bell'), 'ring'); R.bump($('l-ding'), 'ring'); });
window.BrewLobby = {render};
})();
