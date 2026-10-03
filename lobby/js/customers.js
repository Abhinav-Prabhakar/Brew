/* brew · customers.js — guests and their state machine (3D)
   enter → queue → order → wait (patience ring) → seated → eating → linger → pay → leave
   Takeaway skips the seat. Run out of patience and you either walk out in a
   huff (grey cloud) or stay and leave a bad review (a star cracks in the HUD). */
(function () {
  const B = window.B, T = THREE, G = B.gfx, A = B.art, L = B.L, P = B.people;
  const list = [];
  const queue = [];
  const REG = [L.printer[0] + 0.05, 1.86];
  const QUEUE = [REG, [2.25, 1.25], [2.8, 0.62], [3.35, 0.0], [3.9, -0.62], [4.4, -1.25], [4.85, -1.9], [5.25, -2.55], [5.75, -3.1], [6.25, -3.6], [6.7, -4.1], [7.1, -4.6]];
  const PICKUP = [[0.75, 1.05], [0.05, 0.85], [-0.65, 1.05], [-1.35, 0.85], [-2.05, 1.05], [0.4, 0.3], [-1.0, 0.3]];
  const DOOR = L.doorIn;
  const OFFS = [[0, 0], [0.42, -0.22], [-0.4, -0.2], [0.08, -0.5]];
  const pickupTaken = new Array(PICKUP.length).fill(null);
  let uid = 0;

  /* ---------------- hand-held props ---------------- */
  function paperCup() {
    const g = new T.Group();
    G.m(G.lathe([[0, 0], [0.028, 0], [0.04, 0.11], [0, 0.11]], 24), G.mat('#ffffff', { roughness: 0.6 }), { parent: g });
    G.m(G.lathe([[0.033, 0.03], [0.038, 0.08], [0.0385, 0.08], [0.0335, 0.03]], 24), G.mat('#f39ab3', { roughness: 0.7, side: T.DoubleSide }), { parent: g });
    G.m(G.cyl(0.042, 0.04, 0.014, 24), G.mat('#f6eef0', { roughness: 0.5 }), { p: [0, 0.115, 0], parent: g });
    g.position.set(0, -0.06, 0.02);
    return g;
  }
  function mug(id) {
    const g = new T.Group();
    const c = B.ITEM[id] && B.ITEM[id].cat === 'notcoffee' ? '#f3b9c8' : '#fbf7f5';
    G.m(G.lathe([[0, 0], [0.032, 0], [0.04, 0.075], [0.037, 0.077], [0, 0.07]], 24), G.mat(c, { physical: true, roughness: 0.3, clearcoat: 1 }), { parent: g });
    G.m(G.tor(0.016, 0.005, 8, 16, Math.PI * 1.2), G.mat(c, { roughness: 0.3 }), { p: [0.042, 0.04, 0], r: [0, 0, -1.9], parent: g });
    g.position.set(0, -0.05, 0.03);
    return g;
  }
  function takeBag() {
    const g = new T.Group();
    G.m(G.rbox(0.14, 0.17, 0.08, 0.005), G.mat('#c99a69', { roughness: 0.9 }), { p: [0, -0.1, 0], parent: g });
    G.m(G.rbox(0.142, 0.03, 0.05, 0.005), G.mat('#b5895c', { roughness: 0.9 }), { p: [0, 0.0, 0], parent: g });
    return g;
  }
  function phone() {
    const g = new T.Group();
    G.m(G.rbox(0.075, 0.15, 0.009, 0.01), G.mat('#2d2a33', { roughness: 0.3 }), { parent: g });
    G.m(new T.PlaneGeometry(0.066, 0.138), new T.MeshStandardMaterial({ color: '#bfe3f5', emissive: '#9fd6f5', emissiveIntensity: 0.8 }), { p: [0, 0, 0.005], parent: g, cast: false });
    g.position.set(0, -0.04, 0.05);
    g.rotation.x = -0.6;
    return g;
  }
  function laptop() {
    const g = new T.Group();
    const alu = G.mat('#c9ced8', { metalness: 0.8, roughness: 0.32 });
    G.m(G.rbox(0.32, 0.014, 0.22, 0.006), alu, { p: [0, 0.007, 0], parent: g });
    const lid = G.group(g, [0, 0.014, -0.11]);
    G.m(G.rbox(0.32, 0.21, 0.008, 0.006), alu, { p: [0, 0.105, 0], parent: lid });
    const sc = G.canvas(256, 170), x = sc.getContext('2d');
    x.fillStyle = '#1e2433'; x.fillRect(0, 0, 256, 170);
    const cols = ['#f6a3b8', '#8fd0b8', '#ffd36b', '#9fb8ff', '#ffffff'];
    for (let i = 0; i < 12; i++) { x.fillStyle = cols[i % 5]; x.globalAlpha = 0.8; x.fillRect(16 + (i % 3) * 14, 16 + i * 12, 40 + Math.random() * 140, 5); }
    G.m(new T.PlaneGeometry(0.3, 0.19), new T.MeshStandardMaterial({ map: G.tex(sc, { wrap: false }), emissive: '#ffffff', emissiveMap: G.tex(sc, { wrap: false }), emissiveIntensity: 0.9 }), { p: [0, 0.105, 0.0045], parent: lid, cast: false });
    G.m(new T.CircleGeometry(0.03, 20), G.mat('#f4a3b9'), { p: [0, 0.11, -0.005], r: [0, Math.PI, 0], parent: lid, cast: false });
    lid.rotation.x = Math.PI / 2 - 0.02; // closed flat
    g.userData.lid = lid;
    return g;
  }
  function cloudPuff(parent) {
    const g = G.group(parent, [0, 1.95, 0]);
    const mat = new T.MeshStandardMaterial({ color: '#8d8995', roughness: 1, transparent: true, opacity: 0.95 });
    [[0, 0, 0, 0.12], [0.12, 0.03, 0, 0.1], [-0.12, 0.02, 0, 0.1], [0.05, 0.09, 0, 0.09], [-0.06, 0.08, 0, 0.08]].forEach(([x, y, z, r]) => G.m(G.sph(r, 14, 10), mat, { p: [x, y, z], parent: g, cast: false }));
    g.scale.setScalar(0.2);
    gsap.to(g.scale, { x: 1, y: 1, z: 1, duration: 0.5, ease: 'back.out(2.2)' });
    gsap.to(g.position, { y: 2.35, duration: 2.2, ease: 'power1.out' });
    gsap.to(mat, { opacity: 0, duration: 0.8, delay: 1.4, onComplete: () => parent.remove(g) });
    // little rain from the cloud
    for (let i = 0; i < 6; i++) {
      const d = G.m(G.cap(0.006, 0.03), G.mat('#7fa6d6'), { p: [B.rand(-0.1, 0.1), -0.08, 0], parent: g, cast: false });
      gsap.to(d.position, { y: -0.35, duration: 0.5, delay: 0.3 + i * 0.12, repeat: 1 });
    }
  }

  /* ---------------- HTML overlays (glass) ---------------- */
  function tagFor(c) {
    const el = B.h(`<div class="ptag glass-chip"><span class="pi">${A.persona[c.persona === 'group' ? 'group' : c.persona] || ''}</span><b>${c.name}</b><em></em><i class="pring"></i></div>`);
    c.tagEl = el;
    c.tagState = el.querySelector('em');
    c.tagA = G.anchor(el, c.p.head, [0, 0.42, 0]);
  }
  function setTag(c, s) { if (c.tagState) c.tagState.textContent = s; }
  function bubble(c, items) {
    const el = B.h(`<div class="obubble glass">${items.slice(0, 3).map((it) => `<img src="${B.food.photos[it.id]}" alt="${B.ITEM[it.id].name}">`).join('')}${items.length > 3 ? `<span class="more">+${items.length - 3}</span>` : ''}</div>`);
    const a = G.anchor(el, c.p.head, [0, 0.5, 0]);
    gsap.fromTo(el.firstElementChild ? el : el, { scale: 0.2, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.45, ease: 'back.out(2.2)' });
    B.audio.play('pop');
    return { el, a };
  }
  function emote(c, txt, dur = 1.6) {
    const el = B.h(`<div class="emote">${txt}</div>`);
    const a = G.anchor(el, c.p.head, [0, 0.42, 0]);
    gsap.fromTo(el, { y: 10, opacity: 0, scale: 0.5 }, { y: -18, opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(2)' });
    gsap.to(el, { opacity: 0, y: -40, duration: 0.5, delay: dur, onComplete: () => a.remove() });
  }
  function ringColor(f) {
    if (f > 0.55) return A.mix('#f2a93b', '#ec7d98', (f - 0.55) / 0.45);
    return A.mix('#e0453a', '#f2a93b', f / 0.55);
  }

  /* ---------------- motion ---------------- */
  function walkTo(c, x, z, speed = 1) {
    return new Promise((res) => {
      if (c.moveTw) c.moveTw.kill();
      const r = c.p.root, o = { x: r.position.x, z: r.position.z };
      const d = Math.hypot(x - o.x, z - o.z);
      if (d < 0.02) { res(); return; }
      const targetRy = Math.atan2(x - o.x, z - o.z);
      turnTo(c, targetRy, 0.25);
      c.moving = true;
      c.moveTw = B.tw(o, {
        x, z, duration: d / (1.25 * speed), ease: 'none',
        onUpdate: () => { r.position.x = o.x; r.position.z = o.z; },
        onComplete: () => { c.moveTw = null; c.moving = false; P.stand(c.p); res(); },
      });
    });
  }
  function turnTo(c, ry, dur = 0.35) {
    const r = c.p.root;
    let d = ry - r.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    B.tw(r.rotation, { y: r.rotation.y + d, duration: dur, ease: 'power2.out' });
  }
  G.onFrame((dt) => {
    const k = B.state.paused ? 0 : Math.min(B.state.speed, 12);
    list.forEach((c) => { if (c.moving) P.walkCycle(c.p, dt * k * 8.2); });
  });
  function moveParty(c, x, z, speed) {
    return Promise.all(c.party.map((m, i) => {
      const [ox, oz] = OFFS[i] || [0, 0];
      return new Promise((r) => B.after(i * 0.25, () => walkTo(m, x + ox, z + oz, speed).then(r)));
    }));
  }
  const faceCounter = (c) => c.party.forEach((m) => turnTo(m, 0));

  /* ---------------- lifecycle ---------------- */
  function spawn(persona, opts = {}) {
    const n = persona === 'group' ? opts.n || B.ri(3, 4) : opts.n || 1;
    const lead0 = persona === 'group' ? B.pick(['student', 'leisurely', 'student']) : persona;
    const party = [];
    for (let i = 0; i < n; i++) {
      const per = i === 0 ? lead0 : B.pick(['student', 'leisurely', lead0]);
      const c = { id: ++uid, persona: i === 0 ? persona : per, name: B.pick(B.NAMES), state: 'enter', mood: 'neutral' };
      c.p = P.build(P.randomTraits(persona === 'group' ? per : persona));
      c.p.root.position.set(DOOR[0] + (OFFS[i] || [0, 0])[0] * 0.3, 0, DOOR[1] - 0.9);
      c.p.root.rotation.y = 0;
      c.p.root.visible = false;
      G.scene.add(c.p.root);
      P.setMood(c.p, 'neutral');
      party.push(c);
      list.push(c);
      G.pickable(c.p.root, { hover: (on) => c.tagEl && c.tagEl.classList.toggle('show', on) });
    }
    const lead = party[0];
    lead.party = party;
    lead.channel = opts.channel || 'dine';
    party.forEach((m) => { m.lead = lead; m.party = party; });
    tagFor(lead);
    const base = { commuter: 70, student: 95, leisurely: 120, camper: 110, group: 100 }[persona] || 90;
    lead.patienceMax = base * (B.WX[B.state.weather].wet > 0.3 ? 1.15 : 1) * B.rand(0.85, 1.15);
    lead.patience = lead.patienceMax;
    party.forEach((m, i) => B.after(i * 0.35, () => {
      if (i === 0) B.world.door(1500);
      m.p.root.visible = true;
    }));
    setTag(lead, 'walking in');
    queue.push(lead);
    B.after(0.2, advanceQueue);
    return lead;
  }

  function advanceQueue() {
    queue.forEach((c, i) => {
      if (c.state !== 'enter' && c.state !== 'queue') return;
      let [x, z] = QUEUE[Math.min(i, QUEUE.length - 1)];
      if (i >= QUEUE.length) { const k = i - QUEUE.length + 1; x = Math.min(7.4, x + k * 0.25); z -= k * 0.45; }
      if (c.qSlot === i && c.state === 'queue') return;
      c.qSlot = i;
      c.state = 'queue';
      setTag(c, i === 0 ? 'at the counter' : `in line · #${i + 1}`);
      P.ring(c.p, true);
      const go = () => moveParty(c, x, z).then(() => {
        if (c.qSlot === i) faceCounter(c);
        if (c.qSlot === 0 && c.state === 'queue' && !c.ordering) order(c);
      });
      // first step through the doorway
      if (c.p.root.position.z < DOOR[1] - 0.2) moveParty(c, DOOR[0], DOOR[1]).then(go);
      else go();
    });
  }

  function order(c) {
    c.ordering = true;
    c.state = 'order';
    setTag(c, 'ordering');
    P.setMood(c.p, 'happy');
    const t = B.game.placeOrder(c);
    if (!t) { emote(c, '😕'); B.after(1.2, () => renege(c, 'Nothing they wanted was available.')); return; }
    c.ticket = t;
    const bub = bubble(c, t.items);
    B.audio.play('keys');
    B.after(2.4, () => {
      gsap.to(bub.el, { scale: 0, opacity: 0, duration: 0.25, onComplete: () => bub.a.remove() });
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
    P.setMood(c.p, 'neutral');
    setTag(c, `waiting · #${c.ticket.no}`);
    const [x, z] = PICKUP[slot];
    moveParty(c, x, z).then(() => faceCounter(c));
  }
  function freePickup(c) {
    if (c.pSlot != null && pickupTaken[c.pSlot] === c) pickupTaken[c.pSlot] = null;
    c.pSlot = null;
  }

  function served(c) {
    if (c.state !== 'wait') return;
    freePickup(c);
    P.ring(c.p, false);
    if (!c.unhappy) P.setMood(c.p, 'happy');
    emote(c, B.state.t > c.ticket.promise ? '🙂' : B.pick(['😍', '🥰', '✨', '☕']));
    c.party.forEach((m, i) => {
      const it = c.ticket.items[i] || c.ticket.items[0];
      P.hold(m.p, c.channel === 'take' ? (i === 0 ? takeBag() : paperCup()) : mug(it.id));
      P.carry(m.p, true);
      m.carrying = true;
    });
    if (c.channel === 'take') { setTag(c, 'heading out'); B.after(0.8, () => leave(c, true)); return; }
    const claim = B.room.claim(c.party.length, c);
    if (!claim) {
      emote(c, '🥡');
      setTag(c, 'no table — to go');
      B.toast('🪑', 'No free table', `${c.name} took it to go. More seats, more dine-in revenue.`);
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
      // approach the chair from in front of it, then sit
      const ax = s.x + Math.sin(s.ry) * 0.0, az = s.z + 0.35;
      walkTo(m, ax, az).then(() => walkTo(m, s.x, s.z)).then(() => {
        P.carry(m.p, false);
        m.carrying = false;
        P.hold(m.p, null);
        turnTo(m, s.ry, 0.3);
        P.sit(m.p, true);
        m.seat = s;
        B.audio.play('thud', 800);
        r();
      });
    }))));
    // dishes on the table in front of each sitter
    c.dishes = [];
    c.ticket.items.slice(0, 4).forEach((it, i) => {
      const s = seats[i % seats.length];
      const t = claim.merge ? (s.x < (claim.tables[0].mx + claim.tables[1].mx) / 2 ? claim.tables[0] : claim.tables[1]) : claim.tables[0];
      const fx = Math.sin(s.ry), fz = Math.cos(s.ry);
      const off = i >= seats.length ? 0.12 : 0;
      const dx = s.x + fx * 0.36 + -fz * (off - 0.05), dz = s.z + fz * 0.36 + fx * (off - 0.05);
      c.dishes.push({ m: B.room.dish(t, it.id, dx, dz), id: it.id, t });
    });
    if (c.persona === 'camper') {
      const s = seats[0], t = claim.tables[0];
      const lap = laptop();
      lap.position.set(s.x + Math.sin(s.ry) * 0.3 - t.cx, B.room.TOP_Y, s.z + Math.cos(s.ry) * 0.3 - t.z);
      lap.rotation.y = s.ry + Math.PI;
      t.obj.add(lap);
      t.laptop = true;
      c.laptop = lap;
      gsap.to(lap.userData.lid.rotation, { x: -0.25, duration: 0.9, delay: 0.4, ease: 'back.out(1.4)', onStart: () => B.audio.play('pop', 800) });
    }
    c.state = 'eating';
    setTag(c, c.persona === 'camper' ? 'working + sipping' : 'enjoying it');
    c.eatEnd = B.state.t + B.rand(24, 40) * (c.party.length > 2 ? 1.3 : 1);
    c.party.forEach((m, i) => B.after(1 + i * 1.3, () => sipLoop(m, c)));
  }
  function sipLoop(m, lead) {
    if (lead.state !== 'eating' && lead.state !== 'linger') return;
    if (lead.state === 'eating' || Math.random() < 0.4) {
      const drink = (lead.ticket.items.find((it) => ['coffee', 'notcoffee'].includes(B.ITEM[it.id].cat)) || lead.ticket.items[0]).id;
      P.hold(m.p, mug(drink));
      const o = { a: 0 };
      P.setMood(m.p, 'eat');
      B.tw(o, { a: 1, duration: 0.7, ease: 'power2.inOut', onUpdate: () => P.sipPose(m.p, o.a) });
      B.after(1.6, () => {
        B.audio.play('sip', 800);
        B.tw(o, { a: 0, duration: 0.7, ease: 'power2.inOut', onUpdate: () => P.sipPose(m.p, o.a), onComplete: () => { P.hold(m.p, null); P.setMood(m.p, lead.unhappy ? 'sad' : 'happy'); if (m.seat) P.sit(m.p, true); } });
      });
    }
    B.after(B.rand(3.5, 7), () => sipLoop(m, lead));
  }
  function linger(c) {
    c.state = 'linger';
    c.party.forEach((m) => { P.setMood(m.p, m.lead.unhappy ? 'sad' : 'happy'); if (Math.random() < 0.4 && c.persona !== 'camper') P.hold(m.p, phone()); });
    setTag(c, c.persona === 'camper' ? 'one more email…' : 'chatting');
    const dur = c.persona === 'camper' ? B.rand(90, 150) : c.persona === 'leisurely' || c.persona === 'group' ? B.rand(16, 34) : B.rand(6, 14);
    c.lingerEnd = B.state.t + dur;
  }
  function payAtTable(c) {
    c.state = 'pay';
    setTag(c, 'paying · UPI');
    const el = B.h(`<div class="obubble glass qrb">${A.qr(c.id * 7)}<span>UPI</span></div>`);
    const a = G.anchor(el, c.p.head, [0, 0.5, 0]);
    gsap.fromTo(el, { scale: 0.2, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(2)' });
    B.after(2.2, () => {
      gsap.to(el, { scale: 0, opacity: 0, duration: 0.25, onComplete: () => a.remove() });
      B.game.pay(c);
      B.after(1, () => leave(c));
    });
  }

  function leave(c, happy = true, fast = false) {
    if (c.state === 'leave') return;
    c.state = 'leave';
    freePickup(c);
    P.ring(c.p, false);
    setTag(c, happy ? 'bye! ♥' : 'leaving');
    c.party.forEach((m) => {
      if (m.p.seated) P.sit(m.p, false);
      m.seat = null;
      P.sipPose(m.p, 0);
      if (!m.carrying) P.hold(m.p, null);
    });
    if (c.laptop) {
      const lap = c.laptop, t = c.claim.tables[0];
      gsap.to(lap.userData.lid.rotation, { x: Math.PI / 2 - 0.02, duration: 0.45 });
      gsap.to(lap.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.3, delay: 0.5, onComplete: () => lap.parent && lap.parent.remove(lap) });
      t.laptop = false;
    }
    if (c.claim) {
      const claim = c.claim;
      B.after(1.4, () => {
        (c.dishes || []).forEach((d) => gsap.to(d.m.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.4, onComplete: () => d.m.parent && d.m.parent.remove(d.m) }));
        B.room.release(claim, c);
      });
    }
    const qi = queue.indexOf(c);
    if (qi >= 0) { queue.splice(qi, 1); advanceQueue(); }
    moveParty(c, DOOR[0], DOOR[1], fast ? 1.5 : 1).then(() => {
      B.world.door(1500);
      return moveParty(c, DOOR[0], DOOR[1] - 1.0, fast ? 1.5 : 1);
    }).then(() => {
      if (c.tagA) c.tagA.remove();
      c.party.forEach((m) => { G.unpick(m.p.root); G.scene.remove(m.p.root); P.dispose(m.p); list.splice(list.indexOf(m), 1); });
    });
  }

  function renege(c, why) {
    if (c.state === 'leave') return;
    c.party.forEach((m) => P.setMood(m.p, 'sad'));
    cloudPuff(c.p.root);
    B.audio.play('huff', 1000);
    B.state.walkouts++;
    if (c.ticket && c.ticket.state !== 'served') B.game.voidTicket(c.ticket);
    B.toast('💨', `${c.name} walked out`, why || 'Waited too long — that ticket is void.');
    leave(c, false, true);
  }
  function badReview(c) {
    c.unhappy = true;
    P.setMood(c.p, 'sad');
    cloudPuff(c.p.root);
    B.audio.play('huff', 1000);
    P.ring(c.p, false);
    B.game.review(1 + (Math.random() < 0.4 ? 1 : 0), c, B.pick(['“Took forever for one coffee.”', '“Lovely place but sooo slow.”', '“Waited 20 min. Not again.”', '“Staff seemed swamped.”']));
  }

  function tick(dt) {
    for (const c of list) {
      if (c.lead !== c) continue;
      if (c.state === 'queue' || c.state === 'wait' || c.state === 'enter') {
        if (!c.unhappy) {
          c.patience -= dt * (c.state === 'wait' ? 1 : 0.6);
          const f = B.clamp(c.patience / c.patienceMax, 0, 1);
          P.ring(c.p, null, f, ringColor(f));
          if (c.tagEl) c.tagEl.style.setProperty('--f', f.toFixed(3));
          if (c.patience <= 0) { if (Math.random() < 0.55) renege(c); else badReview(c); }
        }
      } else if (c.state === 'eating') {
        const k = 1 - (c.eatEnd - B.state.t) / 30;
        (c.dishes || []).forEach((d) => {
          const stage = k > 0.66 ? 2 : k > 0.33 ? 1 : 0;
          if (d.stage !== stage) {
            d.stage = stage;
            // drinks drain, plates empty
            d.m.traverse((o) => { if (o.isMesh && o.geometry.type === 'CircleGeometry') o.position.y -= 0.004; });
            if (stage === 2 && !['coffee', 'notcoffee'].includes(B.ITEM[d.id].cat)) d.m.children.slice(1).forEach((o) => gsap.to(o.scale, { x: 0.4, y: 0.4, z: 0.4, duration: 0.6 }));
          }
        });
        if (B.state.t >= c.eatEnd) {
          (c.dishes || []).forEach((d) => d.m.traverse((o) => { if (o.isMesh && o.geometry.type === 'CircleGeometry') o.visible = false; }));
          linger(c);
        }
      } else if (c.state === 'linger' && B.state.t >= c.lingerEnd) payAtTable(c);
    }
  }

  B.cust = {
    spawn, tick, served, renege, emote,
    get list() { return list; },
    get queueLen() { return queue.length; },
    count() { return list.length; },
  };
})();
