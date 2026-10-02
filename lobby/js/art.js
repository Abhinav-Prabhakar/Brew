/* brew · art.js — small vector icons (ticket overlays, persona hints, weather,
   stars, QR) used both by the glass UI and when painting 3D canvas textures. */
(function () {
  const B = (window.B = window.B || {});
  const A = (B.art = {});

  /* ---------- colour helpers ---------- */
  const hex2rgb = (h) => {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const rgb2hex = (r, g, b) =>
    '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  /** shade(#hex, -0.2) darkens 20%, shade(#hex, 0.2) lightens 20% */
  const shade = (h, amt) => {
    const [r, g, b] = hex2rgb(h);
    const t = amt < 0 ? 0 : 255;
    const p = Math.abs(amt);
    return rgb2hex(r + (t - r) * p, g + (t - g) * p, b + (t - b) * p);
  };
  const mix = (a, b, t) => {
    const x = hex2rgb(a), y = hex2rgb(b);
    return rgb2hex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
  };
  A.shade = shade;
  A.mix = mix;

  /* ---------- customisation overlays (tiny SVG icons for badges) ---------- */
  A.modIcon = {
    oat: `<svg viewBox="0 0 16 16"><g fill="#c9a061"><ellipse cx="8" cy="4" rx="1.8" ry="3" /><ellipse cx="5" cy="8" rx="1.6" ry="2.8" transform="rotate(-35 5 8)"/><ellipse cx="11" cy="8" rx="1.6" ry="2.8" transform="rotate(35 11 8)"/></g><path d="M8 6 V15" stroke="#9c7a3d" stroke-width="1.2"/></svg>`,
    shot: `<svg viewBox="0 0 16 16"><ellipse cx="8" cy="8" rx="5" ry="6.4" fill="#6b3a1f" transform="rotate(25 8 8)"/><path d="M5.4 3.6 C9 6 7 10 10.6 12.4" stroke="#2f1609" stroke-width="1.3" fill="none"/><ellipse cx="6" cy="6" rx="1.2" ry="2" fill="#a96a42" opacity=".6" transform="rotate(25 6 6)"/></svg>`,
    noonion: `<svg viewBox="0 0 16 16"><path d="M8 2 C8 4 3 6 3 10 C3 13 5.4 14.6 8 14.6 C10.6 14.6 13 13 13 10 C13 6 8 4 8 2Z" fill="#c779b4"/><path d="M8 5 C6.6 7 5.6 9 6 13 M8 5 C9.4 7 10.4 9 10 13" stroke="#9a4d8a" stroke-width=".8" fill="none"/><path d="M2 14 L14 2" stroke="#e0453a" stroke-width="2" stroke-linecap="round"/></svg>`,
    nonuts: `<svg viewBox="0 0 16 16"><path d="M8 2.5 C11 2.5 12.5 5 12 8 C11.6 10.5 10 13.5 8 13.5 C6 13.5 4.4 10.5 4 8 C3.5 5 5 2.5 8 2.5Z" fill="#c28b52"/><path d="M5 7 Q8 8 11 7 M5.4 10 Q8 11 10.6 10" stroke="#8a5a2b" stroke-width=".7" fill="none"/><path d="M2 14 L14 2" stroke="#e0453a" stroke-width="2" stroke-linecap="round"/></svg>`,
    lesssugar: `<svg viewBox="0 0 16 16"><path d="M3 6 L8 3.5 L13 6 L13 11 L8 13.5 L3 11Z" fill="#fff" stroke="#c7b9bd" stroke-width=".8"/><path d="M3 6 L8 8.5 L13 6 M8 8.5 V13.5" stroke="#c7b9bd" stroke-width=".8" fill="none"/><text x="8" y="16" font-size="5" text-anchor="middle" fill="#7a5560" font-family="DM Sans" font-weight="700">½</text></svg>`,
    iced: `<svg viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="2.4" fill="#d6f0fb" stroke="#7cc3e4" stroke-width="1"/><path d="M5.5 5.5 l3 -.8" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/></svg>`,
    hot: `<svg viewBox="0 0 16 16"><path d="M8 1.5 C9 4.5 12.5 6 12.5 10 C12.5 12.8 10.4 14.6 8 14.6 C5.6 14.6 3.5 12.8 3.5 10 C3.5 7.6 5 6.4 5.6 5 C6.4 6.6 7 7 7.4 7 C7.4 5 7.2 3.4 8 1.5Z" fill="#f2724a"/><path d="M8 8 C9 9.6 10.2 10.4 10.2 11.8 C10.2 13 9.2 13.8 8 13.8 C6.8 13.8 5.8 13 5.8 11.8 C5.8 10.6 7 9.8 8 8Z" fill="#ffd36b"/></svg>`,
    cheese: `<svg viewBox="0 0 16 16"><path d="M2 11 L14 7.5 L14 13 L2 13Z" fill="#f6c94c"/><path d="M2 11 L14 7.5 L9 4Z" fill="#ffe08a"/><circle cx="6" cy="12" r="1" fill="#d9a12a"/><circle cx="11" cy="10.6" r=".8" fill="#d9a12a"/></svg>`,
    decaf: `<svg viewBox="0 0 16 16"><ellipse cx="8" cy="8" rx="5" ry="6.4" fill="#b98a6a" transform="rotate(25 8 8)"/><path d="M5.4 3.6 C9 6 7 10 10.6 12.4" stroke="#7a5236" stroke-width="1.3" fill="none"/><text x="8" y="10.4" font-size="6" text-anchor="middle" fill="#fff" font-family="DM Sans" font-weight="800">D</text></svg>`,
  };

  /* ---------- persona hint icons ---------- */
  A.persona = {
    commuter: `<svg viewBox="0 0 20 20"><rect x="2.5" y="6" width="15" height="10.5" rx="2" fill="#5a4038"/><path d="M7 6 V4.4 C7 3.6 7.6 3 8.4 3 H11.6 C12.4 3 13 3.6 13 4.4 V6" stroke="#5a4038" stroke-width="1.6" fill="none"/><rect x="2.5" y="9.6" width="15" height="1.4" fill="#3c2a25"/><rect x="8.6" y="9" width="2.8" height="2.6" rx=".6" fill="#d8b56a"/></svg>`,
    student: `<svg viewBox="0 0 20 20"><rect x="3" y="12.6" width="14" height="3.6" rx=".8" fill="#e46d8d"/><rect x="4" y="9" width="12.4" height="3.6" rx=".8" fill="#6d93c8"/><rect x="3.4" y="5.4" width="13" height="3.6" rx=".8" fill="#f2b84b" transform="rotate(-4 10 7)"/><path d="M5 13.8 H15 M5.6 10.2 H15" stroke="#fff" stroke-width=".7" opacity=".7"/></svg>`,
    leisurely: `<svg viewBox="0 0 20 20"><ellipse cx="10" cy="15.6" rx="8" ry="2.2" fill="#e9a7b8"/><path d="M4.6 8 H14 V10.6 C14 13.4 12 15 9.3 15 C6.6 15 4.6 13.4 4.6 10.6Z" fill="#fff" stroke="#c78a9a" stroke-width="1"/><path d="M14 9 C16.6 9 16.6 12.6 13.6 12.4" stroke="#c78a9a" stroke-width="1.2" fill="none"/><path d="M8 6.4 C7 5 9 4 8 2.6 M11 6.4 C10 5 12 4 11 2.6" stroke="#c9b2b8" stroke-width=".9" fill="none" stroke-linecap="round"/></svg>`,
    camper: `<svg viewBox="0 0 20 20"><rect x="4" y="4" width="12" height="8.4" rx="1.2" fill="#5b6b86"/><rect x="5.2" y="5.2" width="9.6" height="6" rx=".6" fill="#bfe3f5"/><path d="M2 13.4 H18 L16.6 15.6 H3.4Z" fill="#8b97ad"/></svg>`,
    group: `<svg viewBox="0 0 20 20"><circle cx="7" cy="7" r="3" fill="#e9a07a"/><circle cx="13.4" cy="7.6" r="2.6" fill="#a8693f"/><path d="M1.6 17 C1.6 12.6 4 11 7 11 C10 11 12.4 12.6 12.4 17Z" fill="#e46d8d"/><path d="M9.6 17 C9.6 13.4 11.4 11.8 13.4 11.8 C15.6 11.8 18.4 13.4 18.4 17Z" fill="#6d93c8"/></svg>`,
    delivery: `<svg viewBox="0 0 20 20"><circle cx="5" cy="14.6" r="2.6" fill="none" stroke="#4a3a40" stroke-width="1.6"/><circle cx="15" cy="14.6" r="2.6" fill="none" stroke="#4a3a40" stroke-width="1.6"/><path d="M5 14.6 L8 9 H12.6 L15 14.6" stroke="#4a3a40" stroke-width="1.6" fill="none"/><rect x="9" y="4" width="6.4" height="5" rx="1" fill="#e46d8d"/><path d="M12.6 9 L13.4 6.6 H16" stroke="#4a3a40" stroke-width="1.4" fill="none"/></svg>`,
  };

  A.star = (fill = 1, id = 's') => `<svg viewBox="0 0 24 24" class="star"><defs><clipPath id="clip-${id}"><rect x="0" y="0" width="${24 * fill}" height="24"/></clipPath></defs>
      <path d="M12 2.4 L14.9 8.6 L21.6 9.4 L16.6 14 L18 20.7 L12 17.3 L6 20.7 L7.4 14 L2.4 9.4 L9.1 8.6Z" fill="#f6dbe2" stroke="#e8b7c5" stroke-width=".8" stroke-linejoin="round"/>
      <path clip-path="url(#clip-${id})" d="M12 2.4 L14.9 8.6 L21.6 9.4 L16.6 14 L18 20.7 L12 17.3 L6 20.7 L7.4 14 L2.4 9.4 L9.1 8.6Z" fill="#f9b84a" stroke="#d9993a" stroke-width=".8" stroke-linejoin="round"/>
      <path class="crack" d="M12 4 L11 9 L13.4 11.6 L10.6 14.6 L12.4 18" fill="none" stroke="#5a3a2a" stroke-width="1.2" stroke-linejoin="round" opacity="0"/>
    </svg>`;

  A.wx = {
    sunny: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" fill="#ffc94d"/><g stroke="#ffb02e" stroke-width="1.8" stroke-linecap="round">${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<path d="M12 2.6 V4.6" transform="rotate(${a} 12 12)"/>`).join('')}</g></svg>`,
    partly: `<svg viewBox="0 0 24 24"><circle cx="9" cy="9" r="4.4" fill="#ffc94d"/><path d="M7 19 C3.6 19 3.6 14 7 14 C7.6 10.6 12.6 10 14 13 C17.6 12 19.6 15 18.6 17 C20.6 17.6 20 19 18 19Z" fill="#fff" stroke="#d6c3cc" stroke-width=".8"/></svg>`,
    cloudy: `<svg viewBox="0 0 24 24"><path d="M6 18 C2 18 2 12.4 6 12.4 C6.6 8.4 12.4 7.6 14 11.4 C18.4 10.2 21 14 19.6 16.4 C22 17 21.4 18 19 18Z" fill="#ece6ea" stroke="#b9a9b2" stroke-width=".9"/></svg>`,
    drizzle: `<svg viewBox="0 0 24 24"><path d="M6 14 C2 14 2 8.4 6 8.4 C6.6 4.4 12.4 3.6 14 7.4 C18.4 6.2 21 10 19.6 12.4 C22 13 21.4 14 19 14Z" fill="#e3dce4" stroke="#a698a6" stroke-width=".9"/><g stroke="#6aa6d8" stroke-width="1.5" stroke-linecap="round"><path d="M8 17 L7 19"/><path d="M13 17 L12 19"/><path d="M18 17 L17 19"/></g></svg>`,
    rain: `<svg viewBox="0 0 24 24"><path d="M6 13 C2 13 2 7.4 6 7.4 C6.6 3.4 12.4 2.6 14 6.4 C18.4 5.2 21 9 19.6 11.4 C22 12 21.4 13 19 13Z" fill="#c9c0cc" stroke="#8a7d8c" stroke-width=".9"/><g stroke="#4f8fcf" stroke-width="1.6" stroke-linecap="round"><path d="M7 15.6 L5.4 19.6"/><path d="M11 15.6 L9.4 19.6"/><path d="M15 15.6 L13.4 19.6"/><path d="M19 15.6 L17.4 19.6"/></g></svg>`,
    night: `<svg viewBox="0 0 24 24"><path d="M15.6 3.6 C11 4.4 8 8.6 8.8 13.2 C9.6 17.4 13.6 20.4 18 19.6 C15.6 21.6 11.6 22 8.6 20.2 C4.4 17.8 3.2 12.2 5.8 8.2 C7.8 5 11.6 3.2 15.6 3.6Z" fill="#ffe08a"/><circle cx="18" cy="7" r=".9" fill="#ffe08a"/><circle cx="20" cy="12" r=".6" fill="#ffe08a"/></svg>`,
  };

  /** fake-but-plausible QR (finder patterns + seeded modules) */
  A.qr = function (seed = 7, n = 25) {
    let s = seed;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    let cells = '';
    const finder = (x, y) => `<rect x="${x}" y="${y}" width="7" height="7" fill="#111"/><rect x="${x + 1}" y="${y + 1}" width="5" height="5" fill="#fff"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" fill="#111"/>`;
    const inFinder = (x, y) => (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (inFinder(x, y)) continue;
        if ((x === 6 || y === 6) && (x + y) % 2 === 0) { cells += `<rect x="${x}" y="${y}" width="1" height="1"/>`; continue; }
        if (rnd() > 0.52) cells += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
      }
    return `<svg viewBox="-1 -1 ${n + 2} ${n + 2}" class="qr" shape-rendering="crispEdges"><rect x="-1" y="-1" width="${n + 2}" height="${n + 2}" fill="#fff"/><g fill="#111">${cells}</g>${finder(0, 0)}${finder(n - 7, 0)}${finder(0, n - 7)}<rect x="${n - 9}" y="${n - 9}" width="5" height="5" fill="#111"/><rect x="${n - 8}" y="${n - 8}" width="3" height="3" fill="#fff"/><rect x="${n - 7}" y="${n - 7}" width="1" height="1" fill="#111"/></svg>`;
  };


  /** rasterise an SVG string into an Image (for drawing onto canvas textures) */
  const imgCache = {};
  A.img = (svg, w = 64, h = 64) => {
    const key = svg + w + h;
    if (imgCache[key]) return imgCache[key];
    let src = svg;
    if (!/xmlns=/.test(src)) src = src.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    src = src.replace('<svg', `<svg width="${w}" height="${h}"`);
    const im = new Image();
    im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src);
    return (imgCache[key] = im);
  };
  A.ready = (imgs) => Promise.all(imgs.map((im) => (im.complete ? Promise.resolve() : new Promise((r) => { im.onload = r; im.onerror = r; }))));
})();
