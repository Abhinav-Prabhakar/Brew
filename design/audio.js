/* brew — sound. Every sound is synthesised with the Web Audio API (ported from the retired 3D lobby's audio.js:
   paper, thermal printer, scooter, rain, bells, cash…), so nothing is downloaded and nothing needs a licence.

   Mix: master → compressor. Buses: sfx (the room on screen), wall (sounds from the other rooms, muffled through a
   low-pass like a wall), amb (room tone per room + rain), music (a generative lo-fi bed that follows kitchen load).
   The "order up" bell ducks music and room tone. Pan follows the x position in the room. Every voice has a minimum
   gap and the whole mix has a voice budget, so a rush stays music, not noise. Night (café closed) is quieter.

   Events come from the live bus (backend.md §6.3). Catch-up bursts (hydrate, reconnect replay, events far behind the
   clock) stay silent. Audio starts on the first user gesture (browser rule). Settings (volume, mute, calm, captions)
   live in localStorage; calm mode = no music, softer effects, no clinks. Captions: a small paper strip that names the
   important sounds ("🔔 order #142 up"). */
(() => {
  const store = (() => { try { return JSON.parse(localStorage.getItem('brew.audio') || '{}'); } catch (e) { return {}; } })();
  const cfg = {vol: store.vol ?? .7, muted: store.muted ?? false, calm: store.calm ?? false, captions: store.captions ?? false};
  const save = () => { try { localStorage.setItem('brew.audio', JSON.stringify(cfg)); } catch (e) { /* private mode */ } };
  const silent = /[?&](still|mute)\b/.test(location.search) || navigator.webdriver;

  let ctx = null, master, sfxBus, wallBus, ambBus, musicBus, duckBus, noiseBuf, brownBuf;
  const last = {}; let budget = [];

  /* ---------------------------------------------------------------- engine */
  function init() {
    if (silent) return;
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    duckBus = ctx.createGain(); duckBus.connect(master);              // music + room tone sit under the bell
    sfxBus = ctx.createGain(); sfxBus.connect(master);
    const wall = ctx.createBiquadFilter(); wall.type = 'lowpass'; wall.frequency.value = 650;
    wallBus = ctx.createGain(); wallBus.gain.value = .32; wallBus.connect(wall).connect(master);
    ambBus = ctx.createGain(); ambBus.connect(duckBus);
    musicBus = ctx.createGain(); musicBus.connect(duckBus);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    brownBuf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const b = brownBuf.getChannelData(0); let lo = 0;
    for (let i = 0; i < b.length; i++) { lo = (lo + .02 * (Math.random() * 2 - 1)) / 1.02; b[i] = lo * 3.5; }
    startAmbience(); startMusic(); apply();
  }
  const T0 = () => ctx.currentTime;
  function apply() {
    if (!ctx) return;
    const night = !(R.S()?.clock?.is_open ?? true);
    master.gain.setTargetAtTime(cfg.muted ? 0 : cfg.vol * (night ? .6 : 1), T0(), .08);
    sfxBus.gain.setTargetAtTime(cfg.calm ? .5 : 1, T0(), .1);
    musicBus.gain.setTargetAtTime(cfg.calm ? 0 : .55, T0(), .6);
  }
  /** a voice may play: not muted, its own minimum gap passed, and the mix has room (≤ 9 voices / 400 ms) */
  function ok(name, gap = .05) {
    if (!ctx || cfg.muted || ctx.state !== 'running') return false;
    const t = T0(); if (last[name] && t - last[name] < gap) return false;
    budget = budget.filter((x) => t - x < .4); if (budget.length >= 9) return false;
    last[name] = t; budget.push(t); return true;
  }
  function env(g, t, a, peak, dcy) { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(.0001, t + a + dcy); }
  function pan(node, p) { if (!ctx.createStereoPanner || p == null) return node; const s = ctx.createStereoPanner(); s.pan.value = Math.max(-1, Math.min(1, p)); node.connect(s); return s; }
  let DEST = null;  // the bus the current voice goes to (sfx or wall), set by play()
  function tone({f = 440, f2, type = 'sine', t = 0, a = .005, d = .2, g = .2, p, dest}) {
    const T = T0() + t, o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, T);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, T + a + d);
    const gn = ctx.createGain(); env(gn, T, a, g, d); o.connect(gn); pan(gn, p).connect(dest || DEST || sfxBus);
    o.start(T); o.stop(T + a + d + .05);
  }
  function noise({t = 0, a = .005, d = .15, g = .2, type = 'bandpass', f = 1000, f2, q = 1, p, buf, dest}) {
    const T = T0() + t, s = ctx.createBufferSource(); s.buffer = buf || noiseBuf; s.loop = true;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, T);
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, T + a + d); fl.Q.value = q;
    const gn = ctx.createGain(); env(gn, T, a, g, d); s.connect(fl).connect(gn); pan(gn, p).connect(dest || DEST || sfxBus);
    s.start(T, Math.random()); s.stop(T + a + d + .05);
  }
  const px = (x) => (x == null ? 0 : (x / 1600) * 1.6 - .8);

  /* ---------------------------------------------------------------- voices */
  const V = {
    click() { tone({f: 1400, f2: 900, d: .04, g: .05, type: 'triangle'}); },
    chime(x) { [[1318.5, 0], [1046.5, .16]].forEach(([f, t]) => { tone({f, t, d: 1.3, g: .07, p: px(x)}); tone({f: f * 2.76, t, d: .45, g: .015, p: px(x)}); }); },
    slide(x) { noise({f: 2600, f2: 900, d: .28, a: .03, g: .11, q: .7, p: px(x)}); },
    clip(x) { tone({f: 2900, type: 'triangle', d: .05, g: .08, p: px(x)}); tone({f: 4300, d: .04, g: .04, t: .012, p: px(x)}); noise({f: 5200, type: 'highpass', d: .02, g: .1, p: px(x)}); },
    tear(x) { for (let i = 0; i < 16; i++) noise({t: i * .017 + Math.random() * .008, f: 2400 + Math.random() * 2400, q: 2, d: .018, g: .14 + Math.random() * .1, p: px(x)}); noise({f: 1800, f2: 4000, d: .26, g: .05, q: .5, p: px(x)}); },
    printer(n = 6) { for (let i = 0; i < n; i++) { tone({t: i * .07, f: 1180 + (i % 3) * 40, type: 'square', d: .05, a: .004, g: .018, p: .45}); noise({t: i * .07, f: 4200, q: 3, d: .012, g: .04, p: .45}); }
      tone({t: n * .07, f: 220, f2: 260, type: 'sawtooth', d: .3, g: .016, p: .45}); },
    page() { noise({f: 700, f2: 3200, a: .06, d: .32, g: .14, q: .6}); noise({t: .18, f: 2200, f2: 900, d: .18, g: .07, q: .9}); noise({t: .36, type: 'lowpass', f: 400, d: .06, g: .1}); },
    pen() { for (let i = 0; i < 9; i++) noise({t: i * .045 + Math.random() * .015, f: 3600 + Math.random() * 1800, q: 5, d: .03, g: .05}); },
    stamp() { tone({f: 150, f2: 60, d: .14, g: .22}); noise({type: 'lowpass', f: 900, d: .07, g: .22}); noise({t: .02, f: 2400, q: 1, d: .04, g: .05}); },
    huff(x) { const T = T0(), o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(190, T); o.frequency.exponentialRampToValueAtTime(105, T + .38);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 620; f.Q.value = 3;
      const g = ctx.createGain(); env(g, T, .02, .14, .4); o.connect(f).connect(g); pan(g, px(x)).connect(DEST || sfxBus); o.start(T); o.stop(T + .5);
      noise({type: 'lowpass', f: 900, d: .45, a: .03, g: .1, p: px(x)}); },
    scooter(x) { const T = T0(), o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(52, T); o.frequency.linearRampToValueAtTime(96, T + 1.4); o.frequency.linearRampToValueAtTime(82, T + 2.6);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 23; const lg = ctx.createGain(); lg.gain.value = 6; lfo.connect(lg).connect(o.frequency);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
      const g = ctx.createGain(); g.gain.setValueAtTime(.0001, T); g.gain.linearRampToValueAtTime(.12, T + .25); g.gain.linearRampToValueAtTime(.08, T + 1.2); g.gain.exponentialRampToValueAtTime(.0001, T + 2.8);
      o.connect(f).connect(g);
      if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.setValueAtTime(px(x), T); p.pan.linearRampToValueAtTime(1, T + 2.6); g.connect(p).connect(DEST || sfxBus); } else g.connect(DEST || sfxBus);
      o.start(T); lfo.start(T); o.stop(T + 3); lfo.stop(T + 3);
      tone({f: 1500, t: .05, d: .08, g: .025, type: 'square', p: px(x)}); tone({f: 1500, t: .17, d: .12, g: .025, type: 'square', p: px(x)}); },
    /* the bill: a thermal receipt printer at the register. One stepper-motor voice for the whole job (a buzzy saw
       through the plastic body's resonance, chopped by the motor's steps), gated line by line with the tiny stalls a
       real printer makes while it waits for data; the QR prints slower and lower (dense graphics); a smooth paper
       feed; then the auto-cutter: a short motor grunt, the blade snap and the slip dropping. Returns its length. */
    bill(n = 8, x = 150) {
      const T = T0(), p = px(x), dest = DEST || sfxBus, J = () => .8 + Math.random() * .4;
      const mot = ctx.createOscillator(); mot.type = 'sawtooth';
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1750; bp.Q.value = .8;
      const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 430; body.Q.value = 2.2; body.gain.value = 9;
      const vca = ctx.createGain(); vca.gain.value = .62;
      const steps = ctx.createOscillator(); steps.type = 'square'; steps.frequency.value = 68;
      const depth = ctx.createGain(); depth.gain.value = .38; steps.connect(depth).connect(vca.gain);
      const gate = ctx.createGain(); gate.gain.setValueAtTime(0, T);
      mot.connect(bp).connect(body).connect(vca).connect(gate);
      const fr = ctx.createBufferSource(); fr.buffer = noiseBuf; fr.loop = true;            // paper sliding over the head
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3200;
      const fg = ctx.createGain(); fg.gain.value = .5; fr.connect(hp).connect(fg).connect(gate);
      pan(gate, p).connect(dest);
      let t = T + .03;
      const line = (dur, f, g) => { mot.frequency.setValueAtTime(f, t); steps.frequency.setValueAtTime(f / 17, t);
        gate.gain.setTargetAtTime(g, t, .004); t += dur; };
      const stall = (dur) => { gate.gain.setTargetAtTime(.006, t, .005); t += dur; };
      for (let i = 0; i < n; i++) { line(.05 * J(), 1080 + Math.random() * 140, .085); if (Math.random() < .55) stall(.02 * J()); }
      stall(.05);
      for (let i = 0; i < 6; i++) line(.06, 820 + (i % 2) * 30, .1);                  // the QR: slow, dense, lower
      gate.gain.setTargetAtTime(.07, t, .01); mot.frequency.setValueAtTime(1350, t);     // feed: smooth, a step higher
      steps.frequency.setValueAtTime(140, t); mot.frequency.linearRampToValueAtTime(1500, t + .28); t += .3;
      gate.gain.setTargetAtTime(0, t, .012);
      for (const o of [mot, steps, fr]) { o.start(T); o.stop(t + .1); }
      const c = t + .08 - T;                                                              // the auto-cutter
      tone({t: c, f: 190, f2: 120, type: 'sawtooth', a: .01, d: .07, g: .05, p});
      noise({t: c + .075, type: 'highpass', f: 2600, d: .025, g: .2, p});
      tone({t: c + .075, f: 950, f2: 480, type: 'triangle', d: .045, g: .05, p});
      noise({t: c + .12, f: 1300, q: .7, a: .01, d: .14, g: .035, p});
      billEnd = T + c + .2;
      return c + .2;
    },
    /* money in, after the bill: a cash drawer (lever clack, drawer roll, bell), the UPI soundbox chime every Indian
       counter has, or the card terminal's double beep */
    drawer(t = 0) { const p = px(150);
      noise({t, f: 1500, q: 2, d: .03, g: .14, p}); tone({t, f: 140, f2: 80, d: .08, g: .1, p});
      noise({t: t + .05, type: 'lowpass', f: 380, f2: 900, a: .03, d: .22, g: .1, p});
      [2390, 3580, 5170, 6010].forEach((f, i) => tone({t: t + .11 + i * .004, f, d: 1 - i * .18, g: .045 / (1 + i * .6), p}));
      tone({t: t + .32, f: 110, f2: 70, d: .1, g: .1, p}); },
    soundbox(t = 0) { const p = px(150);
      tone({t, f: 987.8, type: 'triangle', a: .01, d: .18, g: .07, p}); tone({t: t + .14, f: 1479.98, type: 'triangle', a: .01, d: .55, g: .07, p});
      tone({t: t + .14, f: 2959.96, d: .25, g: .012, p}); },
    beep(t = 0) { const p = px(150); [0, .17].forEach((d) => tone({t: t + d, f: 2730, type: 'square', d: .09, a: .003, g: .022, p})); },
    register() { noise({f: 1800, d: .08, g: .1, q: 2, p: .4}); [2093, 2637, 3136].forEach((f, i) => tone({f, t: .08 + i * .015, d: .8, g: .04, p: .4})); },
    coin() { tone({f: 1568, d: .08, g: .05, p: .4}); tone({f: 2093, t: .07, d: .3, g: .05, p: .4}); },
    /* fast-forward: a tape motor spinning up (or winding down to real time) */
    ff(up = true) { const T = T0(), o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(up ? 90 : 520, T); o.frequency.exponentialRampToValueAtTime(up ? 560 : 80, T + .45);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(up ? 600 : 2400, T); f.frequency.exponentialRampToValueAtTime(up ? 2600 : 500, T + .45);
      const g = ctx.createGain(); env(g, T, .04, .05, .5); o.connect(f).connect(g).connect(DEST || sfxBus); o.start(T); o.stop(T + .6);
      noise({type: 'bandpass', f: up ? 900 : 2600, f2: up ? 3200 : 700, q: .7, a: .05, d: .42, g: .05}); },
    /* ---- easter-egg voices (eggs.js) ---- */
    cuckoo(n = 1) { for (let i = 0; i < Math.min(12, n); i++) { const t = i * .62;
      tone({t, f: 784, type: 'triangle', a: .01, d: .2, g: .07, p: .6}); tone({t: t + .2, f: 622, type: 'triangle', a: .01, d: .32, g: .07, p: .6}); } },
    purr(x) { const T = T0(), s = ctx.createBufferSource(); s.buffer = brownBuf; s.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
      const am = ctx.createGain(); am.gain.value = 0; const lfo = ctx.createOscillator(); lfo.frequency.value = 24; const lg = ctx.createGain(); lg.gain.value = .5;
      lfo.connect(lg).connect(am.gain); const g = ctx.createGain(); g.gain.setValueAtTime(.0001, T); g.gain.linearRampToValueAtTime(.5, T + .3); g.gain.setValueAtTime(.5, T + 1.6); g.gain.exponentialRampToValueAtTime(.0001, T + 2.4);
      s.connect(lp).connect(am).connect(g); pan(g, px(x)).connect(DEST || sfxBus); s.start(T); lfo.start(T); s.stop(T + 2.5); lfo.stop(T + 2.5); },
    squeak(x, hi = 1) { tone({f: 1900 * hi, f2: 2900 * hi, d: .09, g: .05, type: 'triangle', p: px(x)}); tone({t: .1, f: 2700 * hi, f2: 1700 * hi, d: .12, g: .04, type: 'triangle', p: px(x)}); },
    kettle() { const T = T0(), o = ctx.createOscillator(); o.frequency.setValueAtTime(1500, T); o.frequency.linearRampToValueAtTime(2350, T + 1.4);
      const g = ctx.createGain(); g.gain.setValueAtTime(.0001, T); g.gain.linearRampToValueAtTime(.035, T + .9); g.gain.setValueAtTime(.035, T + 1.6); g.gain.exponentialRampToValueAtTime(.0001, T + 2);
      const vib = ctx.createOscillator(); vib.frequency.value = 6; const vg = ctx.createGain(); vg.gain.value = 18; vib.connect(vg).connect(o.frequency);
      o.connect(g).connect(DEST || sfxBus); o.start(T); vib.start(T); o.stop(T + 2.1); vib.stop(T + 2.1);
      noise({f: 2500, q: .8, a: .6, d: 1.3, g: .03}); },
    radio() { for (let i = 0; i < 7; i++) noise({t: i * .05, f: 800 + Math.random() * 3000, q: 3, d: .05, g: .06, p: .75});
      tone({t: .12, f: 1200, f2: 300, d: .25, g: .02, type: 'sine', p: .75}); },
    clink() { tone({f: 3200, d: .18, g: .05, p: .2}); tone({t: .06, f: 4100, d: .3, g: .04, p: .2}); tone({t: .13, f: 2700, d: .25, g: .025, p: .2}); },
    jingle() { [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5].forEach((f, i) => tone({t: i * .09, f, type: 'square', d: .1, a: .004, g: .03})); },
    bell(x) { tone({f: 2637, d: 1.1, g: .08, p: px(x)}); tone({f: 2637 * 2.4, d: .4, g: .015, p: px(x)}); tone({f: 1318, d: .6, g: .02, p: px(x)}); duck(); },
    warn(x) { [0, .16].forEach((t) => tone({f: 880, f2: 660, t, d: .11, g: .07, type: 'square', p: px(x)})); },
    sparks(x) { for (let i = 0; i < 10; i++) noise({t: .2 + i * .03 + Math.random() * .04, type: 'highpass', f: 3500 + Math.random() * 3000, d: .02, g: .12, p: px(x)}); tone({t: .2, f: 140, f2: 70, d: .18, g: .12, p: px(x)}); },
    sparkle() { [1568, 1976, 2349, 3136].forEach((f, i) => tone({f, t: i * .06, d: .35, g: .04})); },
    fridgeOpen() { noise({type: 'lowpass', f: 500, f2: 200, d: .2, g: .22, p: -.6}); noise({t: .05, f: 3000, q: .5, d: .3, a: .05, g: .035, p: -.6}); },
    fridgeClose() { noise({type: 'lowpass', f: 300, d: .12, g: .35, p: -.6}); tone({f: 90, f2: 60, d: .12, g: .18, p: -.6}); },
    thud(x) { tone({f: 120, f2: 70, d: .12, g: .13, p: px(x)}); noise({type: 'lowpass', f: 600, d: .06, g: .1, p: px(x)}); },
    whoosh() { noise({f: 300, f2: 2400, a: .12, d: .32, g: .07, q: .8}); },
    // kitchen stations (task.started): short, recognisable, quiet
    espresso(x) { noise({f: 5200, f2: 3000, q: .8, a: .15, d: 1.4, g: .05, p: px(x)}); noise({type: 'lowpass', f: 260, a: .1, d: 1.2, g: .06, p: px(x)}); },
    grinder(x) { const T = T0(), o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(160, T); o.frequency.linearRampToValueAtTime(190, T + .9);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.5; const g = ctx.createGain(); env(g, T, .05, .045, 1);
      o.connect(f).connect(g); pan(g, px(x)).connect(DEST || sfxBus); o.start(T); o.stop(T + 1.1); noise({f: 2600, q: 1, a: .05, d: 1, g: .04, p: px(x)}); },
    sizzle(x) { noise({type: 'highpass', f: 4200, a: .08, d: 1.6, g: .05, p: px(x)}); for (let i = 0; i < 8; i++) noise({t: Math.random() * 1.4, type: 'highpass', f: 6000, d: .015, g: .06, p: px(x)}); },
    blender(x) { const T = T0(), o = ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(110, T); o.frequency.linearRampToValueAtTime(240, T + .4);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1200; const g = ctx.createGain(); env(g, T, .1, .035, 1.4);
      o.connect(f).connect(g); pan(g, px(x)).connect(DEST || sfxBus); o.start(T); o.stop(T + 1.6); },
    oven(x) { tone({f: 1760, d: .12, g: .03, p: px(x)}); tone({f: 1760, t: .2, d: .12, g: .03, p: px(x)}); },
    open() { V.chime(1440); [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone({f, t: .35 + i * .07, d: 1.6, g: .04, type: 'triangle'})); },
    close() { [783.99, 659.25, 523.25, 392].forEach((f, i) => tone({f, t: i * .12, d: 1.4, g: .035, type: 'triangle'})); },
  };
  const GAP = {click: .03, chime: .9, slide: .12, clip: .1, tear: .15, printer: .6, page: .2, pen: .25, stamp: .2, huff: .5, scooter: 1.5,
    register: .5, coin: .15, bell: .35, warn: .5, sparks: .5, sparkle: .4, fridgeOpen: .4, fridgeClose: .4, thud: .15, whoosh: .3,
    espresso: 1.5, grinder: 2, sizzle: 2, blender: 2.5, oven: 1.5, open: 5, close: 5,
    bill: 1.1, drawer: .6, soundbox: .5, beep: .5, ff: .2, cuckoo: 1, purr: 2, squeak: .15, kettle: 2.5, radio: .3, clink: .08, jingle: 1};
  let billEnd = 0;  // ctx time the bill in the printer finishes (the money sound waits for the cut)

  /** play a voice for a room: on screen → sfx bus, other rooms → through the wall, 'ui' → always on screen */
  function play(name, room = 'ui', ...args) {
    if (!V[name] || !ok(name, GAP[name] ?? .05)) return;
    const here = room === 'ui' || room === document.body.dataset.room;
    if (!here && cfg.calm) return;
    DEST = here ? sfxBus : wallBus;
    try { V[name](...args); } catch (e) { /* audio is best-effort */ } finally { DEST = null; }
  }
  function duck() {
    const t = T0(); duckBus.gain.cancelScheduledValues(t); duckBus.gain.setTargetAtTime(.35, t, .03); duckBus.gain.setTargetAtTime(1, t + .9, .5);
  }

  /* ---------------------------------------------------------------- ambience: one room tone per room */
  const tones = {};
  function bed(room, build) { const g = ctx.createGain(); g.gain.value = 0; build(g); g.connect(ambBus); tones[room] = g; }
  let rainGain = null;
  function startAmbience() {
    const src = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * 2); return s; };
    const filt = (type, f, q = .7) => { const x = ctx.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; return x; };
    bed('lobby', (g) => { src(brownBuf).connect(filt('bandpass', 420, .6)).connect(g);   // murmur, breathing slowly
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = .11; lg.gain.value = .25; lfo.connect(lg).connect(g.gain); lfo.start(); });
    bed('kitchen', (g) => { src(brownBuf).connect(filt('lowpass', 320)).connect(g);       // extraction hood
      const hiss = ctx.createGain(); hiss.gain.value = .05; src(noiseBuf).connect(filt('bandpass', 1400, 1.2)).connect(hiss).connect(g); });
    bed('pantry', (g) => { const o = ctx.createOscillator(), o2 = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 59; o2.frequency.value = 118;  // compressor hum
      const lp = filt('lowpass', 240); o.connect(lp); o2.connect(lp); const h = ctx.createGain(); h.gain.value = .35; lp.connect(h).connect(g); o.start(); o2.start();
      src(brownBuf).connect(filt('lowpass', 180)).connect(g); });
    const rain = src(noiseBuf), bp = filt('bandpass', 2400, .4); rainGain = ctx.createGain(); rainGain.gain.value = 0; rain.connect(bp).connect(rainGain).connect(ambBus);
    setInterval(() => {                                       // cup clinks in the lobby while it's busy
      if (!ctx || cfg.muted || cfg.calm || document.body.dataset.room !== 'lobby' || !R.S()?.clock?.is_open) return;
      if (Math.random() < .45) tone({f: 2600 + Math.random() * 1600, d: .25, g: .01, p: Math.random() * 1.6 - .8, dest: ambBus});
    }, 1700);
    setInterval(updateAmbience, 1000); updateAmbience();
  }
  function updateAmbience() {
    if (!ctx) return;
    const s = R.S() || {}, room = document.body.dataset.room, open = s.clock?.is_open ?? true, load = Math.min(1, (s.kpis?.load_pct ?? 30) / 100);
    const level = {lobby: open ? .05 + load * .06 : .02, kitchen: open ? .05 + load * .05 : .015, pantry: .05};
    for (const [r, g] of Object.entries(tones)) g.gain.setTargetAtTime(r === room ? level[r] : 0, T0(), 1.2);  // crossfade on room change
    const rain = s.weather?.rain_mm_h ?? (/rain|drizzle/.test(s.weather?.state || '') ? 2 : 0);
    rainGain.gain.setTargetAtTime(Math.min(1, rain / 6) * .08, T0(), 2);
    music.load = load; music.open = open; music.rate = s.world?.rate ?? 1; apply();
  }

  /* ---------------------------------------------------------------- music: a generative lo-fi bed */
  // Four soft electric-piano chords (ii–V–I–vi in F) over a warm sub, a brushed hat when the kitchen is busy, vinyl
  // crackle. Tempo and brightness follow kitchen load; at night only the chords remain, slower.
  const music = {load: .3, open: true, next: 0, step: 0, station: 0, rate: 1};
  const hz = (cs) => cs.map((c) => c.map((m) => 440 * 2 ** ((m - 69) / 12)));
  const CH = hz([[55, 60, 64, 67], [52, 55, 60, 64], [53, 57, 60, 64], [50, 53, 57, 62]]);
  // the lobby radio's stations (eggs.js tunes it): the house lo-fi, a slow minor monsoon, a bright swingy chai-time
  const STATIONS = [
    {name: '92.7 brew fm', ch: CH, bpm: (m) => (m.open ? 66 + m.load * 18 : 56), hat: (m) => m.open && m.load > .35, lp: 900},
    {name: '98.3 monsoon fm', ch: hz([[57, 60, 64, 67], [53, 57, 60, 64], [50, 53, 57, 60], [52, 55, 59, 62]]), bpm: () => 52, hat: () => false, lp: 650},
    {name: '104.8 chai-time fm', ch: hz([[60, 64, 67, 69], [57, 61, 64, 67], [62, 65, 69, 72], [55, 59, 62, 65]]), bpm: (m) => 84 + m.load * 10, hat: () => true, lp: 1500},
  ];
  let lpMusic = null;
  function startMusic() {
    lpMusic = ctx.createBiquadFilter(); lpMusic.type = 'lowpass'; lpMusic.frequency.value = 1400; lpMusic.connect(musicBus);
    const cr = ctx.createBufferSource(); cr.buffer = noiseBuf; cr.loop = true; const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5000;
    const cg = ctx.createGain(); cg.gain.value = .006; cr.connect(hp).connect(cg).connect(musicBus); cr.start();
    music.next = T0() + .2;
    setInterval(schedule, 200);
  }
  function schedule() {
    if (!ctx || cfg.calm || cfg.muted) { if (ctx) music.next = Math.max(music.next, T0() + .1); return; }
    const S = STATIONS[music.station] || STATIONS[0];
    const bpm = S.bpm(music) * (music.rate > 1 ? 1.12 : 1), beat = 60 / bpm;  // fast-forward: the tape runs a hair quick
    lpMusic.frequency.setTargetAtTime(S.lp + music.load * 1600, T0(), 2);
    while (music.next < T0() + .6) {
      const t = music.next - T0(), st = music.step, chord = S.ch[Math.floor(st / 8) % 4];
      if (st % 8 === 0) chord.forEach((f, i) => tone({f, t: t + i * .012, a: .02, d: beat * 7, g: .022, type: 'triangle', dest: lpMusic}));
      if (st % 4 === 0) tone({f: chord[0] / 2, t, a: .02, d: beat * 3, g: .05, dest: lpMusic});
      if (st % 2 === 1 && S.hat(music)) noise({t, type: 'highpass', f: 7000, d: .05, g: .012 * Math.max(.4, music.load), dest: musicBus});
      if (st % 8 === 6 && Math.random() < .5) tone({f: chord[3] * 2, t, a: .01, d: beat * 1.5, g: .012, type: 'triangle', dest: lpMusic});
      music.next += beat / 2; music.step++;
    }
  }

  /* ---------------------------------------------------------------- captions */
  const cap = document.createElement('div'); cap.id = 'captions'; cap.setAttribute('aria-hidden', 'true');
  document.getElementById('viewport')?.appendChild(cap);
  function caption(text) {
    if (!cfg.captions || !text) return;
    const el = document.createElement('span'); el.textContent = text; cap.appendChild(el);
    while (cap.children.length > 3) cap.firstChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 500); }, 2600);
  }

  /* the UPI soundbox's voice ("₹415 received"), off unless an egg turns it on (eggs.js: type "upi") */
  let soundboxVoice = false, lastSpoke = 0;
  function speak(amount, wait = 0) {
    if (!window.speechSynthesis || cfg.muted || amount == null || document.body.dataset.room !== 'lobby' || performance.now() - lastSpoke < 4000) return;
    lastSpoke = performance.now();
    setTimeout(() => { const u = new SpeechSynthesisUtterance(`${Math.round(amount)} rupees received`);
      const v = speechSynthesis.getVoices().find((x) => /en-IN/i.test(x.lang)); if (v) u.voice = v;
      u.lang = 'en-IN'; u.rate = 1.08; u.pitch = 1.1; u.volume = Math.min(1, cfg.vol * .8); speechSynthesis.speak(u); }, (wait + .7) * 1000);
  }

  /* ---------------------------------------------------------------- events → sounds */
  const L = () => window.BrewLive || {};
  const fresh = (ev) => { const st = L().status; if (st && !['live', 'replay', 'offline-demo', 'dev'].includes(st)) return false;
    // "fresh" = within ~45 sim-s of the clock; fast-forward widens it (60× → a few wall seconds), catch-up still stays silent
    return !ev || ev.sim_s == null || Math.abs(R.now() - ev.sim_s) < 45 * Math.max(1, (R.S()?.world?.rate ?? 1) / 10); };
  const bookOpen = () => !!window.BREW_MENUBOOK?.isOpen;
  const KX = {prep: 230, oven: 400, fryer: 545, press: 705, espresso: 930, bar: 1012, grinder: 1095, blender: 1175, cold: 1266, dishpit: 1405, pass: 640};
  const STATION_VOICE = {espresso: 'espresso', grinder: 'grinder', fryer: 'sizzle', press: 'sizzle', blender: 'blender', oven: 'oven'};
  const ON = {
    'customer.arrived': () => play('chime', 'lobby', 1440),
    'order.placed': () => play('slide', 'lobby', 1290),
    'batch.formed': () => play('clip', 'lobby', 800),
    'order.ready': (d) => { play('bell', 'ui', 640); caption(`🔔 order ${d?.order_no != null ? '#' + d.order_no + ' ' : ''}up`); },
    'order.served': () => play('tear', 'lobby', 800),
    // every customer's bill prints at the register when they pay; the money sound lands after the cutter
    'receipt.printed': (d) => play('bill', 'lobby', Math.min(14, 6 + (d?.lines?.length || 2)), 150),
    'payment.received': (d) => { const wait = ctx ? Math.max(0, billEnd - T0()) + .06 : 0, m = d?.method;
      play(m === 'cash' ? 'drawer' : m === 'card' ? 'beep' : 'soundbox', 'lobby', wait);
      if (m === 'upi' && soundboxVoice) speak(d?.amount, wait); },
    'rider.picked_up': () => { play('scooter', 'lobby', 1500); caption('🛵 rider away'); },
    'price.changed': () => { if (bookOpen()) play('pen'); },
    'replate.marked_down': () => { if (bookOpen()) play('stamp'); },
    'customer.reneged': () => { play('huff', 'lobby', 900); caption('😤 a customer walked out'); },
    'task.started': (d) => { const v = STATION_VOICE[d?.station]; if (v) play(v, 'kitchen', KX[d.station]); },
    'equipment.down': (d) => { const x = KX[d?.station] ?? 800; play('warn', 'ui', x); play('sparks', 'kitchen', x); caption(`⚠ ${R.human(d?.equipment || d?.station || 'equipment')} down`); },
    'equipment.up': (d) => { play('sparkle', 'kitchen'); caption(`✓ ${R.human(d?.equipment || d?.station || 'equipment')} fixed`); },
    'chaos.triggered': (d) => { if (!/equipment|oven|espresso|power/.test(d?.kind || '')) play('warn', 'ui'); caption(`⚡ ${R.human(d?.kind || 'disruption')}`); },
    'po.received': () => play('thud', 'pantry', 1200),
    'investment.delivered': () => { play('sparkle', 'ui'); caption('✨ investment delivered'); },
    'day.started': () => play('open', 'lobby'),
    'day.ended': () => play('close', 'lobby'),
    'ui.page': () => play('page'),
    'ui.ff': (d) => play('ff', 'ui', (d?.rate ?? 2) > 1),
    'camera.zoom': () => play('whoosh'),
  };
  const bus = window.BREW_LIVE;
  for (const [type, fn] of Object.entries(ON)) bus?.on?.(type, (data, ev) => { if (ctx && fresh(ev)) fn(data, ev); });
  bus?.on?.('hydrate', () => { budget = []; setTimeout(updateAmbience, 0); });
  // room changes: a soft whoosh; the walk-in door thunks open as you arrive in the pantry and shuts as you leave
  let room = document.body.dataset.room;
  new MutationObserver(() => { const now = document.body.dataset.room; if (now === room) return;
    if (now === 'pantry') setTimeout(() => play('fridgeOpen', 'pantry'), 650); else if (room === 'pantry') play('fridgeClose', 'ui');
    play('whoosh'); room = now; updateAmbience(); }).observe(document.body, {attributes: true, attributeFilter: ['data-room']});
  // UI clicks on real buttons
  document.addEventListener('click', (e) => { if (ctx && e.target.closest('button, .btn, .tab, [data-action]')) play('click'); }, true);

  /* ---------------------------------------------------------------- first gesture + the HUD control */
  const gesture = () => { init(); };
  for (const t of ['pointerdown', 'keydown']) addEventListener(t, gesture, {capture: true, passive: true});
  window.BrewAudio = {
    init, play, cfg,
    set(k, v) { cfg[k] = v; save(); apply(); if (k === 'calm' || k === 'muted') updateAmbience(); render(); },
    get running() { return !!ctx && ctx.state === 'running'; },
    /** seconds until the bill in the printer is cut (hud.js times the "+₹" with it) */
    billLeft() { return ctx && ctx.state === 'running' && !cfg.muted ? Math.max(0, billEnd - T0()) : null; },
    /** the lobby radio (eggs.js): next station, returns its name */
    tune() { music.station = (music.station + 1) % STATIONS.length; music.step = 0; return STATIONS[music.station].name; },
    set soundbox(on) { soundboxVoice = !!on; }, get soundbox() { return soundboxVoice; },
  };

  // the HUD "bgm" button becomes a sound control: click = mute/unmute, the little panel has volume, calm, captions
  const btn = document.querySelector('#hud .bgm');
  let panel = null;
  function render() {
    if (!btn) return;
    btn.setAttribute('aria-label', cfg.muted ? 'sound off · open sound settings' : 'sound on · open sound settings');
    btn.querySelector('span').textContent = cfg.muted ? 'muted' : cfg.calm ? 'calm' : 'sound';
    btn.classList.toggle('off', cfg.muted); btn.title = 'sound settings';
    if (panel) {
      panel.querySelector('[data-k=muted]').checked = !cfg.muted; panel.querySelector('[data-k=vol]').value = Math.round(cfg.vol * 100);
      panel.querySelector('[data-k=calm]').checked = cfg.calm; panel.querySelector('[data-k=captions]').checked = cfg.captions;
    }
  }
  if (btn) {
    btn.setAttribute('aria-haspopup', 'true'); btn.setAttribute('aria-expanded', 'false');
    panel = document.createElement('div'); panel.id = 'soundpanel'; panel.className = 'card'; panel.hidden = true;
    panel.setAttribute('role', 'group'); panel.setAttribute('aria-label', 'sound settings');
    panel.innerHTML = `<label><input type="checkbox" data-k="muted"> sound</label>
      <label class="vol">volume <input type="range" min="0" max="100" step="5" data-k="vol" aria-label="volume"></label>
      <label><input type="checkbox" data-k="calm"> calm mode <small>no music · softer</small></label>
      <label><input type="checkbox" data-k="captions"> captions <small>“🔔 order up”</small></label>`;
    btn.parentElement.appendChild(panel);
    const toggle = (open) => { panel.hidden = !open; btn.setAttribute('aria-expanded', String(open)); if (open) panel.querySelector('input').focus(); };
    btn.addEventListener('click', (e) => { e.stopPropagation(); init(); toggle(panel.hidden); });
    panel.addEventListener('click', (e) => e.stopPropagation());
    panel.addEventListener('input', (e) => { const k = e.target.dataset.k; if (!k) return; init();
      if (k === 'muted') BrewAudio.set('muted', !e.target.checked); else if (k === 'vol') BrewAudio.set('vol', e.target.value / 100); else BrewAudio.set(k, e.target.checked); });
    panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { toggle(false); btn.focus(); } });
    document.addEventListener('click', () => { if (!panel.hidden) toggle(false); });
    render();
  }
})();
