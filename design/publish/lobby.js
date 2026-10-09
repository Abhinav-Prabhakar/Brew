/* brew — lobby room. Draws the café floor into #lobby-scene and exposes the shared doodle helpers
   (I, st, C, th, use, head, eyes, brows, mouth, blush, torso, arm, bubble, bag, B) that kitchen.js reuses. */
const th = {pink:'#f7c3a3', pinkD:'#e07e52', pinkL:'#fdeee4', floor:'#f6e0d4', lip:'#eeab88', sky:'#fde0cf'};

const I = '#1d1a1c';
const st = (w = 3) => `stroke="${I}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
let C, seed;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

C = {pink:th.pink, pinkD:th.pinkD, pinkL:th.pinkL, sage:'#8fa585', olive:'#6f7a4c', terra:'#c0634f',
     mustard:'#e3b25a', navy:'#3d4556', kraft:'#c9a27a', paper:'#fbf7f1'};
seed = 11;

/* ---------- defs: filters + food doodles ---------- */
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

/* ---------- wall, window, door ---------- */
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

// window + skyline
const wx = 470, wy = 185, ww = 660, wh = 275;
W += `<g clip-path="url(#win)"><rect x="${wx}" y="${wy}" width="${ww}" height="${wh}" fill="url(#sky)"/>
  <circle cx="1052" cy="250" r="24" fill="#f6d58e" ${st(2.5)}/>
  <path d="M560 250q8-16 24-8q10-14 26 0q16-2 14 12h-60q-10 0-4-4z" fill="#fff" ${st(2)}/>
  <path d="M880 222q8-14 22-6q10-12 22 0q14-2 12 10h-52q-8 0-4-4z" fill="#fff" ${st(2)}/>
  <path d="M540 410L690 262L840 410z" fill="#eef0f4" ${st(2.5)}/>
  <path d="M652 300L690 262L728 300L714 294L702 306L690 292L678 306L666 294z" fill="#fff" ${st(2)}/>`;
let bx = wx - 10;
while (bx < wx + ww){
  const bw = 40 + rnd() * 46, bh = 60 + rnd() * 140, dark = rnd() < .3, pinkB = !dark && rnd() < .3;
  const top = wy + wh - bh;
  W += `<rect x="${bx}" y="${top}" width="${bw}" height="${bh+4}" fill="${dark ? C.navy : pinkB ? C.pinkL : '#fff'}" ${st(2.2)}/>`;
  for (let yy = top + 10; yy < wy + wh - 8; yy += 13)
    for (let xx = bx + 7; xx < bx + bw - 8; xx += 11)
      if (rnd() < .78) W += `<rect x="${xx}" y="${yy}" width="5" height="7" fill="${dark ? '#f6e9d0' : I}" opacity="${dark ? .9 : .7}"/>`;
  if (rnd() < .3) W += `<path d="M${bx+bw/2} ${top}v-16" ${st(2)}/>`;
  bx += bw + (rnd() < .3 ? 6 : 0);
}
W += `</g>
<rect x="${wx}" y="${wy}" width="${ww}" height="${wh}" fill="none" ${st(4)}/>
<rect x="${wx+7}" y="${wy+7}" width="${ww-14}" height="${wh-14}" fill="none" ${st(1.6)}/>`;
for (let k = 1; k < 6; k++) W += `<path d="M${wx + ww*k/6} ${wy}V${wy+wh}" ${st(3)}/>`;
W += `<path d="M${wx} ${wy+58}H${wx+ww}" ${st(3)}/>
<rect x="${wx-16}" y="${wy+wh}" width="${ww+32}" height="12" rx="3" fill="#fff" ${st(2.5)}/>
<path d="M405 178H1195" ${st(4)}/><circle cx="403" cy="178" r="7" fill="${C.mustard}" ${st(2.5)}/><circle cx="1197" cy="178" r="7" fill="${C.mustard}" ${st(2.5)}/>`;
const curtain = `<path d="M430 180H505C500 260 520 330 492 360C520 400 500 440 512 472H440C450 430 428 400 452 360C430 330 440 260 430 180Z" fill="${C.pinkL}" ${st(3)}/>
<path d="M455 190C458 260 470 320 470 356M482 190C484 260 488 320 484 356M462 372C458 410 466 440 462 468M486 372C490 410 484 440 490 468" fill="none" ${st(1.6)}/>
<ellipse cx="472" cy="360" rx="27" ry="7" fill="${C.mustard}" ${st(2.5)}/>`;
W += curtain + `<g transform="translate(1600 0) scale(-1 1)">${curtain}</g>`;

// wainscot + floor
W += `<rect x="0" y="470" width="1600" height="140" fill="${C.pinkL}"/>
<path d="M0 470H1600M0 478H1600" fill="none" ${st(2.5)}/>`;
for (let x = 14; x < 1600; x += 156) W += `<rect x="${x}" y="494" width="132" height="100" rx="8" fill="none" ${st(1.8)}/>`;
W += `<rect x="0" y="610" width="1600" height="160" fill="${th.floor}"/><path d="M0 610H1600" ${st(3)}/>`;
[640, 680, 730].forEach(y => W += `<path d="M0 ${y}H1600" ${st(1.4)} opacity=".3"/>`);
for (let x = -400; x <= 2000; x += 120){
  const x2 = 800 + (x - 800) * 1.6;
  W += `<path d="M${x} 610L${x2} 770" ${st(1.4)} opacity=".25"/>`;
}

// door
W += `<rect x="1355" y="290" width="170" height="320" fill="none" ${st(3)}/>
<rect x="1365" y="300" width="150" height="310" rx="4" fill="${C.pink}" ${st(3)}/>
<rect x="1385" y="320" width="110" height="130" rx="4" fill="#fff" ${st(2.5)}/>
<path d="M1400 340l20-12M1404 354l34-22" ${st(2)} opacity=".35"/>
<rect x="1385" y="470" width="110" height="120" rx="4" fill="none" ${st(2)}/>
<circle cx="1502" cy="470" r="6" fill="${C.mustard}" ${st(2)}/>
<path d="M1412 345L1440 326L1468 345" fill="none" ${st(1.8)}/>
<rect x="1402" y="345" width="76" height="30" rx="6" fill="#fff" ${st(2.5)}/>`;

// wall clock 8:42
{
  const cx = 1300, cy = 210, h = (8 + 42/60) * 30 * Math.PI/180, m = 42 * 6 * Math.PI/180;
  W += `<circle cx="${cx}" cy="${cy}" r="34" fill="#fff" ${st(3)}/><circle cx="${cx}" cy="${cy}" r="27" fill="none" ${st(1.4)}/>`;
  for (let i = 0; i < 12; i++){ const a = i * Math.PI/6; W += `<path d="M${cx+22*Math.sin(a)} ${cy-22*Math.cos(a)}L${cx+26*Math.sin(a)} ${cy-26*Math.cos(a)}" ${st(2)}/>`; }
  W += `<path d="M${cx} ${cy}L${cx+14*Math.sin(h)} ${cy-14*Math.cos(h)}" ${st(3.2)}/><path d="M${cx} ${cy}L${cx+21*Math.sin(m)} ${cy-21*Math.cos(m)}" ${st(2.2)}/><circle cx="${cx}" cy="${cy}" r="3" fill="${C.pinkD}"/>`;
}

// hanging plant
W += `<path d="M1548 80L1562 150M1590 80L1576 150" ${st(1.8)}/>
<path d="M1540 150h60l-8 34h-44z" fill="${C.terra}" ${st(3)}/>`;
[[1548,190,9],[1544,212,8],[1550,234,7],[1592,192,9],[1596,214,8]].forEach(([x,y,r],i) =>
  W += `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r*0.55}" fill="${C.sage}" ${st(1.8)} transform="rotate(${i%2?40:-40} ${x} ${y})"/>`);
