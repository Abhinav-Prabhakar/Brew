/* brew · core.js — shared state, data, world clock and helpers */
(function () {
  const B = (window.B = window.B || {});

  /* ---------- DOM helpers ---------- */
  B.$ = (s, r = document) => r.querySelector(s);
  B.$$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  B.h = (html) => {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  };
  B.rand = (a, b) => a + Math.random() * (b - a);
  B.ri = (a, b) => Math.floor(B.rand(a, b + 1));
  B.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  B.wpick = (pairs) => {
    const tot = pairs.reduce((s, p) => s + p[1], 0);
    let r = Math.random() * tot;
    for (const [v, w] of pairs) if ((r -= w) <= 0) return v;
    return pairs[0][0];
  };
  B.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  B.lerp = (a, b, t) => a + (b - a) * t;
  B.inr = (n, sign) => {
    const s = Math.round(Math.abs(n)).toLocaleString('en-IN');
    return (sign ? (n < 0 ? '−' : '+') : n < 0 ? '−' : '') + '₹' + s;
  };

  /* ---------- the menu ---------- */
  B.MENU = [
    { id: 'cappuccino', name: 'Cappuccino', cat: 'coffee', base: 220, prep: 14, milk: true, desc: 'Double ristretto under velvety microfoam. Poured with a heart.' },
    { id: 'flatwhite', name: 'Flat White', cat: 'coffee', base: 240, prep: 13, milk: true, desc: 'Silky, strong and small — our Chikmagalur house blend.' },
    { id: 'icedlatte', name: 'Iced Latte', cat: 'coffee', base: 260, prep: 11, milk: true, cold: true, desc: 'Espresso over cold milk and big clear ice.' },
    { id: 'coldbrew', name: 'Cold Brew', cat: 'coffee', base: 250, prep: 5, cold: true, fridge: true, desc: '18-hour steep, chocolatey and low-acid. With an orange twist.' },
    { id: 'chai', name: 'Masala Chai', cat: 'notcoffee', base: 140, prep: 16, desc: 'Assam, ginger, cardamom and clove — served in a kulhad.' },
    { id: 'matcha', name: 'Matcha Latte', cat: 'notcoffee', base: 290, prep: 13, milk: true, desc: 'Ceremonial-grade Uji matcha, whisked to order.' },
    { id: 'hotchoc', name: 'Hot Chocolate', cat: 'notcoffee', base: 230, prep: 14, milk: true, desc: '54% single-origin chocolate, marshmallows on top.' },
    { id: 'rosemilk', name: 'Rose Milk', cat: 'notcoffee', base: 180, prep: 7, cold: true, desc: 'Chilled rose milk with sabja seeds. A Chennai classic.' },
    { id: 'croissant', name: 'Butter Croissant', cat: 'bakes', base: 180, prep: 6, fridge: true, desc: '72 layers, French butter, baked at 6 every morning.' },
    { id: 'muffin', name: 'Blueberry Muffin', cat: 'bakes', base: 160, prep: 5, fridge: true, desc: 'Bursting with berries and a crunchy sugar top.' },
    { id: 'cheesecake', name: 'Strawberry Cheesecake', cat: 'bakes', base: 290, prep: 4, fridge: true, desc: 'Baked Basque-style, Mahabaleshwar strawberry glaze.' },
    { id: 'cinnamon', name: 'Cinnamon Roll', cat: 'bakes', base: 190, prep: 7, fridge: true, desc: 'Soft swirl, brown-butter cinnamon, cream cheese icing.' },
    { id: 'avotoast', name: 'Avocado Toast', cat: 'plates', base: 380, prep: 28, slow: true, desc: 'Sourdough, smashed avo, chilli crunch and microgreens.' },
    { id: 'sandwich', name: 'Paneer Tikka Sandwich', cat: 'plates', base: 320, prep: 30, slow: true, desc: 'Tandoori paneer, mint chutney, pickled onion, toasted.' },
    { id: 'cheesetoast', name: 'Chilli Cheese Toast', cat: 'plates', base: 260, prep: 22, desc: 'Bombay-style, bubbling cheddar and green chilli.' },
  ];
  B.ITEM = Object.fromEntries(B.MENU.map((m) => [m.id, m]));
  B.CATS = [
    { id: 'coffee', name: 'Coffee', em: 'from the bar' },
    { id: 'notcoffee', name: 'Not Coffee', em: 'chai & friends' },
    { id: 'bakes', name: 'Bakes', em: 'from the fridge' },
    { id: 'plates', name: 'Plates', em: 'from the kitchen' },
  ];
  B.MODS = {
    oat: { label: 'oat', icon: 'oat', price: 40, long: 'oat milk' },
    shot: { label: '+1 shot', icon: 'shot', price: 40, long: 'extra shot' },
    decaf: { label: 'decaf', icon: 'decaf', price: 0, long: 'decaf' },
    lesssugar: { label: '½ sugar', icon: 'lesssugar', price: 0, long: 'less sugar' },
    iced: { label: 'iced', icon: 'iced', price: 20, long: 'make it iced' },
    hot: { label: 'xtra hot', icon: 'hot', price: 0, long: 'extra hot' },
    noonion: { label: 'onion', icon: 'noonion', price: 0, long: 'no onion', x: true },
    nonuts: { label: 'nuts', icon: 'nonuts', price: 0, long: 'nut allergy', x: true },
    cheese: { label: '+cheese', icon: 'cheese', price: 30, long: 'extra cheese' },
  };
  B.modsFor = (id) => {
    const m = B.ITEM[id];
    if (m.milk) return ['oat', 'shot', 'lesssugar', 'decaf', m.cold ? null : 'hot'].filter(Boolean);
    if (id === 'chai') return ['lesssugar', 'hot'];
    if (id === 'coldbrew') return ['shot'];
    if (id === 'sandwich' || id === 'cheesetoast') return ['noonion', 'cheese'];
    if (id === 'avotoast') return ['nonuts', 'cheese'];
    if (id === 'muffin' || id === 'cinnamon') return ['nonuts'];
    return [];
  };

  B.NAMES = ['Riya', 'Arjun', 'Meera', 'Kabir', 'Zoya', 'Dev', 'Ananya', 'Ishaan', 'Tara', 'Neel', 'Sana', 'Rohan', 'Priya', 'Aditya', 'Nisha', 'Vikram', 'Leah', 'Omar', 'Kavya', 'Farhan', 'Aisha', 'Siddharth', 'Maya', 'Yash', 'Ira', 'Rahul', 'Diya', 'Kunal', 'Noor', 'Varun', 'Esha', 'Aman', 'Pooja', 'Imran', 'Tanvi', 'Joel', 'Ritika', 'Arnav', 'Lina', 'Sameer'];
  B.NOTES = ['make it strong pls', 'for Riya — happy bday!', 'allergic to nuts!!', 'extra napkins pls', 'no straw, thanks', 'less ice', 'warm it up pls', 'cut in half?', 'can you write "you got this"', 'quick, train in 10!', 'pls draw a heart ♥', 'separate bags pls'];

  /* ---------- state ---------- */
  B.state = {
    started: false,
    paused: false,
    speed: 1,
    t: 0, // sim seconds since opening
    day: 1,
    cash: 18450,
    revenue: 0,
    cost: 0,
    profit: 0,
    rating: 4.62,
    ratingN: 214,
    weather: 'sunny',
    temp: 27,
    policy: 'balanced',
    orderNo: 141,
    served: 0,
    walkouts: 0,
  };

  /* 3 sim-seconds = 1 game minute, day runs 08:00 → 22:00 */
  B.SEC_PER_MIN = 3;
  B.OPEN_MIN = 8 * 60;
  B.CLOSE_MIN = 22 * 60;
  B.gameMin = () => {
    const m = B.OPEN_MIN + B.state.t / B.SEC_PER_MIN;
    const span = B.CLOSE_MIN - B.OPEN_MIN;
    return B.OPEN_MIN + ((m - B.OPEN_MIN) % span);
  };
  B.fmtClock = (mins, pad) => {
    const h24 = Math.floor(mins / 60) % 24, m = Math.floor(mins % 60);
    const h = ((h24 + 11) % 12) + 1;
    return { hm: `${pad ? String(h).padStart(2, '0') : h}:${String(m).padStart(2, '0')}`, ap: h24 < 12 ? 'AM' : 'PM', h24, m };
  };
  B.toGameMin = (simSec) => simSec / B.SEC_PER_MIN;

  /* ---------- world timeline: everything that lives "in the sim" ---------- */
  B.wt = gsap.timeline({ smoothChildTiming: true, autoRemoveChildren: true });
  B.wt.to({}, { duration: 1e7 });
  /** tween on the world clock (scales with speed, stops on pause) */
  B.tw = (target, vars) => B.wt.to(target, vars, B.wt.time());
  B.twFrom = (target, from, to) => B.wt.fromTo(target, from, to, B.wt.time());

  /* sim-time scheduler */
  const timers = [];
  B.after = (sec, fn) => {
    const t = { at: B.state.t + sec, fn, dead: false };
    timers.push(t);
    return t;
  };
  B.cancel = (t) => t && (t.dead = true);
  B.runTimers = () => {
    for (let i = timers.length - 1; i >= 0; i--) {
      const t = timers[i];
      if (t.dead) { timers.splice(i, 1); continue; }
      if (t.at <= B.state.t) { timers.splice(i, 1); try { t.fn(); } catch (e) { console.error(e); } }
    }
  };

  /* ---------- depth projection: ground y → sprite scale ---------- */
  B.proj = (y) => 0.75 + (y - 440) * 0.00105;
  B.place = (el, x, y, w, h, extraY = 0) => {
    const s = B.proj(y);
    gsap.set(el, { x: x - w / 2, y: y - h + extraY * s, scale: s, zIndex: Math.round(y * 10) });
  };

  /* ---------- view fitting ---------- */
  B.view = { scale: 1, left: 0, top: 0 };
  B.fit = () => {
    const W = window.innerWidth, H = window.innerHeight;
    const hud = B.$('#hud').getBoundingClientRect();
    const topPad = hud.bottom + 10;
    const availH = H - topPad - 10;
    const s = Math.min((W - 24) / 1600, availH / 900);
    const left = (W - 1600 * s) / 2;
    const top = topPad + Math.max(0, (availH - 900 * s) / 2);
    Object.assign(B.view, { scale: s, left, top });
    gsap.set('#camera', { x: left, y: top, scale: s });
  };
  /** world coords → screen px */
  B.w2s = (x, y) => {
    const r = B.$('#world').getBoundingClientRect();
    return { x: r.left + (x / 1600) * r.width, y: r.top + (y / 900) * r.height, k: r.width / 1600 };
  };
  B.elCenter = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  /* ---------- toasts ---------- */
  B.toast = (icon, title, text, opts = {}) => {
    const box = B.$('#toasts');
    const el = B.h(`<div class="toast"><div class="ti">${icon}</div><b>${title}</b><span class="${opts.hand ? 'hand' : ''}">${text}</span></div>`);
    box.prepend(el);
    gsap.from(el, { y: -16, opacity: 0, scale: 0.96, duration: 0.45, ease: 'back.out(1.6)' });
    while (box.children.length > 4) box.lastElementChild.remove();
    gsap.to(el, { opacity: 0, x: 30, duration: 0.4, delay: opts.ttl || 4.5, onComplete: () => el.remove() });
  };

  /* ---------- tiny event bus ---------- */
  const subs = {};
  B.on = (ev, fn) => (subs[ev] = subs[ev] || []).push(fn);
  B.emit = (ev, ...a) => (subs[ev] || []).forEach((fn) => fn(...a));
})();
