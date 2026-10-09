/* brew · customers.js — paper-doll guests and their state machine
   enter → queue → order → wait (patience ring) → seated → eating → linger → pay → leave
   (takeaway skips the seat; reneging customers huff out early) */
(function () {
  const B = window.B, A = B.art;
  const list = [];
  const queue = [];
  const QUEUE = [[1192, 762], [1256, 704], [1304, 654], [1344, 606], [1376, 560], [1400, 516], [1418, 478]];
  const PICKUP = [[1062, 708], [986, 694], [910, 708], [834, 694], [758, 708], [682, 694], [606, 708], [530, 696]];
  const DOOR = [1405, 446];
  const OFFS = [[0, 0], [34, -16], [-30, -12], [12, -30]];
  const pickupTaken = new Array(PICKUP.length).fill(null);
  let uid = 0;

  /* ---------------- appearance ---------------- */
  const SKIN_W = [[0, 1], [1, 3], [2, 4], [3, 5], [4, 5], [5, 4], [6, 3], [7, 1]];
  const P = {
    commuter: { tops: ['#2f3e5c', '#4a4f5a', '#8a6a4a', '#5f6f86', '#3d3a4a'], inner: ['#ffffff', '#dbe7f3', '#f7e1e6', '#f3efe6'], bottoms: ['#2b3140', '#3e4350', '#4a4f5a', '#b9a888'], shoes: ['#3b2a22', '#1f1a1a', '#5a3a2a'] },
    student: { tops: ['#a7c4a0', '#c9b6e4', '#f2c14e', '#f08fa6', '#7fb7d8', '#e9e4da', '#f4a582', '#2f2f38'], bottoms: ['#5878a5', '#3e5675', '#2b2b33', '#6f86a8'], shoes: ['#f4f1ec', '#fff', '#e9e4da', '#2b2b33'] },
    leisurely: { tops: ['#f6d1c1', '#fff3e6', '#e7a1b0', '#b5d3c7', '#f3e3a3', '#d9c8ef', '#f9c9d6'], bottoms: ['#efe6dc', '#c7b39a', '#fffaf2', '#e7d9c9'], shoes: ['#c79a6b', '#e9a7b8', '#8a5a33'] },
    camper: { tops: ['#6d5a7a', '#3f5a52', '#8c6f5b', '#2f2f38', '#5b6b86', '#9a7f6a'], inner: ['#efe6dc', '#ffffff', '#f2c14e'], bottoms: ['#2b2b33', '#5878a5', '#4a4f5a'], shoes: ['#f4f1ec', '#2b2b33', '#8a5a33'] },
  };
  const PRINTS = [
    `<path d="M-6 -3 C-6 -7 0 -7 0 -3 C0 -7 6 -7 6 -3 C6 2 0 5 0 7 C0 5 -6 2 -6 -3Z" fill="#e46d8d"/>`,
    `<circle r="6" fill="#ffd36b"/><g stroke="#ffd36b" stroke-width="1.6">${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<path d="M0 -8 V-10" transform="rotate(${a})"/>`).join('')}</g>`,
    `<text y="3" text-anchor="middle" font-family="DM Sans" font-weight="800" font-size="7" fill="#fff">CHAI</text>`,
    `<path d="M-7 4 L0 -7 L7 4Z" fill="none" stroke="#fff" stroke-width="1.6"/>`,
  ];

  function traits(persona) {
    const pal = P[persona] || P.leisurely;
    const fem = Math.random() < 0.52;
    const elder = persona === 'leisurely' && Math.random() < 0.22;
    const skin = A.SKINS[B.wpick(SKIN_W)];
    let hair = fem ? B.pick(['long', 'bob', 'bun', 'pony', 'wavy', 'braid', 'curly', 'long']) : B.pick(['crop', 'sidepart', 'buzz', 'curly', 'sidepart', 'crop', 'wavy']);
    let hairColor = B.wpick([[A.HAIRC[0], 4], [A.HAIRC[1], 4], [A.HAIRC[2], 3], [A.HAIRC[3], 2], [A.HAIRC[4], 1], [A.HAIRC[6], 0.5]]);
    if (persona === 'student' && Math.random() < 0.12) hairColor = A.HAIRC[8];
    if (elder) { hairColor = A.HAIRC[7]; if (!fem && Math.random() < 0.5) hair = 'bald'; }
    const t = {
      skin, hair, hairColor, fem,
      build: B.pick(['slim', 'avg', 'avg', 'broad']),
      beard: !fem && Math.random() < 0.5 ? B.pick(['full', 'stubble', 'stubble', 'mustache']) : null,
      lashes: fem,
      lip: fem && Math.random() < 0.5 ? B.pick(['#b8505e', '#a84858', '#c46470', '#9a4a50']) : null,
      blush: fem ? 0.24 : 0.12,
      acc: {},
      outfit: {},
    };
    const o = t.outfit, a = t.acc;
    const top = B.pick(pal.tops);
    o.top = top;
    o.sleeve = top;
    o.bottom = B.pick(pal.bottoms);
    o.shoe = B.pick(pal.shoes);
    o.bottomKind = 'trousers';
    switch (persona) {
      case 'commuter':
        o.kind = fem && Math.random() < 0.25 ? 'dress' : Math.random() < 0.65 ? 'blazer' : 'shirt';
        o.inner = B.pick(pal.inner);
        if (o.kind === 'blazer' && !fem && Math.random() < 0.45) o.tie = B.pick(['#8a2a3a', '#23314f', '#c43e64', '#3f5a52']);
        if (o.kind === 'shirt') { o.top = o.sleeve = B.pick(['#dbe7f3', '#ffffff', '#f7e1e6', '#cfd8e8']); o.pattern = Math.random() < 0.3 ? 'check' : null; }
        if (o.kind === 'dress') { o.top = o.sleeve = B.pick(['#2f3e5c', '#5a2a3a', '#4a4f5a']); o.belt = '#c9a061'; o.bottom = skin; }
        a.messenger = Math.random() < 0.5 ? B.pick(['#7a4a2a', '#3b2a22', '#5a3a2a']) : null;
        a.lanyard = !a.messenger && Math.random() < 0.6 ? B.pick(['#3b4f8f', '#c43e64', '#2f5a4c']) : null;
        a.glasses = Math.random() < 0.35 ? B.pick(['#2b2230', '#8a5a33', '#a8a8b0']) : null;
        o.watch = Math.random() < 0.6 ? B.pick(['#d8b56a', '#2b2230', '#c0c4cc']) : null;
        break;
      case 'student':
        o.kind = B.pick(['hoodie', 'tee', 'tee', 'sweater', 'hoodie']);
        if (o.kind === 'tee') { o.sleeveLen = 'short'; o.print = Math.random() < 0.6 ? B.pick(PRINTS) : null; }
        if (o.kind === 'hoodie') o.string = '#fff';
        o.bottomKind = Math.random() < 0.15 ? 'shorts' : 'jeans';
        o.sole = B.pick(['#e46d8d', '#bfc4cc', '#6d93c8']);
        a.backpack = Math.random() < 0.55 ? B.pick(['#e46d8d', '#3b4f8f', '#2f5a4c', '#f2b84b', '#2b2b33', '#c9b6e4']) : null;
        a.tote = !a.backpack && Math.random() < 0.6 ? B.pick(['#f3e9d6', '#e9e4da', '#fff3e6']) : null;
        a.glasses = Math.random() < 0.3 ? '#2b2230' : null;
        if (Math.random() < 0.15) a.cap = B.pick(['#2b2b33', '#e46d8d', '#3b4f8f']);
        else if (Math.random() < 0.25) a.headphonesNeck = true;
        if (fem && Math.random() < 0.5) a.earrings = B.pick(['#f2d27a', '#e46d8d', '#c0c4cc']);
        if (fem && Math.random() < 0.15) a.nosering = true;
        break;
      case 'leisurely':
        if (fem) o.kind = B.pick(['kurta', 'kurta', 'dress', 'cardigan']);
        else o.kind = B.pick(['shirt', 'kurta', 'cardigan', 'shirt']);
        if (o.kind === 'kurta') { o.trim = B.pick(['#d8b25a', '#e46d8d', '#ffffff', '#3f5a52']); o.print = Math.random() < 0.6; o.bottom = B.pick(['#ffffff', '#fffaf2', '#efe6dc', '#f2c9d4']); if (fem && Math.random() < 0.55) a.dupatta = B.pick(['#e46d8d', '#f3e3a3', '#b5d3c7', '#ffffff', '#d9c8ef']); if (fem && Math.random() < 0.5) a.bindi = true; o.bangle = fem; }
        if (o.kind === 'dress') { o.print = Math.random() < 0.6 ? B.pick(['#e46d8d', '#ffffff', '#3f5a52', '#f2b84b']) : null; o.bottom = skin; o.sleeveLen = 'short'; if (Math.random() < 0.3) { a.sunhat = B.pick(['#f3e3c3', '#fff3e6']); a.ribbon = B.pick(['#e46d8d', '#3f5a52']); } }
        if (o.kind === 'cardigan') { o.inner = B.pick(['#ffffff', '#fff3e6', '#f7e1e6']); o.top = o.sleeve = B.pick(['#e7a1b0', '#b5d3c7', '#f3e3a3', '#d9c8ef', '#c9a58a']); }
        if (o.kind === 'shirt') { o.top = o.sleeve = B.pick(['#fff3e6', '#dbe7f3', '#f6d1c1', '#e3efe2']); o.sleeveLen = Math.random() < 0.5 ? 'short' : null; }
        a.glasses = elder || Math.random() < 0.25 ? B.pick(['#8a5a33', '#c9a061', '#2b2230']) : null;
        if (!a.glasses && Math.random() < 0.15) { a.glasses = '#2b2230'; a.sunglasses = true; }
        if (fem && !a.earrings) a.earrings = '#f2d27a';
        a.tote = Math.random() < 0.35 ? B.pick(['#f3e9d6', '#fff3e6']) : null;
        a.scarf = !a.dupatta && Math.random() < 0.15 ? B.pick(['#e46d8d', '#3f5a52']) : null;
        break;
      case 'camper':
        o.kind = B.pick(['hoodie', 'cardigan', 'sweater', 'hoodie']);
        o.inner = B.pick(pal.inner);
        o.bottomKind = 'jeans';
        a.backpack = Math.random() < 0.7 ? B.pick(['#2b2b33', '#4a4f5a', '#3b4f8f', '#5a4038']) : null;
        a.glasses = Math.random() < 0.5 ? B.pick(['#2b2230', '#8a5a33']) : null;
        if (Math.random() < 0.4) a.beanie = B.pick(['#e46d8d', '#f2c14e', '#2b2b33', '#9a7f6a', '#3f5a52']);
        if (Math.random() < 0.35) a.headphones = true; else if (Math.random() < 0.4) a.headphonesNeck = true;
        break;
    }
    if (a.beanie || a.sunhat || a.cap || a.headphones) { if (hair === 'bun') t.hair = 'crop'; }
    return t;
  }

  /* ---------------- DOM + motion ---------------- */
  function makeEl(c) {
    const el = B.h(`<div class="cust ent">${A.person(c.traits)}<div class="tag">${A.persona[c.persona === 'group' ? 'group' : c.persona] || ''}${c.name}<em></em></div></div>`);
    el.querySelector('.eyes').style.setProperty('--blink', `${B.rand(-5, 0).toFixed(2)}s`);
    c.el = el;
    c.svg = el.querySelector('svg');
    c.parts = {
      legL: el.querySelector('.leg-l'), legR: el.querySelector('.leg-r'),
      armL: el.querySelector('.arm-l'), armR: el.querySelector('.arm-r'), foreR: el.querySelector('.fore-r'), foreL: el.querySelector('.fore-l'),
      held: el.querySelector('.held'), body: el.querySelector('.body'), ring: el.querySelector('.ring-p'), tag: el.querySelector('.tag em'),
    };
    B.$('#room').appendChild(el);
    el._c = c;
    return el;
  }
  function place(c) { B.place(c.el, c.x, c.y, 100, 220, c.seated ? 52 : 0); }
  function setMood(c, m) { c.mood = m; c.svg.setAttribute('data-mood', m); }
  function setTag(c, s) { c.parts.tag.textContent = s; }

  function applyWalk(c) {
    const p = c.anim.p, s = Math.sin(p);
    const P = c.parts;
    P.legL.setAttribute('transform', `rotate(${(11 * s).toFixed(2)} 44 118)`);
    P.legR.setAttribute('transform', `rotate(${(-11 * s).toFixed(2)} 56 118)`);
    if (!c.carrying) P.armL.setAttribute('transform', `rotate(${(-7 * s).toFixed(2)} 29 57)`);
    P.armR.setAttribute('transform', `rotate(${(7 * s).toFixed(2)} 71 57)`);
    P.body.setAttribute('transform', `translate(0 ${(-Math.abs(Math.cos(p)) * 2.4).toFixed(2)})`);
  }
  function stopWalk(c) {
    if (c.walkTw) c.walkTw.kill();
    c.walkTw = null;
    ['legL', 'legR', 'armL', 'body'].forEach((k) => c.parts[k].removeAttribute('transform'));
    if (!c.pose) c.parts.armR.removeAttribute('transform');
  }
  function walkTo(c, x, y, speed = 1) {
    return new Promise((res) => {
      if (c.moveTw) c.moveTw.kill();
      const d = Math.hypot(x - c.x, y - c.y);
      if (d < 2) { res(); return; }
      c.anim = c.anim || { p: 0 };
      if (!c.walkTw) c.walkTw = B.tw(c.anim, { p: '+=' + Math.PI * 2, duration: 0.62 / speed, repeat: -1, ease: 'none', onUpdate: () => applyWalk(c) });
      const o = { x: c.x, y: c.y };
      c.moveTw = B.tw(o, {
        x, y, duration: d / (118 * speed), ease: 'none',
        onUpdate: () => { c.x = o.x; c.y = o.y; place(c); },
        onComplete: () => { c.moveTw = null; stopWalk(c); res(); },
      });
    });
  }
  function moveParty(c, x, y, speed) {
    const party = c.party || [c];
    return Promise.all(party.map((m, i) => {
      const [ox, oy] = OFFS[i] || [0, 0];
      return new Promise((r) => B.after(i * 0.25, () => walkTo(m, x + ox, y + oy, speed).then(r)));
    }));
  }

  /** arm-to-mouth: hold `a` in 0..1 */
  function armPose(c, a) {
    const t1 = 30 * a, t2 = 145 * a;
    c.parts.armR.setAttribute('transform', `rotate(${t1.toFixed(1)} 71 57)`);
    c.parts.foreR.setAttribute('transform', `rotate(${t2.toFixed(1)} 72 88)`);
    c.parts.held.setAttribute('transform', `rotate(${(-(t1 + t2)).toFixed(1)} 71 120)`);
  }
  function sip(c) {
    if (c.state !== 'eating' && c.state !== 'linger') return;
    const o = { a: 0 };
    c.pose = true;
    setMood(c, 'eat');
    B.tw(o, { a: 1, duration: 0.7, ease: 'power2.inOut', onUpdate: () => armPose(c, o.a) });
    B.after(1.5, () => {
      B.audio.play('sip', c.x);
      B.tw(o, { a: 0, duration: 0.7, ease: 'power2.inOut', onUpdate: () => armPose(c, o.a), onComplete: () => { c.pose = false; setMood(c, c.unhappy ? 'sad' : 'happy'); } });
    });
  }

  /* ---------------- effects ---------------- */
  function bubble(c, items) {
    const b = B.h(`<div class="bubble">${items.slice(0, 3).map((it) => `<div class="photo">${A.food(it.id)}</div>`).join('')}${items.length > 3 ? `<span class="more">+${items.length - 3}</span>` : ''}</div>`);
    c.el.appendChild(b);
    gsap.fromTo(b, { scale: 0, y: 10, transformOrigin: '50% 100%' }, { scale: 1, y: 0, duration: 0.45, ease: 'back.out(2.2)' });
    B.audio.play('pop');
    return b;
  }
  function emote(c, txt, dur = 1.6) {
    const e = B.h(`<div class="emote">${txt}</div>`);
    c.el.appendChild(e);
    gsap.fromTo(e, { y: 6, opacity: 0, scale: 0.6 }, { y: -16, opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(2)' });
    gsap.to(e, { opacity: 0, y: -30, duration: 0.5, delay: dur, onComplete: () => e.remove() });
  }
  function puff(c) {
    const p = B.h(`<div>${A.cloudPuff}</div>`).firstElementChild;
    c.el.appendChild(p);
    gsap.fromTo(p, { scale: 0.3, opacity: 0, y: 10 }, { scale: 1.1, opacity: 0.95, y: -10, duration: 0.5, ease: 'back.out(2)' });
    gsap.to(p, { y: -50, opacity: 0, scale: 1.4, duration: 1.4, delay: 0.9, ease: 'power1.in', onComplete: () => p.remove() });
  }
  function ringColor(f) {
    if (f > 0.55) return A.mix('#f2a93b', '#ec7d98', (f - 0.55) / 0.45);
    return A.mix('#e0453a', '#f2a93b', f / 0.55);
  }

  /* ---------------- lifecycle ---------------- */
  function spawn(persona, opts = {}) {
    const groupN = persona === 'group' ? opts.n || B.ri(3, 4) : opts.n || 1;
    const leadPersona = persona === 'group' ? B.pick(['student', 'leisurely', 'student']) : persona;
    const party = [];
    for (let i = 0; i < groupN; i++) {
      const per = i === 0 ? leadPersona : B.pick(['student', 'leisurely', leadPersona]);
      const c = {
        id: ++uid, persona: i === 0 ? persona : per, name: B.pick(B.NAMES), traits: traits(persona === 'group' ? per : persona),
        x: DOOR[0] + (OFFS[i] || [0, 0])[0] * 0.3, y: DOOR[1], state: 'enter', mood: 'neutral',
      };
      makeEl(c);
      party.push(c);
      list.push(c);
    }
    const lead = party[0];
    lead.party = party;
    lead.channel = opts.channel || 'dine';
    party.forEach((m) => { m.lead = lead; });
    const base = { commuter: 70, student: 95, leisurely: 120, camper: 110, group: 100 }[persona] || 90;
    lead.patienceMax = base * (B.WX[B.state.weather].wet > 0.3 ? 1.15 : 1) * B.rand(0.85, 1.15);
    lead.patience = lead.patienceMax;
    party.forEach((m, i) => {
      gsap.set(m.el, { opacity: 0 });
      place(m);
      B.after(i * 0.35, () => {
        if (i === 0) B.scene.door(DOOR[0]);
        B.tw(m.el, { opacity: 1, duration: 0.45 });
      });
    });
    setTag(lead, 'walking in');
    queue.push(lead);
    B.after(0.3, () => advanceQueue());
    return lead;
  }

  function advanceQueue() {
    queue.forEach((c, i) => {
      if (c.state !== 'enter' && c.state !== 'queue') return;
      const [x, y] = QUEUE[Math.min(i, QUEUE.length - 1)];
      const ty = i >= QUEUE.length ? y - (i - QUEUE.length + 1) * 10 : y;
      if (c.qSlot === i && c.state === 'queue') return;
      c.qSlot = i;
      c.state = 'queue';
      setTag(c, i === 0 ? 'at the counter' : `in line · #${i + 1}`);
      c.el.classList.add('ringed');
      moveParty(c, x, ty).then(() => {
        if (c.qSlot === 0 && c.state === 'queue' && !c.ordering) order(c);
      });
    });
  }

  function order(c) {
    c.ordering = true;
    c.state = 'order';
    setTag(c, 'ordering');
    setMood(c, 'happy');
    const t = B.game.placeOrder(c);
    if (!t) { // nothing they want is available
      emote(c, '😕');
      B.after(1.2, () => renege(c, 'nothing they wanted was available'));
      return;
    }
    c.ticket = t;
    const bub = bubble(c, t.items);
    B.audio.play('keys');
    B.after(2.4, () => {
      gsap.to(bub, { scale: 0, opacity: 0, duration: 0.25, onComplete: () => bub.remove() });
      queue.splice(queue.indexOf(c), 1);
      advanceQueue();
      toPickup(c);
    });
  }

  function toPickup(c) {
    let slot = pickupTaken.findIndex((x) => !x);
    if (slot < 0) slot = PICKUP.length - 1;
    pickupTaken[slot] = c;
    c.pSlot = slot;
    c.state = 'wait';
    setMood(c, 'neutral');
    setTag(c, `waiting · #${c.ticket.no}`);
    const [x, y] = PICKUP[slot];
    moveParty(c, x, y);
  }
  function freePickup(c) {
    if (c.pSlot != null && pickupTaken[c.pSlot] === c) pickupTaken[c.pSlot] = null;
    c.pSlot = null;
  }

  /** the kitchen handed over their order */
  function served(c) {
    if (c.state !== 'wait') return;
    freePickup(c);
    c.el.classList.remove('ringed');
    const late = B.state.t > c.ticket.promise;
    if (!c.unhappy) setMood(c, 'happy');
    emote(c, late ? '🙂' : B.pick(['😍', '🥰', '✨', '☕']));
    c.party.forEach((m) => { m.carrying = true; m.parts.held.innerHTML = c.channel === 'take' ? A.heldBag : A.heldCup; });
    if (c.channel === 'take') {
      setTag(c, 'heading out');
      B.after(0.8, () => leave(c, true));
      return;
    }
    const claim = B.room.claim(c.party.length, c);
    if (!claim) {
      emote(c, '🥡');
      setTag(c, 'no table — to go');
      B.toast('🪑', 'No free table', `${c.name} took it to go. More seats = more dine-in revenue.`);
      c.channel = 'take';
      B.game.pay(c);
      B.after(0.8, () => leave(c, true));
      return;
    }
    c.claim = claim;
    seat(c, claim);
  }

  async function seat(c, claim) {
    c.state = 'seated';
    setTag(c, 'finding a seat');
    let seats = claim.seats;
    if (claim.merge) seats = await B.room.merge();
    await Promise.all(c.party.map((m, i) => new Promise((r) => B.after(i * 0.3, () => {
      const s = seats[i] || seats[seats.length - 1];
      walkTo(m, s.x, s.y).then(() => {
        m.seated = true;
        m.carrying = false;
        m.parts.held.innerHTML = '';
        m.el.classList.add('seated');
        stopWalk(m);
        place(m);
        B.audio.play('thud', m.x);
        r();
      });
    }))));
    // dishes
    const t = claim.tables[0];
    c.dishes = [];
    c.ticket.items.slice(0, 4).forEach((it, i) => {
      const tb = claim.tables[i % claim.tables.length];
      const off = claim.merge ? (i < 2 ? -24 + i * 30 : -10 + (i - 2) * 26) : (seats[i % seats.length].side || 1) * 18 + (i > 1 ? -8 : 0);
      c.dishes.push({ el: B.room.dish(tb, it.id, off - 15), id: it.id, table: tb });
    });
    if (c.persona === 'camper') {
      const side = seats[0].side || 1;
      const lap = B.h(`<div class="laptop" style="position:absolute;left:${40 + side * 22}px;top:-14px;width:40px;height:30px">${A.laptop()}</div>`);
      t.items.appendChild(lap);
      t.laptop = true;
      c.laptop = lap;
      const lid = lap.querySelector('.lid');
      gsap.fromTo(lid, { scaleY: 0.05 }, { scaleY: 1, duration: 0.7, ease: 'back.out(1.6)', delay: 0.4 });
      B.after(0.6, () => { c.el.classList.add('laptop'); B.audio.play('pop', c.x); });
    }
    c.state = 'eating';
    setTag(c, c.persona === 'camper' ? 'working + sipping' : 'enjoying it');
    const eatDur = B.rand(24, 40) * (c.party.length > 2 ? 1.3 : 1);
    c.eatEnd = B.state.t + eatDur;
    c.party.forEach((m, i) => B.after(1 + i * 1.3, () => sipLoop(m, c)));
  }
  function sipLoop(m, lead) {
    if (lead.state !== 'eating' && lead.state !== 'linger') return;
    if (lead.state === 'eating') {
      m.parts.held.innerHTML = Math.random() < 0.6 ? A.heldCup : '';
      m.state = lead.state;
      sip(m);
    }
    B.after(B.rand(3.5, 7), () => sipLoop(m, lead));
  }

  function linger(c) {
    c.state = 'linger';
    c.party.forEach((m) => { setMood(m, m.unhappy ? 'sad' : 'happy'); m.parts.held.innerHTML = Math.random() < 0.4 ? A.heldPhone : ''; });
    setTag(c, c.persona === 'camper' ? 'one more email…' : 'chatting');
    const dur = c.persona === 'camper' ? B.rand(90, 150) : c.persona === 'leisurely' || c.persona === 'group' ? B.rand(16, 34) : B.rand(6, 14);
    c.lingerEnd = B.state.t + dur;
  }

  function payAtTable(c) {
    c.state = 'pay';
    setTag(c, 'paying · UPI');
    const b = B.h(`<div class="bubble"><div class="photo" style="width:38px;height:38px;background:#fff;padding:3px">${A.qr(c.id * 7)}</div></div>`);
    c.el.appendChild(b);
    gsap.fromTo(b, { scale: 0, transformOrigin: '50% 100%' }, { scale: 1, duration: 0.4, ease: 'back.out(2)' });
    B.after(2.2, () => {
      gsap.to(b, { scale: 0, duration: 0.25, onComplete: () => b.remove() });
      B.game.pay(c);
      B.after(1, () => leave(c));
    });
  }

  function leave(c, happy = true, fast = false) {
    c.state = 'leave';
    freePickup(c);
    c.el.classList.remove('ringed');
    setTag(c, happy ? 'bye! ♥' : 'leaving');
    const party = c.party;
    party.forEach((m) => {
      if (m.seated) {
        m.seated = false;
        m.el.classList.remove('seated');
        place(m);
      }
      m.parts.foreR.removeAttribute('transform');
      m.parts.armR.removeAttribute('transform');
      m.parts.held.removeAttribute('transform');
      m.pose = false;
      m.el.classList.remove('laptop');
    });
    if (c.laptop) {
      const lid = c.laptop.querySelector('.lid'), lap = c.laptop;
      gsap.to(lid, { scaleY: 0.05, duration: 0.4 });
      gsap.to(lap, { opacity: 0, delay: 0.5, duration: 0.3, onComplete: () => lap.remove() });
      c.claim.tables[0].laptop = false;
    }
    if (c.claim) {
      const claim = c.claim;
      B.after(1.2, () => {
        (c.dishes || []).forEach((d) => gsap.to(d.el, { opacity: 0, y: -6, duration: 0.5, onComplete: () => d.el.remove() }));
        B.room.release(claim, c);
      });
    }
    const qi = queue.indexOf(c);
    if (qi >= 0) { queue.splice(qi, 1); advanceQueue(); }
    moveParty(c, DOOR[0], DOOR[1] + 4, fast ? 1.5 : 1).then(() => {
      B.scene.door(DOOR[0]);
      party.forEach((m) => B.tw(m.el, { opacity: 0, duration: 0.4, onComplete: () => { m.el.remove(); list.splice(list.indexOf(m), 1); } }));
    });
  }

  function renege(c, why) {
    if (c.state === 'leave') return;
    setMood(c, 'sad');
    c.party.forEach((m) => setMood(m, 'sad'));
    puff(c);
    B.audio.play('huff', c.x);
    B.state.walkouts++;
    if (c.ticket && c.ticket.state !== 'served') B.game.voidTicket(c.ticket);
    B.toast('💨', `${c.name} walked out`, why || 'Waited too long. That ticket is void.');
    leave(c, false, true);
  }

  function badReview(c) {
    c.unhappy = true;
    setMood(c, 'sad');
    puff(c);
    B.audio.play('huff', c.x);
    c.el.classList.remove('ringed');
    B.game.review(1 + (Math.random() < 0.4 ? 1 : 0), c, B.pick(['“Took forever for one coffee.”', '“Lovely place but sooo slow.”', '“Waited 20 min. Not again.”', '“Staff seemed swamped.”']));
  }

  /* ---------------- per-step update ---------------- */
  function tick(dt) {
    for (const c of list) {
      if (c.lead !== c) continue;
      if (c.state === 'queue' || c.state === 'wait' || c.state === 'enter') {
        if (!c.unhappy) {
          c.patience -= dt * (c.state === 'wait' ? 1 : 0.6);
          const f = B.clamp(c.patience / c.patienceMax, 0, 1);
          c.parts.ring.setAttribute('stroke-dashoffset', ((1 - f) * 100).toFixed(1));
          c.parts.ring.setAttribute('stroke', ringColor(f));
          if (f < 0.3 && c.mood !== 'sad') setMood(c, 'neutral');
          if (c.patience <= 0) {
            if (Math.random() < 0.55) renege(c);
            else badReview(c);
          }
        }
      } else if (c.state === 'eating' && B.state.t >= c.eatEnd) {
        (c.dishes || []).forEach((d) => { d.el.innerHTML = A.dish(d.id, 1); d.el.firstElementChild.style.cssText = 'width:100%;height:100%'; });
        linger(c);
      } else if (c.state === 'linger' && B.state.t >= c.lingerEnd) {
        payAtTable(c);
      } else if (c.state === 'eating') {
        const k = 1 - (c.eatEnd - B.state.t) / 30;
        (c.dishes || []).forEach((d) => {
          const stage = k > 0.66 ? 2 : k > 0.33 ? 1 : 0;
          if (d.stage !== stage) { d.stage = stage; d.el.innerHTML = A.dish(d.id, stage * 0.45); d.el.firstElementChild.style.cssText = 'width:100%;height:100%'; }
        });
      }
    }
  }

  B.cust = {
    spawn, tick, served, renege, emote,
    get list() { return list; },
    get queueLen() { return queue.length; },
    count() { return list.length; },
    waitingFor(t) { return list.find((c) => c.ticket === t && c.lead === c); },
  };
})();