W += `<path d="M1552 184q-6 20-4 50M1588 184q6 16 6 32" fill="none" ${st(1.8)}/>`;

// rattan pendant lamp
W += `<ellipse cx="220" cy="240" rx="170" ry="150" fill="url(#glow)"/><path d="M220 0V102" ${st(2)}/>
<path d="M165 152Q165 102 220 102Q275 102 275 152Z" fill="#f3d9a4" ${st(3)}/>`;
for (let x = 176; x <= 266; x += 11){
  const yt = 152 - 50 * Math.sqrt(Math.max(0, 1 - ((x - 220) / 55) ** 2));
  W += `<path d="M${x} ${yt+3}V150" ${st(1.2)} opacity=".55"/>`;
}
[120, 135].forEach(y => W += `<path d="M${168} ${y+8}Q220 ${y-12} 272 ${y+8}" fill="none" ${st(1.2)} opacity=".55"/>`);
W += `<ellipse cx="220" cy="154" rx="16" ry="6" fill="#fff6d8" ${st(2)}/>`;

/* ---------- menu lectern ---------- */
const BOOK = `<rect x="162" y="568" width="16" height="180" fill="#b07f55" ${st(2.5)}/>
<path d="M120 752h100l-12-12h-76z" fill="#b07f55" ${st(2.5)}/>
<path d="M44 576H296L284 562H56Z" fill="#b07f55" ${st(2.5)}/>
<path d="M48 428Q110 410 170 428Q230 410 292 428V570Q230 554 170 570Q110 554 48 570Z" fill="${C.pinkD}" ${st(3)}/>
<path d="M56 434Q112 418 168 434V560Q112 546 56 560Z" fill="#fffdf8" ${st(2)}/>
<path d="M172 434Q228 418 284 434V560Q228 546 172 560Z" fill="#fffdf8" ${st(2)}/>
<path d="M178 560l3 26l4-7l4 7l-1-27" fill="${C.mustard}" ${st(2)}/>
<path d="M284 540l-18 20q10-2 18-2z" fill="#f0e6da" ${st(1.6)}/>`;

/* ---------- characters ---------- */
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
  const d = {neutral:`M${x-4} ${y+15}h8`, smile:`M${x-6} ${y+13}q6 5 12 0`, frown:`M${x-6} ${y+17}q6-5 12 0`}[t];
  return `<path d="${d}" fill="none" ${st(2.5)}/>`;
}
const blush = (x, y) => `<ellipse cx="${x-17}" cy="${y+11}" rx="5" ry="3" fill="${C.pink}"/><ellipse cx="${x+17}" cy="${y+11}" rx="5" ry="3" fill="${C.pink}"/>`;
const head = (x, y) => `<circle cx="${x}" cy="${y}" r="27" fill="#fff" ${st(3.2)}/>`;
const torso = (x, y, f) => `<path d="M${x-6} ${y+26}L${x+6} ${y+26}C${x+24} ${y+30} ${x+32} ${y+40} ${x+34} ${y+60}L${x+38} ${y+125}L${x-38} ${y+125}L${x-34} ${y+60}C${x-32} ${y+40} ${x-24} ${y+30} ${x-6} ${y+26}Z" fill="${f}" ${st(3)}/>`;
const arm = (sx, sy, cx, cy, ex, ey) => `<path d="M${sx} ${sy}Q${cx} ${cy} ${ex} ${ey}" fill="none" ${st(3.2)}/><circle cx="${ex}" cy="${ey}" r="4.6" fill="${I}"/>`;
const chair = x => `<path d="M${x-46} 650V540Q${x-46} 500 ${x} 500Q${x+46} 500 ${x+46} 540V650" fill="${C.pink}" ${st(3)}/>
  <path d="M${x-34} 650V546Q${x-34} 514 ${x} 514Q${x+34} 514 ${x+34} 546V650" fill="none" ${st(1.6)}/>
  <circle cx="${x-20}" cy="560" r="2" fill="${I}"/><circle cx="${x+20}" cy="560" r="2" fill="${I}"/><circle cx="${x}" cy="532" r="2" fill="${I}"/>`;
