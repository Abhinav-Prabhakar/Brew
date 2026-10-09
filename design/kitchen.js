/* brew — kitchen room. Static backdrop (tiles, hood, back counter, the machines) + live layers from
   window.BrewLive.state: the crew walking to whichever station their current task is on (or resting on the crate
   by the back door), station cards (active tasks, timers, order chips, stock), machine motion that only runs while a
   station is busy, breakdowns (tape, sign, sparks, technician) from equipment.down/up, ready plates + bags on the
   pass, and the three cards: crew, stations board, chaos (with the buttons that trigger disruptions).
   Reuses doodles.js (ink kit) and render.js. */
(() => {
const K = {steel:'#e4e7eb', steelD:'#c7cdd4', steelL:'#f2f4f6', tile:'#fffaf6', grout:'#f1dccd', oil:'#e9b44c',
           wood:'#c99a6e', woodD:'#a87a52', glass:'#e6f1f4', red:'#d6453d', haz:'#f6d04d', brew:'#6b3f26'};
const FLOOR = 650, HY = 478;
const t = tx, gt = gtx;
const fatCol = f => f < .5 ? C.sage : f < .75 ? C.mustard : C.terra;
const $ = id => document.getElementById(id);

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
<linearGradient id="k-cold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a4f5a"/><stop offset="1" stop-color="#6b707a"/></linearGradient>
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
<symbol id="k-pot" viewBox="0 0 40 40"><path d="M6 16h28v14q0 6-6 6h-16q-6 0-6-6z" fill="#c7cdd4" ${st(2.5)}/><path d="M2 18h4M34 18h4" ${st(3)}/><path d="M14 10q-2-4 0-7M22 10q-2-4 0-7" fill="none" ${st(1.8)} opacity=".5"/></symbol>
<symbol id="k-waffle" viewBox="0 0 40 40"><rect x="6" y="10" width="28" height="22" rx="5" fill="#e8b66a" ${st(2.5)}/><path d="M13 10v22M20 10v22M27 10v22M6 17h28M6 25h28" ${st(1.5)}/></symbol>
<symbol id="k-sick" viewBox="0 0 40 40"><circle cx="20" cy="22" r="14" fill="#fff" ${st(2.5)}/><path d="M13 20q2-2 4 0M23 20q2-2 4 0" fill="none" ${st(2)}/><path d="M15 29q5-3 10 0" fill="none" ${st(2)}/><rect x="26" y="4" width="5" height="18" rx="2.5" fill="#fff" ${st(2)} transform="rotate(30 28 13)"/><circle cx="24" cy="21" r="2.6" fill="#e0554a"/><path d="M6 12q-3 3 0 6" fill="none" stroke="#9fd0e8" stroke-width="2.4" stroke-linecap="round"/></symbol>
<symbol id="k-rain" viewBox="0 0 40 40"><path d="M8 20q0-8 8-8q3-7 11-5q7 2 7 9q5 1 4 6q-1 4-6 4h-20q-5 0-4-6z" fill="#dfe3e8" ${st(2.4)}/><path d="M12 30l-2 6M20 30l-2 6M28 30l-2 6" stroke="#5b8fb0" stroke-width="2.6" stroke-linecap="round"/><path d="M22 24l-4 6h4l-3 5" fill="none" stroke="${K.haz}" stroke-width="2.4" stroke-linejoin="round"/></symbol>
<symbol id="k-scooter" viewBox="0 0 40 40"><circle cx="9" cy="30" r="5" fill="#fff" ${st(2.3)}/><circle cx="31" cy="30" r="5" fill="#fff" ${st(2.3)}/><path d="M9 30h14l6-12h5M27 18l-3-8h-4" fill="none" ${st(2.4)}/><rect x="4" y="14" width="13" height="12" rx="2" fill="${K.red}" ${st(2.2)}/></symbol>
</defs>`;

/* ---------- room: wall, doors, hood, counter, floor ---------- */
let M = `<rect width="1600" height="1000" fill="${C.paper}"/>
<rect width="1600" height="70" fill="#f5ece2"/><path d="M0 70H1600M0 78H1600" fill="none" ${st(2.5)}/>
<rect x="0" y="79" width="1600" height="471" fill="url(#k-tile)"/>
<rect x="0" y="252" width="1600" height="24" fill="${C.pink}" opacity=".6"/><path d="M0 252H1600M0 276H1600" ${st(1.5)} opacity=".3"/>`;
for (let x = 24; x < 1600; x += 48) M += `<path d="M${x} 252V276" ${st(1.2)} opacity=".25"/>`;
M += `<rect x="12" y="292" width="122" height="360" fill="#f5ece2" ${st(3)}/>
<g id="k-door" class="k-door"><rect x="20" y="300" width="106" height="350" rx="4" fill="${C.pink}" ${st(3)}/>
<circle cx="73" cy="384" r="28" fill="#fff" ${st(3)}/><circle cx="73" cy="384" r="21" fill="${C.pinkL}" ${st(2)}/>
<path d="M58 394h30M62 394v10M84 394v10" ${st(1.8)}/><circle cx="68" cy="378" r="5" fill="#fff" ${st(1.5)}/>
<rect x="24" y="468" width="10" height="48" rx="4" fill="${K.steelD}" ${st(2)}/>
<rect x="26" y="598" width="94" height="46" rx="3" fill="${K.steel}" ${st(2.5)}/>
<circle cx="34" cy="606" r="2" fill="${I}"/><circle cx="112" cy="606" r="2" fill="${I}"/><circle cx="34" cy="636" r="2" fill="${I}"/><circle cx="112" cy="636" r="2" fill="${I}"/></g>
<rect x="24" y="256" width="98" height="28" rx="6" fill="#fff" ${st(2.5)}/>`;
M += `<ellipse cx="560" cy="330" rx="90" ry="110" fill="url(#k-lamp)"/><ellipse cx="724" cy="330" rx="90" ry="110" fill="url(#k-lamp)"/>
<rect x="604" y="0" width="74" height="74" fill="${K.steel}" ${st(3)}/>
<path d="M520 72H762L814 206H466Z" fill="${K.steelL}" ${st(3)}/>`;
for (let x = 534; x <= 748; x += 22) M += `<path d="M${x} 112V180" ${st(1.6)} opacity=".35"/>`;
M += `<rect x="458" y="204" width="364" height="18" rx="4" fill="${K.steel}" ${st(3)}/>
<ellipse cx="560" cy="226" rx="12" ry="4" fill="#fff6d8" ${st(1.8)}/><ellipse cx="724" cy="226" rx="12" ry="4" fill="#fff6d8" ${st(1.8)}/>`;
M += `<rect x="140" y="90" width="326" height="8" rx="4" fill="${K.steelD}" ${st(2.5)}/><rect x="816" y="90" width="662" height="8" rx="4" fill="${K.steelD}" ${st(2.5)}/>`;
[150, 456, 826, 1468].forEach(x => M += `<rect x="${x-4}" y="80" width="8" height="12" fill="${K.steelD}" ${st(2)}/>`);
// back door, propped open — staff break spot (the sky outside is live: #k-outside)
const BACKDOOR = `<path d="M1580 292L1600 282V662L1580 652Z" fill="${C.pinkD}" ${st(3)}/>
<rect x="1494" y="256" width="100" height="28" rx="6" fill="#fff" ${st(2.5)}/>`;
M += `<rect x="0" y="${FLOOR}" width="1600" height="120" fill="${th.floor}"/>`;
for (let r = 0; r < 3; r++) for (let i = 0; i * 56 < 1600; i++) if ((i + r) % 2) M += `<rect x="${i*56}" y="${FLOOR + r*40}" width="56" height="40" fill="${C.pinkL}"/>`;
M += `<path d="M0 ${FLOOR}H1600" ${st(3)}/>`;
[[150, 120], [420, 160], [910, 190]].forEach(([x, w]) => M += `<rect x="${x}" y="660" width="${w}" height="11" rx="5" fill="${C.navy}" opacity=".85"/>`);
M += `<rect x="134" y="566" width="1356" height="84" fill="${K.steel}" ${st(3)}/>`;
for (let x = 140; x + 108 < 1490; x += 112) M += `<rect x="${x+4}" y="574" width="104" height="60" rx="3" fill="none" ${st(1.8)}/><rect x="${x+42}" y="580" width="28" height="5" rx="2.5" fill="${K.steelD}" ${st(1.5)}/>`;
M += `<rect x="134" y="638" width="1356" height="12" fill="${C.pinkD}" ${st(2.5)}/>
<rect x="128" y="546" width="1368" height="20" rx="4" fill="${K.steelL}" ${st(3)}/><path d="M136 552H1488" stroke="#fff" stroke-width="2.5"/>`;

/* ---------- stations (hardware) ---------- */
M += `<rect x="148" y="330" width="166" height="8" rx="2" fill="${K.steel}" ${st(2.5)}/><path d="M160 338l10 14M302 338l-10 14" ${st(2)}/>`;
M += `<rect x="156" y="538" width="156" height="12" rx="4" fill="${K.wood}" ${st(2.5)}/><path d="M164 544h140" stroke="${K.woodD}" stroke-width="1.5"/>`;
[250, 266, 282].forEach(x => M += `<ellipse cx="${x}" cy="535" rx="7" ry="3.5" fill="#e0554a" ${st(1.8)}/>`);
M += `<rect x="334" y="336" width="132" height="216" rx="8" fill="#ece6df" ${st(3)}/>
<rect x="334" y="336" width="132" height="24" rx="7" fill="${C.pinkD}" ${st(3)}/>
<circle cx="350" cy="348" r="6" fill="#fff" ${st(2)}/><path d="M350 348l3-4" ${st(1.8)}/>
<circle cx="368" cy="348" r="6" fill="#fff" ${st(2)}/><path d="M368 348l-4-2" ${st(1.8)}/>
<rect x="394" y="341" width="62" height="14" rx="3" fill="#2b2a2e" ${st(2)}/>
<rect x="420" y="328" width="30" height="8" rx="2" fill="${K.steelD}" ${st(2)}/>`;
[368, 456].forEach(y => M += `<rect x="344" y="${y}" width="112" height="80" rx="5" fill="${K.steel}" ${st(2.5)}/>
<rect x="360" y="${y+5}" width="80" height="6" rx="3" fill="${K.steelD}" ${st(2)}/>
<rect class="k-ovenwin" x="352" y="${y+16}" width="96" height="54" rx="4" fill="url(#k-cold)" ${st(2.2)}/>
<path d="M356 ${y+62}H444" ${st(2)}/>`);
M += `<rect x="488" y="452" width="114" height="100" rx="6" fill="${K.steel}" ${st(3)}/>
<rect x="496" y="452" width="98" height="12" fill="${K.oil}" ${st(2.5)}/>
<path d="M514 458L494 412l12-4" fill="none" ${st(4.5)}/>
<rect x="566" y="392" width="14" height="6" fill="${K.steelD}" ${st(1.8)}/><path d="M573 398V414" ${st(2.5)}/>
<rect x="556" y="414" width="34" height="26" rx="3" fill="none" ${st(2.2)}/>
<path d="M556 422h34M556 430h34M564 414v26M573 414v26M582 414v26" ${st(1.2)} opacity=".6"/>
<circle cx="514" cy="496" r="11" fill="#fff" ${st(2.5)}/><path d="M514 496l6-5" ${st(2)}/>
<circle cx="578" cy="496" r="7" fill="${C.navy}" ${st(2)}/>
<path d="M534 532h22l-11-18z" fill="${C.mustard}" ${st(2)}/><path d="M545 520v5" ${st(2)}/><circle cx="545" cy="528" r="1.2" fill="${I}"/>`;
M += `<rect x="620" y="500" width="170" height="52" rx="6" fill="${K.steelD}" ${st(3)}/>
<rect x="626" y="488" width="158" height="14" rx="3" fill="#3a3a3e" ${st(2)}/>`;
for (let i = 0; i < 4; i++){ const x = 628 + i * 39;
  M += `<path d="M${x} 490V472Q${x} 462 ${x+8} 462H${x+28}Q${x+36} 462 ${x+36} 472V490Z" fill="${K.steel}" ${st(2.5)}/><rect x="${x+10}" y="452" width="16" height="8" rx="3" fill="#2b2a2e" ${st(1.8)}/><path d="M${x+18} 460v3" ${st(2)}/>`; }
M += `<circle cx="705" cy="526" r="11" fill="#fff" ${st(2.5)}/><path d="M705 526l-6-6" ${st(2)}/>`;
M += `<rect x="822" y="392" width="216" height="9" rx="3" fill="${K.steel}" ${st(2.5)}/>`;
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
M += `<path d="M1040 470Q1060 480 1056 506" fill="none" ${st(4)}/>
<path d="M1046 504h20l-2.5 18q-1 4-4 4h-7q-3 0-4-4z" fill="${K.steelL}" ${st(2.5)}/><path d="M1066 508q7 2 3 11" fill="none" ${st(2.2)}/>`;
// grinder (hopper fill is live: #k-hopper)
M += `<path d="M1064 336H1126L1110 412H1080Z" fill="${K.glass}" fill-opacity=".7" ${st(3)}/>`;
const GRINDER_FRONT = `<path d="M1064 336H1126L1110 412H1080Z" fill="none" ${st(3)}/>
<rect x="1060" y="326" width="70" height="12" rx="4" fill="${C.navy}" ${st(2.5)}/>
<path d="M1122 350h6M1119 365h8M1116 380h6M1113 395h6" ${st(1.6)}/>
<rect x="1072" y="412" width="46" height="26" rx="4" fill="#2b2f3a" ${st(2.5)}/>
<rect x="1076" y="436" width="38" height="116" rx="6" fill="${C.navy}" ${st(3)}/>
<circle cx="1095" cy="456" r="9" fill="${C.pink}" ${st(2)}/><path d="M1095 456l4-6" ${st(2)}/>
<path d="M1088 474h14v10h-14z" fill="#2b2f3a" ${st(2)}/>
<rect x="1080" y="500" width="30" height="8" rx="2" fill="${K.steelD}" ${st(2)}/>
<rect x="1070" y="540" width="50" height="12" rx="3" fill="#2b2f3a" ${st(2.5)}/>`;
M += `<path d="M1150 424H1200L1194 512H1156Z" fill="${K.glass}" fill-opacity=".6" ${st(3)}/>
<path d="M1152 452H1198L1194 512H1156Z" fill="#f4a7b9"/>
<path d="M1150 424H1200L1194 512H1156Z" fill="none" ${st(3)}/>
<path d="M1200 438q16 4 10 34l-10 4" fill="none" ${st(3)}/>
<rect x="1146" y="414" width="58" height="12" rx="4" fill="${C.navy}" ${st(2.5)}/><rect x="1168" y="406" width="14" height="9" rx="3" fill="${C.navy}" ${st(2)}/>
<path d="M1162 506l13-6l13 6" fill="none" ${st(2)}/>
<path d="M1146 552L1152 512H1198L1204 552Z" fill="${C.pink}" ${st(3)}/>
<circle cx="1163" cy="534" r="4" fill="#fff" ${st(1.5)}/><circle cx="1187" cy="534" r="4" fill="${C.pinkD}" ${st(1.5)}/>`;
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
<path d="${carafe}" fill="${K.glass}" ${st(3)}/>`;
const CARAFE_FRONT = `<path d="${carafe}" fill="none" ${st(3)}/><path d="M1284 520h8M1286 532h6" ${st(1.6)}/>`;
M += `<rect x="1322" y="322" width="150" height="8" rx="2" fill="${K.steel}" ${st(2.5)}/><path d="M1334 330l8 12M1460 330l-8 12" ${st(2)}/>`;
M += `<rect x="1328" y="546" width="78" height="8" rx="2" fill="#9fc6d9" ${st(2)}/>`;
M += `<path d="M1402 548V474Q1402 456 1388 456Q1376 456 1376 470" fill="none" ${st(5)}/><path d="M1402 548V474Q1402 456 1388 456Q1376 456 1376 470" fill="none" stroke="${K.steelL}" stroke-width="2"/>
<rect x="1396" y="520" width="14" height="6" rx="2" fill="${K.steelD}" ${st(1.8)}/>
<rect x="1410" y="420" width="62" height="132" rx="6" fill="${K.steel}" ${st(3)}/>
<rect x="1414" y="428" width="54" height="8" rx="3" fill="${K.steelD}" ${st(2)}/>
<rect x="1418" y="446" width="46" height="60" rx="4" fill="#cfe7f5" ${st(2.2)}/>
<path d="M1424 470h34M1424 486h34" ${st(1.4)} opacity=".5"/>
<circle cx="1458" cy="520" r="4" fill="${C.sage}" ${st(1.5)}/>
<rect x="1406" y="540" width="70" height="12" rx="2" fill="${K.steelD}" ${st(2.2)}/>`;

/* ---------- where things are ---------- */
const STATION_X = {register: 86, display: 180, prep: 232, oven: 400, fryer: 545, stove: 560, press: 705, griddle: 690, espresso: 930,
                   bar: 1012, grinder: 1095, blender: 1175, cold: 1266, dishpit: 1405, pass: 640};
const MACHINE = {prep: [230, 500, 150], oven: [400, 430, 120], fryer: [545, 490, 110], stove: [545, 490, 110], press: [705, 500, 190],
                 griddle: [705, 500, 190], espresso: [930, 466, 220], bar: [1010, 470, 80], grinder: [1095, 440, 70], blender: [1175, 470, 64],
                 cold: [1266, 420, 84], dishpit: [1432, 480, 74], pass: [640, 560, 160]};
const LABEL = {prep: 'prep', oven: 'oven', fryer: 'fryer', stove: 'stove', press: 'panini press', griddle: 'waffle iron', espresso: 'espresso',
               bar: 'bar', grinder: 'grind', blender: 'blend', cold: 'tower', dishpit: 'dish pit', pass: 'the pass', display: 'pastry fridge', register: 'register'};
const ICON = {prep: 'k-avo', oven: 'k-oven', fryer: 'k-fries', stove: 'k-pot', press: 'k-panini', griddle: 'k-waffle', espresso: 'k-espresso',
              bar: 'k-cup', grinder: 'k-grinder', blender: 'k-smoothie', cold: 'coldbrew', dishpit: 'k-dirty', pass: 'k-cup', display: 'cake', register: 'k-cup'};

/* ---------- machine motion (only while that station is busy) ---------- */
const steam = (x, y, d = 0) => `<path class="k-steam" style="animation-delay:${d}s" d="M${x} ${y}q-5-7 0-14q5-7 0-14" fill="none" ${st(2)} opacity=".45"/>`;
const FX = {
  oven: `<rect class="k-glow" x="352" y="384" width="96" height="54" rx="4" fill="#ffd27a" opacity=".2"/><rect class="k-glow" style="animation-delay:-1.4s" x="352" y="472" width="96" height="54" rx="4" fill="#ffd27a" opacity=".2"/>`
    + `<rect x="352" y="384" width="96" height="54" rx="4" fill="url(#k-fire)" opacity=".85"/><rect x="352" y="472" width="96" height="54" rx="4" fill="url(#k-fire)" opacity=".85"/>`
    + [358, 386, 414].map((x, i) => `<g class="k-rise" style="animation-delay:${-i*.5}s">${use('croissant', x, 403, 30)}</g>`).join('') + steam(440, 326, -.5),
  fryer: Array.from({length: 8}, (_, i) => `<circle class="k-bub" style="animation-delay:${(-(i * .37) % 1.1).toFixed(2)}s" cx="${502 + i*12}" cy="458" r="${2.5 + (i % 3)}" fill="#fff6d8" ${st(1.2)}/>`).join('') + steam(530, 446, -.4) + steam(558, 446, -1.6) + steam(584, 444, -.9),
  press: [640, 682, 724].map((x) => use('k-panini', x, 468, 28)).join('') + steam(690, 450, -.3) + steam(740, 446, -1.1),
  griddle: steam(660, 448, -.6),
  stove: steam(520, 440, -.2),
  espresso: [868, 930, 992].map((gx, i) => `<path class="k-pour" d="M${gx} 497V514" stroke="${K.brew}" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="5 4" style="animation-delay:${-i*.2}s"/>`).join('') + steam(1058, 500) + steam(1066, 494, -1.2),
  blender: `<path class="k-swirl" d="M1175 470c14 0 16 14 0 16c-12 1-14-10-3-11c8-1 9 6 2 6" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="6 5" opacity=".9"/><path class="k-swirl" style="animation-delay:-.2s" d="M1160 492c10 6 22 6 30 0" fill="none" stroke="#e07e8f" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="6 5"/>`,
  cold: `<circle class="k-drip" cx="1266" cy="333" r="2.4" fill="#9fc6d9"/><circle class="k-drip" style="animation-delay:-.8s" cx="1266" cy="467" r="2.6" fill="${K.brew}"/>`,
  dishpit: `<path class="k-water" d="M1376 472V544" stroke="#9fd0e8" stroke-width="4" stroke-linecap="round" stroke-dasharray="7 5"/><g class="k-whoosh"><path d="M1478 452q9 10 0 20M1486 446q13 16 0 32" fill="none" ${st(2)} opacity=".7"/></g>` + steam(1440, 418, -.8),
  prep: `<g transform="translate(308 528)"><g class="k-chop"><path d="M-24 -5L-68 -2Q-72 4-66 7L-24 5Z" fill="#e9edf0" ${st(2)}/><rect x="-24" y="-5" width="24" height="10" rx="4" fill="${C.navy}" ${st(2)}/></g></g>`,
  grinder: `<g class="k-whoosh"><path d="M1124 470q8 8 0 16" fill="none" ${st(2)}/></g>`,
};
let FXL = '';
for (const k in FX) FXL += `<g id="k-fx-${k}" style="display:none">${FX[k]}</g>`;

/* ---------- floor props + the pass (live bits in #k-pass) ---------- */
let P = `<ellipse cx="720" cy="714" rx="24" ry="5" fill="${K.steelD}" ${st(2)}/><path d="M704 714h32M712 711v6M720 710v8M728 711v6" ${st(1.2)}/>`;
P += `<rect x="0" y="790" width="1600" height="210" fill="${K.steel}"/>`;
for (let yy = 818; yy < 975; yy += 16) P += `<path d="M0 ${yy}H1600" stroke="#fff" stroke-width="1.5" opacity=".55"/>`;
for (let x = 40; x < 1600; x += 160) P += `<circle cx="${x}" cy="812" r="3" fill="${K.steelD}" ${st(1.4)}/>`;
P += `<rect x="-5" y="975" width="1610" height="30" fill="${C.pinkD}" ${st(3)}/>
<rect x="0" y="800" width="1600" height="9" fill="${th.lip}"/>
<path d="M-10 762H1610V800H-10Z" fill="${K.steelL}" ${st(3)}/><path d="M0 770H1600" stroke="#fff" stroke-width="2.5"/>`;
P += `<ellipse cx="626" cy="760" rx="16" ry="4" fill="${K.steelD}" ${st(2)}/><path d="M626 758V690" ${st(2.5)}/>`;
P += `<path d="M1470 762l10-28h12l10 28z" fill="${K.steelD}" ${st(2.5)}/>
<rect x="1400" y="660" width="172" height="78" rx="10" fill="${C.navy}" ${st(3)}/><rect x="1408" y="668" width="156" height="62" rx="6" fill="#fdf6ee" ${st(2)}/>`;
const BELL = `<ellipse cx="548" cy="762" rx="30" ry="6" fill="#ddd" ${st(2.5)}/>
<g id="k-bell" class="l-bell"><path d="M522 759Q522 726 548 726Q574 726 574 759Z" fill="${C.mustard}" ${st(3)}/><rect x="543" y="716" width="10" height="10" rx="2" fill="${I}"/><path d="M532 744q4-7 11-8" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/></g>
<g id="k-ding" class="l-ding"><path d="M584 722l12-8M588 736l14-2M512 722l-12-8" ${st(2.2)}/></g>`;

/* ---------- assemble ---------- */
const g = (id, extra = '') => `<g id="${id}" ${extra}></g>`;
document.getElementById('kitchen-scene').innerHTML = DEFS
  + `<g filter="url(#wob)"><rect x="1490" y="292" width="106" height="360" fill="url(#k-out)" ${st(3)}/></g>` + g('k-outside')
  + `<g filter="url(#wob)">${M}</g>` + g('k-hopper') + g('k-brewlvl') + `<g filter="url(#wob)">${GRINDER_FRONT}${CARAFE_FRONT}${BACKDOOR}</g>`
  + g('k-dishes', 'filter="url(#wob)"') + `<g id="k-fx">${FXL}</g>` + g('k-broken') + g('k-crew') + g('k-tech')
  + `<g filter="url(#wob)">${P}</g>` + g('k-pass', 'filter="url(#wob)"') + `<g filter="url(#wob)">${BELL}</g>` + g('k-passtxt')
  + g('k-cards') + g('k-labels') + g('k-dark')
  + `<rect width="1600" height="1000" filter="url(#grain)" opacity=".22" pointer-events="none"/>`;
$('k-labels').innerHTML = gt(73, 277, '← lobby', 17, `text-anchor="middle" fill="${C.pinkD}"`) + gt(1544, 276, 'staff break', 16, 'text-anchor="middle"')
  + gt(930, 451, 'brew', 15, 'text-anchor="middle" fill="#fff"') + t(1418, 686, 'queue', 13);

/* ================================================================ crew */
const ROLE_LOOK = {
  barista: (L, y) => ({back: L.hair === 'long' || L.hair === 'bun' ? `<circle cx="20" cy="${y-20}" r="10" fill="${L.hairCol}" ${st(2.5)}/>` : '',
    hat: `<path d="M-28 ${y+6}C-31 ${y-26} 31 ${y-26} 28 ${y+6}C20 ${y-6} -20 ${y-6} -28 ${y+6}Z" fill="${L.hairCol}" ${st(3)}/>
      <path d="M-29 ${y-6}C-27 ${y-36} 27 ${y-36} 29 ${y-6}C12 ${y-15} -12 ${y-15} -29 ${y-6}Z" fill="${L.cap}" ${st(2.8)}/>
      <circle cx="-12" cy="${y-22}" r="2" fill="#fff"/><circle cx="2" cy="${y-26}" r="2" fill="#fff"/><circle cx="15" cy="${y-21}" r="2" fill="#fff"/>
      <path d="M26 ${y-10}l14-8l-1 12z" fill="${L.cap}" ${st(2)}/>`}),
  cook: (L, y) => ({hat: `<path d="M-24 ${y-18}C-36 ${y-38} -22 ${y-60} -8 ${y-52}C-4 ${y-68} 16 ${y-68} 18 ${y-52}C32 ${y-60} 40 ${y-38} 24 ${y-18}Z" fill="#fff" ${st(3)}/>
      <rect x="-25" y="${y-24}" width="50" height="12" rx="3" fill="#fff" ${st(3)}/>` + (L.acc.includes('beard') ? '' : `<path d="M-9 ${y+11}q9-5 18 0q-9 3-18 0z" fill="${L.hairCol}"/>`)}),
  cashier: (L, y) => ({back: `<path d="M16 ${y-22}C40 ${y-22} 46 ${y+10} 38 ${y+42}C33 ${y+20} 30 ${y} 14 ${y-8}Z" fill="${L.hairCol}" ${st(2.5)}/>`,
    hat: shortHair(0, y, L.hairCol) + `<path d="M-28 ${y-6}C-30 ${y-38} 30 ${y-38} 28 ${y-6}C14 ${y-14} -14 ${y-14} -28 ${y-6}Z" fill="${C.pink}" ${st(3)}/>
      <path d="M27 ${y-9}L46 ${y-5}L44 ${y+2}L26 ${y-2}Z" fill="${C.pinkD}" ${st(2.5)}/>`}),
  dishwasher: (L, y) => ({hat: `<path d="M-27 ${y}L-30 ${y-18}L-20 ${y-16}L-22 ${y-32}L-8 ${y-24}L-2 ${y-38}L8 ${y-26}L20 ${y-34}L18 ${y-20}L30 ${y-20}L27 ${y}C16 ${y-14} -12 ${y-14} -27 ${y}Z" fill="${L.hairCol}" ${st(3)}/>
      <path d="M-28 ${y-8}Q0 ${y-18} 28 ${y-8}" fill="none" stroke="${C.sage}" stroke-width="6" stroke-linecap="round"/>`, apron: '#7fa9c6', chef: true}),
};
function staffLook(sf){
  const L = Doodle.look(R.hash(sf.id), sf.role === 'cook' ? 'regular' : 'remote_worker');
  L.cap = [C.pinkD, C.terra, C.sage, C.mustard][R.hash(sf.id + 'c') % 4];
  return L;
}
function body(o, walking){
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
function staffBody(sf, mood){
  const L = staffLook(sf), look = (ROLE_LOOK[sf.role] || ROLE_LOOK.barista)(L, HY);
  return body({...look, mouth: mood === 'tired' ? 'frown' : mood === 'happy' ? 'smile' : 'neutral', brow: mood === 'tired' ? 'worried' : null,
               blush: L.blush, ly: 2, lx: L.lx});
}
function restingBody(sf, kx, ky){
  const L = staffLook(sf), look = (ROLE_LOOK[sf.role] || ROLE_LOOK.barista)(L, ky);
  return `<rect x="${kx-36}" y="${ky+84}" width="72" height="44" rx="3" fill="${K.wood}" ${st(2.8)}/><path d="M${kx-36} ${ky+99}h72M${kx-36} ${ky+113}h72" ${st(1.6)}/>
  <g transform="translate(${kx} 0)">${look.back || ''}<path d="M-6 ${ky+26}L6 ${ky+26}C24 ${ky+30} 32 ${ky+40} 34 ${ky+60}L36 ${ky+90}L-36 ${ky+90}L-34 ${ky+60}C-32 ${ky+40} -24 ${ky+30} -6 ${ky+26}Z" fill="#fffdf9" ${st(3)}/>
  <path d="M-34 ${ky+70}H34L36 ${ky+90}H-36Z" fill="${look.apron || C.pink}" ${st(2.5)}/>
  <path d="M-14 ${ky+90}L-16 ${ky+126}M14 ${ky+90}L16 ${ky+126}" fill="none" ${st(3.2)}/>
  <ellipse cx="-20" cy="${ky+128}" rx="8" ry="4" fill="${I}"/><ellipse cx="20" cy="${ky+128}" rx="8" ry="4" fill="${I}"/>
  ${head(0, ky)}<path d="M-14 ${ky+3}q4 4 8 0M6 ${ky+3}q4 4 8 0" fill="none" ${st(2.5)}/>${mouth(0, ky, 'smile')}${blush(0, ky)}${look.hat || ''}
  ${arm(-28, ky+46, -42, ky+82, -10, ky+66)}${arm(28, ky+46, 42, ky+82, 10, ky+66)}${use('k-cup', -15, ky + 48, 30)}</g>`;
}
function meter(id, name, fat, y){
  return `<g><rect x="-50" y="${y}" width="100" height="31" rx="9" fill="#fffefb" ${st(2)}/>
  ${t(0, y + 15, esc(name.toLowerCase()), 13.5, 'text-anchor="middle"')}
  <rect x="-40" y="${y+20}" width="80" height="6" rx="3" fill="#eee" ${st(1.3)}/>
  <rect class="fat" x="-39.5" y="${y+20.5}" width="${(79*Math.min(1, fat)).toFixed(1)}" height="5" rx="2.5" fill="${fatCol(fat)}"/></g>`;
}
const BREAK_SPOTS = [[1544, 540], [1468, 540]];
const crewMemo = new Map();
const lCrew = R.layer($('k-crew'), {
  key: (it) => it.sf.id,
  sig: (it) => `${it.mode}|${it.mood}|${it.spot}|${it.sf.name}|${it.bubble}`,
  html: (it) => {
    if (it.mode === 'break') { const [kx, ky] = BREAK_SPOTS[it.spot] || BREAK_SPOTS[0];
      return `<g filter="url(#wob)">${restingBody(it.sf, kx, ky)}</g><g transform="translate(${kx} 0)">${meter(it.sf.id, it.sf.name, it.sf.fatigue || 0, ky - 104)}
        <rect x="-62" y="${ky-138}" width="124" height="26" rx="13" fill="${C.pinkL}" ${st(2)}/>${use('k-lock', -56, ky-136, 22)}<text class="brk" x="-30" y="${ky-120}" font-family="Patrick Hand" font-size="14.5" fill="${I}">break</text></g>
        ${[0, 1, 2].map(i => `<text class="k-z" style="animation-delay:${-i * .93}s" x="${kx + 30 + i*8}" y="${ky - 150 - i*10}" font-family="Gochi Hand" font-size="${16 + i*3}" fill="${C.pinkD}">z</text>`).join('')}`; }
    return `<g class="staff" data-staff="${esc(it.sf.id)}"><g class="bob"><g filter="url(#wob)">${staffBody(it.sf, it.mood)}</g>${meter(it.sf.id, it.sf.name, it.sf.fatigue || 0, HY - 104)}${it.bubble ? bubble(0, HY - 150, bubbleW(it.bubble), esc(it.bubble), C.terra) : ''}</g></g>`;
  },
  place: (r, it, isNew) => {
    if (it.mode === 'break') { r.el.style.transform = 'none'; r.el.style.transition = 'none'; return; }
    const prev = crewMemo.get(it.sf.id);
    if (isNew) R.moveTo(r.el, prev ?? (it.sf.role === 'dishwasher' ? 1560 : 60), 0, {instant: true});
    const from = R.xyOf(r.el)?.[0] ?? it.x, d = Math.abs(it.x - from);
    const ms = R.moveTo(r.el, it.x, 0, {dur: d / 115, ease: 'linear'});
    crewMemo.set(it.sf.id, it.x);
    const sg = r.el.querySelector('.staff');
    if (sg) { sg.classList.toggle('walking', ms > 0); clearTimeout(r.data.w); if (ms) r.data.w = setTimeout(() => sg.classList.remove('walking'), ms); }
    const fat = r.el.querySelector('.fat'); if (fat) { fat.setAttribute('width', (79 * Math.min(1, it.sf.fatigue || 0)).toFixed(1)); fat.setAttribute('fill', fatCol(it.sf.fatigue || 0)); }
  },
  exit: (r) => { r.el.style.transition = 'opacity .6s'; r.el.style.opacity = '0'; return 600; },
});
function tasksBy(s){ const by = {}; for (const tk of Object.values(s.tasks || {})) (by[tk.staff_id] = by[tk.staff_id] || []).push(tk); return by; }
function breakLeft(sf, t){ return sf.break_end_s ? Math.max(0, sf.break_end_s - t) : null; }
function renderCrew(s, t){
  const by = tasksBy(s), items = [];
  let spot = 0;
  const staff = Object.values(s.staff || {}).filter((sf) => sf.present && !sf.absent);
  staff.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const usedX = {};
  for (const sf of staff) {
    if (sf.on_break || sf.state === 'break') { items.push({sf, mode: 'break', spot: spot++ % 2, mood: 'happy'}); continue; }
    const tk = (by[sf.id] || []).sort((a, b) => (a.started_s || 0) - (b.started_s || 0))[0];
    const stn = tk?.station || sf.station || (sf.role === 'dishwasher' ? 'dishpit' : sf.role === 'cashier' ? 'pass' : sf.role === 'cook' ? 'prep' : 'espresso');
    let x = STATION_X[stn] ?? 640;
    if (!tk && s.stations?.[stn]?.status === 'down') x += (MACHINE[stn]?.[2] || 100) / 2 + 60;   // stand clear of a broken machine
    const n = usedX[stn] = (usedX[stn] || 0) + 1; if (n > 1) x += (n % 2 ? -1 : 1) * 46 * Math.ceil((n - 1) / 2);
    const due = sf.break_due_s != null ? sf.break_due_s - t : null;
    const bub = due != null && due > 0 && due < 900 ? `break due · ${Math.ceil(due / 60)} min` : (sf.fatigue || 0) > .85 ? 'need a breather…' : null;
    items.push({sf, mode: tk ? 'work' : 'idle', x, mood: (sf.fatigue || 0) > .75 ? 'tired' : tk ? 'neutral' : 'happy', bubble: bub});
  }
  lCrew.sync(items);
  for (const it of items) if (it.mode === 'break') { const r = lCrew.map.get(it.sf.id), b = r?.el.querySelector('.brk');
    const left = breakLeft(it.sf, t); if (b) b.textContent = left != null ? `break · ${R.mmss(left)}` : 'on break'; }
}

/* ================================================================ machines: motion, levels, breakdowns, tech */
function busyStations(s){ const b = {}; for (const tk of Object.values(s.tasks || {})) b[tk.station] = (b[tk.station] || 0) + 1; return b; }
let fxSig = '';
function renderFX(s){
  const busy = busyStations(s), down = new Set(Object.values(s.stations || {}).filter((x) => x.status === 'down').map((x) => x.station));
  const sig = Object.keys(FX).map((k) => (busy[k] && !down.has(k)) ? 1 : 0).join('');
  if (sig === fxSig) return; fxSig = sig;
  Object.keys(FX).forEach((k, i) => { const el = $('k-fx-' + k); if (el) el.style.display = sig[i] === '1' ? '' : 'none'; });
  document.querySelectorAll('#kitchen-scene .k-ovenwin').forEach((w) => w.setAttribute('fill', busy.oven && !down.has('oven') ? 'url(#k-fire)' : 'url(#k-cold)'));
}
let lvlSig = '';
function renderLevels(s){
  const inv = s.inventory || {}, beans = inv.coffee_beans, cb = inv.coldbrew_concentrate;
  const bf = beans ? Math.max(0, Math.min(1, beans.on_hand / Math.max(1, (beans.par || 14000)))) : .6;
  const cf = cb ? Math.max(0, Math.min(1, cb.on_hand / 6000)) : .7;
  const dish = s.stations?.dishpit?.queue ?? 0;
  const sig = `${bf.toFixed(2)}|${cf.toFixed(2)}|${Math.min(9, dish)}`;
  if (sig === lvlSig) return; lvlSig = sig;
  const top = 412 - 70 * bf;
  let h = `<path d="M${1064 + (412 - top) * 0} ${top}H${1126 - (top - 336) * .2}L1110 412H1080Z" fill="#7a4a2e" opacity="${bf > .02 ? 1 : 0}"/>`;
  if (bf > .15) h += [[1082, 400], [1096, 396], [1108, 402], [1090, 406]].map(([x, y]) => `<ellipse cx="${x}" cy="${Math.max(top + 6, y)}" rx="4" ry="2.6" fill="#a0663e" ${st(1)}/>`).join('');
  $('k-hopper').innerHTML = `<g filter="url(#wob)">${h}</g>`;
  const ly = 552 - 46 * cf;
  $('k-brewlvl').innerHTML = cf > .02 ? `<path d="M1240 ${ly}q0 ${(552 - ly) * .8} 26 ${552 - ly - 4}q26 0 26 -${(552 - ly - 4).toFixed(0)}z" fill="${K.brew}" transform="translate(0 0)"/>` : '';
  let d = '';
  for (let i = 0; i < Math.min(9, dish); i++) d += `<use href="#k-stack" x="${1330 + i*1.6}" y="${528 - i*12}" width="30" height="22.5"/>`;
  [1328, 1352].forEach((x) => { for (let i = 0; i < 3; i++) d += use('k-cup', x, 299 - i * 8, 24); });
  $('k-dishes').innerHTML = d;
}
let brkSig = '';
function renderBroken(s, t){
  const downs = Object.values(s.stations || {}).filter((x) => x.status === 'down' && MACHINE[x.station]);
  const power = Object.values(s.disruptions || {}).some((d) => d.active && d.kind === 'power_cut');
  const sig = downs.map((x) => x.station + Math.round((x.down_until_s || 0) / 60)).join() + '|' + power;
  if (sig !== brkSig) {
    brkSig = sig;
    let h = '';
    for (const x of downs) {
      const [cx, cy, w] = MACHINE[x.station];
      h += `<g data-broken="${x.station}"><g filter="url(#wob)"><rect x="${cx - w/2 - 10}" y="${cy - 8}" width="${w + 20}" height="16" fill="url(#k-haz)" ${st(2)} transform="rotate(-11 ${cx} ${cy})"/>
        <rect x="${cx - w/2 - 10}" y="${cy + 18}" width="${w + 20}" height="16" fill="url(#k-haz)" ${st(2)} transform="rotate(9 ${cx} ${cy + 26})"/></g>`
        + [[cx - 25, cy - 18, 1], [cx + 30, cy - 8, .8], [cx + 5, cy - 28, .6]].map(([x2, y2, sc], i) => `<g transform="translate(${x2} ${y2}) scale(${sc})"><path class="k-spark" style="animation-delay:${-i*.3}s" d="M0 -12L3 -3L12 0L3 3L0 12L-3 3L-12 0L-3 -3Z" fill="${K.haz}" ${st(1.8)}/></g>`).join('')
        + [0, 1, 2].map((i) => `<circle class="k-smoke" style="animation-delay:${-i}s" cx="${cx + i*8}" cy="${cy - 22}" r="10" fill="#9aa0a6" opacity=".4"/>`).join('')
        + `<g transform="rotate(-5 ${cx} ${cy})"><g class="k-sign"><g filter="url(#wob)"><rect x="${cx - 64}" y="${cy - 34}" width="128" height="48" rx="4" fill="#f3e2c8" ${st(2.8)}/>
          <rect x="${cx - 70}" y="${cy - 40}" width="24" height="10" fill="${K.haz}" opacity=".85" transform="rotate(-30 ${cx - 58} ${cy - 35})"/><rect x="${cx + 46}" y="${cy - 40}" width="24" height="10" fill="${K.haz}" opacity=".85" transform="rotate(30 ${cx + 58} ${cy - 35})"/></g>
          ${gt(cx, cy - 11, 'OUT OF ORDER', 18, `text-anchor="middle" fill="${C.terra}"`)}<text class="eta" x="${cx}" y="${cy + 7}" text-anchor="middle" font-family="Patrick Hand" font-size="11.5" fill="${I}"></text></g></g></g>`;
    }
    $('k-broken').innerHTML = h;
    $('k-dark').innerHTML = power ? `<rect width="1600" height="790" fill="#1d1a1c" opacity=".38" pointer-events="none"/>${gt(800, 300, 'power cut · running on the backup line', 26, `text-anchor="middle" fill="#fff6d8"`)}` : '';
  }
  for (const el of document.querySelectorAll('#k-broken [data-broken] .eta')) {
    const x = s.stations?.[el.closest('[data-broken]').dataset.broken];
    if (x?.down_until_s) el.textContent = `back ~${R.hm(x.down_until_s)} · ${R.mmss(Math.max(0, x.down_until_s - t))}`;
  }
  renderTech(s, t, downs);
}
/* The sim models an outage as down-until; the technician walks in for the last third of it and fixes the machine. */
let techSig = '';
function renderTech(s, t, downs){
  const dis = Object.values(s.disruptions || {}).filter((d) => d.active);
  const job = downs.find((x) => { const d = dis.find((q) => q.target && (q.target === x.station || String(q.target).includes(x.station) || x.station === stationOf(q.target)));
    const start = d?.started_s ?? (x.down_until_s - 1800); return t > start + .66 * (x.down_until_s - start); });
  const sig = job ? job.station : '';
  if (sig === techSig) return; techSig = sig;
  const el = $('k-tech');
  if (!job) { if (el.firstElementChild) { const gEl = el.firstElementChild; gEl.classList.add('walking'); R.moveTo(gEl, 1680, 0, {dur: 2.2, ease: 'linear'}); setTimeout(() => { if (!techSig) el.innerHTML = ''; }, 2300); } return; }
  const TECH = {coat: '#4a5d7e', chef: false, mouth: 'smile', lx: -4,
    mid: `<path d="M-24 ${HY+62}H24V${HY+125}H-24Z" fill="#5b6f93" ${st(2)}/><path d="M-22 ${HY+62}L-24 ${HY+30}M22 ${HY+62}L24 ${HY+30}" stroke="${C.mustard}" stroke-width="4" stroke-linecap="round"/>`,
    hat: `<path d="M-28 ${HY-2}C-30 ${HY-36} 30 ${HY-36} 28 ${HY-2}C14 ${HY-10} -14 ${HY-10} -28 ${HY-2}Z" fill="${C.mustard}" ${st(3)}/><path d="M-27 ${HY-5}L-48 ${HY-1}L-45 ${HY+5}L-25 ${HY+1}Z" fill="${C.mustard}" ${st(2.5)}/>`,
    walk: arm(-28, HY+46, -40, HY+92, -34, HY+116) + arm(28, HY+46, 40, HY+92, 36, HY+112) + `<path d="M30 ${HY+114}v-7h16v7" fill="none" ${st(2.5)}/><rect x="20" y="${HY+113}" width="36" height="22" rx="3" fill="${K.red}" ${st(2.5)}/>`,
    work: arm(-28, HY+46, -50, HY+92, -22, HY+76) + arm(28, HY+46, 50, HY+92, 24, HY+72)};
  const [cx] = MACHINE[job.station];
  el.innerHTML = `<g class="staff walking"><g class="bob"><g filter="url(#wob)">${body(TECH)}</g>${plate(0, HY - 104, 'technician', null)}${bubble(0, HY - 150, 140, `here for the ${LABEL[job.station]}`, I)}</g>
    <g transform="translate(40 ${HY + 20})"><g class="k-turn">${use('k-wrench', -15, -15, 30)}</g></g></g>`;
  const gEl = el.firstElementChild;
  R.moveTo(gEl, 1680, 0, {instant: true}); void gEl.getBoundingClientRect();
  const ms = R.moveTo(gEl, cx + 70, 0, {dur: Math.abs(1680 - cx) / 115, ease: 'linear'});
  setTimeout(() => gEl.classList.remove('walking'), ms);
}
const stationOf = (equip) => ({espresso_machine: 'espresso', panini_press: 'press', waffle_iron: 'griddle', cold_tower: 'cold', dishwasher_machine: 'dishpit', pastry_fridge: 'display', bar_station: 'bar', prep_board: 'prep'}[equip] || equip);

/* ================================================================ outside the back door: the weather */
let outSig = '';
function renderOutside(s){
  const w = s.weather || {}, rain = (w.rain_mm_h || 0) > .1, sig = `${w.state}|${rain}`;
  if (sig === outSig) return; outSig = sig;
  let k = `<path d="M1540 330q8-12 20-6q8-10 20 0q10 0 8 10h-44q-6 0-4-4z" fill="${rain ? '#dfe3e8' : '#fff'}" ${st(2)}/><path d="M1490 604q20-24 40-6q16-22 36-4q14-14 30 0V652H1490Z" fill="#b9cdb0" ${st(2.5)}/>`;
  if (rain) for (let i = 0; i < 14; i++) k += `<path class="l-rainy" style="animation-delay:${(-(i % 5) * .12).toFixed(2)}s" d="M${1498 + (i * 37) % 90} ${300 + (i * 61) % 300}l-5 14" stroke="#7fa9c6" stroke-width="2" stroke-linecap="round"/>`;
  $('k-outside').innerHTML = `<g filter="url(#wob)">${k}</g>`;
}

/* ================================================================ station cards (hanging over the line) */
const pill = (xr, yy, label, fill, tc = '#fff') => { const w = String(label).length * 6.6 + 16;
  return `<rect x="${xr - w}" y="${yy}" width="${w}" height="19" rx="9.5" fill="${fill}" ${st(1.8)}/><text x="${xr - w/2}" y="${yy + 14}" text-anchor="middle" font-family="Patrick Hand" font-size="12.5" fill="${tc}">${esc(label)}</text>`; };
const oc = (x, yy, label, ch, w) => `<rect x="${x}" y="${yy}" width="${w}" height="17" rx="8.5" fill="${ch === 'prep' ? C.sage : chan(ch).col}" ${st(1.6)}/><text x="${x + w/2}" y="${yy + 12.5}" text-anchor="middle" font-family="Patrick Hand" font-size="11.5" fill="#fff">${esc(label)}</text>`;
const ring = (cx, cy, r, p, col) => { const c = 2 * Math.PI * r;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff" stroke="#e6e0d8" stroke-width="4"/><circle class="ring" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${col}" stroke-width="4" stroke-dasharray="${(c*Math.max(0, Math.min(1, p))).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/><circle cx="${cx}" cy="${cy}" r="${r+2}" fill="none" ${st(1.4)}/>`; };
function card(cx, top, w, h, inner, o = {}){
  const x = cx - w / 2, hook = o.hook ?? 98;
  return `<path d="M${cx} ${hook}V${top}" ${st(1.8)}/><g ${o.id ? `id="${o.id}"` : ''} transform="translate(${x} ${top}) rotate(${o.rot || 0} ${w/2} 0)">
  <rect x="3" y="4" width="${w}" height="${h}" rx="7" fill="${I}" opacity=".14"/>
  <rect width="${w}" height="${h}" rx="7" fill="#fffefb" stroke="${o.alert ? C.terra : I}" stroke-width="${o.alert ? 3.2 : 2.5}"/>
  <rect x="${w/2 - 7}" y="-9" width="14" height="20" rx="4" fill="#e0b98a" ${st(2)}/><circle cx="${w/2}" cy="1" r="2" fill="${I}"/>${inner}</g>`;
}
const CARDS = {
  prep:     {cx: 230, top: 104, w: 172, h: 130, rot: -1.5},
  oven:     {cx: 400, top: 104, w: 152, h: 146, rot: 1},
  fryer:    {cx: 545, top: 232, w: 118, h: 104, rot: -1, hook: 222, also: ['stove']},
  press:    {cx: 705, top: 232, w: 172, h: 108, rot: 2, hook: 222, also: ['griddle']},
  espresso: {cx: 930, top: 104, w: 240, h: 152, rot: -.8, also: ['bar']},
  grinder:  {cx: 1095, top: 104, w: 76, h: 96, rot: 1.5},
  blender:  {cx: 1176, top: 130, w: 78, h: 110, rot: -2},
  cold:     {cx: 1265, top: 104, w: 82, h: 100, rot: 1},
  dishpit:  {cx: 1395, top: 104, w: 152, h: 124, rot: -1},
};
const utilPill = (stn) => stn?.status === 'down' ? ['DOWN', C.terra] : stn?.util == null ? null : stn.util >= .85 ? [`${Math.round(stn.util * 100)}% busy`, C.terra] : stn.util >= .5 ? [`${Math.round(stn.util * 100)}% busy`, C.mustard] : [stn.util > .02 ? `${Math.round(stn.util * 100)}%` : 'idle', C.sage];
function taskSkus(s, tasks){ const n = {}; for (const tk of tasks) { const o = s.orders?.[tk.order_no]; const sku = o?.items?.[0]?.sku; if (sku) n[sku] = (n[sku] || 0) + 1; } return Object.entries(n).sort((a, b) => b[1] - a[1]); }
function chipsRow(s, tasks, x0, y, w, max){
  const ons = [...new Set(tasks.map((tk) => tk.order_no).filter((n) => n != null))].slice(0, max);
  const cw = Math.min(54, (w - 8 * (ons.length - 1)) / Math.max(1, ons.length));
  let h = ons.map((n, i) => oc(x0 + i * (cw + 6), y, '#' + n, s.orders?.[n]?.channel || 'dine_in', cw)).join('');
  if (!ons.length && tasks.length) h += oc(x0, y, tasks[0].step, 'prep', Math.min(w, tasks[0].step.length * 7 + 18));
  return h;
}
function soonest(tasks, t){ let best = null; for (const tk of tasks) { const left = (tk.started_s ?? t) + (tk.est_s || 0) - t; if (!best || left < best.left) best = {left, p: Math.min(1, Math.max(0, (t - (tk.started_s ?? t)) / Math.max(1, tk.est_s || 1))), tk}; } return best; }
function cardInner(key, s, now){
  const spec = CARDS[key], w = spec.w, keys = [key, ...(spec.also || [])];
  const tasks = Object.values(s.tasks || {}).filter((tk) => keys.includes(tk.station));
  const stn = s.stations?.[key], down = keys.some((k) => s.stations?.[k]?.status === 'down');
  const up = utilPill(stn), sk = taskSkus(s, tasks), soon = soonest(tasks, now);
  const inv = s.inventory || {};
  let h = '';
  if (w < 90) {   // the narrow cards: grinder, blender, tower
    if (key === 'grinder') { const b = inv.coffee_beans, kg = b ? b.on_hand / 1000 : null, cov = b?.days_of_cover;
      h = use('k-bean', 6, 4, 22) + gt(30, 22, 'grind', 15) + gt(38, 50, kg != null ? `${kg.toFixed(1)} kg` : '—', 19, 'text-anchor="middle"')
        + t(38, 67, cov != null ? (cov < 1 ? `~${Math.round(cov * 24)} h left` : `${cov.toFixed(1)} d left`) : (tasks.length ? `grinding ×${tasks.length}` : 'beans'), 12, 'text-anchor="middle"')
        + `<rect x="8" y="76" width="60" height="9" rx="4.5" fill="#fff" ${st(1.6)}/><rect x="8.5" y="76.5" width="${(59 * Math.min(1, b ? b.on_hand / Math.max(1, b.par || 14000) : 0)).toFixed(1)}" height="8" rx="4" fill="#7a4a2e"/>`; }
    else if (key === 'blender') { h = use('k-smoothie', 4, 4, 22) + gt(28, 22, 'blend', 15) + (up ? pill(74, 30, up[0], up[1]) : '')
        + (tasks.length ? sk.slice(0, 1).map(([k2, n]) => use(skuIcon(k2), 6, 54, 26) + gt(36, 74, '×' + n, 16)).join('') + chipsRow(s, tasks, 4, 86, 70, 2)
                        : t(39, 76, down ? 'down' : 'idle', 13, 'text-anchor="middle" opacity=".6"')); }
    else { const c = inv.coldbrew_concentrate, L = c ? c.on_hand / 1000 : null;
      h = use('coldbrew', 2, 2, 26) + gt(30, 22, 'tower', 15)
        + `<rect x="8" y="32" width="66" height="10" rx="5" fill="#fff" ${st(1.6)}/><rect x="8.5" y="32.5" width="${(65 * Math.min(1, (L || 0) / 6)).toFixed(1)}" height="9" rx="4.5" fill="${K.brew}"/>`
        + t(41, 58, L != null ? `${L.toFixed(1)} / 6 L` : '— L', 12.5, 'text-anchor="middle"')
        + t(41, 74, s.prep?.coldbrew_concentrate?.state === 'cooking' ? 'steeping ⟳' : tasks.length ? `pouring ×${tasks.length}` : 'ready', 12, 'text-anchor="middle"')
        + t(41, 90, L != null ? `≈ ${Math.floor(L * 1000 / 150)} pours` : '', 12, 'text-anchor="middle" opacity=".65"'); }
    return h;
  }
  h += gt(10, 24, LABEL[key], key === 'press' || key === 'dishpit' ? 16 : 17);
  if (down) { const d = Object.values(s.disruptions || {}).find((q) => q.active && keys.includes(stationOf(q.target)));
    const until = keys.map((k) => s.stations?.[k]?.down_until_s).find(Boolean);
    return h + pill(w - 8, 9, 'DOWN', C.terra) + use('k-bolt', 8, 30, 22) + t(34, 46, `since ${R.hm(d?.started_s ?? now)} · fix ~${R.mmss(Math.max(0, (until || now) - now))}`, 12.5)
      + use('k-wrench', 8, 54, 22) + t(34, 70, until ? `back ~${R.hm(until)}` : 'tech called', 12.5)
      + t(10, 92, tasks.length ? `${tasks.length} stuck · rerouting` : 'orders rerouted', 12, `fill="${C.terra}"`); }
  if (up) h += pill(w - 8, 9, up[0], up[1]);
  if (!tasks.length) {
    const prepIn = Object.values(s.prep || {}).filter((p) => p.state === 'cooking' && (key === 'prep' || (key === 'oven' && /croissant/.test(p.prep_key))));
    h += prepIn.length ? use(ICON[key], 10, 34, 34) + t(52, 56, `${R.human(prepIn[0].prep_key)} ×${Math.round(prepIn[0].qty)}`, 13)
       : t(w / 2, 62, s.clock?.is_open ? 'idle · ready' : 'cleaned down', 14, `text-anchor="middle" opacity=".55"`);
    if (key === 'oven') { const cro = s.fridge?.croissant?.qty; if (cro != null) h += t(10, h.length ? 92 : 80, `pastry case: croissant ×${Math.round(cro)}`, 12, 'opacity=".7"'); }
    if (key === 'dishpit') h += t(10, 104, `${s.stations?.dishpit?.queue ?? 0} in the sink`, 12.5, 'opacity=".7"');
    return h;
  }
  if (soon && soon.tk.est_s > 30) h += ring(w - 18 - (up ? 0 : 0), up ? 42 : 17, 9, soon.p, C.pinkD) + `<text class="k-left" x="${w - 32}" y="${up ? 46 : 22}" text-anchor="end" font-family="Patrick Hand" font-size="12.5" fill="${I}">${R.mmss(soon.left)}</text>`;
  sk.slice(0, 2).forEach(([k2, n], i) => h += use(skuIcon(k2), 8 + i * 72, 30, 34) + gt(46 + i * 72, 56, '×' + n, 19));
  if (!sk.length) h += use(ICON[key], 8, 30, 32) + gt(46, 56, `${R.human(tasks[0].step)}${tasks.length > 1 ? ' ×' + tasks.length : ''}`, 17);
  const chipY = spec.h - 30;
  h += chipsRow(s, tasks, 8, chipY, w - 16, w > 200 ? 4 : 3);
  const steps = [...new Set(tasks.map((tk) => tk.step))];
  const batch = Object.values(s.batches || {}).find((b) => b.started && keys.includes(b.station) && b.order_nos?.some((n) => tasks.some((tk) => tk.order_no === n)));
  if (spec.h <= 110) { /* short cards: icons + chips only */ }
  else if (batch && batch.size > 1) h += t(10, chipY - 6, `${batch.size} orders → 1 ${batch.step || steps[0]}`, 11.5, 'opacity=".65"');
  else if (steps.length) h += t(10, chipY - 6, steps.slice(0, 3).join(' · '), 11.5, 'opacity=".6"');
  if (key === 'espresso') { const slots = s.equipment?.espresso_machine?.slots || 2, by = tasks.filter((tk) => tk.station === 'espresso').slice(0, slots);
    for (let i = 0; i < Math.min(3, slots); i++) { const tk = by[i], left = tk ? Math.max(0, (tk.started_s ?? now) + tk.est_s - now) : null;
      h += `<rect x="164" y="${86 + i*16}" width="68" height="14" rx="7" fill="${C.pinkL}" ${st(1.4)}/><circle cx="173" cy="${93 + i*16}" r="3.5" fill="${tk ? C.sage : '#fff'}" ${st(1.3)}/>${t(181, 97 + i*16, `G${i + 1} · ${tk ? R.mmss(left) : 'free'}`, 11)}`; } }
  return h;
}
const lCards = R.layer($('k-cards'), {
  key: (it) => it.key, sig: (it) => it.html, html: (it) => it.html,
});
function renderCards(s, t){
  lCards.sync(Object.keys(CARDS).map((key) => { const spec = CARDS[key], inner = cardInner(key, s, t);
    const alert = [key, ...(spec.also || [])].some((k) => s.stations?.[k]?.status === 'down');
    return {key, html: `<g data-station-card="${key}">${card(spec.cx, spec.top, spec.w, spec.h, inner, {rot: spec.rot, hook: spec.hook, alert})}</g>`}; }));
}

/* ================================================================ the pass (foreground) */
let passSig = '';
function renderPass(s){
  const ready = Object.values(s.orders || {}).filter((o) => o.status === 'ready').sort((a, b) => (a.ready_s || 0) - (b.ready_s || 0));
  const plates = ready.filter((o) => o.channel === 'dine_in' || o.channel === 'takeaway').slice(0, 4);
  const bags = Object.values(s.shelf?.bags || {}).filter((b) => b.rider !== 'picked_up').slice(0, 3);
  const queued = Object.values(s.orders || {}).filter((o) => o.status === 'queued' || o.status === 'brewing' || o.status === 'almost');
  const po = Object.values(s.pos || {}).filter((p) => p.status === 'received').sort((a, b) => (b.received_s || 0) - (a.received_s || 0))[0];
  const sig = [plates.map((o) => o.order_no), bags.map((b) => b.order_no), queued.length, po?.po_id].join('|');
  if (sig === passSig) return; passSig = sig;
  let h = '', txt = '';
  plates.forEach((o, i) => { const x = 148 + i * 82, sku = o.items?.[0]?.sku;
    h += `<ellipse cx="${x + 34}" cy="758" rx="34" ry="6" fill="#fff" ${st(2.5)}/>` + use(skuIcon(sku), x + 6, 704, 56);
    txt += `<g transform="translate(${x + 34} 702) rotate(${i % 2 ? 5 : -4})"><rect x="-22" y="-9" width="44" height="18" rx="4" fill="#fffefb" ${st(1.6)}/>${t(0, 5, '#' + o.order_no, 12, 'text-anchor="middle"')}</g>`; });
  bags.forEach((b, i) => { const x = 1090 + i * 70; h += bag(x, chan(b.channel).col);
    txt += `<text x="${x + 31}" y="754" text-anchor="middle" font-family="Patrick Hand" font-size="10.5" fill="#fff">${chan(b.channel).label}·${b.order_no}</text><text x="${x + 31}" y="720" text-anchor="middle" font-family="Gochi Hand" font-size="15" fill="${C.pinkD}">brew</text>`; });
  if (po) { h += [874, 900, 926].map(x => use('k-milk', x, 684, 34)).join('') + `<rect x="868" y="714" width="96" height="46" rx="3" fill="${K.wood}" ${st(2.8)}/><path d="M868 730h96M868 745h96" ${st(1.6)}/>`;
    txt += t(916, 778, `${R.human(po.supplier)} · ${R.hm(po.received_s || 0)} ✓`, 11, 'text-anchor="middle"'); }
  const chs = {}; for (const o of queued) chs[o.channel] = (chs[o.channel] || 0) + 1;
  txt += gt(1430, 722, String(queued.length), 30, 'text-anchor="middle"');
  Object.entries(chs).slice(0, 4).forEach(([c, n], i) => txt += `<rect x="1462" y="${673 + i*13}" width="${Math.min(94, 14 + n * 14)}" height="9" rx="4.5" fill="${chan(c).col}" ${st(1.4)}/>`);
  $('k-pass').innerHTML = h; $('k-passtxt').innerHTML = txt;
}

/* ================================================================ HTML cards: crew, stations board, chaos */
const room = document.getElementById('kitchen');
const face = (sf) => { const L = staffLook(sf), look = (ROLE_LOOK[sf.role] || ROLE_LOOK.barista)(L, 17);
  return `<svg class="face" viewBox="-32 -20 64 64" aria-hidden="true"><g transform="scale(.9)">${head(0, 17)}${eyes(0, 17, 0, 1)}${look.hat || ''}</g></svg>`; };
const stnIcon = (k) => `<svg viewBox="0 0 40 40"><use href="#${ICON[k] || 'k-cup'}"/></svg>`;
let crewHTML = '';
function renderCrewCard(s, t){
  const el = room.querySelector('.crew'); if (!el) return;
  const by = tasksBy(s);
  const staff = Object.values(s.staff || {}).sort((a, b) => (b.present - a.present) || String(a.id).localeCompare(String(b.id)));
  const onShift = staff.filter((x) => x.present && !x.absent), onBreak = staff.filter((x) => x.on_break || x.state === 'break');
  const rule = staff.find((x) => x.break_rule)?.break_rule;
  const rows = staff.slice(0, 5).map((sf) => {
    const tk = (by[sf.id] || [])[0], stn = tk?.station || sf.station, f = sf.fatigue || 0;
    const due = sf.break_due_s != null ? sf.break_due_s - t : null, left = breakLeft(sf, t);
    let tag = `<span class="tag">${tk ? esc(R.human(tk.step)) : 'ready'}</span>`;
    if (sf.absent || sf.state === 'absent') tag = `<span class="tag warn">absent · sick</span>`;
    else if (!sf.present) tag = `<span class="tag rest">off shift${sf.shift ? ' · ' + R.hm(sf.shift[0]) : ''}</span>`;
    else if (sf.on_break || sf.state === 'break') tag = `<span class="tag rest"><svg><use href="#k-lock"/></svg>${left != null ? R.mmss(left) + ' left' : 'on break'}</span>`;
    else if (due != null && due > 0 && due < 1800) tag = `<span class="tag warn">break due · ${Math.ceil(due / 60)} min</span>`;
    return `<div class="crow" data-staff="${esc(sf.id)}">${face(sf)}<b>${esc(sf.name.toLowerCase())}</b><span class="stn">${stnIcon(stn || 'pass')}${esc(sf.on_break ? 'break' : LABEL[stn] || R.human(stn || sf.role))}</span>
      <span class="bar2" title="fatigue ${Math.round(f * 100)}%"><i style="width:${Math.round(f * 100)}%;background:${fatCol(f)}"></i></span>${tag}</div>`;
  }).join('');
  const html = `<h3>crew <small>${onShift.length} on shift${onBreak.length ? ` · ${onBreak.length} on break` : ''}</small></h3>${rows}`
    + `<div class="rule"><svg><use href="#k-lock"/></svg>${esc(rule || 'breaks are enforced by the rota')}</div>`;
  if (html !== crewHTML) { crewHTML = html; el.innerHTML = html; }
}
const BOARD = ['prep', 'oven', 'fryer', 'press', 'espresso', 'grinder', 'blender', 'cold', 'dishpit'];
let boardHTML = '';
function renderBoard(s){
  const el = room.querySelector('.board'); if (!el) return;
  const busy = busyStations(s);
  const cells = BOARD.map((k) => { const x = s.stations?.[k] || {}, down = x.status === 'down', u = x.util;
    const led = down ? 'r' : (u ?? (busy[k] ? .6 : 0)) >= .7 ? 'a' : 'g';
    let v = down ? 'down' : u != null ? Math.round(u * 100) + '%' : busy[k] ? `×${busy[k]}` : '—';
    if (k === 'cold' && !down) { const c = s.inventory?.coldbrew_concentrate; if (c) v = (c.on_hand / 1000).toFixed(1) + 'L'; }
    return `<div class="cell" data-station="${k}" title="${LABEL[k]}${x.queue ? ` · ${x.queue} waiting` : ''}">${stnIcon(k)}<span class="${led === 'a' && u >= .85 ? 'hot' : ''}"><i class="led ${led}"></i>${v}</span></div>`; }).join('');
  const html = `<div class="bh">stations <small><i class="led g"></i>ok <i class="led a"></i>busy <i class="led r"></i>down</small></div><div class="cells">${cells}</div>`;
  if (html !== boardHTML) { boardHTML = html; el.innerHTML = html; }
}
const CHAOS = [
  {kind: 'staff_absent', label: 'barista sick', icon: 'k-sick'},
  {kind: 'equipment_down', target: 'oven', label: 'oven breaks', icon: 'k-oven'},
  {kind: 'supplier_delay', target: 'dairy', label: 'milk late', icon: 'k-milk'},
  {kind: 'rain_storm', label: 'rain storm', icon: 'k-rain'},
  {kind: 'rider_shortage', label: 'no riders', icon: 'k-scooter'},
  {kind: 'power_cut', label: 'power cut', icon: 'k-bolt'},
];
const KIND_TEXT = {staff_absent: (d) => `${R.human(d.target || 'a barista')} off sick · −1 on the line`, staff_late: (d) => `${R.human(d.target || 'staff')} running late`,
  equipment_down: (d) => `${LABEL[stationOf(d.target)] || R.human(d.target)} down`, supplier_delay: (d) => `${R.human(d.target || 'supplier')} delivery late`,
  supplier_short: (d) => `${R.human(d.target || 'supplier')} short-shipped`, rider_shortage: () => 'rider shortage · bags waiting', power_cut: () => 'power cut · machines on backup',
  demand_spike: () => 'demand spike', price_shock: () => 'ingredient price shock', platform_outage: (d) => `${R.human(d.target || 'aggregator')} app down`, rain_storm: () => 'rain storm · delivery surge'};
const KIND_ICON = {staff_absent: 'k-sick', staff_late: 'k-lock', equipment_down: 'k-wrench', supplier_delay: 'k-milk', supplier_short: 'k-milk', rider_shortage: 'k-scooter', power_cut: 'k-bolt', rain_storm: 'k-rain', demand_spike: 'k-bolt', price_shock: 'k-bolt', platform_outage: 'k-scooter'};
let chaosHTML = '', chaosBusy = '';
function renderChaos(s, t){
  const el = room.querySelector('.chaos'); if (!el) return;
  const all = Object.values(s.disruptions || {}).sort((a, b) => (b.started_s || 0) - (a.started_s || 0));
  const act = all.filter((d) => d.active), recent = all.filter((d) => !d.active && d.resolved_s && t - d.resolved_s < 1800).slice(0, 1);
  const pol = s.policy?.policy || s.world?.policy || 'D';
  const since = act.length ? Math.min(...act.map((d) => d.started_s ?? t)) : recent[0]?.started_s;
  const reaction = since != null ? [...(s.decisions || [])].reverse().find((d) => (d.sim_s ?? 0) >= since - 1) : null;
  const cost = all.reduce((a, d) => a + (d.cost_inr || 0), 0);
  const nextB = s.bottleneck?.resource;
  let rows = act.slice(0, 2).map((d) => `<div class="cr" data-disruption="${esc(d.id)}"><svg><use href="#${KIND_ICON[d.kind] || 'k-bolt'}"/></svg><span>${esc((KIND_TEXT[d.kind] || ((x) => R.human(x.kind)))(d))} since ${R.hm(d.started_s ?? t)}</span><b class="hot">${d.until_s ? 'back ~' + R.hm(d.until_s) : 'ongoing'}</b></div>`).join('');
  rows += recent.map((d) => `<div class="cr"><svg><use href="#${KIND_ICON[d.kind] || 'k-bolt'}"/></svg><span>${esc((KIND_TEXT[d.kind] || ((x) => R.human(x.kind)))(d))}</span><b class="good">fixed ✓ ${R.hm(d.resolved_s)}</b></div>`).join('');
  if (act.length || recent.length) rows += `<div class="cr"><svg><use href="#k-oven"/></svg><span>${reaction ? `RL: ${esc(rlText(reaction))}` : `policy ${pol} re-plans at its next tick`}</span><b class="${reaction ? 'good' : ''}">${reaction ? R.hm(reaction.sim_s) : '…'}</b></div>`;
  if (nextB && act.length + recent.length < 2 && (act.length || recent.length)) rows += `<div class="cr"><svg><use href="#k-dirty"/></svg><span>busiest now: ${esc(LABEL[nextB] || R.human(nextB))}</span><b class="hot">next bottleneck</b></div>`;
  if (!rows) rows = `<div class="cr calm"><svg><use href="#k-cup"/></svg><span>all calm. break something and watch policy ${pol} adapt</span><b></b></div>`;
  const btns = CHAOS.map((c) => `<button class="cbtn" data-chaos="${c.kind}" data-target="${c.target || ''}" ${chaosBusy || act.some((d) => d.kind === c.kind && (!c.target || stationOf(d.target) === c.target)) ? 'disabled' : ''} title="${c.label}"><svg viewBox="0 0 40 40"><use href="#${c.icon}"/></svg>${c.label}</button>`).join('');
  const html = `<h3><svg><use href="#k-bolt"/></svg>chaos <span class="chip dark">${act.length ? `policy ${pol} adapting` : 'stress-test'}</span></h3>${rows}
    <div class="cbtns">${btns}</div><div class="foot"><span>${cost > 0 ? `chaos has cost <b>${R.rs(cost)}</b> so far` : act.length ? 'counting the cost…' : 'cost is measured against a no-chaos twin'}</span></div>`;
  if (html !== chaosHTML) { chaosHTML = html; el.innerHTML = html; }
}
function rlText(d){ let x = String(d.summary || d.type).replace(/^RL manager:\s*/i, '').split(/\s*\(drivers:|;\s*/)[0].replace(/_/g, ' ');
  return x.length > 46 ? x.slice(0, 44) + '…' : x; }
room.querySelector('.chaos')?.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-chaos]'); if (!b || b.disabled || !window.BrewApi) return;
  chaosBusy = b.dataset.chaos; renderChaos(R.S() || {}, R.now());
  try { await BrewApi.chaos(b.dataset.chaos, b.dataset.target ? {target: b.dataset.target} : {}); window.BrewToast?.(`${b.textContent.trim()}! watch the kitchen`); }
  catch (err) { window.BrewToast?.(err.message || 'chaos refused', true); }
  finally { chaosBusy = ''; chaosHTML = ''; renderChaos(R.S() || {}, R.now()); }
});

/* ================================================================ frame */
function render(s){
  if (!s) return;
  const t = R.now();
  renderOutside(s); renderFX(s); renderLevels(s); renderBroken(s, t); renderCrew(s, t); renderCards(s, t); renderPass(s);
  renderCrewCard(s, t); renderBoard(s); renderChaos(s, t);
}
R.onState(render);
setInterval(() => { const s = R.S(); if (!s || document.body.dataset.room !== 'kitchen') return; render(s); }, 1000);
window.BREW_LIVE?.on('order.ready', () => { R.bump($('k-bell'), 'ring'); R.bump($('k-ding'), 'ring'); });
if (/[?&]still\b/.test(location.search)) document.body.classList.add('still');
window.BrewKitchen = {render};
})();
