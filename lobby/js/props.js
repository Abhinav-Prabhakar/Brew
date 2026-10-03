/* brew · props.js — furniture & seating, the pastry fridge, delivery bags & riders (3D) */
(function () {
  const B = window.B, T = THREE, G = B.gfx, L = B.L;
  const scene = G.scene;

  /* =================== tables & chairs =================== */
  const TABLES = [
    { id: 'T1', x: -4.05, z: -0.55, mx: -3.8 },
    { id: 'T2', x: -2.75, z: -0.55, mx: -3.04 },
    { id: 'T3', x: -5.7, z: -3.3 },
    { id: 'T4', x: -2.7, z: -3.6 },
    { id: 'T5', x: 0.35, z: -3.3 },
    { id: 'T6', x: 1.25, z: -0.95 },
  ];
  const marbleMat = (() => { const t = G.lib('marble').clone(); t.needsUpdate = true; return new T.MeshPhysicalMaterial({ map: t, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.06 }); })();
  const TOP_Y = 0.75;

  function tableModel() {
    const g = new T.Group();
    G.m(G.cyl(0.38, 0.38, 0.032, 56), marbleMat, { p: [0, TOP_Y - 0.016, 0], parent: g });
    G.m(G.tor(0.38, 0.012, 10, 64), G.brass(), { p: [0, TOP_Y - 0.016, 0], r: [Math.PI / 2, 0, 0], parent: g });
    G.m(G.lathe([[0, 0], [0.26, 0], [0.27, 0.012], [0.2, 0.03], [0.05, 0.05], [0.035, 0.12], [0.03, 0.6], [0.045, 0.7], [0.12, 0.72], [0, 0.72]], 40), G.brass(), { parent: g });
    return g;
  }
  const chairWood = G.mat('#fbf4f1', { physical: true, roughness: 0.35, clearcoat: 0.7 });
  const cushion = G.mat('#f2a3b8', { roughness: 0.85, normal: 'fabric', ns: 0.5 });
  function chairModel() {
    const g = new T.Group();
    const legs = [[-0.15, 0.13], [0.15, 0.13], [-0.14, -0.14], [0.14, -0.14]];
    legs.forEach(([x, z]) => G.m(G.cyl(0.016, 0.012, 0.46, 10), chairWood, { p: [x * 1.05, 0.23, z * 1.05], r: [z * 0.25, 0, -x * 0.25], parent: g }));
    G.m(G.tor(0.15, 0.01, 8, 32), chairWood, { p: [0, 0.16, 0], r: [Math.PI / 2, 0, 0], parent: g });
    G.m(G.cyl(0.2, 0.19, 0.045, 36), chairWood, { p: [0, 0.455, 0], parent: g });
    G.m(G.cyl(0.185, 0.185, 0.04, 36), cushion, { p: [0, 0.495, 0], s: [1, 1, 1], parent: g });
    const back = new T.CatmullRomCurve3([new T.Vector3(-0.17, 0.47, -0.15), new T.Vector3(-0.19, 0.75, -0.2), new T.Vector3(-0.1, 0.9, -0.22), new T.Vector3(0.1, 0.9, -0.22), new T.Vector3(0.19, 0.75, -0.2), new T.Vector3(0.17, 0.47, -0.15)]);
    G.m(new T.TubeGeometry(back, 40, 0.016, 8), chairWood, { parent: g });
    const inner = new T.CatmullRomCurve3([new T.Vector3(-0.1, 0.5, -0.17), new T.Vector3(-0.11, 0.72, -0.2), new T.Vector3(0, 0.8, -0.21), new T.Vector3(0.11, 0.72, -0.2), new T.Vector3(0.1, 0.5, -0.17)]);
    G.m(new T.TubeGeometry(inner, 30, 0.011, 8), chairWood, { parent: g });
    return g;
  }

  function seatSpot(t, side) {
    return { x: t.cx + side * 0.62, z: t.z + 0.02, ry: side < 0 ? Math.PI / 2 : -Math.PI / 2, side };
  }
  function layoutTable(t) {
    t.obj.position.set(t.cx, 0, t.z);
    t.chairs.forEach((c) => {
      if (c.override) return;
      const s = seatSpot(t, c.side);
      c.obj.position.set(s.x, 0, s.z);
      c.obj.rotation.y = s.ry;
    });
  }
  function buildTable(t) {
    t.cx = t.x;
    t.obj = tableModel();
    scene.add(t.obj);
    t.chairs = [-1, 1].map((side) => { const c = { obj: chairModel(), side }; scene.add(c.obj); return c; });
    t.seats = [{ side: -1, who: null }, { side: 1, who: null }];
    t.dishes = new T.Group();
    t.obj.add(t.dishes);
    layoutTable(t);
    t.obj.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
  }

  B.room = {
    tables: TABLES,
    TOP_Y,
    init() { TABLES.forEach(buildTable); },
    claim(n, who) {
      if (n <= 2) {
        let free = TABLES.filter((t) => !t.merged && t.seats.every((s) => !s.who));
        if (!free.length && n === 1) {
          const half = TABLES.filter((t) => !t.merged && !t.laptop && t.seats.some((s) => !s.who));
          if (!half.length) return null;
          const t = B.pick(half), s = t.seats.find((x) => !x.who);
          s.who = who;
          return { tables: [t], seats: [Object.assign({ table: t }, seatSpot(t, s.side))] };
        }
        if (!free.length) return null;
        // prefer tables away from the merge pair so groups can still sit
        const pref = free.filter((t) => t.id !== 'T1' && t.id !== 'T2');
        const t = B.pick(pref.length ? pref : free);
        const order = Math.random() < 0.5 ? [-1, 1] : [1, -1];
        return { tables: [t], seats: order.slice(0, n).map((side) => { t.seats.find((s) => s.side === side).who = who; return Object.assign({ table: t }, seatSpot(t, side)); }) };
      }
      const a = TABLES[0], b = TABLES[1];
      if ([a, b].some((t) => t.merged || t.seats.some((s) => s.who))) return null;
      [a, b].forEach((t) => t.seats.forEach((s) => (s.who = who)));
      return { tables: [a, b], merge: true, seats: null };
    },
    canSeat(n) {
      if (n <= 2) return TABLES.some((t) => !t.merged && t.seats.every((s) => !s.who)) || (n === 1 && TABLES.some((t) => !t.merged && !t.laptop && t.seats.some((s) => !s.who)));
      return [TABLES[0], TABLES[1]].every((t) => !t.merged && t.seats.every((s) => !s.who));
    },
    /** groups push T1 + T2 together; the inner chairs swing round to the far side */
    merge() {
      const a = TABLES[0], b = TABLES[1];
      a.merged = b.merged = true;
      B.audio.play('scrape');
      return new Promise((res) => {
        [a, b].forEach((t) => {
          const o = { x: t.cx };
          B.tw(o, { x: t.mx, duration: 1.0, ease: 'power2.inOut', onUpdate: () => { t.cx = o.x; layoutTable(t); } });
        });
        const inner = [a.chairs[1], b.chairs[0]];
        inner.forEach((c, i) => {
          c.override = true;
          const tx = [a.mx, b.mx][i], tz = a.z - 0.62;
          B.tw(c.obj.position, { x: tx, z: tz, duration: 1.0, ease: 'power2.inOut' });
          B.tw(c.obj.rotation, { y: 0, duration: 1.0, ease: 'power2.inOut' });
        });
        B.after(1.05, () => res([
          { x: a.mx - 0.62, z: a.z + 0.02, ry: Math.PI / 2 },
          { x: b.mx + 0.62, z: b.z + 0.02, ry: -Math.PI / 2 },
          { x: a.mx, z: a.z - 0.62, ry: 0 },
          { x: b.mx, z: b.z - 0.62, ry: 0 },
        ]));
      });
    },
    unmerge() {
      const a = TABLES[0], b = TABLES[1];
      B.audio.play('scrape');
      [a, b].forEach((t) => {
        const o = { x: t.cx };
        B.tw(o, { x: t.x, duration: 1.0, ease: 'power2.inOut', onUpdate: () => { t.cx = o.x; layoutTable(t); }, onComplete: () => { t.merged = false; } });
      });
      [a.chairs[1], b.chairs[0]].forEach((c, i) => {
        const t = [a, b][i], s = seatSpot({ cx: t.x, z: t.z }, c.side);
        B.tw(c.obj.position, { x: s.x, z: s.z, duration: 1.0, ease: 'power2.inOut', onComplete: () => (c.override = false) });
        B.tw(c.obj.rotation, { y: s.ry, duration: 1.0 });
      });
    },
    release(claim, who) {
      claim.tables.forEach((t) => t.seats.forEach((s) => { if (s.who === who || claim.merge) s.who = null; }));
      if (claim.merge) B.room.unmerge();
    },
    /** put a dish on the table, nudged toward a seat */
    dish(t, id, x, z) {
      const m = B.food.model(id);
      m.position.set(x - t.cx, TOP_Y + 0.001, z - t.z);
      m.rotation.y = Math.random() * 6;
      t.obj.add(m);
      m.scale.setScalar(0.01);
      gsap.to(m.scale, { x: 1, y: 1, z: 1, duration: 0.4, ease: 'back.out(2)' });
      return m;
    },
  };

  /* =================== the pastry fridge =================== */
  const STOCK0 = { cheesecake: 5, croissant: 8, muffin: 6, cinnamon: 6, coldbrew: 10 };
  const fr = G.group(scene, [L.fridge[0], L.counterTop, L.fridge[1]]);
  fr.rotation.y = 0.28;
  const FW = 0.74, FH = 0.78, FD = 0.52;
  const pinkL = G.mat('#f4b2c3', { physical: true, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 });
  const paneMat = new T.MeshPhysicalMaterial({ color: '#f2fbff', transparent: true, opacity: 0.14, roughness: 0.03, metalness: 0, envMapIntensity: 1.6, depthWrite: false, side: T.DoubleSide });
  G.m(G.rbox(FW + 0.04, 0.16, FD + 0.04, 0.03), pinkL, { p: [0, 0.08, 0], parent: fr });
  G.m(G.rbox(FW + 0.04, 0.12, FD + 0.04, 0.03), pinkL, { p: [0, 0.16 + FH + 0.06, 0], parent: fr });
  // pillars
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => G.m(G.rbox(0.025, FH, 0.025, 0.006), G.mat('#ffffff', { roughness: 0.3 }), { p: [sx * FW / 2, 0.16 + FH / 2, sz * FD / 2], parent: fr }));
  // glass: back (faces the dining room), sides
  G.m(new T.PlaneGeometry(FW, FH), paneMat, { p: [0, 0.16 + FH / 2, -FD / 2], parent: fr, cast: false, recv: false });
  [-1, 1].forEach((s) => G.m(new T.PlaneGeometry(FD, FH), paneMat, { p: [s * FW / 2, 0.16 + FH / 2, 0], r: [0, Math.PI / 2, 0], parent: fr, cast: false, recv: false }));
  // interior: mirrored back, glass shelves, LED strip
  G.m(G.rbox(FW - 0.02, 0.012, FD - 0.04, 0.004), G.mat('#ffffff', { roughness: 0.5 }), { p: [0, 0.166, 0], parent: fr });
  const shelfYs = [0.17, 0.42, 0.66];
  shelfYs.slice(1).forEach((y) => G.m(G.rbox(FW - 0.03, 0.008, FD - 0.06, 0.003), new T.MeshPhysicalMaterial({ color: '#e8f6ff', transparent: true, opacity: 0.35, roughness: 0.05, envMapIntensity: 1.5 }), { p: [0, 0.16 + y - 0.17, 0], parent: fr, cast: false }));
  const led = G.m(G.rbox(FW - 0.06, 0.012, 0.02, 0.004), new T.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff6ea', emissiveIntensity: 2.2 }), { p: [0, 0.16 + FH - 0.015, FD / 2 - 0.05], parent: fr, cast: false });
  const frLight = new T.PointLight('#fff1e6', 0.6, 1.4, 2);
  frLight.position.set(0, 0.16 + FH - 0.1, 0);
  fr.add(frLight);
  // crown sign
  const crownC = G.canvas(512, 96), crownX = crownC.getContext('2d');
  const drawCrown = () => { crownX.clearRect(0, 0, 512, 96); crownX.fillStyle = '#ffffff'; crownX.font = 'italic 600 64px Fraunces'; crownX.textAlign = 'center'; crownX.textBaseline = 'middle'; crownX.fillText('pâtisserie', 256, 50); crownTex.needsUpdate = true; };
  const crownTex = G.tex(crownC, { wrap: false });
  G.m(new T.PlaneGeometry(0.5, 0.094), new T.MeshStandardMaterial({ map: crownTex, transparent: true, roughness: 0.4 }), { p: [0, 0.16 + FH + 0.06, FD / 2 + 0.022], parent: fr, cast: false });
  // the door faces the cook (+z) and swings on its left edge
  const door = G.group(fr, [-FW / 2, 0.16, FD / 2]);
  G.m(new T.PlaneGeometry(FW, FH), paneMat, { p: [FW / 2, FH / 2, 0], parent: door, cast: false, recv: false });
  [[FW / 2, 0.012, FW, 0.024], [FW / 2, FH - 0.012, FW, 0.024]].forEach(([x, y, w, h]) => G.m(G.rbox(w, h, 0.02, 0.006), G.mat('#ffffff', { roughness: 0.3 }), { p: [x, y, 0], parent: door }));
  G.m(G.rbox(0.018, 0.22, 0.03, 0.008), G.brass(), { p: [FW - 0.05, FH / 2, 0.025], parent: door });
  // stock: real 3D bakes on the shelves
  const SLOTS = [
    { y: 0, ids: [['coldbrew', -0.25], ['coldbrew', -0.12], ['cinnamon', 0.07], ['cinnamon', 0.24]] },
    { y: 0.25, ids: [['croissant', -0.24], ['croissant', -0.08], ['muffin', 0.09], ['muffin', 0.25]] },
    { y: 0.49, ids: [['cheesecake', -0.22], ['cheesecake', 0.0], ['cheesecake', 0.22]] },
  ];
  const items = [];
  SLOTS.forEach((row) => row.ids.forEach(([id, x]) => {
    const m = B.food.model(id);
    m.scale.setScalar(id === 'coldbrew' ? 0.95 : 0.85);
    m.position.set(x, 0.172 + row.y, -0.02);
    m.rotation.y = B.rand(-0.5, 0.5);
    fr.add(m);
    items.push({ id, m });
  }));
  // stock tags
  const tagFor = {};
  [['coldbrew', -0.185, 0], ['cinnamon', 0.155, 0], ['croissant', -0.16, 0.25], ['muffin', 0.17, 0.25], ['cheesecake', 0, 0.49]].forEach(([id, x, y]) => {
    const c = G.canvas(128, 56);
    const tex = G.tex(c, { wrap: false });
    G.m(new T.PlaneGeometry(0.07, 0.03), new T.MeshStandardMaterial({ map: tex, roughness: 0.6, transparent: true }), { p: [x, 0.19 + y, FD / 2 - 0.035], r: [-0.3, 0, 0], parent: fr, cast: false });
    tagFor[id] = { c, tex };
  });
  // cold mist puffs
  const mistTex = (() => { const c = G.canvas(64, 64), x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return G.tex(c, { wrap: false }); })();
  B.mistTex = mistTex;
  const mists = [];
  for (let i = 0; i < 8; i++) { const s = new T.Sprite(new T.SpriteMaterial({ map: mistTex, transparent: true, opacity: 0, depthWrite: false })); s.scale.setScalar(0.25); fr.add(s); mists.push(s); }
  fr.traverse((o) => { if (o.isMesh && o.material !== paneMat) { o.castShadow = o.castShadow !== false; } });

  const fridge = {
    stock: { ...STOCK0 },
    open: false,
    build() { drawCrown(); this.sync(); },
    sync() {
      const seen = {};
      items.forEach((it) => {
        seen[it.id] = (seen[it.id] || 0) + 1;
        const slots = items.filter((x) => x.id === it.id).length;
        const show = Math.min(slots, this.stock[it.id]);
        const vis = seen[it.id] <= show;
        if (it.m.visible !== vis) {
          if (!vis) gsap.to(it.m.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.35, onComplete: () => (it.m.visible = false) });
          else { it.m.visible = true; gsap.fromTo(it.m.scale, { x: 0.01, y: 0.01, z: 0.01 }, { x: 0.85, y: 0.85, z: 0.85, duration: 0.4, ease: 'back.out(2)' }); }
        }
      });
      Object.entries(tagFor).forEach(([id, { c, tex }]) => {
        const x = c.getContext('2d'), n = this.stock[id];
        x.clearRect(0, 0, 128, 56);
        x.fillStyle = 'rgba(255,255,255,.96)'; x.beginPath(); x.roundRect(2, 2, 124, 52, 12); x.fill();
        x.fillStyle = n <= 1 ? '#e0453a' : '#3a2430'; x.font = '700 30px "Space Mono"'; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText(n ? `×${n}` : 'OUT', 64, 30);
        tex.needsUpdate = true;
      });
    },
    has(id) { return this.stock[id] == null || this.stock[id] > 0; },
    take(id) {
      if (this.stock[id] == null) return true;
      if (this.stock[id] <= 0) return false;
      this.stock[id]--;
      if (!this.open && B.state.speed < 10) this.peek();
      this.sync();
      B.emit('stock', id, this.stock[id]);
      return true;
    },
    restock() {
      let cost = 0;
      Object.keys(STOCK0).forEach((id) => { const add = STOCK0[id] - this.stock[id]; if (add > 0) cost += add * Math.round(B.ITEM[id].base * 0.32); this.stock[id] = STOCK0[id]; });
      this.sync();
      return cost;
    },
    toggle(force) {
      this.open = force != null ? force : !this.open;
      gsap.to(door.rotation, { y: this.open ? -1.45 : 0, duration: this.open ? 0.7 : 0.55, ease: this.open ? 'back.out(1.2)' : 'power2.in' });
      gsap.to(frLight, { intensity: this.open ? 1.6 : 0.6, duration: 0.4 });
      gsap.to(led.material, { emissiveIntensity: this.open ? 4 : 2.2, duration: 0.4 });
      B.audio.play(this.open ? 'fridgeOpen' : 'fridgeClose');
      if (this.open) mists.forEach((s, i) => {
        s.position.set(B.rand(-0.25, 0.25), 0.3 + B.rand(0, 0.4), FD / 2);
        s.material.opacity = 0.7;
        s.scale.setScalar(0.15);
        gsap.to(s.position, { z: FD / 2 + 0.35, y: '-=0.15', x: `+=${B.rand(-0.1, 0.1)}`, duration: 1.8, ease: 'power2.out', delay: i * 0.04 });
        gsap.to(s.scale, { x: 0.55, y: 0.55, z: 0.55, duration: 1.8, delay: i * 0.04 });
        gsap.to(s.material, { opacity: 0, duration: 1.8, delay: i * 0.04, ease: 'power1.in' });
      });
    },
    peek() {
      if (this._peek) return;
      this._peek = true;
      this.toggle(true);
      setTimeout(() => { this.toggle(false); this._peek = false; }, 950);
    },
  };
  B.fridge = fridge;
  G.pickable(fr, {
    click: () => {
      if (fridge._peek) return;
      fridge.toggle();
      if (fridge.open) {
        const low = Object.entries(fridge.stock).filter(([, n]) => n <= 2).map(([id]) => B.ITEM[id].name);
        if (low.length) {
          const cost = Object.keys(STOCK0).reduce((s, id) => s + Math.max(0, STOCK0[id] - fridge.stock[id]) * Math.round(B.ITEM[id].base * 0.32), 0);
          B.toast('🧁', 'Running low', `${low.join(', ')}. Tap the fridge again within 3s to restock (−${B.inr(cost)}).`);
          fridge._offer = performance.now();
        }
      } else if (fridge._offer && performance.now() - fridge._offer < 3500) {
        fridge._offer = 0;
        const cost = fridge.restock();
        B.game.spend(cost, 'Bakery restock', fr);
        B.toast('🥐', 'Fridge restocked', `Fresh trays from the bakery · −${B.inr(cost)}`);
      }
    },
  });

  /* =================== delivery shelf, bags & riders =================== */
  const CH = { zomato: { color: '#d23434', label: 'ZOMATO' }, swiggy: { color: '#ec7716', label: 'SWIGGY' } };
  B.CHANNELS = CH;
  const shelf = G.group(scene, [L.shelf[0], L.counterTop, L.shelf[1]]);
  shelf.rotation.y = -0.22;
  {
    const wood = (() => { const t = G.lib('wood').clone(); t.needsUpdate = true; return new T.MeshStandardMaterial({ map: t, roughness: 0.6 }); })();
    G.m(G.rbox(0.64, 0.03, 0.36, 0.01), wood, { p: [0, 0.16, 0], parent: shelf });
    [[-0.29, -0.15], [0.29, -0.15], [-0.29, 0.15], [0.29, 0.15]].forEach(([x, z]) => G.m(G.cyl(0.012, 0.012, 0.16, 10), G.brass(), { p: [x, 0.08, z], parent: shelf }));
    const c = G.canvas(512, 120), x = c.getContext('2d');
    const draw = () => { x.clearRect(0, 0, 512, 120); x.fillStyle = '#fffdf8'; x.beginPath(); x.roundRect(6, 6, 500, 108, 22); x.fill(); x.strokeStyle = '#f39ab3'; x.lineWidth = 6; x.stroke(); x.fillStyle = '#c43e64'; x.font = 'italic 600 58px Fraunces'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('Rider pickup', 256, 62); t.needsUpdate = true; };
    const t = G.tex(c, { wrap: false });
    const sign = G.group(shelf, [0, 0.62, -0.14]);
    G.m(new T.PlaneGeometry(0.34, 0.08), new T.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.5 }), { parent: sign, cast: false });
    [-0.13, 0.13].forEach((sx) => G.m(G.cyl(0.004, 0.004, 0.44, 6), G.brass(), { p: [sx, -0.24, -0.005], parent: sign }));
    B.on('fonts', draw);
    draw();
  }
  const kraftTex = (() => {
    const c = G.canvas(256, 320), x = c.getContext('2d');
    x.fillStyle = '#c99a69'; x.fillRect(0, 0, 256, 320);
    const n = G.noise(128, 33);
    for (let i = 0; i < 9000; i++) { const v = n[i % 16384]; x.fillStyle = `rgba(${100 + v * 60},${70 + v * 40},${40},${0.05 + v * 0.08})`; x.fillRect(Math.random() * 256, Math.random() * 320, 2, 1); }
    x.strokeStyle = 'rgba(110,70,40,.25)'; x.lineWidth = 2; x.beginPath(); x.moveTo(30, 0); x.lineTo(30, 320); x.moveTo(226, 0); x.lineTo(226, 320); x.stroke();
    return G.tex(c, { wrap: false });
  })();
  const stampTex = (() => {
    const c = G.canvas(256, 256), x = c.getContext('2d');
    x.translate(128, 128); x.rotate(-0.15);
    x.strokeStyle = '#e0507a'; x.fillStyle = '#e0507a';
    x.lineWidth = 8; x.beginPath(); x.arc(0, 0, 104, 0, 7); x.stroke();
    x.lineWidth = 3; x.beginPath(); x.arc(0, 0, 84, 0, 7); x.stroke();
    x.font = 'italic 700 84px Fraunces'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('brew', 0, 6);
    x.font = '700 20px "DM Sans"'; x.fillText('FRESH · HOT', 0, -58); x.fillText('★ CAFE ★', 0, 64);
    x.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 500; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.7})`; x.beginPath(); x.arc((Math.random() - 0.5) * 230, (Math.random() - 0.5) * 230, Math.random() * 3, 0, 7); x.fill(); }
    return G.tex(c, { wrap: false });
  })();
  B.on('fonts', () => {});
  const kraftMat = new T.MeshStandardMaterial({ map: kraftTex, roughness: 0.92, normalMap: G.lib('paperN'), normalScale: new T.Vector2(0.6, 0.6) });
  function bagModel() {
    const g = new T.Group();
    G.m(G.rbox(0.16, 0.2, 0.1, 0.006), kraftMat, { p: [0, 0.1, 0], parent: g });
    G.m(G.rbox(0.162, 0.04, 0.06, 0.006), G.mat('#b5895c', { roughness: 0.9 }), { p: [0, 0.215, 0], parent: g });
    G.m(G.cyl(0.012, 0.012, 0.162, 12), G.mat('#c49a6b', { roughness: 0.9 }), { p: [0, 0.235, 0], r: [0, 0, Math.PI / 2], parent: g });
    G.m(new T.PlaneGeometry(0.11, 0.11), new T.MeshStandardMaterial({ map: stampTex, transparent: true, roughness: 0.9 }), { p: [0, 0.09, 0.0505], parent: g, cast: false });
    G.m(new T.PlaneGeometry(0.035, 0.06), G.mat('#fffdf6', { roughness: 0.8 }), { p: [0.05, 0.2, 0.052], r: [0, 0, 0.05], parent: g, cast: false });
    [0.04, 0.06].forEach((x) => G.m(G.rbox(0.012, 0.003, 0.003, 0.001), G.metal(), { p: [x, 0.226, 0.054], parent: g, cast: false }));
    return g;
  }
  const bags = [];
  const SLOT = [[-0.2, 0.05], [0.0, 0.05], [0.2, 0.05], [-0.1, -0.1], [0.1, -0.1]];
  function freeSlot() { for (let i = 0; i < SLOT.length; i++) if (!bags.some((b) => b.slot === i)) return i; return SLOT.length - 1; }
  function addBag(t) {
    const slot = freeSlot();
    const g = bagModel();
    g.position.set(SLOT[slot][0], 0.175 + 0.4, SLOT[slot][1]);
    g.rotation.y = B.rand(-0.3, 0.3);
    shelf.add(g);
    gsap.to(g.position, { y: 0.175, duration: 0.6, ease: 'bounce.out' });
    // hanging tag
    const c = G.canvas(200, 140), tex = G.tex(c, { wrap: false });
    const tag = G.group(g, [0.085, 0.2, 0.04]);
    G.m(new T.PlaneGeometry(0.065, 0.045), new T.MeshStandardMaterial({ map: tex, roughness: 0.8, side: T.DoubleSide }), { p: [0.02, -0.04, 0], r: [0, 0, 0.12], parent: tag, cast: false });
    tag.add(new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(0, 0, 0), new T.Vector3(0.01, -0.02, 0)]), new T.LineBasicMaterial({ color: '#8f6630' })));
    // steam
    const steam = [];
    for (let i = 0; i < 3; i++) { const s = new T.Sprite(new T.SpriteMaterial({ map: mistTex, transparent: true, opacity: 0, depthWrite: false })); s.scale.setScalar(0.06); s.userData.ph = i / 3; g.add(s); steam.push(s); }
    const b = { t, g, c, tex, slot, readyAt: B.state.t, q: 1, steam, tag };
    bags.push(b);
    B.audio.play('rustle', 1460);
    B.after(0.5, () => B.audio.play('thud', 1460));
    drawTag(b);
    return b;
  }
  function drawTag(b) {
    const x = b.c.getContext('2d'), rem = b.t.riderAt - B.state.t;
    const age = B.state.t - b.readyAt;
    b.q = B.clamp(1 - Math.max(0, age - 20) / 90, 0.4, 1);
    const eta = b.rider ? 'HERE' : rem > 0 ? `${Math.ceil(rem / B.SEC_PER_MIN)} MIN` : 'SOON';
    const sig = eta + Math.round(b.q * 100);
    if (b.sig === sig) return;
    b.sig = sig;
    x.clearRect(0, 0, 200, 140);
    x.fillStyle = '#fffdf6'; x.beginPath(); x.roundRect(4, 4, 192, 132, 12); x.fill();
    x.fillStyle = CH[b.t.channel].color; x.fillRect(4, 4, 16, 132);
    x.fillStyle = '#3a2430'; x.font = '700 30px "Space Mono"'; x.textBaseline = 'alphabetic'; x.fillText('#' + b.t.no, 32, 42);
    x.font = '700 24px "Space Mono"'; x.fillText('RIDER ' + eta, 32, 82);
    x.fillStyle = b.q < 0.75 ? '#e0453a' : '#8a7280'; x.fillText(`Q ${Math.round(b.q * 100)}%`, 32, 118);
    b.tex.needsUpdate = true;
  }
  G.onFrame((dt, time) => {
    bags.forEach((b) => b.steam.forEach((s) => {
      const k = (time * 0.45 + s.userData.ph) % 1;
      s.position.set(Math.sin(k * 6 + s.userData.ph * 9) * 0.02, 0.25 + k * 0.16, 0);
      s.scale.setScalar(0.04 + k * 0.07);
      s.material.opacity = Math.sin(k * Math.PI) * 0.55 * Math.max(0, (b.q - 0.45) / 0.55);
    }));
  });

  function rider(t) {
    const ch = CH[t.channel];
    const p = B.people.rider(ch.color);
    const r = { t, p, x: L.doorIn[0], z: L.doorIn[1] };
    t.rider = r;
    p.root.position.set(r.x, 0, r.z - 0.6);
    scene.add(p.root);
    B.world.door(1500);
    walk(r, L.doorIn[0], L.doorIn[1], () => walk(r, L.shelf[0] + 0.05, 1.82, () => {
      p.root.rotation.y = 0;
      r.arrived = true;
      tryPickup(t);
    }));
  }
  function walk(r, x, z, done) {
    const p = r.p, o = { x: p.root.position.x, z: p.root.position.z };
    const d = Math.hypot(x - o.x, z - o.z);
    p.root.rotation.y = Math.atan2(x - o.x, z - o.z);
    const tw = B.tw(o, {
      x, z, duration: d / 1.5, ease: 'none',
      onUpdate: () => { p.root.position.set(o.x, 0, o.z); B.people.walkCycle(p, 0.16); },
      onComplete: () => { B.people.stand(p); done && done(); },
    });
    return tw;
  }
  function tryPickup(t) {
    const b = bags.find((x) => x.t === t), r = t.rider;
    if (!b || !r || !r.arrived || b.leaving) return;
    b.leaving = true;
    b.rider = r;
    b.sig = null;
    drawTag(b);
    B.after(0.6, () => {
      // the bag lifts into the rider's hand
      const hand = new T.Vector3();
      r.p.held.getWorldPosition(hand);
      const start = new T.Vector3(); b.g.getWorldPosition(start);
      scene.attach(b.g);
      B.people.carry(r.p, true);
      B.tw(b.g.position, { x: hand.x, y: hand.y - 0.2, z: hand.z, duration: 0.5, ease: 'power2.out' });
      B.audio.play('rustle', 1460);
      B.after(0.55, () => {
        r.p.held.attach(b.g);
        bags.splice(bags.indexOf(b), 1);
        B.emit('bag:picked', t, b.q);
        walk(r, L.doorIn[0], L.doorIn[1], () => {
          B.world.door(1500);
          walk(r, L.doorIn[0], L.doorIn[1] - 0.8, () => {
            scene.remove(r.p.root);
            B.people.dispose(r.p);
            B.audio.play('scooter', 1500);
            B.world.scooterAway(CH[t.channel].color);
          });
        });
      });
    });
  }

  B.delivery = { addBag, rider, tryPickup, tick() { bags.forEach(drawTag); }, get bags() { return bags; } };
  B.on('fonts', () => { drawCrown(); fridge.sync(); });
})();