const shortHair = (x, y, f) => `<path d="M${x-28} ${y-1}C${x-31} ${y-30} ${x-12} ${y-35} ${x} ${y-34}C${x+16} ${y-35} ${x+32} ${y-27} ${x+28} ${y-1}C${x+20} ${y-16} ${x+4} ${y-21} ${x-6} ${y-18}C${x-14} ${y-15} ${x-22} ${y-10} ${x-28} ${y-1}Z" fill="${f}" ${st(3)}/>`;
const sidePart = (x, y, f) => `<path d="M${x-28} ${y+4}C${x-32} ${y-28} ${x-6} ${y-36} ${x+6} ${y-33}C${x+24} ${y-30} ${x+32} ${y-14} ${x+28} ${y+4}C${x+22} ${y-12} ${x+10} ${y-18} ${x-2} ${y-16}C${x-10} ${y-6} ${x-20} ${y-2} ${x-28} ${y+4}Z" fill="${f}" ${st(3)}/>`;
function table(cx){
  let s = `<ellipse cx="${cx}" cy="760" rx="74" ry="7" fill="${I}" opacity=".12"/>
  <path d="M${cx-7} 654L${cx-9} 750L${cx+9} 750L${cx+7} 654Z" fill="#fff" ${st(2.5)}/>
  <path d="M${cx-50} 760Q${cx} 738 ${cx+50} 760Z" fill="#fff" ${st(2.5)}/>
  <rect x="${cx-112}" y="638" width="224" height="16" rx="4" fill="#fff" ${st(3)}/>`;
  s += `<path d="M${cx-90} 645q14-4 22 2t20 0M${cx+30} 648q12-5 22 0" fill="none" ${st(1)} opacity=".45"/>`;
  return s;
}
const use = (id, x, y, w, h = w) => `<use href="#${id}" x="${x}" y="${y}" width="${w}" height="${h}"/>`;

