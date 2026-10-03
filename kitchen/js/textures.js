/* brew · night kitchen — texture library: CC0 PBR sets from disk + procedural canvases
   (brushed steel, smudges, food, signage, the night city behind the glass). */
import * as THREE from 'three';
import { E } from './engine.js';

export const TX = {};

/* ---------- helpers ---------- */
export function rng(seed = 1) {
  let a = seed >>> 0 || 1;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const canvas = (w, h = w) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
export function tex(c, { srgb = true, repeat, wrap = true, aniso = true, flipY = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (aniso) t.anisotropy = E.maxAniso;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.flipY = flipY;
  return t;
}

/** tileable value-noise fBm, size×size in 0..1. `sx/sy` stretch the lattice (brushed grain). */
export function fbm(size, { seed = 1, base = 4, octaves = 5, sx = 1, sy = 1, gain = 0.5 } = {}) {
  const r = rng(seed);
  const out = new Float32Array(size * size);
  const smooth = (t) => t * t * (3 - 2 * t);
  let amp = 1, tot = 0;
  for (let o = 0; o < octaves; o++) {
    const nx = Math.max(1, Math.round(base * sx * 2 ** o)), ny = Math.max(1, Math.round(base * sy * 2 ** o));
    const g = new Float32Array(nx * ny);
    for (let i = 0; i < g.length; i++) g[i] = r();
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * ny, y0 = Math.floor(fy), ty = smooth(fy - y0), y1 = (y0 + 1) % ny;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * nx, x0 = Math.floor(fx), tx = smooth(fx - x0), x1 = (x0 + 1) % nx;
        const a = g[y0 * nx + x0], b = g[y0 * nx + x1], c = g[y1 * nx + x0], d = g[y1 * nx + x1];
        out[y * size + x] += amp * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
      }
    }
    tot += amp;
    amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

/** height field → tangent-space normal map (OpenGL convention) */
export function normalFromHeight(h, size, strength = 2, opts = {}) {
  const c = canvas(size), ctx = c.getContext('2d'), img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)], r = h[y * size + ((x + 1) % size)];
      const u = h[((y - 1 + size) % size) * size + x], d = h[((y + 1) % size) * size + x];
      const nx = (l - r) * strength, ny = (d - u) * strength, len = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      img.data[i] = (nx / len * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny / len * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return tex(c, { srgb: false, ...opts });
}
/** grey field → canvas texture (for roughness / masks); `map` remaps 0..1 */
export function greyTex(h, size, map = (v) => v, opts = {}) {
  const c = canvas(size), ctx = c.getContext('2d'), img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = Math.max(0, Math.min(255, map(h[i]) * 255));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, { srgb: false, ...opts });
}

const lazy = (name, fn) => Object.defineProperty(TX, name, { get() { const v = fn(); Object.defineProperty(TX, name, { value: v }); return v; }, configurable: true });

/* ------------------------------------------------------------------ */
/* CC0 PBR sets (Poly Haven, 1k WebP): diff / nor / arm                */
/* ------------------------------------------------------------------ */
const loader = new THREE.TextureLoader();
const SETS = {};
export function loadSet(name, { repeat = [1, 1], diff = true } = {}) {
  const key = name + repeat.join('x');
  if (SETS[key]) return SETS[key];
  const mk = (suffix, srgb) => {
    const t = loader.load(`assets/tex/${name}_${suffix}.webp`, () => E.onTexLoad && E.onTexLoad());
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
    t.anisotropy = E.maxAniso;
    return t;
  };
  return (SETS[key] = { map: diff ? mk('diff', true) : null, normalMap: mk('nor', false), arm: mk('arm', false) });
}

/* ------------------------------------------------------------------ */
/* procedural surfaces                                                 */
/* ------------------------------------------------------------------ */
/* brushed stainless: long horizontal grain + wipe marks */
lazy('brushed', () => {
  const S = 512;
  const grain = fbm(S, { seed: 11, base: 2, octaves: 6, sx: 0.02, sy: 64 });
  const fine = fbm(S, { seed: 12, base: 2, octaves: 3, sx: 0.08, sy: 128 });
  const h = new Float32Array(S * S);
  for (let i = 0; i < h.length; i++) h[i] = grain[i] * 0.7 + fine[i] * 0.3;
  const wipe = fbm(S, { seed: 13, base: 3, octaves: 4 });
  const normal = normalFromHeight(h, S, 1.2);
  const rough = greyTex(wipe, S, (v) => 0.78 + (v - 0.5) * 0.5); // multiplier on material roughness
  return { normal, rough };
});
/* fingerprints & wipes for glossy black surfaces */
lazy('smudge', () => {
  const S = 512, c = canvas(S), x = c.getContext('2d');
  const base = fbm(S, { seed: 21, base: 3, octaves: 5 });
  const img = x.createImageData(S, S);
  for (let i = 0; i < S * S; i++) { const v = 150 + (base[i] - 0.5) * 70; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  x.putImageData(img, 0, 0);
  const r = rng(5);
  x.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 60; k++) { // wipe arcs
    x.strokeStyle = `rgba(255,255,255,${0.02 + r() * 0.04})`;
    x.lineWidth = 6 + r() * 30;
    x.beginPath();
    const cx = r() * S, cy = r() * S, rad = 40 + r() * 160;
    x.arc(cx, cy, rad, r() * 6, r() * 6 + 1 + r() * 2);
    x.stroke();
  }
  return tex(c, { srgb: false });
});
/* micro-bump for cast iron, ceramics, lacquer */
lazy('grainN', () => normalFromHeight(fbm(256, { seed: 31, base: 16, octaves: 3 }), 256, 1.4));
lazy('ironN', () => normalFromHeight(fbm(256, { seed: 33, base: 24, octaves: 4, gain: 0.6 }), 256, 3.0));
/* soft round sprite for steam / bokeh / glows */
lazy('puff', () => {
  const S = 128, c = canvas(S), x = c.getContext('2d');
  const n = fbm(S, { seed: 61, base: 4, octaves: 4 });
  const img = x.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let xx = 0; xx < S; xx++) {
    const dx = (xx + 0.5) / S - 0.5, dy = (y + 0.5) / S - 0.5, d = Math.hypot(dx, dy) * 2;
    const a = Math.max(0, 1 - d) ** 1.6 * (0.55 + n[y * S + xx] * 0.9);
    const i = (y * S + xx) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = Math.min(255, a * 255);
  }
  x.putImageData(img, 0, 0);
  return tex(c, { wrap: false });
});
lazy('glow', () => {
  const S = 128, c = canvas(S), x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.55)'); g.addColorStop(0.6, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  return tex(c, { wrap: false });
});
/* vertical fade for light cones */
lazy('coneFade', () => {
  const c = canvas(4, 256), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.15, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 4, 256);
  return tex(c, { wrap: false, aniso: false });
});

