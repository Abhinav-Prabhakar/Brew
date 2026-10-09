/* brew · audio.js
   Every sound in the lobby is synthesised with the Web Audio API — paper,
   thermal printer, split-flap clatter, scooters, rain — so nothing needs to
   be downloaded and every state change can have its own voice. */
(function () {
  const B = (window.B = window.B || {});
  let ctx = null, master = null, sfxBus = null, ambBus = null, noiseBuf = null, brownBuf = null;
  let muted = false;
  const last = {};

  function init() {
    if (ctx) return ctx.resume();
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.connect(master);
    ambBus = ctx.createGain();
    ambBus.gain.value = 0.9;
    ambBus.connect(master);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    brownBuf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const b = brownBuf.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < b.length; i++) {
      const w = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.02 * w) / 1.02;
      b[i] = lastOut * 3.5;
    }
    startAmbience();
  }

  /** throttle: don't let the same sound fire more than once per `gap` seconds,
      and thin out cosmetic sounds when the sim is running fast */
  function ok(name, gap = 0.04, cosmetic = false) {
    if (!ctx || muted) return false;
    const spd = (B.state && B.state.speed) || 1;
    if (cosmetic && spd >= 10 && Math.random() > 0.25) return false;
    const now = ctx.currentTime;
    if (last[name] && now - last[name] < gap * (spd >= 10 ? 4 : 1)) return false;
    last[name] = now;
    return true;
  }

  function env(g, t, a, peak, dcy, sustain = 0) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain || 0.0001), t + a + dcy);
  }

  function pan(node, p) {
    if (!ctx.createStereoPanner || p == null) return node;
    const s = ctx.createStereoPanner();
    s.pan.value = Math.max(-1, Math.min(1, p));
    node.connect(s);
    return s;
  }

  function tone({ f = 440, f2, type = 'sine', t = 0, a = 0.005, d = 0.2, g = 0.2, p, dest }) {
    const T = ctx.currentTime + t;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, T);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, T + a + d);
    const gn = ctx.createGain();
    env(gn, T, a, g, d);
    o.connect(gn);
    pan(gn, p).connect(dest || sfxBus);
    o.start(T);
    o.stop(T + a + d + 0.05);
  }

  function noise({ t = 0, a = 0.005, d = 0.15, g = 0.2, type = 'bandpass', f = 1000, f2, q = 1, p, buf, dest }) {
    const T = ctx.currentTime + t;
    const s = ctx.createBufferSource();
    s.buffer = buf || noiseBuf;
    s.loop = true;
    const fl = ctx.createBiquadFilter();
    fl.type = type;
    fl.frequency.setValueAtTime(f, T);
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, T + a + d);
    fl.Q.value = q;
    const gn = ctx.createGain();
    env(gn, T, a, g, d);
    s.connect(fl).connect(gn);
    pan(gn, p).connect(dest || sfxBus);
    s.start(T, Math.random());
    s.stop(T + a + d + 0.05);
  }

  /* x in world coords (0..1600) → stereo position */
  const px = (x) => (x == null ? 0 : (x / 1600) * 1.6 - 0.8);

  const S = {
    click() { if (!ok('click', 0.03)) return; tone({ f: 1400, f2: 900, d: 0.04, g: 0.06, type: 'triangle' }); },
    pop() { if (!ok('pop', 0.05)) return; tone({ f: 520, f2: 980, d: 0.09, g: 0.12 }); },
    chime(x) {
      if (!ok('chime', 0.6, true)) return;
      [[1318.5, 0], [1046.5, 0.16]].forEach(([f, t]) => {
        tone({ f, t, d: 1.4, g: 0.09, p: px(x) });
        tone({ f: f * 2.76, t, d: 0.5, g: 0.02, p: px(x) });
        tone({ f: f * 5.4, t, d: 0.18, g: 0.01, p: px(x) });
      });
    },
    keys() {
      if (!ok('keys', 0.3, true)) return;
      for (let i = 0; i < 4; i++) tone({ f: [880, 988, 784, 1046][i], t: i * 0.11, d: 0.05, g: 0.035, type: 'square' });
    },
    slide(x) { if (!ok('slide', 0.08, true)) return; noise({ f: 2600, f2: 900, d: 0.28, a: 0.03, g: 0.13, q: 0.7, p: px(x) }); },
    clip(x) {
      if (!ok('clip', 0.06)) return;
      tone({ f: 2900, type: 'triangle', d: 0.05, g: 0.08, p: px(x) });
      tone({ f: 4300, d: 0.04, g: 0.04, t: 0.012, p: px(x) });
      noise({ f: 5200, type: 'highpass', d: 0.02, g: 0.12, p: px(x) });
    },
    tear(x) {
      if (!ok('tear', 0.1)) return;
      const n = 16;
      for (let i = 0; i < n; i++) noise({ t: i * 0.017 + Math.random() * 0.008, f: 2400 + Math.random() * 2400, q: 2, d: 0.018, g: 0.16 + Math.random() * 0.1, p: px(x) });
      noise({ f: 1800, f2: 4000, d: 0.26, g: 0.06, q: 0.5, p: px(x) });
    },
    printLine(i = 0) {
      if (!ok('print', 0.05)) return;
      tone({ f: 1180 + (i % 3) * 40, type: 'square', d: 0.06, a: 0.004, g: 0.022, p: 0.45 });
      tone({ f: 590, type: 'sawtooth', d: 0.07, g: 0.012, p: 0.45 });
      for (let k = 0; k < 3; k++) noise({ t: k * 0.022, f: 4200, q: 3, d: 0.012, g: 0.05, p: 0.45 });
    },
    printFeed() { if (!ok('feed', 0.2)) return; tone({ f: 220, f2: 260, type: 'sawtooth', d: 0.35, g: 0.02, p: 0.45 }); noise({ f: 900, d: 0.35, g: 0.03, p: 0.45 }); },
    page() {
      if (!ok('page', 0.12)) return;
      noise({ f: 700, f2: 3200, a: 0.06, d: 0.32, g: 0.16, q: 0.6 });
      noise({ t: 0.18, f: 2200, f2: 900, d: 0.18, g: 0.08, q: 0.9 });
      noise({ t: 0.36, type: 'lowpass', f: 400, d: 0.06, g: 0.12 });
    },
    flap() {
      if (!ok('flap', 0.025)) return;
      noise({ type: 'highpass', f: 3000, d: 0.012, g: 0.07 });
      tone({ f: 700 + Math.random() * 300, type: 'square', d: 0.008, g: 0.012 });
    },
    clatter(n = 12) {
      if (!ok('clatter', 0.25)) return;
      for (let i = 0; i < n; i++) {
        noise({ t: i * 0.038 + Math.random() * 0.02, type: 'highpass', f: 2600 + Math.random() * 1500, d: 0.011, g: 0.05 + Math.random() * 0.04 });
        tone({ t: i * 0.038, f: 600 + Math.random() * 500, type: 'square', d: 0.006, g: 0.008 });
      }
    },
    huff(x) {
      if (!ok('huff', 0.3)) return;
      const T = ctx.currentTime;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(190, T);
      o.frequency.exponentialRampToValueAtTime(105, T + 0.38);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 620;
      f.Q.value = 3;
      const g = ctx.createGain();
      env(g, T, 0.02, 0.18, 0.4);
      o.connect(f).connect(g);
      pan(g, px(x)).connect(sfxBus);
      o.start(T);
      o.stop(T + 0.5);
      noise({ type: 'lowpass', f: 900, d: 0.45, a: 0.03, g: 0.12, p: px(x) });
    },
    scooter(x) {
      if (!ok('scooter', 0.8)) return;
      const T = ctx.currentTime;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(52, T);
      o.frequency.linearRampToValueAtTime(96, T + 1.4);
      o.frequency.linearRampToValueAtTime(82, T + 2.6);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 23;
      const lg = ctx.createGain();
      lg.gain.value = 6;
      lfo.connect(lg).connect(o.frequency);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 700;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, T);
      g.gain.linearRampToValueAtTime(0.14, T + 0.25);
      g.gain.linearRampToValueAtTime(0.1, T + 1.2);
      g.gain.exponentialRampToValueAtTime(0.0001, T + 2.8);
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      o.connect(f).connect(g);
      if (p) {
        p.pan.setValueAtTime(px(x), T);
        p.pan.linearRampToValueAtTime(1, T + 2.6);
        g.connect(p).connect(sfxBus);
      } else g.connect(sfxBus);
      o.start(T); lfo.start(T); o.stop(T + 3); lfo.stop(T + 3);
      tone({ f: 1500, t: 0.05, d: 0.08, g: 0.03, type: 'square', p: px(x) }); // horn blip
      tone({ f: 1500, t: 0.17, d: 0.12, g: 0.03, type: 'square', p: px(x) });
    },
    register() {
      if (!ok('register', 0.3)) return;
      noise({ type: 'bandpass', f: 1800, d: 0.08, g: 0.12, q: 2, p: 0.4 });
      [2093, 2637, 3136].forEach((f, i) => tone({ f, t: 0.08 + i * 0.015, d: 0.9, g: 0.05, p: 0.4 }));
    },
    coin() { if (!ok('coin', 0.07, true)) return; tone({ f: 1568, d: 0.08, g: 0.06 }); tone({ f: 2093, t: 0.07, d: 0.35, g: 0.06 }); },
    ding() {
      if (!ok('ding', 0.25)) return;
      tone({ f: 2637, d: 1.1, g: 0.08 });
      tone({ f: 2637 * 2.4, d: 0.4, g: 0.015 });
      tone({ f: 2637 * 0.5, d: 0.6, g: 0.02 });
    },
    crack() {
      if (!ok('crack', 0.15)) return;
      noise({ type: 'highpass', f: 2200, d: 0.05, g: 0.3 });
      noise({ t: 0.03, type: 'bandpass', f: 1200, d: 0.08, g: 0.15, q: 3 });
      tone({ f: 140, f2: 70, d: 0.18, g: 0.18 });
    },
    sparkle() {
      if (!ok('sparkle', 0.2)) return;
      [1568, 1976, 2349, 3136].forEach((f, i) => tone({ f, t: i * 0.06, d: 0.35, g: 0.045 }));
    },
    fridgeOpen() {
      if (!ok('fridge', 0.2)) return;
      noise({ type: 'lowpass', f: 500, f2: 200, d: 0.2, g: 0.25 });
      noise({ t: 0.05, f: 3000, q: 0.5, d: 0.3, a: 0.05, g: 0.04 });
      tone({ f: 120, d: 1.2, g: 0.03, a: 0.2, type: 'sawtooth', p: -0.8 });
    },
    fridgeClose() { if (!ok('fridgec', 0.2)) return; noise({ type: 'lowpass', f: 300, d: 0.12, g: 0.4, p: -0.8 }); tone({ f: 90, f2: 60, d: 0.12, g: 0.2, p: -0.8 }); },
    scrape() {
      if (!ok('scrape', 0.3)) return;
      for (let i = 0; i < 6; i++) noise({ t: i * 0.06, f: 380 + Math.random() * 200, q: 4, d: 0.07, g: 0.12 });
    },
    door(x) { if (!ok('door', 0.4, true)) return; noise({ type: 'lowpass', f: 700, d: 0.12, g: 0.1, p: px(x) }); },
    rustle(x) { if (!ok('rustle', 0.2, true)) return; for (let i = 0; i < 5; i++) noise({ t: i * 0.05, f: 3000 + Math.random() * 2000, q: 1.2, d: 0.05, g: 0.05, p: px(x) }); },
    whoosh() { if (!ok('whoosh', 0.2)) return; noise({ f: 300, f2: 2400, a: 0.12, d: 0.32, g: 0.12, q: 0.8 }); },
    sip(x) { if (!ok('sip', 1.2, true)) return; noise({ f: 1400, f2: 900, q: 6, d: 0.22, a: 0.05, g: 0.03, p: px(x) }); },
    thud(x) { if (!ok('thud', 0.1, true)) return; tone({ f: 120, f2: 70, d: 0.12, g: 0.15, p: px(x) }); noise({ type: 'lowpass', f: 600, d: 0.06, g: 0.12, p: px(x) }); },
    rip() { if (!ok('rip', 0.1)) return; noise({ f: 3000, f2: 1400, q: 0.8, d: 0.16, g: 0.14 }); },
    open() {
      // shop sign flip + bell + warm chord
      S.chime(1400);
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone({ f, t: 0.35 + i * 0.07, d: 1.6, g: 0.05, type: 'triangle' }));
    },
  };

  /* ---------- ambience: room tone + rain + street ---------- */
  let rainGain = null, roomGain = null;
  function startAmbience() {
    const room = ctx.createBufferSource();
    room.buffer = brownBuf;
    room.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    roomGain = ctx.createGain();
    roomGain.gain.value = 0.05;
    room.connect(lp).connect(roomGain).connect(ambBus);
    room.start();

    const rain = ctx.createBufferSource();
    rain.buffer = noiseBuf;
    rain.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 0.4;
    rainGain = ctx.createGain();
    rainGain.gain.value = 0;
    rain.connect(bp).connect(rainGain).connect(ambBus);
    rain.start();

    // occasional cup clinks and murmurs
    setInterval(() => {
      if (!ctx || muted || !B.state || B.state.paused) return;
      if (Math.random() < 0.5) tone({ f: 2600 + Math.random() * 1600, d: 0.25, g: 0.012, p: Math.random() * 1.6 - 0.8, dest: ambBus });
    }, 1700);
  }

  B.audio = {
    init,
    play(name, ...args) {
      try { if (S[name]) S[name](...args); } catch (e) { /* audio is best-effort */ }
    },
    setRain(level) {
      if (!rainGain) return;
      rainGain.gain.setTargetAtTime(level * 0.09, ctx.currentTime, 1.5);
    },
    setBusy(level) {
      if (!roomGain) return;
      roomGain.gain.setTargetAtTime(0.03 + level * 0.05, ctx.currentTime, 2);
    },
    toggle() {
      muted = !muted;
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.05);
      return muted;
    },
    get muted() { return muted; },
  };
})();