let BACK = '', OVER = '';
// T1 — commuter
{ const x = 375, y = 520;
  BACK += chair(x) + torso(x, y, C.navy)
    + `<path d="M${x-9} ${y+29}L${x} ${y+54}L${x+9} ${y+29}Z" fill="#fff" ${st(2)}/><path d="M${x-3} ${y+33}l3 24l3-24z" fill="${C.terra}" ${st(1.6)}/>`
    + head(x, y) + eyes(x, y, -4, 2) + brows(x, y, 'angry') + mouth(x, y, 'frown') + shortHair(x, y, '#2b2a2e')
    + `<path d="M${x+32} ${y-24}q-7 10 0 13q7-3 0-13z" fill="#cfe7f5" ${st(1.8)}/>`;
  OVER += arm(x-28, y+46, x-58, y+112, x-18, y+80) + `<rect x="${x-33}" y="${y+76}" width="10" height="8" rx="2" fill="${C.mustard}" ${st(1.6)}/>`
    + arm(x+28, y+46, x+44, y+100, x+26, y+118)
    + `<path d="M${x+62} 638l10-24l10 24z" fill="#fff" ${st(2)}/>`;
}
// T1 — student
{ const x = 505, y = 520;
  BACK += chair(x) + torso(x, y, '#9db592')
    + `<path d="M${x-20} ${y+29}Q${x} ${y+52} ${x+20} ${y+29}" fill="#7f9874" ${st(2.5)}/><path d="M${x-6} ${y+42}l-1 22M${x+6} ${y+42}l1 22" ${st(2)}/>`
    + head(x, y) + eyes(x, y, 0, 4) + mouth(x, y, 'neutral')
    + `<path d="M${x-27} ${y}L${x-30} ${y-18}L${x-20} ${y-16}L${x-22} ${y-32}L${x-8} ${y-24}L${x-2} ${y-38}L${x+8} ${y-26}L${x+20} ${y-34}L${x+18} ${y-20}L${x+30} ${y-20}L${x+27} ${y}C${x+16} ${y-14} ${x-12} ${y-14} ${x-27} ${y}Z" fill="#5a3e2b" ${st(3)}/>`
    + `<path d="M${x-30} ${y}C${x-34} ${y-46} ${x+34} ${y-46} ${x+30} ${y}" fill="none" stroke="${C.pinkD}" stroke-width="6" stroke-linecap="round"/>`
    + `<rect x="${x-37}" y="${y-8}" width="12" height="20" rx="5" fill="${C.pinkD}" ${st(2)}/><rect x="${x+25}" y="${y-8}" width="12" height="20" rx="5" fill="${C.pinkD}" ${st(2)}/>`;
  OVER += arm(x-28, y+46, x-46, y+96, x-24, y+112) + arm(x+28, y+46, x+46, y+96, x+24, y+112)
    + `<path d="M${x-36} 640L${x-31} 596L${x+31} 596L${x+36} 640Z" fill="#e8e2dc" ${st(3)}/><circle cx="${x}" cy="617" r="8" fill="${C.pink}" ${st(1.8)}/>`
    + use('latte', 440, 606, 34);
}
// T2 — reader (green, flower crown)
{ const x = 715, y = 520;
  BACK += chair(x)
    + `<path d="M${x-30} ${y-10}C${x-50} ${y+20} ${x-30} ${y+40} ${x-46} ${y+72}C${x-54} ${y+96} ${x-34} ${y+110} ${x-40} ${y+126}L${x+40} ${y+126}C${x+34} ${y+110} ${x+54} ${y+96} ${x+46} ${y+72}C${x+30} ${y+40} ${x+50} ${y+20} ${x+30} ${y-10}Z" fill="#3d4a3c" ${st(3)}/>`
    + torso(x, y, C.olive)
    + `<path d="M${x-32} ${y+56}L${x+18} ${y+30}L${x+34} ${y+64}L${x-36} ${y+118}Z" fill="#5d6740" ${st(2.5)}/><circle cx="${x+18}" cy="${y+32}" r="5" fill="#cfc6b4" ${st(2)}/>`
    + head(x, y) + eyes(x, y, 0, 3) + mouth(x, y, 'smile') + blush(x, y) + sidePart(x, y, '#3d4a3c');
  for (let a = -160; a <= -20; a += 17){
    const r = a * Math.PI/180, fx = x + 29*Math.cos(r), fy = y - 4 + 29*Math.sin(r);
    BACK += `<circle cx="${fx}" cy="${fy}" r="4.2" fill="${(a/17|0)%2 ? C.mustard : C.pinkL}" ${st(1.5)}/>`;
  }
  [[x-42, y+40], [x+44, y+60], [x-40, y+90]].forEach(([lx, ly]) =>
    BACK += `<ellipse cx="${lx}" cy="${ly}" rx="5" ry="2.6" fill="${C.sage}" ${st(1.2)} transform="rotate(50 ${lx} ${ly})"/>`);
  OVER += arm(x-28, y+46, x-48, y+88, x-32, y+98) + arm(x+28, y+46, x+48, y+88, x+32, y+98)
    + `<path d="M${x-36} ${y+82}Q${x-18} ${y+75} ${x} ${y+82}V${y+108}Q${x-18} ${y+101} ${x-36} ${y+108}Z" fill="#fff" ${st(2.5)}/>`
    + `<path d="M${x+36} ${y+82}Q${x+18} ${y+75} ${x} ${y+82}V${y+108}Q${x+18} ${y+101} ${x+36} ${y+108}Z" fill="#fff" ${st(2.5)}/>`
    + `<path d="M${x-30} ${y+88}h22M${x-30} ${y+95}h20M${x+8} ${y+88}h22M${x+8} ${y+95}h18" ${st(1.2)} opacity=".5"/>`
    + use('matcha', 750, 604, 34);
}
// T2 — friend (terracotta drape, bun)
{ const x = 845, y = 520;
  BACK += chair(x)
    + `<path d="M${x+8} ${y-26}C${x+40} ${y-20} ${x+36} ${y+20} ${x+44} ${y+50}C${x+52} ${y+80} ${x+38} ${y+100} ${x+46} ${y+122}L${x+18} ${y+112}C${x+28} ${y+80} ${x+22} ${y+40} ${x+22} ${y+10}Z" fill="#2f3647" ${st(3)}/>`
    + `<circle cx="${x+25}" cy="${y-18}" r="11" fill="#2f3647" ${st(3)}/>`
    + torso(x, y, '#b5604c')
    + `<path d="M${x-34} ${y+88}L${x+18} ${y+30}L${x+27} ${y+37}L${x-28} ${y+98}Z" fill="${C.mustard}" ${st(2)}/><circle cx="${x+20}" cy="${y+32}" r="5" fill="${C.mustard}" ${st(2)}/>`
    + head(x, y) + eyes(x, y, 1, 2) + mouth(x, y, 'chew') + blush(x, y)
    + `<path d="M${x-28} ${y+2}C${x-30} ${y-28} ${x-10} ${y-34} ${x+4} ${y-33}C${x+20} ${y-32} ${x+30} ${y-20} ${x+28} ${y}C${x+16} ${y-16} ${x-4} ${y-20} ${x-28} ${y+2}Z" fill="#2f3647" ${st(3)}/>`;
  OVER += arm(x-28, y+46, x-44, y+100, x-24, y+116) + arm(x+28, y+46, x+50, y+82, x+30, y+96)
    + `<path d="M${x+30} ${y+96}L${x+20} ${y+70}M${x+17} ${y+72}l-2-7M${x+21} ${y+70}l-1-7M${x+25} ${y+69}l0-7" fill="none" ${st(2)}/>`
    + use('cake', 790, 600, 40);
}
// T3 — the regular (grey beard)
{ const x = 1045, y = 520;
  BACK += chair(x)
    + `<path d="M${x-28} ${y-6}C${x-44} ${y+20} ${x-36} ${y+50} ${x-42} ${y+72}L${x+42} ${y+72}C${x+36} ${y+50} ${x+44} ${y+20} ${x+28} ${y-6}Z" fill="#5e5f66" ${st(3)}/>`
    + torso(x, y, '#6d6f78') + `<path d="M${x-12} ${y+32}L${x+30} ${y+100}" stroke="${C.mustard}" stroke-width="4"/>`
    + head(x, y) + eyes(x, y, 0, 1) + brows(x, y, 'flat')
    + `<path d="M${x-22} ${y+8}C${x-20} ${y+40} ${x-8} ${y+56} ${x} ${y+62}C${x+8} ${y+56} ${x+20} ${y+40} ${x+22} ${y+8}C${x+14} ${y+18} ${x+6} ${y+20} ${x} ${y+18}C${x-6} ${y+20} ${x-14} ${y+18} ${x-22} ${y+8}Z" fill="#5e5f66" ${st(3)}/>`
    + `<path d="M${x-28} ${y+2}C${x-30} ${y-26} ${x-12} ${y-34} ${x} ${y-33}C${x+12} ${y-34} ${x+30} ${y-26} ${x+28} ${y+2}C${x+24} ${y-14} ${x+10} ${y-24} ${x} ${y-21}C${x-10} ${y-24} ${x-24} ${y-14} ${x-28} ${y+2}Z" fill="#5e5f66" ${st(3)}/>`;
  OVER += arm(x-28, y+46, x-46, y+100, x-26, y+116) + arm(x+28, y+46, x+52, y+92, x+22, y+66)
    + use('latte', x+4, y+42, 34) + use('coldbrew', 1082, 600, 38);
}
// T3 — free seat to bus
BACK += chair(1175);
OVER += `<ellipse cx="1170" cy="636" rx="26" ry="5" fill="#fff" ${st(2.5)}/><circle cx="1162" cy="632" r="2" fill="${I}"/><circle cx="1176" cy="633" r="2.2" fill="${I}"/>
<path d="M1196 636l8-22h16l-4 22z" fill="#fff" ${st(2.5)} transform="rotate(-8 1208 626)"/>`;