/* ------------------------------------------------------------------ */
/* the night city behind the windows (pre-defocused)                   */
/* ------------------------------------------------------------------ */
lazy('city', () => {
  const W = 2048, H = 1024, c = canvas(W, H), x = c.getContext('2d'), r = rng(77);
  // sky: deep navy, warm sodium haze near the horizon
  const sky = x.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#05070d'); sky.addColorStop(0.45, '#0c1220'); sky.addColorStop(0.62, '#1a1b26'); sky.addColorStop(0.72, '#2a2224'); sky.addColorStop(1, '#0a0a0c');
  x.fillStyle = sky; x.fillRect(0, 0, W, H);
  // far skyline layers with lit windows
  const layer = (base, hMin, hMax, col, lit, winA) => {
    let px = -20;
    while (px < W) {
      const w = 40 + r() * 120, h = hMin + r() * (hMax - hMin);
      x.fillStyle = col; x.fillRect(px, base - h, w, h + 400);
      for (let wy = base - h + 10; wy < base - 6; wy += 9 + r() * 4)
        for (let wx = px + 5; wx < px + w - 6; wx += 7 + r() * 3)
          if (r() < lit) { const warm = r() < 0.7; x.fillStyle = warm ? `rgba(255,${170 + r() * 50 | 0},${90 + r() * 40 | 0},${winA * (0.4 + r() * 0.6)})` : `rgba(170,200,255,${winA * (0.3 + r() * 0.5)})`; x.fillRect(wx, wy, 3, 4); }
      px += w + r() * 10;
    }
  };
  layer(H * 0.7, 120, 420, '#0b0e16', 0.18, 0.7);
  layer(H * 0.76, 60, 260, '#090b11', 0.24, 0.9);
  // street haze
  const haze = x.createLinearGradient(0, H * 0.62, 0, H * 0.85);
  haze.addColorStop(0, 'rgba(255,160,80,0)'); haze.addColorStop(0.6, 'rgba(255,150,70,0.10)'); haze.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = haze; x.fillRect(0, H * 0.6, W, H * 0.3);
  // defocus everything
  const blurred = canvas(W, H), bx = blurred.getContext('2d');
  bx.filter = 'blur(10px)'; bx.drawImage(c, 0, 0); bx.filter = 'none';
  // bokeh discs: street lights, cars, signs
  bx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 260; i++) {
    const y = H * (0.45 + Math.pow(r(), 0.6) * 0.38), xx = r() * W;
    const rad = 6 + Math.pow(r(), 2.2) * 34;
    const t = r();
    const col = t < 0.55 ? [255, 170 + r() * 60, 90 + r() * 40] : t < 0.8 ? [255, 236, 210] : t < 0.92 ? [140, 180, 255] : [255, 90, 70];
    const a = 0.08 + r() * 0.22;
    const g = bx.createRadialGradient(xx, y, 0, xx, y, rad);
    g.addColorStop(0, `rgba(${col[0]},${col[1] | 0},${col[2] | 0},${a})`);
    g.addColorStop(0.82, `rgba(${col[0]},${col[1] | 0},${col[2] | 0},${a * 0.8})`);
    g.addColorStop(1, `rgba(${col[0]},${col[1] | 0},${col[2] | 0},0)`);
    bx.fillStyle = g; bx.beginPath(); bx.arc(xx, y, rad, 0, Math.PI * 2); bx.fill();
  }
  const t = tex(blurred, { wrap: false });
  t.wrapS = THREE.RepeatWrapping;
  return t;
});

/* ------------------------------------------------------------------ */
/* backlit wall sign: our own tagline in the same treatment            */
/* ------------------------------------------------------------------ */
export function signTexture(lines = ['SLOW FOOD', 'LATE NIGHTS']) {
  const W = 1024, H = 512, c = canvas(W, H), x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '400 112px Oswald, "Arial Narrow", sans-serif';
  const draw = (blur, a) => {
    x.filter = blur ? `blur(${blur}px)` : 'none';
    x.fillStyle = `rgba(255,${blur ? 150 : 196},${blur ? 60 : 120},${a})`;
    lines.forEach((l, i) => x.fillText(l.split('').join(String.fromCharCode(8202)), W / 2, H / 2 + (i - (lines.length - 1) / 2) * 150));
  };
  draw(28, 0.6); draw(8, 0.7); draw(0, 1);
  x.filter = 'none';
  return tex(c, { wrap: false });
}
