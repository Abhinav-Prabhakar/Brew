/* brew — kitchen room. Draws into #kitchen-scene and runs the little crew / chaos simulation.
   Reuses the doodle helpers from lobby.js (I, st, C, th, use, head, eyes, brows, mouth, blush, torso, arm, bubble, bag, shortHair). */
(() => {
const K = {steel:'#e4e7eb', steelD:'#c7cdd4', steelL:'#f2f4f6', tile:'#fffaf6', grout:'#f1dccd', oil:'#e9b44c',
           wood:'#c99a6e', woodD:'#a87a52', glass:'#e6f1f4', red:'#d6453d', haz:'#f6d04d', brew:'#6b3f26'};
const CH = {dine:C.pinkD, zomato:'#e23744', swiggy:'#fc8019', take:'#8a6a4a', prep:C.sage};
const FLOOR = 650, HY = 478;
const t = (x, y, s, sz = 14, opt = '') => `<text x="${x}" y="${y}" ${opt} font-family="Patrick Hand" font-size="${sz}" fill="${I}">${s}</text>`;
const gt = (x, y, s, sz = 18, opt = '') => `<text x="${x}" y="${y}" ${opt} font-family="Gochi Hand" font-size="${sz}" fill="${I}">${s}</text>`;
const fatCol = f => f < .5 ? C.sage : f < .75 ? C.mustard : C.terra;

/* ---------- defs: tiles, hazard tape, station icons ---------- */
const DEFS = `<defs>
<pattern id="k-tile" width="48" height="48" patternUnits="userSpaceOnUse">
  <rect width="48" height="48" fill="${K.tile}"/>
  <path d="M0 .75H48M0 24.75H48M.75 0V24.75M24.75 24.75V48" stroke="${K.grout}" stroke-width="1.6"/>
</pattern>
<pattern id="k-haz" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
  <rect width="22" height="22" fill="${K.haz}"/><rect width="11" height="22" fill="${I}"/>
</pattern>
<linearGradient id="k-fire" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a2e18"/><stop offset=".55" stop-color="#c8662e"/><stop offset="1" stop-color="#ffb35c"/></linearGradient>
<linearGradient id="k-out" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${th.sky}"/><stop offset="1" stop-color="#fff8ef"/></linearGradient>
<radialGradient id="k-lamp"><stop offset="0" stop-color="#ffe2a6" stop-opacity=".55"/><stop offset="1" stop-color="#ffe2a6" stop-opacity="0"/></radialGradient>

<symbol id="k-bean" viewBox="0 0 40 40"><g transform="rotate(30 20 20)"><ellipse cx="20" cy="20" rx="11" ry="15" fill="#7a4a2e" ${st(2.5)}/><path d="M20 7q-7 13 0 26" fill="none" stroke="#e8c39e" stroke-width="2.2" stroke-linecap="round"/></g></symbol>
<symbol id="k-milk" viewBox="0 0 40 40"><path d="M10 15L15 5H25L30 15V36H10Z" fill="#fff" ${st(2.5)}/><path d="M10 15H30M15 5L20 15L25 5" fill="none" ${st(2)}/><rect x="10" y="20" width="20" height="10" fill="${C.pink}" ${st(2)}/><ellipse cx="20" cy="25" rx="2.6" ry="4" fill="#e3c27a" ${st(1.4)}/></symbol>
<symbol id="k-avo" viewBox="0 0 40 40"><path d="M20 3C27 3 31 11 32 19C34 30 28 37 20 37C12 37 6 30 8 19C9 11 13 3 20 3Z" fill="#5f7d3a" ${st(2.5)}/><path d="M20 8C25 8 27 14 28 20C29 28 25 32 20 32C15 32 11 28 12 20C13 14 15 8 20 8Z" fill="#d7e69a"/><circle cx="20" cy="24" r="6" fill="#8a5a3c" ${st(2)}/></symbol>
<symbol id="k-tomato" viewBox="0 0 40 40"><circle cx="20" cy="23" r="14" fill="#e0554a" ${st(2.5)}/><path d="M13 11l7 4l7-4l-2 6h-10z" fill="#6f9a5a" ${st(1.8)}/><path d="M11 20q2-5 6-6" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".7"/></symbol>
<symbol id="k-panini" viewBox="0 0 40 40"><rect x="4" y="12" width="32" height="8" rx="4" fill="#e3b06a" ${st(2.2)}/><rect x="5" y="19" width="30" height="5" fill="#f6d58e" ${st(1.6)}/><path d="M6 23.5h28" stroke="#6f9a5a" stroke-width="3"/><rect x="4" y="24" width="32" height="8" rx="4" fill="#e3b06a" ${st(2.2)}/><path d="M11 13l-3 6M18 13l-3 6M25 13l-3 6M32 13l-3 6" ${st(1.6)}/></symbol>
<symbol id="k-fries" viewBox="0 0 40 40"><g ${st(1.8)} fill="#f6d58e"><rect x="12" y="5" width="4" height="18" transform="rotate(-10 14 14)"/><rect x="18" y="3" width="4" height="20"/><rect x="24" y="5" width="4" height="18" transform="rotate(10 26 14)"/><rect x="15" y="7" width="4" height="16" transform="rotate(4 17 15)"/><rect x="21" y="6" width="4" height="17" transform="rotate(-5 23 14)"/></g><path d="M9 17h22l-3 19h-16z" fill="${C.pinkD}" ${st(2.5)}/><path d="M15 25q5 4 10 0" fill="none" stroke="#fff" stroke-width="2"/></symbol>
<symbol id="k-straw" viewBox="0 0 40 40"><path d="M20 37C10 31 5 21 9 14C12 9 28 9 31 14C35 21 30 31 20 37Z" fill="#e0554a" ${st(2.5)}/><g fill="#f6d58e"><circle cx="15" cy="18" r="1.3"/><circle cx="22" cy="17" r="1.3"/><circle cx="27" cy="21" r="1.3"/><circle cx="18" cy="25" r="1.3"/><circle cx="24" cy="28" r="1.3"/><circle cx="13" cy="24" r="1.3"/></g><path d="M11 12l9-6l9 6l-5 1l-4-4l-4 4z" fill="#6f9a5a" ${st(1.8)}/></symbol>
<symbol id="k-banana" viewBox="0 0 40 40"><path d="M5 11C8 27 24 35 35 27C34 25 32 24 30 25C21 29 12 22 10 9C8 8 6 9 5 11Z" fill="#f6d58e" ${st(2.5)}/><path d="M5 11l-1-4l4 1" fill="none" ${st(2)}/></symbol>
<symbol id="k-smoothie" viewBox="0 0 40 40"><path d="M27 2l-4 16" ${st(1)} stroke="${C.pinkD}" stroke-width="3.5"/><path d="M10 9h20l-3 28h-14z" fill="#fff" ${st(2.5)}/><path d="M11.3 16h17.4l-2.2 20h-13z" fill="#f4a7b9"/><path d="M10 9h20l-3 28h-14z" fill="none" ${st(2.5)}/><circle cx="12" cy="9" r="4" fill="#e0554a" ${st(1.8)}/></symbol>
<symbol id="k-cup" viewBox="0 0 40 40"><ellipse cx="20" cy="34" rx="16" ry="3.5" fill="#fff" ${st(2.2)}/><path d="M30 18q7 0 6 6q-1 5-7 5" fill="none" ${st(2.2)}/><path d="M8 14h24l-2 14q-1 5-6 5h-8q-5 0-6-5z" fill="#fff" ${st(2.5)}/></symbol>
<symbol id="k-dirty" viewBox="0 0 40 40"><ellipse cx="20" cy="34" rx="16" ry="3.5" fill="#efe4d6" ${st(2.2)}/><path d="M30 18q7 0 6 6q-1 5-7 5" fill="none" ${st(2.2)}/><path d="M8 14h24l-2 14q-1 5-6 5h-8q-5 0-6-5z" fill="#efe4d6" ${st(2.5)}/><path d="M12 18q4 3 9 0" stroke="#a5805e" stroke-width="2.5" fill="none"/><circle cx="25" cy="24" r="2" fill="#a5805e"/><path d="M14 9q-2-3 0-6M22 9q-2-3 0-6" fill="none" ${st(1.6)} opacity=".5"/></symbol>
<symbol id="k-stack" viewBox="0 0 40 30"><path d="M30 12q7 0 6 6q-1 5-7 5" fill="none" ${st(2.2)}/><path d="M8 8h24l-2 14q-1 5-6 5h-8q-5 0-6-5z" fill="#efe4d6" ${st(2.5)}/><path d="M12 12q4 3 9 0" stroke="#a5805e" stroke-width="2.5" fill="none"/></symbol>
<symbol id="k-bolt" viewBox="0 0 40 40"><path d="M23 3L9 23h9l-4 14l16-21h-9z" fill="${K.haz}" ${st(2.5)}/></symbol>
<symbol id="k-wrench" viewBox="0 0 40 40"><path d="M29 5a8 8 0 0 0-9 11L6 30a3.5 3.5 0 0 0 5 5l14-14a8 8 0 0 0 11-9l-5 5l-5-1l-1-5z" fill="#c8cdd3" ${st(2.3)}/></symbol>
<symbol id="k-oven" viewBox="0 0 40 40"><rect x="5" y="6" width="30" height="29" rx="4" fill="#ece6df" ${st(2.5)}/><rect x="5" y="6" width="30" height="7" rx="3" fill="${C.pinkD}" ${st(2)}/><rect x="10" y="17" width="20" height="13" rx="2" fill="url(#k-fire)" ${st(2)}/></symbol>
<symbol id="k-lock" viewBox="0 0 40 40"><path d="M13 18v-5a7 7 0 0 1 14 0v5" fill="none" ${st(3)}/><rect x="9" y="18" width="22" height="17" rx="4" fill="${C.mustard}" ${st(2.5)}/><circle cx="20" cy="26" r="2.5" fill="${I}"/></symbol>
<symbol id="k-grinder" viewBox="0 0 40 40"><path d="M10 4h20l-5 13h-10z" fill="#7a4a2e" ${st(2.2)}/><rect x="14" y="17" width="12" height="18" rx="2" fill="${C.navy}" ${st(2.2)}/><circle cx="20" cy="25" r="2.5" fill="${C.pink}"/></symbol>
<symbol id="k-espresso" viewBox="0 0 40 40"><rect x="4" y="8" width="32" height="18" rx="4" fill="#b9cdb0" ${st(2.3)}/><path d="M12 26v4M20 26v4M28 26v4" ${st(2.5)}/><rect x="9" y="31" width="22" height="4" rx="1.5" fill="${K.steelD}" ${st(1.8)}/></symbol>
</defs>`;

/* ---------- room: wall, doors, hood, counter, floor ---------- */
let M = `<rect width="1600" height="1000" fill="${C.paper}"/>
<rect width="1600" height="70" fill="#f5ece2"/><path d="M0 70H1600M0 78H1600" fill="none" ${st(2.5)}/>
<rect x="0" y="79" width="1600" height="471" fill="url(#k-tile)"/>
<rect x="0" y="252" width="1600" height="24" fill="${C.pink}" opacity=".6"/><path d="M0 252H1600M0 276H1600" ${st(1.5)} opacity=".3"/>`;
for (let x = 24; x < 1600; x += 48) M += `<path d="M${x} 252V276" ${st(1.2)} opacity=".25"/>`;

// swing door back to the lobby
M += `<rect x="12" y="292" width="122" height="360" fill="#f5ece2" ${st(3)}/>
<g id="k-door" class="k-door"><rect x="20" y="300" width="106" height="350" rx="4" fill="${C.pink}" ${st(3)}/>
<circle cx="73" cy="384" r="28" fill="#fff" ${st(3)}/><circle cx="73" cy="384" r="21" fill="${C.pinkL}" ${st(2)}/>
<path d="M58 394h30M62 394v10M84 394v10" ${st(1.8)}/><circle cx="68" cy="378" r="5" fill="#fff" ${st(1.5)}/>
<rect x="24" y="468" width="10" height="48" rx="4" fill="${K.steelD}" ${st(2)}/>
<rect x="26" y="598" width="94" height="46" rx="3" fill="${K.steel}" ${st(2.5)}/>
<circle cx="34" cy="606" r="2" fill="${I}"/><circle cx="112" cy="606" r="2" fill="${I}"/><circle cx="34" cy="636" r="2" fill="${I}"/><circle cx="112" cy="636" r="2" fill="${I}"/></g>
<rect x="24" y="256" width="98" height="28" rx="6" fill="#fff" ${st(2.5)}/>`;

// extraction hood over fryer + press
M += `<ellipse cx="560" cy="330" rx="90" ry="110" fill="url(#k-lamp)"/><ellipse cx="724" cy="330" rx="90" ry="110" fill="url(#k-lamp)"/>
<rect x="604" y="0" width="74" height="74" fill="${K.steel}" ${st(3)}/>
<path d="M520 72H762L814 206H466Z" fill="${K.steelL}" ${st(3)}/>`;
for (let x = 534; x <= 748; x += 22) M += `<path d="M${x} 112V180" ${st(1.6)} opacity=".35"/>`;
M += `<rect x="458" y="204" width="364" height="18" rx="4" fill="${K.steel}" ${st(3)}/>
<ellipse cx="560" cy="226" rx="12" ry="4" fill="#fff6d8" ${st(1.8)}/><ellipse cx="724" cy="226" rx="12" ry="4" fill="#fff6d8" ${st(1.8)}/>`;

// card rails
M += `<rect x="140" y="90" width="326" height="8" rx="4" fill="${K.steelD}" ${st(2.5)}/><rect x="816" y="90" width="662" height="8" rx="4" fill="${K.steelD}" ${st(2.5)}/>`;
[150, 456, 826, 1468].forEach(x => M += `<rect x="${x-4}" y="80" width="8" height="12" fill="${K.steelD}" ${st(2)}/>`);

// back door, propped open — staff break spot
M += `<rect x="1490" y="292" width="106" height="360" fill="url(#k-out)" ${st(3)}/>
<path d="M1540 330q8-12 20-6q8-10 20 0q10 0 8 10h-44q-6 0-4-4z" fill="#fff" ${st(2)}/>
<path d="M1490 604q20-24 40-6q16-22 36-4q14-14 30 0V652H1490Z" fill="#b9cdb0" ${st(2.5)}/>
<path d="M1580 292L1600 282V662L1580 652Z" fill="${C.pinkD}" ${st(3)}/>
<rect x="1494" y="256" width="100" height="28" rx="6" fill="#fff" ${st(2.5)}/>`;

// floor + anti-fatigue mats
M += `<rect x="0" y="${FLOOR}" width="1600" height="120" fill="${th.floor}"/>`;
for (let r = 0; r < 3; r++) for (let i = 0; i * 56 < 1600; i++) if ((i + r) % 2) M += `<rect x="${i*56}" y="${FLOOR + r*40}" width="56" height="40" fill="${C.pinkL}"/>`;
M += `<path d="M0 ${FLOOR}H1600" ${st(3)}/>`;
[[150, 120], [420, 160], [910, 190]].forEach(([x, w]) => M += `<rect x="${x}" y="660" width="${w}" height="11" rx="5" fill="${C.navy}" opacity=".85"/>`);

// back counter
M += `<rect x="134" y="566" width="1356" height="84" fill="${K.steel}" ${st(3)}/>`;
for (let x = 140; x + 108 < 1490; x += 112) M += `<rect x="${x+4}" y="574" width="104" height="60" rx="3" fill="none" ${st(1.8)}/><rect x="${x+42}" y="580" width="28" height="5" rx="2.5" fill="${K.steelD}" ${st(1.5)}/>`;
M += `<rect x="134" y="638" width="1356" height="12" fill="${C.pinkD}" ${st(2.5)}/>
<rect x="128" y="546" width="1368" height="20" rx="4" fill="${K.steelL}" ${st(3)}/><path d="M136 552H1488" stroke="#fff" stroke-width="2.5"/>`;

/* ---------- stations ---------- */
// PREP — mise en place rail + board
M += `<rect x="148" y="330" width="166" height="8" rx="2" fill="${K.steel}" ${st(2.5)}/><path d="M160 338l10 14M302 338l-10 14" ${st(2)}/>`;
[['k-avo', '#d7e69a', .8], ['k-tomato', '#f08a7e', .6], ['k-straw', '#f4a7b9', .45], ['k-banana', '#f6e3a0', .7], [null]].forEach(([id, col, lvl], i) => {
  const x = 154 + i * 32;
  if (!id) { M += `<rect x="${x}" y="296" width="28" height="34" rx="3" fill="none" ${st(2)} stroke-dasharray="4 3"/>`; return; }
  M += `<rect x="${x}" y="296" width="28" height="34" rx="3" fill="#fff" ${st(2.2)}/><rect x="${x+2}" y="${330 - 32*lvl}" width="24" height="${32*lvl - 2}" fill="${col}"/>${use(id, x+4, 300, 20)}`;
});
M += `<rect x="156" y="538" width="156" height="12" rx="4" fill="${K.wood}" ${st(2.5)}/><path d="M164 544h140" stroke="${K.woodD}" stroke-width="1.5"/>`;
[250, 266, 282].forEach(x => M += `<ellipse cx="${x}" cy="535" rx="7" ry="3.5" fill="#e0554a" ${st(1.8)}/>`);

// OVEN — two decks
M += `<rect x="334" y="336" width="132" height="216" rx="8" fill="#ece6df" ${st(3)}/>
<rect x="334" y="336" width="132" height="24" rx="7" fill="${C.pinkD}" ${st(3)}/>
<circle cx="350" cy="348" r="6" fill="#fff" ${st(2)}/><path d="M350 348l3-4" ${st(1.8)}/>
<circle cx="368" cy="348" r="6" fill="#fff" ${st(2)}/><path d="M368 348l-4-2" ${st(1.8)}/>
<rect x="394" y="341" width="62" height="14" rx="3" fill="#2b2a2e" ${st(2)}/>
<rect x="420" y="328" width="30" height="8" rx="2" fill="${K.steelD}" ${st(2)}/>`;
[368, 456].forEach(y => M += `<rect x="344" y="${y}" width="112" height="80" rx="5" fill="${K.steel}" ${st(2.5)}/>
<rect x="360" y="${y+5}" width="80" height="6" rx="3" fill="${K.steelD}" ${st(2)}/>
<rect x="352" y="${y+16}" width="96" height="54" rx="4" fill="url(#k-fire)" ${st(2.2)}/>
<path d="M356 ${y+62}H444" ${st(2)}/>`);

// FRYER
M += `<rect x="488" y="452" width="114" height="100" rx="6" fill="${K.steel}" ${st(3)}/>
<rect x="496" y="452" width="98" height="12" fill="${K.oil}" ${st(2.5)}/>
<path d="M514 458L494 412l12-4" fill="none" ${st(4.5)}/>
<rect x="566" y="392" width="14" height="6" fill="${K.steelD}" ${st(1.8)}/><path d="M573 398V414" ${st(2.5)}/>
<rect x="556" y="414" width="34" height="26" rx="3" fill="none" ${st(2.2)}/>
<path d="M556 422h34M556 430h34M564 414v26M573 414v26M582 414v26" ${st(1.2)} opacity=".6"/>
<circle cx="514" cy="496" r="11" fill="#fff" ${st(2.5)}/><path d="M514 496l6-5" ${st(2)}/>
<circle cx="578" cy="496" r="7" fill="${C.navy}" ${st(2)}/>
<path d="M534 532h22l-11-18z" fill="${C.mustard}" ${st(2)}/><path d="M545 520v5" ${st(2)}/><circle cx="545" cy="528" r="1.2" fill="${I}"/>`;

// PANINI PRESS — four slots
M += `<rect x="620" y="500" width="170" height="52" rx="6" fill="${K.steelD}" ${st(3)}/>
<rect x="626" y="488" width="158" height="14" rx="3" fill="#3a3a3e" ${st(2)}/>`;
for (let i = 0; i < 4; i++){ const x = 628 + i * 39;
  M += `<path d="M${x} 490V472Q${x} 462 ${x+8} 462H${x+28}Q${x+36} 462 ${x+36} 472V490Z" fill="${K.steel}" ${st(2.5)}/><rect x="${x+10}" y="452" width="16" height="8" rx="3" fill="#2b2a2e" ${st(1.8)}/><path d="M${x+18} 460v3" ${st(2)}/>`;
}
M += `<circle cx="705" cy="526" r="11" fill="#fff" ${st(2.5)}/><path d="M705 526l-6-6" ${st(2)}/>`;
[640, 655, 755, 770].forEach(x => M += `<circle cx="${x}" cy="528" r="4" fill="${C.sage}" ${st(1.5)}/>`);

// ESPRESSO — three group heads (the bottleneck)
M += `<rect x="804" y="360" width="252" height="188" rx="16" fill="none" stroke="${C.terra}" stroke-width="3" stroke-dasharray="7 6"/>
<rect x="822" y="392" width="216" height="9" rx="3" fill="${K.steel}" ${st(2.5)}/>`;
[834, 862, 890, 1004].forEach(x => M += use('k-cup', x, 368, 26));
M += `<rect x="814" y="400" width="232" height="98" rx="12" fill="#b9cdb0" ${st(3)}/>
<rect x="814" y="400" width="232" height="24" rx="10" fill="${C.sage}" ${st(3)}/>
<circle cx="846" cy="446" r="13" fill="#fff" ${st(2.5)}/><path d="M846 446l8-6" ${st(2.2)}/><path d="M855 436a13 13 0 0 1 4 9" stroke="${C.terra}" stroke-width="3" fill="none"/>
<circle cx="1014" cy="446" r="13" fill="#fff" ${st(2.5)}/><path d="M1014 446l-3-9" ${st(2.2)}/>
<rect x="900" y="436" width="60" height="20" rx="10" fill="${C.pinkD}" ${st(2)}/>`;
[868, 930, 992].forEach(gx => M += `<rect x="${gx-17}" y="476" width="34" height="14" rx="4" fill="#d9d9d9" ${st(2.5)}/><rect x="${gx-14}" y="489" width="28" height="8" rx="3" fill="#9aa3ab" ${st(2)}/><path d="M${gx+14} 492L${gx+36} 500" ${st(6)}/>`);
M += `<rect x="826" y="498" width="12" height="32" fill="${K.steelD}" ${st(2.5)}/><rect x="1022" y="498" width="12" height="32" fill="${K.steelD}" ${st(2.5)}/>
<rect x="818" y="528" width="224" height="12" rx="3" fill="${K.steelD}" ${st(2.5)}/><path d="M830 534h200" ${st(1.4)} stroke-dasharray="3 5"/>
<rect x="822" y="540" width="216" height="12" rx="2" fill="${K.steel}" ${st(2.5)}/>`;
[868, 930].forEach(gx => M += use('k-cup', gx - 14, 500, 28));
M += `<path d="M1040 470Q1060 480 1056 506" fill="none" ${st(4)}/>
<path d="M1046 504h20l-2.5 18q-1 4-4 4h-7q-3 0-4-4z" fill="${K.steelL}" ${st(2.5)}/><path d="M1066 508q7 2 3 11" fill="none" ${st(2.2)}/>`;

// GRINDER — hopper level is the bean stock
M += `<path d="M1064 336H1126L1110 412H1080Z" fill="${K.glass}" fill-opacity=".7" ${st(3)}/>
<path d="M1070 365H1120L1110 412H1080Z" fill="#7a4a2e"/>`;
[[1082,378],[1096,372],[1108,382],[1090,392],[1102,398],[1094,406],[1080,370]].forEach(([x, y]) => M += `<ellipse cx="${x}" cy="${y}" rx="4" ry="2.6" fill="#a0663e" ${st(1)}/>`);
M += `<path d="M1064 336H1126L1110 412H1080Z" fill="none" ${st(3)}/>
<rect x="1060" y="326" width="70" height="12" rx="4" fill="${C.navy}" ${st(2.5)}/>
<path d="M1122 350h6M1119 365h8M1116 380h6M1113 395h6" ${st(1.6)}/>
<rect x="1072" y="412" width="46" height="26" rx="4" fill="#2b2f3a" ${st(2.5)}/>
<rect x="1076" y="436" width="38" height="116" rx="6" fill="${C.navy}" ${st(3)}/>
<circle cx="1095" cy="456" r="9" fill="${C.pink}" ${st(2)}/><path d="M1095 456l4-6" ${st(2)}/>
<path d="M1088 474h14v10h-14z" fill="#2b2f3a" ${st(2)}/>
<rect x="1080" y="500" width="30" height="8" rx="2" fill="${K.steelD}" ${st(2)}/>
<rect x="1070" y="540" width="50" height="12" rx="3" fill="#2b2f3a" ${st(2.5)}/>`;

// BLENDER
M += `<path d="M1150 424H1200L1194 512H1156Z" fill="${K.glass}" fill-opacity=".6" ${st(3)}/>
<path d="M1152 452H1198L1194 512H1156Z" fill="#f4a7b9"/>
<path d="M1150 424H1200L1194 512H1156Z" fill="none" ${st(3)}/>
<path d="M1200 438q16 4 10 34l-10 4" fill="none" ${st(3)}/>
<rect x="1146" y="414" width="58" height="12" rx="4" fill="${C.navy}" ${st(2.5)}/><rect x="1168" y="406" width="14" height="9" rx="3" fill="${C.navy}" ${st(2)}/>
<path d="M1162 506l13-6l13 6" fill="none" ${st(2)}/>
<path d="M1146 552L1152 512H1198L1204 552Z" fill="${C.pink}" ${st(3)}/>
<circle cx="1163" cy="534" r="4" fill="#fff" ${st(1.5)}/><circle cx="1187" cy="534" r="4" fill="${C.pinkD}" ${st(1.5)}/>`;

// COLD BREW TOWER
const coil = 'M1266 410C1290 413 1290 423 1266 425C1242 427 1242 437 1266 439C1290 441 1290 451 1266 453C1242 455 1242 463 1266 466';
const carafe = 'M1256 472h20v12q18 10 18 34q0 34-28 34q-28 0-28-34q0-24 18-34z';
M += `<rect x="1222" y="246" width="88" height="12" rx="3" fill="${K.woodD}" ${st(2.5)}/>
<rect x="1226" y="258" width="9" height="290" fill="${K.wood}" ${st(2.5)}/><rect x="1297" y="258" width="9" height="290" fill="${K.wood}" ${st(2.5)}/>
<rect x="1224" y="400" width="84" height="8" fill="${K.woodD}" ${st(2)}/>
<rect x="1220" y="542" width="92" height="10" rx="2" fill="${K.woodD}" ${st(2.5)}/>
<circle cx="1266" cy="290" r="26" fill="${K.glass}" ${st(3)}/><path d="M1240.3 296A26 26 0 0 0 1291.7 296Z" fill="#cfe7f5"/><circle cx="1266" cy="290" r="26" fill="none" ${st(3)}/>
<path d="M1256 280q4-10 12-10" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>
<rect x="1262" y="316" width="8" height="14" fill="${K.steelD}" ${st(2)}/><path d="M1270 322h6" ${st(2.5)}/>
<rect x="1249" y="338" width="34" height="56" rx="6" fill="${K.glass}" ${st(2.5)}/>
<rect x="1251" y="362" width="30" height="30" rx="3" fill="#5a3a26"/><rect x="1251" y="356" width="30" height="6" fill="#9a7a5a"/>
<rect x="1249" y="338" width="34" height="56" rx="6" fill="none" ${st(2.5)}/>
<path d="M1266 394V410" ${st(2.5)}/>
<path d="${coil}" fill="none" stroke="${I}" stroke-width="5" stroke-linecap="round"/><path d="${coil}" fill="none" stroke="${K.glass}" stroke-width="2.4" stroke-linecap="round"/>
<path d="${carafe}" fill="${K.glass}" ${st(3)}/><path d="M1240 512q0 36 26 36q26 0 26-36z" fill="${K.brew}"/><path d="${carafe}" fill="none" ${st(3)}/>
<path d="M1284 520h8M1286 532h6" ${st(1.6)}/>`;

// DISH PIT — clean cup shelf, sink with a tower of dirty cups, dishwasher
M += `<rect x="1322" y="322" width="150" height="8" rx="2" fill="${K.steel}" ${st(2.5)}/><path d="M1334 330l8 12M1460 330l-8 12" ${st(2)}/>`;
[1328, 1352].forEach(x => { for (let i = 0; i < 3; i++) M += use('k-cup', x, 299 - i * 8, 24); });
[1380, 1402, 1424, 1446].forEach(x => M += `<path d="M${x+3} 306h16l-1.6 11q-1 4-5 4h-3q-4 0-5-4z" fill="none" ${st(1.8)} stroke-dasharray="3 3" opacity=".6"/>`);
M += `<rect x="1328" y="546" width="78" height="8" rx="2" fill="#9fc6d9" ${st(2)}/>`;
for (let i = 0; i < 9; i++) M += `<use href="#k-stack" x="${1330 + i*1.6}" y="${528 - i*12}" width="30" height="22.5"/>`;
M += `<path d="M1402 548V474Q1402 456 1388 456Q1376 456 1376 470" fill="none" ${st(5)}/><path d="M1402 548V474Q1402 456 1388 456Q1376 456 1376 470" fill="none" stroke="${K.steelL}" stroke-width="2"/>
<rect x="1396" y="520" width="14" height="6" rx="2" fill="${K.steelD}" ${st(1.8)}/>
<rect x="1410" y="420" width="62" height="132" rx="6" fill="${K.steel}" ${st(3)}/>
<rect x="1414" y="428" width="54" height="8" rx="3" fill="${K.steelD}" ${st(2)}/>
<rect x="1418" y="446" width="46" height="60" rx="4" fill="#cfe7f5" ${st(2.2)}/>
<path d="M1424 470h34M1424 486h34" ${st(1.4)} opacity=".5"/>
<circle cx="1458" cy="520" r="4" fill="${C.sage}" ${st(1.5)}/>
<rect x="1406" y="540" width="70" height="12" rx="2" fill="${K.steelD}" ${st(2.2)}/>`;

/* ---------- breakdown overlay (toggled by the chaos loop) ---------- */
const BRK = `<g id="k-broken">
${[640, 655, 755, 770].map(x => `<circle cx="${x}" cy="528" r="4" fill="${C.terra}" ${st(1.5)}/>`).join('')}
<path d="M672 470q6-8 14-2q6-6 12 2q4 6-4 8q-12 3-22-8z" fill="${I}" opacity=".35"/>
<rect x="596" y="474" width="218" height="17" fill="url(#k-haz)" ${st(2)} transform="rotate(-11 705 482)"/>
<rect x="596" y="500" width="218" height="17" fill="url(#k-haz)" ${st(2)} transform="rotate(9 705 508)"/>
</g>`;

/* ---------- machine motion (unfiltered, under the crew) ---------- */
const steam = (x, y, d = 0) => `<path class="k-steam" style="animation-delay:${d}s" d="M${x} ${y}q-5-7 0-14q5-7 0-14" fill="none" ${st(2)} opacity=".45"/>`;
let FB = `<rect class="k-glow" x="352" y="384" width="96" height="54" rx="4" fill="#ffd27a" opacity=".2"/><rect class="k-glow" style="animation-delay:-1.4s" x="352" y="472" width="96" height="54" rx="4" fill="#ffd27a" opacity=".2"/>`;
[358, 386, 414].forEach((x, i) => FB += `<g class="k-rise" style="animation-delay:${-i*.5}s">${use('croissant', x, 403, 30)}</g>`);
[360, 390, 420].forEach(x => FB += use('k-panini', x, 495, 28));
[868, 930].forEach(gx => FB += `<path class="k-pour" d="M${gx} 497V514" stroke="${K.brew}" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="5 4"/>`);
FB += steam(1058, 500) + steam(1066, 494, -1.2) + steam(530, 446, -.4) + steam(558, 446, -1.6) + steam(584, 444, -.9) + steam(440, 326, -.5) + steam(1440, 418, -.8) + steam(1288, 252, -2);
for (let i = 0; i < 8; i++) FB += `<circle class="k-bub" style="animation-delay:${(-(i * .37) % 1.1).toFixed(2)}s" cx="${502 + i*12}" cy="458" r="${2.5 + (i % 3)}" fill="#fff6d8" ${st(1.2)}/>`;
FB += `<g id="k-sparks">`
  + [[680, 462, 1], [744, 472, .8], [712, 452, .6]].map(([x, y, s], i) => `<g transform="translate(${x} ${y}) scale(${s})"><path class="k-spark" style="animation-delay:${-i*.3}s" d="M0 -12L3 -3L12 0L3 3L0 12L-3 3L-12 0L-3 -3Z" fill="${K.haz}" ${st(1.8)}/></g>`).join('')
  + [[-18, -22], [16, -26], [24, -8], [-24, -6], [6, -30]].map(([dx, dy], i) => `<circle class="k-fly" style="--dx:${dx}px;--dy:${dy}px;animation-delay:${-i*.17}s" cx="${710 + dx*.3}" cy="${466 + dy*.3}" r="2.2" fill="#f6a43c"/>`).join('')
  + `</g><g id="k-smoke">` + [0, 1, 2].map(i => `<circle class="k-smoke" style="animation-delay:${-i}s" cx="${716 + i*8}" cy="446" r="10" fill="#9aa0a6" opacity=".4"/>`).join('') + `</g>`;
FB += `<path class="k-swirl" d="M1175 470c14 0 16 14 0 16c-12 1-14-10-3-11c8-1 9 6 2 6" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="6 5" opacity=".9"/>
<path class="k-swirl" style="animation-delay:-.2s" d="M1160 492c10 6 22 6 30 0" fill="none" stroke="#e07e8f" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="6 5"/>
<circle class="k-drip" cx="1266" cy="333" r="2.4" fill="#9fc6d9"/><circle class="k-drip" style="animation-delay:-.8s" cx="1266" cy="467" r="2.6" fill="${K.brew}"/>
<path class="k-water" d="M1376 472V544" stroke="#9fd0e8" stroke-width="4" stroke-linecap="round" stroke-dasharray="7 5"/>
<g class="k-whoosh"><path d="M1478 452q9 10 0 20M1486 446q13 16 0 32" fill="none" ${st(2)} opacity=".7"/></g>
<g transform="translate(308 528)"><g class="k-chop"><path d="M-24 -5L-68 -2Q-72 4-66 7L-24 5Z" fill="#e9edf0" ${st(2)}/><rect x="-24" y="-5" width="24" height="10" rx="4" fill="${C.navy}" ${st(2)}/></g></g>
<g id="k-oos" transform="rotate(-5 705 452)"><g class="k-sign"><g filter="url(#wob)">
  <rect x="642" y="402" width="128" height="48" rx="4" fill="#f3e2c8" ${st(2.8)}/>
  <rect x="636" y="396" width="24" height="10" fill="${K.haz}" opacity=".85" transform="rotate(-30 648 401)"/><rect x="752" y="396" width="24" height="10" fill="${K.haz}" opacity=".85" transform="rotate(30 764 401)"/></g>
  ${gt(706, 425, 'OUT OF ORDER', 18, `text-anchor="middle" fill="${C.terra}"`)}${t(706, 443, 'tech called · 08:31', 11.5, 'text-anchor="middle"')}</g></g>
<g id="k-fixing" style="display:none" transform="translate(744 452)"><g class="k-turn">${use('k-wrench', -15, -15, 30)}</g></g>`;

/* ---------- crew ---------- */
function meter(id, name, fat, hy = HY){
  const y = hy - 104;
  return `<g><rect x="-50" y="${y}" width="100" height="31" rx="9" fill="#fffefb" ${st(2)}/>
  ${t(0, y + 15, name, 13.5, 'text-anchor="middle"')}
  <rect x="-40" y="${y+20}" width="80" height="6" rx="3" fill="#eee" ${st(1.3)}/>
  <rect id="fat-${id}" x="-39.5" y="${y+20.5}" width="${(79*fat).toFixed(1)}" height="5" rx="2.5" fill="${fatCol(fat)}"/></g>`;
}
function body(o){
  const y = HY;
  let s = `<g class="leg leg-l"><path d="M-10 ${y+116}L-12 ${y+188}" fill="none" ${st(3.2)}/><ellipse cx="-16" cy="${y+190}" rx="8" ry="4" fill="${I}"/></g>
  <g class="leg leg-r"><path d="M10 ${y+116}L12 ${y+188}" fill="none" ${st(3.2)}/><ellipse cx="16" cy="${y+190}" rx="8" ry="4" fill="${I}"/></g>`;
  s += (o.back || '') + torso(0, y, o.coat || '#fffdf9');
  if (o.chef !== false) {
    s += [44, 62].map(dy => `<circle cx="-8" cy="${y+dy}" r="2.2" fill="${I}"/><circle cx="8" cy="${y+dy}" r="2.2" fill="${I}"/>`).join('');
    s += `<path d="M-34 ${y+80}H34L38 ${y+125}H-38Z" fill="${o.apron || C.pink}" ${st(2.5)}/><path d="M-35 ${y+80}l-10 10M35 ${y+80}l10 10" ${st(2)}/>`;
  }
  s += (o.mid || '') + head(0, y) + eyes(0, y, o.lx || 0, o.ly || 0) + (o.brow ? brows(0, y, o.brow) : '') + mouth(0, y, o.mouth || 'neutral') + (o.blush ? blush(0, y) : '') + (o.hat || '');
  s += `<g class="arms-work">${o.work || arm(-28, y+46, -50, y+92, -22, y+78) + arm(28, y+46, 50, y+92, 22, y+78)}</g>`;
  s += `<g class="arms-walk">${o.walk || arm(-28, y+46, -40, y+92, -34, y+116) + arm(28, y+46, 40, y+92, 34, y+116)}</g>`;
  return s;
}
const staff = (id, x, name, fat, o, extra = '', walking = false) =>
  `<g id="st-${id}" class="staff${walking ? ' walking' : ''}" transform="translate(${x} 0)"><g class="bob"><g filter="url(#wob)">${body(o)}</g>${meter(id, name, fat)}${extra}</g></g>`;

const y = HY;
const ASHA = {
  back: `<circle cx="20" cy="${y-20}" r="10" fill="#2b2a2e" ${st(2.5)}/>`,
  hat: `<path d="M-28 ${y+6}C-31 ${y-26} 31 ${y-26} 28 ${y+6}C20 ${y-6} -20 ${y-6} -28 ${y+6}Z" fill="#2b2a2e" ${st(3)}/>
    <path d="M-29 ${y-6}C-27 ${y-36} 27 ${y-36} 29 ${y-6}C12 ${y-15} -12 ${y-15} -29 ${y-6}Z" fill="${C.pinkD}" ${st(2.8)}/>
    <circle cx="-12" cy="${y-22}" r="2" fill="#fff"/><circle cx="2" cy="${y-26}" r="2" fill="#fff"/><circle cx="15" cy="${y-21}" r="2" fill="#fff"/>
    <path d="M26 ${y-10}l14-8l-1 12z" fill="${C.pinkD}" ${st(2)}/>`,
  mouth: 'smile', blush: true, ly: 2,
};
const RAVI = {
  hat: `<path d="M-24 ${y-18}C-36 ${y-38} -22 ${y-60} -8 ${y-52}C-4 ${y-68} 16 ${y-68} 18 ${y-52}C32 ${y-60} 40 ${y-38} 24 ${y-18}Z" fill="#fff" ${st(3)}/>
    <rect x="-25" y="${y-24}" width="50" height="12" rx="3" fill="#fff" ${st(3)}/>
    <path d="M-9 ${y+11}q9-5 18 0q-9 3-18 0z" fill="#3a2a22"/>`,
  brow: 'flat', ly: 3,
};
const MEERA = {
  back: `<path d="M16 ${y-22}C40 ${y-22} 46 ${y+10} 38 ${y+42}C33 ${y+20} 30 ${y} 14 ${y-8}Z" fill="#6b4a32" ${st(2.5)}/>`,
  hat: shortHair(0, y, '#6b4a32') + `<path d="M-28 ${y-6}C-30 ${y-38} 30 ${y-38} 28 ${y-6}C14 ${y-14} -14 ${y-14} -28 ${y-6}Z" fill="${C.pink}" ${st(3)}/>
    <path d="M27 ${y-9}L46 ${y-5}L44 ${y+2}L26 ${y-2}Z" fill="${C.pinkD}" ${st(2.5)}/>
    <path d="M-33 ${y-16}q-6 9 0 12q6-3 0-12z" fill="#cfe7f5" ${st(1.6)}/>`,
  brow: 'worried', ly: 2,
};
const TECH = {
  coat: '#4a5d7e', chef: false, mouth: 'smile', lx: -4,
  mid: `<path d="M-24 ${y+62}H24V${y+125}H-24Z" fill="#5b6f93" ${st(2)}/><path d="M-22 ${y+62}L-24 ${y+30}M22 ${y+62}L24 ${y+30}" stroke="${C.mustard}" stroke-width="4" stroke-linecap="round"/><rect x="-10" y="${y+74}" width="20" height="14" rx="2" fill="none" ${st(1.8)}/>`,
  hat: `<path d="M-28 ${y-2}C-30 ${y-36} 30 ${y-36} 28 ${y-2}C14 ${y-10} -14 ${y-10} -28 ${y-2}Z" fill="${C.mustard}" ${st(3)}/><path d="M-27 ${y-5}L-48 ${y-1}L-45 ${y+5}L-25 ${y+1}Z" fill="${C.mustard}" ${st(2.5)}/>`,
  walk: arm(-28, y+46, -40, y+92, -34, y+116) + arm(28, y+46, 40, y+92, 36, y+112)
    + `<path d="M30 ${y+114}v-7h16v7" fill="none" ${st(2.5)}/><rect x="20" y="${y+113}" width="36" height="22" rx="3" fill="${K.red}" ${st(2.5)}/><path d="M20 ${y+123}h36" ${st(1.6)}/>`,
  work: arm(-28, y+46, -50, y+92, -22, y+76) + arm(28, y+46, 50, y+92, 24, y+72),
};

// kabir, seated on a crate by the back door
const kx = 1544, ky = 540;
const KABIR = `<g filter="url(#wob)">
<rect x="${kx-36}" y="${ky+84}" width="72" height="44" rx="3" fill="${K.wood}" ${st(2.8)}/><path d="M${kx-36} ${ky+99}h72M${kx-36} ${ky+113}h72" ${st(1.6)}/>
<path d="M${kx-6} ${ky+26}L${kx+6} ${ky+26}C${kx+24} ${ky+30} ${kx+32} ${ky+40} ${kx+34} ${ky+60}L${kx+36} ${ky+90}L${kx-36} ${ky+90}L${kx-34} ${ky+60}C${kx-32} ${ky+40} ${kx-24} ${ky+30} ${kx-6} ${ky+26}Z" fill="#fffdf9" ${st(3)}/>
<path d="M${kx-34} ${ky+70}H${kx+34}L${kx+36} ${ky+90}H${kx-36}Z" fill="${C.pink}" ${st(2.5)}/>
<path d="M${kx-14} ${ky+90}L${kx-16} ${ky+126}M${kx+14} ${ky+90}L${kx+16} ${ky+126}" fill="none" ${st(3.2)}/>
<ellipse cx="${kx-20}" cy="${ky+128}" rx="8" ry="4" fill="${I}"/><ellipse cx="${kx+20}" cy="${ky+128}" rx="8" ry="4" fill="${I}"/>
${head(kx, ky)}<path d="M${kx-14} ${ky+3}q4 4 8 0M${kx+6} ${ky+3}q4 4 8 0" fill="none" ${st(2.5)}/>${mouth(kx, ky, 'smile')}${blush(kx, ky)}
<path d="M${kx-28} ${ky}L${kx-30} ${ky-18}L${kx-20} ${ky-16}L${kx-22} ${ky-32}L${kx-8} ${ky-24}L${kx-2} ${ky-38}L${kx+8} ${ky-26}L${kx+20} ${ky-34}L${kx+18} ${ky-20}L${kx+30} ${ky-20}L${kx+28} ${ky}C${kx+16} ${ky-14} ${kx-12} ${ky-14} ${kx-28} ${ky}Z" fill="#5a3e2b" ${st(3)}/>
${arm(kx-28, ky+46, kx-42, ky+82, kx-10, ky+66)}${arm(kx+28, ky+46, kx+42, ky+82, kx+10, ky+66)}
${use('k-cup', kx-15, ky+48, 30)}
</g>
<g transform="translate(${kx} 0)">${meter('kabir', 'kabir', .9, ky)}
<rect x="-56" y="${ky-138}" width="112" height="26" rx="13" fill="${C.pinkL}" ${st(2)}/>${use('k-lock', -50, ky-136, 22)}
<text id="k-break" x="-24" y="${ky-120}" font-family="Patrick Hand" font-size="14.5" fill="${I}">break · 6:40</text></g>`;

const STAFF = KABIR
  + staff('ravi', 205, 'ravi', .62, RAVI)
  + staff('meera', 468, 'meera', .78, MEERA, bubble(0, HY - 150, 140, 'break due · 12 min', C.terra))
  + staff('asha', 1000, 'asha', .38, ASHA)
  + staff('tech', 1478, 'technician', .2, TECH, bubble(0, HY - 150, 120, 'here for the press', I), true);

/* ---------- floor props + the pass ---------- */
let P = [874, 900, 926].map(x => use('k-milk', x, 684, 34)).join('')
  + `<rect x="868" y="714" width="96" height="46" rx="3" fill="${K.wood}" ${st(2.8)}/><path d="M868 730h96M868 745h96" ${st(1.6)}/>
<ellipse cx="720" cy="714" rx="24" ry="5" fill="${K.steelD}" ${st(2)}/><path d="M704 714h32M712 711v6M720 710v8M728 711v6" ${st(1.2)}/>
<path d="M1296 762L1314 696H1326L1344 762Z" fill="${K.haz}" ${st(2.8)}/><path d="M1320 712l-7 14h14z" fill="none" ${st(2)}/>`;
P += `<rect x="0" y="790" width="1600" height="210" fill="${K.steel}"/>`;
for (let yy = 818; yy < 975; yy += 16) P += `<path d="M0 ${yy}H1600" stroke="#fff" stroke-width="1.5" opacity=".55"/>`;
for (let x = 40; x < 1600; x += 160) P += `<circle cx="${x}" cy="812" r="3" fill="${K.steelD}" ${st(1.4)}/>`;
P += `<rect x="-5" y="975" width="1610" height="30" fill="${C.pinkD}" ${st(3)}/>
<rect x="0" y="800" width="1600" height="9" fill="${th.lip}"/>
<path d="M-10 762H1610V800H-10Z" fill="${K.steelL}" ${st(3)}/><path d="M0 770H1600" stroke="#fff" stroke-width="2.5"/>`;
// plates waiting for a runner, the batched tray, spike, smoothies, bags, queue tablet
P += use('toast', 148, 688, 74) + `<ellipse cx="262" cy="758" rx="32" ry="6" fill="#fff" ${st(2.5)}/>` + use('croissant', 238, 714, 48);
P += `<rect x="306" y="752" width="170" height="10" rx="4" fill="${C.pinkL}" ${st(2.5)}/>` + use('latte', 316, 708, 46) + use('latte', 366, 708, 46) + use('latte', 416, 708, 46);
P += `<ellipse cx="626" cy="760" rx="16" ry="4" fill="${K.steelD}" ${st(2)}/><path d="M626 758V690" ${st(2.5)}/>`
  + [[724, -8], [732, 6], [742, -4]].map(([yy, r]) => `<rect x="609" y="${yy-12}" width="34" height="22" rx="2" fill="#fffefb" ${st(1.8)} transform="rotate(${r} 626 ${yy})"/>`).join('');
P += use('k-smoothie', 960, 712, 50) + use('k-smoothie', 1004, 712, 50);
P += use('croissant', 1100, 650, 40) + bag(1090, '#e23744') + bag(1160, '#fc8019');
P += `<path d="M1470 762l10-28h12l10 28z" fill="${K.steelD}" ${st(2.5)}/>
<rect x="1400" y="660" width="172" height="78" rx="10" fill="${C.navy}" ${st(3)}/><rect x="1408" y="668" width="156" height="62" rx="6" fill="#fdf6ee" ${st(2)}/>`;
[[CH.dine, 70], [CH.zomato, 52], [CH.take, 62], [CH.swiggy, 40]].forEach(([c, w], i) => P += `<rect x="1462" y="${673 + i*13}" width="${w}" height="9" rx="4.5" fill="${c}" ${st(1.4)}/>`);

/* ---------- pass motion ---------- */
const FF = `<g class="k-slide"><ellipse cx="800" cy="760" rx="34" ry="6" fill="#fff" ${st(2.5)}/>${use('k-panini', 774, 717, 52)}</g>
<ellipse cx="548" cy="762" rx="30" ry="6" fill="#ddd" ${st(2.5)}/>
<g class="k-bell"><path d="M522 759Q522 726 548 726Q574 726 574 759Z" fill="${C.mustard}" ${st(3)}/><rect x="543" y="716" width="10" height="10" rx="2" fill="${I}"/><path d="M532 744q4-7 11-8" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/></g>
<g class="k-ding"><path d="M584 722l12-8M588 736l14-2M512 722l-12-8" ${st(2.2)}/></g>
${[0, 1, 2].map(i => `<text class="k-z" style="animation-delay:${-i * .93}s" x="${kx + 30 + i*8}" y="${ky - 150 - i*10}" font-family="Gochi Hand" font-size="${16 + i*3}" fill="${C.pinkD}">z</text>`).join('')}`;

/* ---------- loading cards: what goes into each machine, merged across orders ---------- */
const pill = (xr, yy, label, fill, tc = '#fff') => { const w = label.length * 6.6 + 16;
  return `<rect x="${xr - w}" y="${yy}" width="${w}" height="19" rx="9.5" fill="${fill}" ${st(1.8)}/><text x="${xr - w/2}" y="${yy + 14}" text-anchor="middle" font-family="Patrick Hand" font-size="12.5" fill="${tc}">${label}</text>`; };
const oc = (x, yy, label, kind, w) => `<rect x="${x}" y="${yy}" width="${w}" height="17" rx="8.5" fill="${CH[kind]}" ${st(1.6)}/><text x="${x + w/2}" y="${yy + 12.5}" text-anchor="middle" font-family="Patrick Hand" font-size="11.5" fill="#fff">${label}</text>`;
const mg = (xs, y0, tx, ty) => xs.map(x => `<path d="M${x} ${y0}C${x} ${(y0+ty)/2} ${tx} ${(y0+ty)/2+4} ${tx} ${ty+6}" fill="none" ${st(1.6)} opacity=".55"/>`).join('')
  + `<path d="M${tx-4} ${ty+6}L${tx} ${ty}L${tx+4} ${ty+6}" fill="none" ${st(1.8)}/>`;
const ring = (cx, cy, r, p, col) => { const c = 2 * Math.PI * r;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff" stroke="#e6e0d8" stroke-width="4"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${col}" stroke-width="4" stroke-dasharray="${(c*p).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/><circle cx="${cx}" cy="${cy}" r="${r+2}" fill="none" ${st(1.4)}/>`; };
const hdr = (s, sz = 17) => gt(10, 24, s, sz);
function card(cx, top, w, h, inner, o = {}){
  const x = cx - w / 2, hook = o.hook ?? 98;
  return `<path d="M${cx} ${hook}V${top}" ${st(1.8)}/><g ${o.id ? `id="${o.id}"` : ''} transform="translate(${x} ${top}) rotate(${o.rot || 0} ${w/2} 0)">
  <rect x="3" y="4" width="${w}" height="${h}" rx="7" fill="${I}" opacity=".14"/>
  <rect width="${w}" height="${h}" rx="7" fill="#fffefb" stroke="${o.alert ? C.terra : I}" stroke-width="${o.alert ? 3.2 : 2.5}"/>
  <rect x="${w/2 - 7}" y="-9" width="14" height="20" rx="4" fill="#e0b98a" ${st(2)}/><circle cx="${w/2}" cy="1" r="2" fill="${I}"/>${inner}</g>`;
}

let CARDS = '';
CARDS += card(230, 104, 172, 130, hdr('prep') + pill(162, 9, 'chopping', C.sage)
  + use('k-avo', 12, 30, 32) + gt(46, 56, '×3', 21) + use('k-tomato', 88, 30, 32) + gt(122, 56, '×4', 21)
  + mg([33, 85, 137], 92, 86, 66) + oc(10, 92, '#043', 'zomato', 46) + oc(62, 92, '#046', 'dine', 46) + oc(114, 92, '#049', 'swiggy', 46)
  + t(86, 124, '3 orders → 1 prep run', 11.5, 'text-anchor="middle" opacity=".6"'), {rot: -1.5});
CARDS += card(400, 104, 152, 146, hdr('oven') + ring(134, 17, 9, .55, C.pinkD) + t(118, 22, '4:20', 12.5, 'text-anchor="end"')
  + use('croissant', 6, 26, 40) + gt(48, 54, '×6', 21) + pill(144, 38, '180°', C.pinkL, I)
  + mg([30, 79, 124], 76, 27, 62) + oc(7, 76, '#041×2', 'dine', 46) + oc(58, 76, '#044', 'dine', 42) + oc(104, 76, 'prep×3', 'prep', 44)
  + `<path d="M8 102H144" ${st(1.4)} stroke-dasharray="4 4" opacity=".5"/>`
  + use('k-panini', 6, 104, 34) + gt(42, 130, '×3', 19) + pill(144, 114, '↺ press', C.terra), {rot: 1});
CARDS += card(545, 232, 118, 104, hdr('fryer') + t(108, 23, '1:40', 13, 'text-anchor="end"')
  + use('k-fries', 6, 26, 36) + gt(42, 52, '×3', 20) + t(78, 51, '450 g', 12.5)
  + mg([22, 59, 96], 78, 24, 64) + oc(6, 78, '#045', 'take', 33) + oc(43, 78, '#047', 'dine', 33) + oc(80, 78, '#043', 'zomato', 33), {hook: 222, rot: -1});
CARDS += card(705, 232, 172, 108, `<g id="k-pc-down">${hdr('panini press', 16) + pill(164, 9, 'DOWN', C.terra)
  + use('k-bolt', 8, 28, 22) + t(34, 44, 'since 08:31 · fix ~18 min', 12.5)
  + use('k-wrench', 8, 52, 22) + t(34, 68, 'tech', 12.5) + `<text id="k-eta" x="62" y="69" font-family="Gochi Hand" font-size="16" fill="${C.terra}">arriving</text>`
  + use('k-panini', 6, 76, 26) + gt(34, 97, '×3 →', 16) + use('k-oven', 76, 78, 22) + t(102, 95, 'oven +3 min', 12.5)}</g>
  <g id="k-pc-up" style="display:none">${hdr('panini press', 16) + pill(164, 9, 'OK', C.sage)
  + gt(86, 64, 'back in service ✓', 18, `text-anchor="middle" fill="#4f7a45"`) + t(86, 86, 'fixed after an 18 min outage', 12, 'text-anchor="middle" opacity=".7"')}</g>`, {hook: 222, rot: 2, alert: true, id: 'k-pcard'});
CARDS += card(930, 104, 240, 152, hdr('espresso') + t(86, 23, '3 groups', 12.5, 'opacity=".6"') + pill(230, 9, '94% busy', C.terra)
  + use('k-bean', 8, 28, 30) + gt(42, 52, '54 g', 20) + t(86, 50, '→ 3 doubles', 13)
  + use('k-milk', 8, 62, 30) + gt(42, 86, '0.9 L', 20) + t(92, 84, 'oat · one steam', 12.5)
  + mg([35, 85, 131], 112, 23, 94) + oc(8, 112, '#041 ×2', 'dine', 54) + oc(64, 112, '#043', 'zomato', 42) + oc(110, 112, '#045', 'take', 42)
  + [['G1 · 0:18', C.sage], ['G2 · 0:22', C.sage], ['G3 · free', null]].map(([l, c], i) => `<rect x="164" y="${100 + i*16}" width="68" height="14" rx="7" fill="${C.pinkL}" ${st(1.4)}/><circle cx="173" cy="${107 + i*16}" r="3.5" fill="${c || '#fff'}" ${st(1.3)}/>${t(181, 111 + i*16, l, 11)}`).join('')
  + t(10, 145, '3 orders → 1 milk steam', 11.5, 'opacity=".6"'), {rot: -.8});
CARDS += card(1095, 104, 76, 96, use('k-bean', 6, 4, 22) + gt(30, 22, 'grind', 15)
  + gt(38, 50, '1.4 kg', 19, 'text-anchor="middle"') + t(38, 67, '~3 h left', 12, 'text-anchor="middle"')
  + `<rect x="8" y="76" width="60" height="9" rx="4.5" fill="#fff" ${st(1.6)}/><rect x="8.5" y="76.5" width="${(59*.62).toFixed(1)}" height="8" rx="4" fill="#7a4a2e"/>`, {rot: 1.5});
CARDS += card(1176, 130, 78, 110, use('k-smoothie', 4, 4, 22) + gt(28, 22, 'blend', 15)
  + use('k-straw', 4, 28, 22) + gt(27, 46, '8', 16) + use('k-banana', 40, 28, 22) + gt(63, 46, '2', 16)
  + gt(8, 72, '→', 18) + use('k-smoothie', 24, 52, 24) + gt(50, 72, '×2', 16)
  + mg([21, 57], 86, 39, 74) + oc(4, 86, '#048', 'dine', 34) + oc(40, 86, '#050', 'zomato', 34), {rot: -2});
CARDS += card(1265, 104, 82, 100, use('coldbrew', 2, 2, 26) + gt(30, 22, 'tower', 15)
  + `<rect x="8" y="32" width="66" height="10" rx="5" fill="#fff" ${st(1.6)}/><rect x="8.5" y="32.5" width="${(65*.8).toFixed(1)}" height="9" rx="4.5" fill="${K.brew}"/>`
  + t(41, 58, '3.2 / 4 L', 12.5, 'text-anchor="middle"') + t(41, 74, 'ready 10:00', 12, 'text-anchor="middle"') + t(41, 90, '≈ 22 orders', 12, 'text-anchor="middle" opacity=".65"'), {rot: 1});
{ const pts = [14, 12, 11, 9, 8, 6, 4, 2, 0].map((v, i) => [12 + i * 16, 104 - v * 2.4]);
  const line = 'M' + pts.map(p => p.join(' ')).join('L');
  CARDS += card(1395, 104, 152, 124, hdr('dish pit') + pill(142, 9, '~12 min', C.terra)
    + use('k-dirty', 6, 26, 30) + gt(38, 50, '×18', 19) + use('k-cup', 80, 26, 30) + gt(112, 50, '×6', 19)
    + `<path d="M12 104H140" ${st(1.2)} opacity=".4"/><path d="${line}L140 104L12 104Z" fill="${C.pinkL}"/><path d="${line}" fill="none" stroke="${C.terra}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="140" cy="104" r="4" fill="${C.terra}" ${st(1.4)}/>`
    + t(12, 118, 'clean cups now', 10.5, 'opacity=".6"') + t(140, 118, '08:54 · out', 10.5, `text-anchor="end" fill="${C.terra}"`), {rot: -1}); }

/* ---------- crisp labels ---------- */
let TXT = gt(73, 277, '← lobby', 17, `text-anchor="middle" fill="${C.pinkD}"`) + gt(1544, 276, 'staff break', 16, 'text-anchor="middle"')
  + `<text x="425" y="352" text-anchor="middle" font-family="Courier Prime" font-weight="700" font-size="11" fill="#f6d58e">180°C</text>`
  + gt(930, 451, 'brew', 15, 'text-anchor="middle" fill="#fff"') + t(1133, 369, '62%', 11.5)
  + t(1320, 752, 'wet!', 11, 'text-anchor="middle"') + t(916, 754, 'oat milk ×12 · 08:15 ✓', 11, 'text-anchor="middle"')
  + `<rect x="318" y="772" width="148" height="20" rx="10" fill="#fff" ${st(2)}/>` + t(392, 787, 'batch · #041 #043 #045', 12.5, 'text-anchor="middle"')
  + [1090, 1160].map(x => `<text x="${x+31}" y="${765-45}" text-anchor="middle" font-family="Gochi Hand" font-size="15" fill="${C.pinkD}">brew</text>`).join('')
  + `<text x="1121" y="754" text-anchor="middle" font-family="Patrick Hand" font-size="10.5" fill="#fff">zomato·050</text><text x="1191" y="754" text-anchor="middle" font-family="Patrick Hand" font-size="10.5" fill="#fff">swiggy·051</text>`
  + t(1418, 686, 'queue', 13) + gt(1430, 722, '7', 30, 'text-anchor="middle"');
const ARROW = `<g id="k-reroute"><path class="k-route" d="M636 238C600 196 520 190 484 206" fill="none" stroke="${C.terra}" stroke-width="3" stroke-dasharray="7 6" stroke-linecap="round"/>
<path d="M494 198l-12 8l13 5" fill="none" stroke="${C.terra}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
<rect x="526" y="176" width="72" height="20" rx="10" fill="#fff" stroke="${C.terra}" stroke-width="2"/>${t(562, 191, 'reroute', 13, `text-anchor="middle" fill="${C.terra}"`)}</g>`;

document.getElementById('kitchen-scene').innerHTML = DEFS
  + `<g filter="url(#wob)">${M}</g><g filter="url(#wob)">${BRK}</g>`
  + FB + STAFF + `<g filter="url(#wob)">${P}</g>` + FF + CARDS + TXT + ARROW
  + `<rect width="1600" height="1000" filter="url(#grain)" opacity=".22" pointer-events="none"/>`;

/* ---------- live loop: crew walking between stations, enforced break, breakdown + repair ---------- */
const $ = id => document.getElementById(id);
const still = /[?&]still\b/.test(location.search);
if (still) document.body.classList.add('still');
if (still || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

const SPEED = 115;
const crew = [
  {id: 'asha', x: 1000, fat: .38, route: [[1000, 5], [1095, 2.5], [1176, 3], [930, 4.5]]},
  {id: 'ravi', x: 205, fat: .62, route: [[205, 5], [400, 4], [300, 2.5]]},
  {id: 'meera', x: 468, fat: .78, route: [[468, 4], [548, 5], [400, 3]]},
];
crew.forEach(c => Object.assign(c, {el: $('st-' + c.id), i: 0, wait: c.route[0][1], walking: false, max: c.fat + .08}));
const bobOf = el => el.querySelector('.bob');
crew.forEach(c => c.bob = bobOf(c.el));
const tech = {id: 'tech', el: $('st-tech'), x: 1478, tx: 770, state: 'in', t: 0, walking: true};
tech.bob = bobOf(tech.el);
let kabir = {fat: .9, left: 400};

function setBroken(b){
  ['k-broken', 'k-sparks', 'k-smoke', 'k-oos', 'k-reroute', 'k-pc-down'].forEach(id => $(id).style.display = b ? '' : 'none');
  $('k-pc-up').style.display = b ? 'none' : '';
  $('k-pcard').querySelector('rect:nth-of-type(2)').setAttribute('stroke', b ? C.terra : I);
  $('cell-panini').innerHTML = b ? '<i class="led r"></i>down' : '<i class="led g"></i>12%';
  $('k-chaos-press').textContent = b ? 'panini press down · adversarial fault' : 'panini press back in service';
}
function eta(s){ $('k-eta').textContent = s; $('k-eta2').textContent = s === 'back ✓' ? 'fixed ✓' : 'tech ' + s; $('k-eta2').className = s === 'back ✓' ? 'good' : 'hot'; }
function place(c, clock){
  const bob = c.walking ? -Math.abs(Math.sin(clock * 11)) * 4 : 0;
  c.el.setAttribute('transform', `translate(${c.x.toFixed(1)} 0)`);
  c.bob.setAttribute('transform', `translate(0 ${bob.toFixed(1)})`);
  c.el.classList.toggle('walking', c.walking);
}
function walk(c, dt){
  const d = c.tx - c.x, m = SPEED * dt;
  if (Math.abs(d) <= m) { c.x = c.tx; return true; }
  c.x += Math.sign(d) * m; return false;
}
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

let last = performance.now(), clock = 0, uiTick = 0;
function frame(now){
  const dt = Math.min(.05, (now - last) / 1000); last = now; clock += dt; uiTick += dt;
  for (const c of crew) {
    if (c.walking) { if (walk(c, dt)) { c.walking = false; c.wait = c.route[c.i][1]; } c.fat = Math.min(c.max, c.fat + .002 * dt); }
    else { c.wait -= dt; c.fat = Math.min(c.max, c.fat + .006 * dt); if (c.wait <= 0) { c.i = (c.i + 1) % c.route.length; c.tx = c.route[c.i][0]; c.walking = true; } }
    place(c, clock);
  }
  switch (tech.state) {
    case 'in': if (walk(tech, dt)) { tech.state = 'fix'; tech.t = 6; tech.walking = false; $('k-fixing').style.display = ''; eta('fixing…'); } break;
    case 'fix': if ((tech.t -= dt) <= 0) { setBroken(false); $('k-fixing').style.display = 'none'; tech.state = 'out'; tech.tx = 1680; tech.walking = true; eta('back ✓'); } break;
    case 'out': if (walk(tech, dt)) { tech.state = 'ok'; tech.t = 7; } break;
    case 'ok': if ((tech.t -= dt) <= 0) { setBroken(true); tech.state = 'eta'; tech.t = 10; } break;
    case 'eta': tech.t -= dt; eta('ETA ' + fmt(Math.max(0, Math.ceil(tech.t)))); if (tech.t <= 0) { tech.state = 'in'; tech.x = 1680; tech.tx = 770; tech.walking = true; eta('arriving'); } break;
  }
  place(tech, clock);
  kabir.left -= dt; kabir.fat = Math.max(.22, kabir.fat - .0025 * dt);
  if (kabir.left <= 0) { kabir.left = 400; kabir.fat = .9; }
  if (uiTick > .4) {
    uiTick = 0;
    for (const c of [...crew, {id: 'kabir', fat: kabir.fat}]) {
      const bar = $('fat-' + c.id), cb = $('cb-' + c.id);
      if (bar) { bar.setAttribute('width', (79 * c.fat).toFixed(1)); bar.setAttribute('fill', fatCol(c.fat)); }
      if (cb) { cb.style.width = Math.round(c.fat * 100) + '%'; cb.style.background = fatCol(c.fat); }
    }
    $('k-break').textContent = 'break · ' + fmt(kabir.left);
    $('cb-kabir-t').textContent = fmt(kabir.left);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
})();