const TABLES = table(440) + table(780) + table(1110);

// delivery rider standing by the door
let RIDER = '';
{ const x = 1305, y = 478;
  RIDER += `<rect x="${x+8}" y="${y+32}" width="54" height="66" rx="5" fill="#d6453d" ${st(3)}/><path d="M${x+8} ${y+46}h54" ${st(2)}/>`
    + `<path d="M${x-10} ${y+120}L${x-13} ${y+190}M${x+10} ${y+120}L${x+13} ${y+190}" ${st(3.2)}/>`
    + `<ellipse cx="${x-17}" cy="${y+192}" rx="8" ry="4" fill="${I}"/><ellipse cx="${x+17}" cy="${y+192}" rx="8" ry="4" fill="${I}"/>`
    + torso(x, y, '#d6453d') + `<path d="M${x} ${y+30}V${y+122}" ${st(1.8)}/>`
    + head(x, y) + eyes(x, y, -4, 4) + brows(x, y, 'flat') + mouth(x, y, 'neutral')
    + `<path d="M${x-31} ${y+4}C${x-35} ${y-42} ${x+35} ${y-42} ${x+31} ${y+4}C${x+20} ${y-6} ${x-20} ${y-6} ${x-31} ${y+4}Z" fill="#d6453d" ${st(3)}/>`
    + `<path d="M${x-18} ${y-24}q10-8 22-6" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`
    + arm(x-28, y+46, x-48, y+98, x-14, y+84)
    + `<rect x="${x-24}" y="${y+66}" width="13" height="22" rx="3" fill="${C.navy}" ${st(2)} transform="rotate(-12 ${x-18} ${y+77})"/>`
    + arm(x+28, y+46, x+40, y+92, x+34, y+120);
}

/* ---------- counter + items ---------- */
let CT = `<rect x="0" y="790" width="1600" height="210" fill="${C.pink}"/>`;
for (let x = 22; x < 1600; x += 44) CT += `<path d="M${x} 808V975" ${st(1.4)} opacity=".3"/>`;
CT += `<rect x="-5" y="975" width="1610" height="30" fill="${C.pinkD}" ${st(3)}/>
<rect x="0" y="800" width="1600" height="9" fill="${th.lip}"/>
<path d="M-10 762H1610V800H-10Z" fill="#fffaf6" ${st(3)}/>
<path d="M40 778q30-6 60 2t50 0M620 784q40-8 70 0M1180 776q30 6 64-2" fill="none" ${st(1)} opacity=".4"/>`;
const B = 765;
let ITEMS = '';
// receipt printer
ITEMS += `<rect x="60" y="${B-76}" width="180" height="76" rx="10" fill="#fffdf9" ${st(3)}/>
<rect x="70" y="${B-86}" width="160" height="24" rx="8" fill="${C.navy}" ${st(3)}/>
<rect x="84" y="${B-37}" width="132" height="7" rx="3" fill="${I}"/>
<circle cx="224" cy="${B-52}" r="4.5" fill="#9cbf7a" ${st(1.5)}/><rect x="74" y="${B-58}" width="22" height="9" rx="3" fill="${C.pink}" ${st(1.5)}/>
<path d="M44 ${B-58}l-12-4M42 ${B-44}l-14 0M44 ${B-30}l-12 4" ${st(2)}/>`;
// espresso machine (the bottleneck)
ITEMS += `<rect x="280" y="${B-115}" width="180" height="123" rx="16" fill="none" stroke="${C.terra}" stroke-width="3" stroke-dasharray="7 6"/>
<path d="M300 ${B-120}q-6-10 2-16q8-6 2-14M318 ${B-122}q-6-10 2-16q8-6 2-14" fill="none" ${st(2)} opacity=".4"/>
<rect x="290" y="${B-104}" width="160" height="104" rx="10" fill="#b9cdb0" ${st(3)}/>
<rect x="290" y="${B-104}" width="160" height="22" rx="8" fill="${C.sage}" ${st(3)}/>
<circle cx="322" cy="${B-60}" r="14" fill="#fff" ${st(2.5)}/><path d="M322 ${B-60}l9-5" ${st(2.2)}/><path d="M331 ${B-70}a14 14 0 0 1 4 8" stroke="${C.terra}" stroke-width="3" fill="none"/>
<rect x="372" y="${B-70}" width="44" height="12" rx="3" fill="#ddd" ${st(2.5)}/><path d="M416 ${B-62}L454 ${B-54}" ${st(6)}/>
<path d="M394 ${B-56}v12" stroke="#6b3f26" stroke-width="2.5" stroke-dasharray="3 3"/>
<path d="M382 ${B-26}h26l-3 22h-20z" fill="#fff" ${st(2.5)}/>
<path d="M302 ${B-60}q-10 20-8 46" fill="none" ${st(3)}/>
<rect x="280" y="${B-126}" width="92" height="24" rx="12" fill="${C.terra}" ${st(2.5)}/>`;
// pastry dome (pre-prepped)
ITEMS += `<ellipse cx="590" cy="${B-2}" rx="76" ry="8" fill="#fff" ${st(2.5)}/>
${use('croissant', 528, B-46, 44)}${use('croissant', 568, B-46, 44)}${use('croissant', 608, B-46, 44)}${use('croissant', 548, B-74, 44)}
<path d="M520 ${B-4}Q520 ${B-94} 590 ${B-94}Q660 ${B-94} 660 ${B-4}" fill="#e8f2f4" fill-opacity=".45" ${st(3)}/>
<path d="M538 ${B-40}q2-30 26-40" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
<circle cx="590" cy="${B-100}" r="7" fill="${C.pink}" ${st(2.5)}/>`;
// pass: toast + bell
ITEMS += `${use('toast', 700, B-78, 86)}<path d="M760 ${B-60}V${B-96}" ${st(2)}/><path d="M760 ${B-96}l22 6l-22 6z" fill="${C.pink}" ${st(1.8)}/>
<ellipse cx="870" cy="${B-3}" rx="32" ry="6" fill="#ddd" ${st(2.5)}/><path d="M842 ${B-6}Q842 ${B-40} 870 ${B-40}Q898 ${B-40} 898 ${B-6}Z" fill="${C.mustard}" ${st(3)}/>
<rect x="865" y="${B-50}" width="10" height="10" rx="2" fill="${I}"/><path d="M852 ${B-30}q4-6 10-6" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>
<path d="M906 ${B-52}l12-8M910 ${B-38}l14-2M832 ${B-52}l-12-8" ${st(2.2)}/>`;
// ghost bag (just picked up)
ITEMS += `<g opacity=".38"><path d="M942 ${B-150}h58v92h-58z" fill="none" stroke="${I}" stroke-width="2.5" stroke-dasharray="6 5"/>
<path d="M958 ${B-50}v-12M972 ${B-46}v-18M986 ${B-50}v-12" ${st(2)}/></g>`;
// kraft bags
function bag(x, col){
  let teeth = `M${x} ${B-96}`;
  for (let i = 0; i < 8; i++) teeth += `l7.75 ${i%2 ? 7 : -7}`;
  return `<path d="M${x} ${B-96}h62v96h-62z" fill="${C.kraft}" ${st(3)}/>
  <path d="${teeth}" fill="none" ${st(2)}/><path d="M${x} ${B-80}h62" ${st(1.6)} opacity=".5"/>
  <circle cx="${x+31}" cy="${B-50}" r="19" fill="none" stroke="${C.pinkD}" stroke-width="2.6" stroke-dasharray="40 4"/>
  <rect x="${x+5}" y="${B-22}" width="52" height="15" rx="3" fill="${col}" ${st(1.6)}/>`;
}
ITEMS += bag(1030, '#fc8019') + bag(1100, '#e23744') + bag(1170, '#8a6a4a');
// tip jar + radio
ITEMS += `<path d="M1262 ${B-58}h44v6q4 4 4 12v40h-52v-40q0-8 4-12z" fill="#eef6f7" fill-opacity=".7" ${st(2.5)}/>
<circle cx="1276" cy="${B-12}" r="6" fill="${C.mustard}" ${st(1.6)}/><circle cx="1292" cy="${B-9}" r="6" fill="${C.mustard}" ${st(1.6)}/>
<path d="M1500 ${B-64}L1540 ${B-110}" ${st(2.2)}/><circle cx="1541" cy="${B-111}" r="3.5" fill="${I}"/>
<rect x="1450" y="${B-66}" width="126" height="66" rx="14" fill="${C.mustard}" ${st(3)}/>
<circle cx="1484" cy="${B-33}" r="20" fill="#fff8e6" ${st(2.5)}/>`;
for (let i = -12; i <= 12; i += 6) for (let j = -12; j <= 12; j += 6)
  if (i*i + j*j < 190) ITEMS += `<circle cx="${1484+i}" cy="${B-33+j}" r="1.6" fill="${I}"/>`;
