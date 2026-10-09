/* brew · scene.js — sky, weather, street life, the door, light & camera */
(function () {
  const B = window.B, A = B.art;
  const root = document.documentElement;

  /* ---------------- sky keyframes (hour → colours) ---------------- */
  const SKY = [
    [5, '#3a3466', '#c58aa0'],
    [7, '#f4b8b0', '#ffe2c6'],
    [9, '#9fd3f2', '#fde6d6'],
    [12, '#7cc4f0', '#e8f4fb'],
    [16, '#8cc5ec', '#fbe6d2'],
    [17.8, '#f2a08c', '#ffd7a4'],
    [19, '#6d5aa0', '#f2a1a6'],
    [20.3, '#232454', '#4d3b78'],
    [24, '#1a1a40', '#33285a'],
  ];
  const lerpHex = A.mix;
  function skyAt(h) {
    for (let i = 0; i < SKY.length - 1; i++) {
      const [h0, t0, b0] = SKY[i], [h1, t1, b1] = SKY[i + 1];
      if (h >= h0 && h <= h1) {
        const k = (h - h0) / (h1 - h0);
        return [lerpHex(t0, t1, k), lerpHex(b0, b1, k)];
      }
    }
    return [SKY[0][1], SKY[0][2]];
  }

  const WX = {
    sunny: { label: 'Sunny', clouds: 2, grey: 0, wet: 0, sun: 1, dT: 1 },
    partly: { label: 'Partly cloudy', clouds: 5, grey: 0.08, wet: 0, sun: 0.8, dT: 0 },
    cloudy: { label: 'Overcast', clouds: 8, grey: 0.35, wet: 0, sun: 0.35, dT: -1 },
    drizzle: { label: 'Drizzle', clouds: 8, grey: 0.45, wet: 0.45, sun: 0.2, dT: -3 },
    rain: { label: 'Monsoon rain', clouds: 10, grey: 0.6, wet: 1, sun: 0.1, dT: -5 },
  };
  B.WX = WX;
  const NEXT = {
    sunny: [['sunny', 3], ['partly', 3]],
    partly: [['sunny', 2], ['cloudy', 3], ['partly', 1]],
    cloudy: [['drizzle', 3], ['partly', 2], ['rain', 1]],
    drizzle: [['rain', 3], ['cloudy', 2]],
    rain: [['drizzle', 3], ['rain', 1], ['cloudy', 1]],
  };

  const scene = (B.scene = {});
  let lastLight = -1;

  scene.update = function () {
    const mins = B.gameMin();
    const h = mins / 60;
    const w = WX[B.state.weather];
    let [top, bot] = skyAt(h);
    if (w.grey) {
      top = lerpHex(top, '#9a9cb0', w.grey);
      bot = lerpHex(bot, '#c9c6d2', w.grey);
    }
    root.style.setProperty('--sky-top', top);
    root.style.setProperty('--sky-bot', bot);

    // night factor: 18:30 → 20:00
    const night = B.clamp((h - 18.5) / 1.5, 0, 1);
    // daylight 0..1, peaks midday, scaled by weather
    const day = B.clamp(Math.sin(((h - 6.5) / 13) * Math.PI), 0, 1) * w.sun;
    root.style.setProperty('--night', night.toFixed(3));
    root.style.setProperty('--sun', (day * (1 - night)).toFixed(3));
    document.body.classList.toggle('night', night > 0.5);

    // interior ambient: warm at golden hour, cool-lavender at night, grey under rain
    let amb = '#ffffff', ao = 0;
    if (h > 16.5 && h < 19.5) { amb = '#ffcf9e'; ao = 0.22 * Math.sin(((h - 16.5) / 3) * Math.PI); }
    if (night > 0) { amb = lerpHex(amb, '#cbb6e6', night); ao = Math.max(ao, night * 0.24); }
    if (w.grey > 0.3) { amb = lerpHex(amb, '#d8d4e6', 0.5); ao = Math.max(ao, w.grey * 0.16); }
    root.style.setProperty('--amb', amb);
    root.style.setProperty('--amb-o', ao.toFixed(3));

    // sun & moon arc across the window band
    const sun = B.$('#sun'), moon = B.$('#moon');
    const sk = B.clamp((h - 6) / 13, 0, 1);
    gsap.set(sun, { x: 40 + sk * 1480, y: 250 - Math.sin(sk * Math.PI) * 120, opacity: (1 - night) * (0.35 + w.sun * 0.65) });
    const mk = B.clamp((h - 18.5) / 5, 0, 1);
    gsap.set(moon, { x: 200 + mk * 1100, y: 230 - Math.sin(mk * Math.PI * 0.8) * 70, opacity: night * (1 - w.grey * 0.6) });

    // window light patches skew with the sun
    const skew = (0.5 - sk) * 50;
    B.$$('.pool:not(.lamp)').forEach((p) => (p.style.transform = `skewX(${skew}deg)`));

    // neon flickers on in the evening (it's always on, just brighter at night)
    const lightLvl = Math.round(night * 4);
    if (lightLvl !== lastLight) lastLight = lightLvl;
  };

  /* ---------------- weather ---------------- */
  let nextWxAt = 0;
  scene.setWeather = function (kind, silent) {
    B.state.weather = kind;
    const w = WX[kind];
    root.style.setProperty('--wet', w.wet);
    B.audio.setRain(w.wet);
    buildClouds(w);
    scene.update();
    B.emit('weather', kind);
    if (!silent) {
      const ico = { sunny: '☀️', partly: '⛅', cloudy: '☁️', drizzle: '🌦️', rain: '🌧️' }[kind];
      const msg = {
        sunny: 'Sun’s out — iced drinks will move.',
        partly: 'A few clouds rolling in.',
        cloudy: 'Overcast. Chai weather incoming.',
        drizzle: 'Light drizzle — expect more deliveries.',
        rain: 'Proper monsoon rain. Delivery apps are spiking.',
      }[kind];
      B.toast(ico, `Weather: ${w.label}`, msg);
    }
  };
  scene.tickWeather = function () {
    const mins = B.gameMin();
    if (!nextWxAt) nextWxAt = B.state.t + B.rand(70, 110) * B.SEC_PER_MIN;
    if (B.state.t >= nextWxAt) {
      nextWxAt = B.state.t + B.rand(80, 150) * B.SEC_PER_MIN;
      const nx = B.wpick(NEXT[B.state.weather]);
      if (nx !== B.state.weather) scene.setWeather(nx);
    }
    const w = WX[B.state.weather];
    const h = mins / 60;
    B.state.temp = Math.round(26 + Math.sin(((h - 8) / 12) * Math.PI) * 6 + w.dT);
  };

  function cloudSVG(grey) {
    const c1 = lerpHex('#ffffff', '#8f8fa3', grey), c2 = lerpHex('#f6eef3', '#7c7b90', grey);
    const blobs = [];
    const n = B.ri(4, 6);
    for (let i = 0; i < n; i++) blobs.push(`<circle cx="${30 + i * 22 + B.rand(-6, 6)}" cy="${40 + B.rand(-12, 6)}" r="${B.rand(16, 28)}" fill="${c1}"/>`);
    return `<svg width="${60 + n * 22}" height="80" viewBox="0 0 ${60 + n * 22} 80"><g>${blobs.join('')}</g><rect x="14" y="44" width="${n * 22 + 30}" height="20" rx="10" fill="${c2}"/></svg>`;
  }
  function buildClouds(w) {
    const box = B.$('#clouds');
    const old = Array.from(box.children);
    old.forEach((c) => gsap.to(c, { opacity: 0, duration: 3, onComplete: () => c.remove() }));
    for (let i = 0; i < w.clouds; i++) {
      const el = B.h(`<div class="cloud">${cloudSVG(w.grey)}</div>`);
      box.appendChild(el);
      const y = B.rand(110, 200), sc = B.rand(0.6, 1.3);
      const x0 = B.rand(-200, 1600);
      gsap.set(el, { x: x0, y, scale: sc, opacity: 0 });
      gsap.to(el, { opacity: 0.92, duration: 3 });
      const drift = () => {
        const x = gsap.getProperty(el, 'x');
        B.tw(el, { x: 1700, duration: ((1700 - x) / 1900) * 260, ease: 'none', onComplete: () => { gsap.set(el, { x: -300 }); drift(); } });
      };
      drift();
    }
  }

  /* ---------------- street traffic ---------------- */
  const traffic = B.$('#traffic');
  const WALK_COL = ['#e46d8d', '#6d93c8', '#f2b84b', '#7fae7c', '#c9b6e4', '#8a5a33', '#e9e4da', '#3f5a52'];
  const UMB = ['#e46d8d', '#2f5a4c', '#f2b84b', '#3b4f8f', '#ffffff', '#c43e64'];
  function spawnStreet() {
    const wet = B.WX[B.state.weather].wet > 0.3;
    const r = Math.random();
    let el, y, sc, dur, dir = Math.random() < 0.5 ? 1 : -1, w;
    if (r < 0.45) {
      // pedestrian on our side of the street, right outside the windows
      el = B.h(`<div>${A.walker(B.pick(WALK_COL), wet || Math.random() < 0.1 ? B.pick(UMB) : null)}</div>`);
      sc = B.rand(1.45, 1.6);
      w = 40 * sc;
      y = 446 - 100 * sc;
      dur = B.rand(16, 22);
    } else if (r < 0.65) {
      // pedestrian across the street
      el = B.h(`<div>${A.walker(B.pick(WALK_COL), wet ? B.pick(UMB) : null)}</div>`);
      sc = 0.55;
      w = 22;
      y = 343 - 100 * sc;
      dur = B.rand(30, 40);
    } else if (r < 0.88) {
      el = B.h(`<div>${A.scooter(B.pick(['#e46d8d', '#3b4f8f', '#f2b84b', '#d23434', '#ec7716', '#2f5a4c']))}</div>`);
      sc = B.rand(0.8, 0.95);
      w = 120 * sc;
      y = 418 - 90 * sc;
      dur = B.rand(4, 6);
    } else {
      el = B.h(`<div>${A.auto()}</div>`);
      sc = 0.85;
      w = 150 * sc;
      y = 420 - 100 * sc;
      dur = B.rand(6, 8);
    }
    el.firstElementChild.setAttribute('width', el.firstElementChild.viewBox.baseVal.width * sc);
    el.firstElementChild.setAttribute('height', el.firstElementChild.viewBox.baseVal.height * sc);
    traffic.appendChild(el);
    const from = dir > 0 ? -w - 20 : 1620, to = dir > 0 ? 1620 : -w - 20;
    gsap.set(el, { x: from, y, scaleX: dir > 0 ? 1 : -1 });
    if (r < 0.65) B.tw(el, { y: y - 2, duration: 0.3, yoyo: true, repeat: Math.ceil(dur / 0.3), ease: 'sine.inOut' });
    B.tw(el, { x: to, duration: dur, ease: 'none', onComplete: () => el.remove() });
  }
  scene.scooterAway = function (box) {
    const el = B.h(`<div>${A.scooter(box)}</div>`);
    el.firstElementChild.setAttribute('width', 110);
    el.firstElementChild.setAttribute('height', 82);
    traffic.appendChild(el);
    gsap.set(el, { x: 1360, y: 334, opacity: 0 });
    B.tw(el, { opacity: 1, duration: 0.3 });
    B.tw(el, { x: 1720, duration: 2.6, ease: 'power2.in', onComplete: () => el.remove() });
  };
  let nextStreet = 0;
  scene.tickStreet = function () {
    if (B.state.t < nextStreet) return;
    const h = B.gameMin() / 60;
    const busy = h > 8.5 && h < 10.5 ? 1.6 : h > 17 && h < 20 ? 1.4 : 1;
    nextStreet = B.state.t + B.rand(2.5, 6) / busy;
    if (traffic.children.length < 9) spawnStreet();
  };

  /* ---------------- door ---------------- */
  let doorOpen = 0, doorTween = null, doorCloseTimer = null;
  scene.door = function (x) {
    doorOpen++;
    const leaf = B.$('.door-leaf');
    if (doorTween) doorTween.kill();
    doorTween = gsap.to(leaf, { rotationY: -72, duration: 0.45, ease: 'power2.out' });
    B.audio.play('chime', x || 1405);
    B.audio.play('door', x || 1405);
    clearTimeout(doorCloseTimer);
    doorCloseTimer = setTimeout(() => {
      doorTween = gsap.to(leaf, { rotationY: 0, duration: 0.9, ease: 'elastic.out(1, 0.45)' });
    }, 1300 / Math.min(B.state.speed || 1, 6));
  };

  /* ---------------- light pools ---------------- */
  function buildPools() {
    const box = B.$('#light-pools');
    [[60, 170], [270, 170], [1120, 170]].forEach(([x, w]) => {
      box.appendChild(B.h(`<div class="pool" style="left:${x}px;width:${w}px"></div>`));
    });
    [[290, 520], [1230, 530]].forEach(([x, y]) => {
      box.appendChild(B.h(`<div class="pool lamp" style="left:${x - 130}px;top:${y}px;width:260px"></div>`));
    });
  }

  /* ---------------- camera ----------------
     The app is one canvas of rooms. A room change is a camera move:
     the View Transitions API captures before/after and GSAP pans the world. */
  const ROOMS = { lobby: { x: 0, y: 0, z: 1 } };
  B.camera = {
    room: 'lobby',
    goTo(room, opts = {}) {
      const r = ROOMS[room];
      if (!r) return;
      const move = () => gsap.to('#world', { x: -r.x, y: -r.y, scale: r.z, duration: opts.duration || 1.1, ease: 'power3.inOut' });
      this.room = room;
      if (document.startViewTransition && !opts.noVT) document.startViewTransition(() => { move().progress(1); });
      else move();
    },
    /** gentle push-in on a point of interest, then settle back */
    nudge(x, y, z = 1.05) {
      gsap.to('#world', { scale: z, x: (800 - x) * (z - 1), y: (450 - y) * (z - 1), duration: 0.8, ease: 'power2.out' });
      gsap.to('#world', { scale: 1, x: 0, y: 0, duration: 1.2, ease: 'power2.inOut', delay: 1.4 });
    },
    intro() {
      gsap.fromTo('#world', { scale: 1.22, y: 70, filter: 'blur(6px)' }, { scale: 1, y: 0, filter: 'blur(0px)', duration: 2.4, ease: 'power3.inOut', clearProps: 'filter' });
    },
  };

  /* subtle parallax: the street sits further away than the room */
  function parallax() {
    let tx = 0, ty = 0, cx = 0, cy = 0;
    window.addEventListener('pointermove', (e) => {
      tx = (e.clientX / window.innerWidth - 0.5) * 2;
      ty = (e.clientY / window.innerHeight - 0.5) * 2;
    });
    gsap.ticker.add(() => {
      cx += (tx - cx) * 0.05;
      cy += (ty - cy) * 0.05;
      gsap.set('#street, #glass-fx', { x: -cx * 9, y: -cy * 4 });
      gsap.set('.pendant', { rotation: cx * 1.2 });
    });
  }

  scene.init = function () {
    buildPools();
    parallax();
    scene.setWeather('sunny', true);
    scene.update();
    // a few passers-by already on the street
    for (let i = 0; i < 4; i++) {
      spawnStreet();
      const el = traffic.lastElementChild;
      B.wt.getTweensOf(el).forEach((t) => t.progress(Math.random() * 0.8));
    }
  };
})();