ITEMS += `<rect x="1516" y="${B-52}" width="48" height="14" rx="4" fill="#fff8e6" ${st(2)}/><path d="M1530 ${B-52}v14" stroke="${C.terra}" stroke-width="2.5"/>
<circle cx="1528" cy="${B-20}" r="7" fill="${C.pinkD}" ${st(2)}/><circle cx="1552" cy="${B-20}" r="7" fill="${C.pinkD}" ${st(2)}/>`;

// receipt draping over the counter front
let R = '';
{ let z = 'M92 732H208V952'; for (let i = 0; i < 12; i++) z += `l${-116/12} ${i%2 ? -8 : 8}`; z += 'Z';
  R += `<path d="${z}" transform="translate(5 5)" fill="${I}" opacity=".14"/><path d="${z}" fill="#fffefb" ${st(2)}/>`;
  const L = [['brew café ♡','',1],['#041 · T1 · 08:42',''],['- - - - - - - - - -',''],['oat latte ×2','440'],[' + extra shot','40'],
             ['croissant','160'],['- - - - - - - - - -',''],['subtotal','640'],['gst 5%','32'],['TOTAL','₹672',2]];
  L.forEach(([a, b, f], i) => {
    const y = 754 + i * 14.5, fw = f === 2 ? 700 : 400;
    R += f === 1 ? `<text x="150" y="${y}" text-anchor="middle" font-family="Courier Prime" font-weight="700" font-size="11.5" fill="${I}">${a}</text>`
      : `<text x="98" y="${y}" font-family="Courier Prime" font-weight="${fw}" font-size="10.5" fill="${I}">${a}</text><text x="202" y="${y}" text-anchor="end" font-family="Courier Prime" font-weight="${fw}" font-size="10.5" fill="${I}">${b}</text>`;
  });
  for (let x = 100; x < 200; x += 3) if (rnd() < .62) R += `<rect x="${x}" y="904" width="${rnd() < .5 ? 1.5 : 2.6}" height="20" fill="${I}"/>`;
  R += `<text x="150" y="940" text-anchor="middle" font-family="Courier Prime" font-size="10.5" fill="${I}">thank u, come back ♡</text>`;
}

/* ---------- order tickets on the rail ---------- */
const TK = [
  {n:'041', ch:'dine·T1',  col:C.pinkD,   food:['latte','croissant'], q:'×2', notes:['oat milk','+ extra shot'],          t:'2:14', p:.70, tc:C.sage,    rot:-3},
  {n:'043', ch:'zomato',   col:'#e23744', food:['latte','coldbrew'],  q:'',   notes:['oat milk','brew: less ice'],        t:'4:50', p:.42, tc:C.mustard, rot:2},
  {n:'045', ch:'takeaway', col:'#8a6a4a', food:['latte'],             q:'×1', notes:['extra hot','no sugar'],             t:'1:05', p:.86, tc:C.sage,    rot:-1.5},
  {n:'038', ch:'swiggy',   col:'#fc8019', food:['toast'],             q:'',   notes:['no chilli flakes','cut in half'],   t:'done', p:1,   tc:C.sage,    rot:3, ready:true},
  {n:'044', ch:'dine·T2',  col:C.pinkD,   food:['matcha','cake'],     q:'',   notes:['half-sweet matcha','warm the cake'],t:'3:10', p:.5,  tc:C.mustard, rot:-2},
  {n:'046', ch:'dine·T3',  col:C.pinkD,   food:['coldbrew'],          q:'↻',  notes:['"the usual"','41st visit ♡'],       t:'0:40', p:.92, tc:C.sage,    rot:2.5},
];
const railY = x => { const u = (x - 310) / 980; return 92 + 13 * 4 * u * (1 - u); };
let TIX = `<path d="M310 92Q800 118 1290 92" fill="none" ${st(2.5)}/><circle cx="310" cy="92" r="7" fill="${C.mustard}" ${st(2.5)}/><circle cx="1290" cy="92" r="7" fill="${C.mustard}" ${st(2.5)}/>`;
TK.forEach((k, i) => {
  const x = 345 + i * 152, y = railY(x + 66) - 4;
  let teeth = 'M0 0H132V172'; for (let j = 0; j < 12; j++) teeth += `l-11 ${j%2 ? -7 : 7}`; teeth += 'Z';
  const cw = Math.max(46, k.ch.length * 5.9 + 14);
  let g = `<g transform="translate(${x} ${y}) rotate(${k.rot} 66 0)">
    <path d="${teeth}" transform="translate(4 4)" fill="${I}" opacity=".15"/>
    <path d="${teeth}" fill="#fffefb" ${st(2.5)}/>
    <text x="10" y="30" font-family="Gochi Hand" font-size="23" fill="${I}">#${k.n}</text>
    <rect x="${126-cw}" y="14" width="${cw}" height="19" rx="9.5" fill="${k.col}" ${st(1.8)}/>
    <text x="${126-cw/2}" y="28" text-anchor="middle" font-family="Patrick Hand" font-size="12.5" fill="#fff">${k.ch}</text>
    <path d="M8 40H124" ${st(1.4)} stroke-dasharray="4 4" opacity=".5"/>`;
  if (k.food.length === 2) g += use(k.food[0], 6, 42, 58) + use(k.food[1], 68, 42, 58);
  else g += use(k.food[0], 37, 42, 58);
  if (k.q) g += `<circle cx="${k.food.length === 2 ? 56 : 92}" cy="90" r="11" fill="${I}"/><text x="${k.food.length === 2 ? 56 : 92}" y="94.5" text-anchor="middle" font-family="Patrick Hand" font-size="13" fill="#fff">${k.q}</text>`;
  k.notes.forEach((nt, j) => g += `<text x="10" y="${118 + j*15}" font-family="Patrick Hand" font-size="13.5" fill="${I}">• ${nt}</text>`);
  g += `<text x="10" y="152" font-family="Patrick Hand" font-size="11.5" fill="${I}" opacity=".6">wait</text>
    <text x="122" y="152" text-anchor="end" font-family="Patrick Hand" font-size="12.5" fill="${I}">${k.t}</text>
    <rect x="10" y="156" width="112" height="9" rx="4.5" fill="#fff" ${st(1.8)}/><rect x="11" y="157" width="${110*k.p}" height="7" rx="3.5" fill="${k.tc}"/>`;
  if (k.ready) g += `<g transform="translate(66 92) rotate(-14)" opacity=".88"><rect x="-50" y="-17" width="100" height="34" rx="6" fill="#fffefb" fill-opacity=".6" stroke="${C.pinkD}" stroke-width="3"/><text y="8" text-anchor="middle" font-family="Gochi Hand" font-size="22" fill="${C.pinkD}">READY ✓</text></g>`;
  g += `<rect x="58" y="-12" width="16" height="30" rx="4" fill="#e0b98a" ${st(2.5)}/><path d="M66 -9V15" ${st(1.4)}/><circle cx="66" cy="4" r="2.4" fill="${I}"/></g>`;
  TIX += g;
});
// batch ribbon across #041 #043 #045
{ const c = [411, 563, 715], yb = 278;
  TIX += `<path d="M${c[0]} ${yb}Q${(c[0]+c[1])/2} ${yb+30} ${c[1]} ${yb+2}Q${(c[1]+c[2])/2} ${yb+30} ${c[2]} ${yb}" fill="none" stroke="${C.pinkD}" stroke-width="4" stroke-linecap="round"/>`;
  c.forEach(x => TIX += `<path d="M${x} ${yb}l-9-6v12zM${x} ${yb}l9-6v12z" fill="${C.pink}" ${st(1.8)}/>`);
  TIX += `<rect x="${c[1]-108}" y="${yb+18}" width="216" height="26" rx="13" fill="#fff" ${st(2.2)}/>
  <text x="${c[1]}" y="${yb+36}" text-anchor="middle" font-family="Patrick Hand" font-size="15" fill="${I}">batched ×3 oat lattes · saves 2m40s</text>`;
}

/* ---------- labels, bubbles, nameplates (crisp, unfiltered) ---------- */
let TXT = '';
const t = (x, y, s, sz = 14, opt = '') => `<text x="${x}" y="${y}" ${opt} font-family="Patrick Hand" font-size="${sz}" fill="${I}">${s}</text>`;
function plate(x, y, label, p, col){
  let s = `<rect x="${x-52}" y="${y}" width="104" height="${p == null ? 22 : 31}" rx="9" fill="#fffefb" ${st(2)} ${p == null ? 'stroke-dasharray="5 4"' : ''}/>`
    + t(x, y + 16, label, 13.5, 'text-anchor="middle"');
  if (p != null) s += `<rect x="${x-42}" y="${y+20}" width="84" height="6" rx="3" fill="#eee" ${st(1.3)}/><rect x="${x-41.5}" y="${y+20.5}" width="${83*p}" height="5" rx="2.5" fill="${col}"/>`;
  return s;
}
function bubble(x, y, w, s, col = I){
  return `<rect x="${x-w/2}" y="${y}" width="${w}" height="32" rx="16" fill="#fff" ${st(2.4)}/>
  <path d="M${x-8} ${y+31}L${x-2} ${y+44}L${x+7} ${y+31}" fill="#fff" ${st(2.4)}/><path d="M${x-6.5} ${y+31}H${x+5.5}" stroke="#fff" stroke-width="3.5"/>
  ${t(x, y + 22, s, 16, `text-anchor="middle" fill="${col}"`)}`;
}
TXT += plate(375, 446, 'commuter', .22, C.terra) + plate(505, 446, 'laptop camper', .9, C.sage)
     + plate(715, 446, 'lingerer', .95, C.sage) + plate(845, 446, 'leisurely', .8, C.sage)
     + plate(1045, 446, 'the regular', .7, C.mustard) + plate(1175, 452, 'seat free · bus it', null)
     + plate(1305, 400, 'delivery rider', .55, C.mustard);
TXT += bubble(375, 394, 150, '⏱ 7:40 … my train!', C.terra) + bubble(1305, 350, 112, '#038 ready?');
[[756, 486, 1], [770, 466, .75]].forEach(([x, y, s]) =>
  TXT += `<path transform="translate(${x} ${y}) scale(${s})" d="M0 6C-8 0-10-6-5-9C-2-11 0-8 0-6C0-8 2-11 5-9C10-6 8 0 0 6Z" fill="${C.pinkD}" ${st(1.5)}/>`);
// menu book text
{ const row = (x1, x2, y, a, b, mark) => t(x1, y, a, 13.5) + t(x2, y, b + (mark ? ` <tspan fill="${mark === '▲' ? C.terra : '#5f7d55'}">${mark}</tspan>` : ''), 13.5, 'text-anchor="end"');
  TXT += t(112, 456, '~ coffee ~', 17, 'text-anchor="middle" font-family="Gochi Hand"') + t(228, 456, '~ bakes ~', 17, 'text-anchor="middle" font-family="Gochi Hand"');
  TXT += row(64, 162, 480, 'oat latte', '220', '▼') + row(64, 162, 499, 'cold brew', '250', '▲') + row(64, 162, 518, 'matcha', '260') + row(64, 162, 537, 'espresso', '140');
  TXT += row(180, 278, 480, 'croissant', '160') + row(180, 278, 499, 'avo toast', '280', '▲') + row(180, 278, 518, 'cake slice', '190', '▼') + row(180, 278, 537, 'bagel', '150');
  TXT += `<rect x="118" y="388" width="104" height="24" rx="12" fill="${C.pink}" ${st(2)}/><circle cx="134" cy="400" r="4.5" fill="${C.terra}"/>` + t(178, 405, 'live prices', 14, 'text-anchor="middle"');
}
// counter labels
TXT += `<text x="326" y="${B-109}" text-anchor="middle" font-family="Patrick Hand" font-size="14" fill="#fff">94% busy</text>`;
TXT += `<g transform="translate(590 ${B-128}) rotate(-3)"><rect x="-70" y="-14" width="140" height="22" rx="5" fill="${C.pinkL}" ${st(2)}/>${t(0, 3, 'pre-prepped ×4 · 9am', 13.5, 'text-anchor="middle"')}</g>`;
TXT += t(970, B - 34, 'picked up ✓', 13.5, 'text-anchor="middle" opacity=".55"');
['swiggy·038', 'zomato·036', 'takeaway·039'].forEach((s, i) => TXT += `<text x="${1061 + i*70}" y="${B-11}" text-anchor="middle" font-family="Patrick Hand" font-size="10.5" fill="#fff">${s}</text>`);
[1030, 1100, 1170].forEach(x => TXT += `<text x="${x+31}" y="${B-45}" text-anchor="middle" font-family="Gochi Hand" font-size="15" fill="${C.pinkD}">brew</text>`);
TXT += `<text x="1284" y="${B-64}" text-anchor="middle" font-family="Gochi Hand" font-size="14" fill="${I}">tips ♡</text>`;
TXT += `<text x="1440" y="${B-110}" font-family="Gochi Hand" font-size="22" fill="${C.pinkD}" opacity=".7">♪</text><text x="1470" y="${B-128}" font-family="Gochi Hand" font-size="17" fill="${C.pinkD}" opacity=".5">♫</text>`;
TXT += `<text x="38" y="${B-92}" font-family="Gochi Hand" font-size="17" fill="${C.pinkD}" transform="rotate(-10 38 ${B-92})">brrrt~</text>`;
TXT += `<text x="1440" y="367" text-anchor="middle" font-family="Gochi Hand" font-size="19" fill="${C.pinkD}">open ♡</text>`;

/* ---------- assemble ---------- */
document.getElementById('lobby-scene').innerHTML = defs
  + `<g filter="url(#wob)">${W}${BOOK}${BACK}${TABLES}${OVER}${RIDER}</g>`
  + `<g filter="url(#wob)">${CT}${ITEMS}</g>`
  + R + TIX + TXT
  + `<rect width="1600" height="1000" filter="url(#grain)" opacity=".22" pointer-events="none"/>`;
