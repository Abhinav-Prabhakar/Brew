/* brew · game.js — orders, kitchen, live menu, policies, HUD and the main loop */
(function () {
  const B = window.B, A = B.art, S = B.state;
  const tickets = []; // live tickets (not yet served/voided)
  const STATIONS = 3;
  let batchSeq = 0;
  let orderSig = '';
  let kitchenLoad = 0, loadSmooth = 0, rushOn = false;

  /* =================== policies =================== */
  const POLICIES = {
    balanced: { icon: '⚖️', name: 'Balanced', desc: 'First promised, first brewed.' },
    delivery: { icon: '🛵', name: 'Delivery first', desc: 'Rider orders jump the line. Riders hate waiting.' },
    rush: { icon: '⚡', name: 'Rush menu', desc: 'Hide slow plates, brew 15% faster.' },
    happy: { icon: '🍹', name: 'Happy hour', desc: 'Drinks −15%. More walk-ins, thinner margins.' },
  };
  function setPolicy(id, silent) {
    S.policy = id;
    B.$('#policy-name').textContent = POLICIES[id].name;
    B.$$('#policy-menu li').forEach((li) => li.classList.toggle('on', li.dataset.id === id));
    if (!silent) {
      B.audio.play('click');
      B.toast(POLICIES[id].icon, `Policy: ${POLICIES[id].name}`, POLICIES[id].desc);
    }
    menuTick(true);
    relayout(true);
  }

  /* =================== live menu engine =================== */
  B.menuState = {};
  B.MENU.forEach((m) => (B.menuState[m.id] = { base: m.base, price: m.base, chip: null, pick: false, out: false }));
  const isDrink = (id) => ['coffee', 'notcoffee'].includes(B.ITEM[id].cat);

  function menuTick(force) {
    const h = B.gameMin() / 60;
    const wx = B.WX[S.weather];
    const wet = wx.wet > 0.3;
    const rushHour = (h >= 8.5 && h < 10.5) || (h >= 13 && h < 14.5) || (h >= 18 && h < 20);
    if (!rushOn && loadSmooth >= 78) rushOn = true;
    if (rushOn && loadSmooth < 55) rushOn = false;
    const slowAfternoon = h >= 15 && h < 17.5 && loadSmooth < 30;
    let picks;
    if (wet) picks = ['chai', 'cheesetoast'];
    else if (h < 11) picks = ['croissant', 'flatwhite'];
    else if (h < 14) picks = ['avotoast', 'icedlatte'];
    else if (h < 17.5) picks = S.temp >= 31 ? ['rosemilk', 'coldbrew'] : ['cheesecake', 'coldbrew'];
    else picks = ['hotchoc', 'cinnamon'];

    const changed = [];
    B.MENU.forEach((m) => {
      const id = m.id, st = B.menuState[id];
      let price = m.base, chip = null, out = false, outWhy = null;
      if (!B.fridge.has(id)) { out = true; outWhy = 'Sold out for now'; }
      if (S.policy === 'rush' && m.slow) { out = true; outWhy = 'Sold out for now'; }
      if (S.policy === 'happy' && isDrink(id)) {
        price = Math.round((m.base * 0.85) / 10) * 10;
        chip = { dir: 'down', text: `₹${m.base - price} · happy hour` };
      } else if (rushOn && rushHour && ['cappuccino', 'flatwhite', 'icedlatte', 'matcha'].includes(id)) {
        price = m.base + 20;
        chip = { dir: 'up', text: `₹20 · rush hour · kitchen at ${Math.round(loadSmooth)}%` };
      } else if (wet && (id === 'chai' || id === 'hotchoc')) {
        price = m.base + 10;
        chip = { dir: 'up', text: '₹10 · rainy-day demand' };
      } else if (wet && (id === 'icedlatte' || id === 'rosemilk')) {
        price = m.base - 20;
        chip = { dir: 'down', text: '₹20 · it’s pouring' };
      } else if (slowAfternoon && (id === 'cheesecake' || id === 'cinnamon')) {
        price = m.base - (id === 'cheesecake' ? 30 : 20);
        chip = { dir: 'down', text: `₹${m.base - price} · slow afternoon` };
      } else if (S.temp >= 31 && !wet && (id === 'coldbrew' || id === 'rosemilk')) {
        price = m.base + 10;
        chip = { dir: 'up', text: `₹10 · ${S.temp}° outside` };
      } else if (B.fridge.stock[id] != null && B.fridge.stock[id] > 0 && B.fridge.stock[id] <= 2) {
        price = m.base + 10;
        chip = { dir: 'up', text: `₹10 · last ${B.fridge.stock[id]} left` };
      }
      const pick = !out && picks.includes(id);
      const sig = JSON.stringify([price, chip, out, outWhy, pick]);
      if (sig !== st.sig) {
        if (st.sig) changed.push(id);
        Object.assign(st, { price, chip, out, outWhy, pick, sig });
      }
    });
    if (changed.length) B.menubook.changed(changed);
    B.menubook.policyNote(`Today’s policy: ${POLICIES[S.policy].name} — ${POLICIES[S.policy].desc}`);
  }

  /* =================== orders =================== */
  const WANTS = {
    commuter: { drinks: [['cappuccino', 4], ['flatwhite', 4], ['coldbrew', 3], ['icedlatte', 2], ['chai', 2]], food: [['croissant', 3], ['muffin', 1], ['sandwich', 1]], foodP: 0.4 },
    student: { drinks: [['icedlatte', 4], ['coldbrew', 3], ['rosemilk', 3], ['chai', 3], ['matcha', 2], ['hotchoc', 1]], food: [['cheesetoast', 3], ['muffin', 2], ['sandwich', 2], ['cinnamon', 1]], foodP: 0.55 },
    leisurely: { drinks: [['cappuccino', 3], ['matcha', 3], ['chai', 2], ['hotchoc', 2], ['flatwhite', 2], ['rosemilk', 1]], food: [['cheesecake', 3], ['avotoast', 3], ['cinnamon', 2], ['croissant', 2]], foodP: 0.75 },
    camper: { drinks: [['flatwhite', 3], ['coldbrew', 3], ['matcha', 2], ['icedlatte', 2]], food: [['sandwich', 3], ['avotoast', 2], ['croissant', 1], ['muffin', 1]], foodP: 0.6 },
  };
  function choose(pairs) {
    const ok = pairs.filter(([id]) => !B.menuState[id].out);
    if (!ok.length) return null;
    // the menu nudges: picks get a bump, price drops attract
    const w = ok.map(([id, wt]) => [id, wt * (B.menuState[id].pick ? 1.8 : 1) * (B.menuState[id].chip && B.menuState[id].chip.dir === 'down' ? 1.4 : 1)]);
    // rain bias toward hot drinks
    if (B.WX[S.weather].wet > 0.3) w.forEach((p) => { if (p[0] === 'chai' || p[0] === 'hotchoc') p[1] *= 2; if (B.ITEM[p[0]].cold) p[1] *= 0.5; });
    return B.wpick(w);
  }
  function mkItem(id) {
    const mods = [];
    const pool = B.modsFor(id);
    pool.forEach((k) => { if (Math.random() < (k === 'oat' ? 0.28 : k === 'shot' ? 0.2 : k === 'noonion' ? 0.3 : 0.1) && mods.length < 2) mods.push(k); });
    if (mods.includes('decaf') && mods.includes('shot')) mods.splice(mods.indexOf('decaf'), 1);
    return { id, qty: 1, mods, price: B.menuState[id].price };
  }
  function basket(persona, n = 1) {
    const items = [];
    for (let i = 0; i < n; i++) {
      const per = persona === 'group' ? B.pick(['student', 'leisurely']) : persona;
      const W = WANTS[per] || WANTS.leisurely;
      const d = choose(W.drinks);
      if (d) items.push(mkItem(d));
      if (Math.random() < W.foodP / (n > 1 ? 2 : 1)) {
        const f = choose(W.food);
        if (f) items.push(mkItem(f));
      }
    }
    // merge identical items without mods
    const merged = [];
    items.forEach((it) => {
      const same = merged.find((m) => m.id === it.id && !m.mods.length && !it.mods.length);
      if (same) same.qty++;
      else merged.push(it);
    });
    // fridge stock is claimed at order time
    return merged.filter((it) => {
      for (let q = 0; q < it.qty; q++) if (!B.fridge.take(it.id)) { it.qty = q; break; }
      return it.qty > 0;
    });
  }
  function prepOf(items) {
    const ps = items.map((it) => B.ITEM[it.id].prep * (1 + (it.qty - 1) * 0.35) * (it.mods.includes('shot') ? 1.08 : 1));
    const mx = Math.max(...ps);
    return (mx + (ps.reduce((a, b) => a + b, 0) - mx) * 0.3) * (S.policy === 'rush' ? 0.85 : 1);
  }
  function workAhead() {
    const queued = tickets.filter((t) => t.state === 'queued').reduce((s, t) => s + t.prep, 0);
    const brewing = tickets.filter((t) => t.state === 'brewing').reduce((s, t) => s + t.prep * (1 - t.progress), 0);
    return (queued + brewing) / STATIONS;
  }

  function newTicket({ items, channel, name, persona, customer }) {
    const prep = prepOf(items);
    const t = {
      no: ++S.orderNo, items, channel, name, persona, customer, created: S.t, prep,
      promise: S.t + workAhead() + prep + B.rand(18, 30), progress: 0, state: 'queued', batch: null, bumped: false,
      rot: B.rand(-1.6, 1.6),
      note: Math.random() < 0.28 ? B.pick(B.NOTES) : null,
    };
    if (t.note && /nut/.test(t.note)) t.items.forEach((it) => { if (B.modsFor(it.id).includes('nonuts') && !it.mods.includes('nonuts')) it.mods.push('nonuts'); });
    tickets.push(t);
    B.tickets.render(t);
    relayout(true, [t]);
    B.audio.play('slide', 900);
    return t;
  }

  function placeOrder(c) {
    const n = c.party.length;
    const items = basket(c.persona, n);
    if (!items.length) return null;
    const t = newTicket({ items, channel: c.channel, name: c.name, persona: c.persona, customer: c });
    if (c.channel === 'take') B.after(1.2, () => pay(c));
    return t;
  }

  function spawnDelivery() {
    const ch = Math.random() < 0.5 ? 'zomato' : 'swiggy';
    const W = B.pick([WANTS.student, WANTS.leisurely, WANTS.camper]);
    const items = [];
    const n = B.ri(1, 3);
    for (let i = 0; i < n; i++) {
      const id = Math.random() < 0.55 ? choose(W.food) : choose(W.drinks);
      if (id) items.push(mkItem(id));
    }
    const ok = items.filter((it) => B.fridge.take(it.id));
    if (!ok.length) return;
    const t = newTicket({ items: ok, channel: ch, name: B.pick(B.NAMES), persona: 'delivery' });
    t.riderAt = S.t + workAhead() + t.prep + B.rand(-6, 22);
    t.promise = Math.max(t.promise, t.riderAt);
    B.after(Math.max(4, t.riderAt - S.t), () => B.delivery.rider(t));
    B.audio.play('ding');
  }

  /* =================== kitchen =================== */
  function priority(t) {
    if (t.state === 'ready') return -1e6 + t.readyAt;
    let p = t.promise - S.t;
    if (t.state === 'brewing') p -= 1e4;
    if (t.bumped) p -= 5e3;
    if (S.policy === 'delivery' && (t.channel === 'zomato' || t.channel === 'swiggy')) p -= 2e3;
    return p;
  }
  function ordered() {
    const groups = new Map();
    tickets.forEach((t) => {
      const key = t.batch || 'solo' + t.no;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    });
    const arr = Array.from(groups.values()).map((g) => ({ g, p: Math.min(...g.map(priority)) }));
    arr.sort((a, b) => a.p - b.p);
    return arr.flatMap((x) => x.g.sort((a, b) => a.no - b.no));
  }
  function relayout(force, newcomers = []) {
    const order = ordered();
    const sig = order.map((t) => t.no + (t.batch || '')).join(',');
    if (!force && sig === orderSig) return;
    orderSig = sig;
    B.tickets.layout(order, newcomers);
  }

  function formBatches() {
    const queued = tickets.filter((t) => t.state === 'queued' && !t.batch && isDrink(t.items[0].id));
    const by = {};
    queued.forEach((t) => (by[t.items[0].id] = by[t.items[0].id] || []).push(t));
    let made = false;
    Object.entries(by).forEach(([id, g]) => {
      if (g.length >= 2) {
        const b = 'b' + ++batchSeq;
        g.slice(0, 3).forEach((t) => (t.batch = b));
        made = true;
        B.toast('📎', `Batched ×${Math.min(3, g.length)}`, `${B.ITEM[id].name}s clipped together — one pour, three tickets.`, { ttl: 3 });
      }
    });
    if (made) relayout(true);
  }

  function kitchenStep(dt) {
    // progress brewing (batches share one station)
    const brewingUnits = new Set();
    tickets.forEach((t) => {
      if (t.state !== 'brewing') return;
      brewingUnits.add(t.batch || t.no);
      t.progress = Math.min(1, t.progress + dt / t.brewTime);
      if (t.progress >= 1) {
        t.state = 'ready';
        t.readyAt = S.t;
        B.audio.play('ding');
        t.autoAt = S.t + (t.channel === 'zomato' || t.channel === 'swiggy' ? 5 : 9);
        orderSig = '';
      }
    });
    let free = STATIONS - brewingUnits.size;
    if (free > 0) {
      const next = ordered().filter((t) => t.state === 'queued');
      const seen = new Set();
      for (const t of next) {
        if (free <= 0) break;
        const key = t.batch || t.no;
        if (seen.has(key)) continue;
        seen.add(key);
        const unit = t.batch ? tickets.filter((x) => x.batch === t.batch && x.state === 'queued') : [t];
        const bt = Math.max(...unit.map((x) => x.prep)) * (1 + 0.15 * (unit.length - 1));
        unit.forEach((x) => { x.state = 'brewing'; x.brewTime = bt; x.progress = 0; });
        free--;
        orderSig = '';
      }
    }
    // the floor staff hand over anything that's been sitting ready
    tickets.filter((t) => t.state === 'ready' && S.t >= t.autoAt).forEach((t) => serve(t, true));
    const q = tickets.filter((t) => t.state === 'queued').length;
    kitchenLoad = B.clamp(Math.round((brewingUnits.size / STATIONS) * 72 + q * 7), 0, 100);
    loadSmooth += (kitchenLoad - loadSmooth) * Math.min(1, dt * 0.25);
  }

  let tipShown = false;
  function serve(t, auto) {
    if (t.state !== 'ready') return;
    const group = t.batch ? tickets.filter((x) => x.batch === t.batch && x.state === 'ready') : [t];
    group.forEach((x, i) => {
      x.state = 'served';
      x.servedAt = S.t;
      tickets.splice(tickets.indexOf(x), 1);
      setTimeout(() => B.tickets.tear(x), i * 140);
      if (x.channel === 'zomato' || x.channel === 'swiggy') {
        B.delivery.addBag(x);
        B.delivery.tryPickup(x);
        B.printer.print({ no: x.no, name: x.name, where: x.channel.toUpperCase(), items: x.items, pay: 'Online · prepaid' });
      } else if (x.customer) {
        B.cust.served(x.customer);
      }
      S.served++;
    });
    if (auto && !tipShown) {
      tipShown = true;
      B.toast('🙋', 'Mira served it for you', 'Tap READY tickets yourself to hand them over faster — every second costs patience.');
    }
    if (!auto) B.audio.play('click');
    orderSig = '';
    setTimeout(() => relayout(true), group.length * 140 + 30);
  }

  function voidTicket(t) {
    if (t.state === 'served') return;
    const idx = tickets.indexOf(t);
    if (idx < 0) return;
    tickets.splice(idx, 1);
    // un-batch the rest
    if (t.batch) {
      const rest = tickets.filter((x) => x.batch === t.batch);
      if (rest.length < 2) rest.forEach((x) => (x.batch = null));
    }
    if (t.state === 'brewing' || t.state === 'ready') spend(Math.round(t.items.reduce((s, it) => s + it.price * it.qty, 0) * 0.32), null);
    t.state = 'void';
    B.tickets.tear(t, { voided: true }).then(() => relayout(true));
  }

  B.on('ticket:click', (t) => {
    if (t.state === 'ready') serve(t, false);
    else if (t.state === 'queued') {
      t.bumped = !t.bumped;
      B.audio.play(t.bumped ? 'pop' : 'click');
      B.tickets.refresh(t);
      relayout(true);
    } else B.tickets.wiggle(t);
  });

  /* =================== money & reviews =================== */
  function flyText(from, txt, neg) {
    const el = B.h(`<div class="fly-cash ${neg ? 'neg' : ''}">${txt}</div>`);
    B.$('#fx').appendChild(el);
    const to = B.elCenter(B.$(neg ? '#hud-profit' : '#hud-cash'));
    gsap.set(el, { x: from.x - 20, y: from.y - 10 });
    gsap.timeline({ onComplete: () => el.remove() })
      .to(el, { y: from.y - 50, duration: 0.5, ease: 'power2.out' })
      .to(el, { x: to.x - 30, y: to.y - 10, scale: 0.7, duration: 0.7, ease: 'power2.in' })
      .to(el, { opacity: 0, duration: 0.15 });
  }
  function pay(c) {
    const t = c.ticket;
    if (!t || t.paid) return;
    t.paid = true;
    const total = B.printer.print({ no: t.no, name: c.name, where: c.channel === 'take' ? 'TAKEAWAY' : c.claim ? `DINE-IN ${c.claim.tables[0].id}` : 'DINE-IN', items: t.items, pay: B.pick(['UPI', 'UPI', 'UPI', 'Card', 'Cash']) });
    earn(total);
    B.audio.play('register');
    const p = B.w2s(c.x, c.y - 200 * B.proj(c.y));
    flyText(p, '+' + B.inr(total));
    // reviews
    const late = (t.servedAt || S.t) > t.promise + 6;
    if (!c.unhappy) {
      if (!late && Math.random() < 0.3) review(5, c, B.pick(['“Best flat white in Indiranagar.”', '“Cosy corner, kind staff ♥”', '“That cheesecake. Wow.”', '“Fast even in the rush!”', '“Felt like home.”']));
      else if (late && Math.random() < 0.25) review(3, c, '“Nice, but a bit slow today.”');
    }
  }
  function earn(total) {
    S.cash += total;
    S.revenue += total;
    S.cost += Math.round(total * 0.3);
  }
  function spend(amount, why) {
    if (!amount) return;
    S.cash -= amount;
    S.cost += amount;
    if (why) flyText(B.elCenter(B.$('#fridge')), '−' + B.inr(amount), true);
  }
  function review(stars, c, text) {
    S.rating = (S.rating * S.ratingN + stars) / (S.ratingN + 1);
    S.ratingN++;
    const from = c && c.el ? B.elCenter(c.el.querySelector('.head') || c.el) : { x: innerWidth / 2, y: innerHeight / 2 };
    const to = B.elCenter(B.$('#hud-stars'));
    const bad = stars <= 2;
    const el = B.h(`<div class="fly-star">${A.star(1, 'fly' + Math.random().toString(36).slice(2, 7))}</div>`);
    B.$('#fx').appendChild(el);
    gsap.set(el, { x: from.x - 17, y: from.y - 40, scale: 0.4 });
    const tl = gsap.timeline();
    tl.to(el, { scale: 1.3, y: from.y - 90, duration: 0.5, ease: 'back.out(2)' })
      .to(el, { x: to.x - 17, y: to.y - 17, scale: 0.9, rotation: bad ? 0 : 360, duration: 0.9, ease: 'power2.inOut' })
      .add(() => {
        if (bad) {
          const crack = el.querySelector('.crack');
          crack.setAttribute('opacity', 1);
          gsap.from(crack, { strokeDasharray: '0 40', duration: 0.2 });
          el.querySelector('path:nth-of-type(2)').setAttribute('fill', '#c9b8bd');
          B.audio.play('crack');
          const r = B.$('.pill.rating');
          r.classList.remove('hit'); void r.offsetWidth; r.classList.add('hit');
          for (let i = 0; i < 7; i++) {
            const s = B.h('<i class="shard"></i>');
            B.$('#fx').appendChild(s);
            gsap.set(s, { x: to.x, y: to.y, rotation: B.rand(0, 360) });
            gsap.to(s, { x: to.x + B.rand(-50, 50), y: to.y + B.rand(10, 70), rotation: '+=' + B.rand(90, 300), opacity: 0, duration: 0.8, ease: 'power2.out', onComplete: () => s.remove() });
          }
          gsap.to(el, { y: '+=40', rotation: 30, opacity: 0, duration: 0.7, delay: 0.25, ease: 'power2.in', onComplete: () => el.remove() });
        } else {
          B.audio.play('sparkle');
          gsap.to(el, { scale: 1.8, opacity: 0, duration: 0.5, onComplete: () => el.remove() });
        }
        hud(true);
      });
    const name = c ? c.name : 'A guest';
    B.toast(bad ? '💔' : stars >= 5 ? '⭐' : '🙂', `${'★'.repeat(stars)}${'☆'.repeat(5 - stars)} from ${name}`, text, { hand: true });
  }

  /* =================== HUD =================== */
  const shown = { cash: S.cash, profit: 0 };
  let lastStarsKey = '';
  function hud(force) {
    const mins = B.gameMin();
    const ck = B.fmtClock(mins);
    B.$('#hud-time').textContent = ck.hm;
    B.$('#hud-ampm').textContent = ck.ap;
    B.$('#hud-day').textContent = `${['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'][(S.day - 1) % 7]} · Day ${S.day}`;
    const hAng = ((mins / 60) % 12) * 30, mAng = (mins % 60) * 6;
    B.$('#clock-hand-h').setAttribute('transform', `rotate(${hAng} 12 12)`);
    B.$('#clock-hand-m').setAttribute('transform', `rotate(${mAng - 90} 12 12)`);
    B.$('#wc-h').setAttribute('transform', `rotate(${hAng})`);
    B.$('#wc-m').setAttribute('transform', `rotate(${mAng})`);
    const night = mins / 60 > 19.2;
    const wxIcon = night && B.state.weather === 'sunny' ? 'night' : B.state.weather;
    const wxEl = B.$('#hud-wx-ico');
    if (wxEl.dataset.k !== wxIcon) { wxEl.dataset.k = wxIcon; wxEl.innerHTML = A.wx[wxIcon]; gsap.from(wxEl, { scale: 0.4, rotation: -30, duration: 0.5, ease: 'back.out(2)' }); }
    B.$('#hud-temp').textContent = `${S.temp}°`;
    B.$('#hud-wx').textContent = B.WX[S.weather].label;
    S.profit = S.revenue - S.cost - S.wages;
    if (Math.round(shown.cash) !== S.cash) gsap.to(shown, { cash: S.cash, duration: 0.8, ease: 'power2.out', overwrite: 'auto', onUpdate: () => (B.$('#hud-cash').textContent = B.inr(shown.cash)) });
    if (Math.round(shown.profit) !== Math.round(S.profit)) gsap.to(shown, { profit: S.profit, duration: 0.8, overwrite: 'auto', onUpdate: () => { const p = B.$('#hud-profit'); p.textContent = B.inr(shown.profit, true); p.className = shown.profit < 0 ? 'neg' : 'pos'; } });
    const key = S.rating.toFixed(2);
    if (key !== lastStarsKey || force) {
      lastStarsKey = key;
      B.$('#hud-rating').textContent = key;
      B.$('#hud-stars').innerHTML = [0, 1, 2, 3, 4].map((i) => A.star(B.clamp(S.rating - i, 0, 1), 'h' + i)).join('');
    }
  }

  /* =================== board =================== */
  function boardTick() {
    const label = (t) => `${String(t.no).slice(-3)} ${t.channel === 'zomato' || t.channel === 'swiggy' ? 'RIDER' : t.name.toUpperCase().slice(0, 5)}`;
    const ord = ordered();
    B.board.update({
      brewing: ord.filter((t) => t.state === 'brewing' && t.progress < 0.7).map(label),
      almost: ord.filter((t) => t.state === 'brewing' && t.progress >= 0.7).map(label),
      ready: ord.filter((t) => t.state === 'ready').map(label),
    });
    const ck = B.fmtClock(B.gameMin(), true);
    B.board.foot(Math.round(loadSmooth), `${ck.hm} ${ck.ap}`);
    B.audio.setBusy(B.cust.count() / 14);
  }

  /* =================== spawner =================== */
  let nextWalkIn = 0, nextDelivery = 0;
  function spawner() {
    const h = B.gameMin() / 60;
    const wet = B.WX[S.weather].wet > 0.3;
    if (S.t >= nextWalkIn) {
      const rush = (h >= 8.5 && h < 10.5) || (h >= 13 && h < 14.5) || (h >= 18 && h < 20);
      let gap = rush ? B.rand(7, 12) : h > 15 && h < 17 ? B.rand(15, 26) : B.rand(11, 19);
      if (wet) gap *= 1.35;
      if (S.policy === 'happy') gap *= 0.78;
      nextWalkIn = S.t + gap;
      if (B.cust.count() < 16 && B.cust.queueLen < 6) {
        let weights;
        if (h < 11) weights = [['commuter', 5], ['student', 2], ['leisurely', 1], ['camper', 1]];
        else if (h < 14) weights = [['student', 3], ['camper', 2], ['leisurely', 2], ['commuter', 1], ['group', 1]];
        else if (h < 17) weights = [['camper', 3], ['student', 3], ['leisurely', 2], ['group', 1]];
        else weights = [['leisurely', 3], ['group', 2], ['student', 2], ['commuter', 2]];
        let persona = B.wpick(weights);
        let n = 1;
        if (persona === 'group') {
          n = B.ri(3, 4);
          if (!B.room.canSeat(n)) { n = 2; if (!B.room.canSeat(2)) persona = 'student'; }
          if (n === 2 && persona === 'group') persona = 'group';
        }
        if (persona !== 'group') n = Math.random() < 0.15 && persona !== 'commuter' && persona !== 'camper' ? 2 : 1;
        const channel = persona === 'commuter' ? (Math.random() < 0.7 ? 'take' : 'dine') : persona === 'student' ? (Math.random() < 0.3 ? 'take' : 'dine') : 'dine';
        B.cust.spawn(persona, { n, channel });
      }
    }
    if (S.t >= nextDelivery) {
      nextDelivery = S.t + (wet ? B.rand(12, 22) : B.rand(24, 44));
      if (tickets.length < 11) spawnDelivery();
    }
  }

  /* =================== loop =================== */
  let lastDay = 1, uiAcc = 0, menuAcc = 0, slowAcc = 0;
  S.wages = 0;
  function step(dt) {
    S.t += dt;
    S.wages += dt * (600 / (60 * B.SEC_PER_MIN)); // ₹600 per game hour for the crew
    B.runTimers();
    spawner();
    kitchenStep(dt);
    B.cust.tick(dt);
    B.scene.tickWeather();
    B.scene.tickStreet();
    slowAcc += dt;
    if (slowAcc > 0.5) { slowAcc = 0; formBatches(); relayout(false); B.delivery.tick(); }
    menuAcc += dt;
    if (menuAcc > 4) { menuAcc = 0; menuTick(); }
    const day = 1 + Math.floor(S.t / ((B.CLOSE_MIN - B.OPEN_MIN) * B.SEC_PER_MIN));
    if (day !== lastDay) {
      lastDay = day;
      S.day = day;
      S.revenue = S.cost = S.wages = 0;
      const cost = B.fridge.restock();
      spend(cost, null);
      B.toast('🌅', `Day ${day} — doors open`, `The bakery dropped off fresh trays (−${B.inr(cost)}). Yesterday’s numbers are banked.`);
    }
    // lunchtime bakery top-up
    const h = B.gameMin() / 60;
    if (h >= 13 && h < 13.05 && !S._lunchRestock) {
      S._lunchRestock = true;
      const cost = B.fridge.restock();
      spend(cost, null);
      B.toast('🥐', 'Lunch delivery from the bakery', `Fridge topped up · −${B.inr(cost)}`);
    }
    if (h < 12) S._lunchRestock = false;
  }

  gsap.ticker.add((time, deltaMs) => {
    if (!S.started) return;
    if (!S.paused) {
      let rem = Math.min(deltaMs / 1000, 0.1) * S.speed;
      while (rem > 0) {
        const d = Math.min(rem, 0.25);
        step(d);
        rem -= d;
      }
    }
    uiAcc += deltaMs;
    if (uiAcc > 120) {
      uiAcc = 0;
      const ord = ordered();
      const queued = ord.filter((t) => t.state === 'queued');
      ord.forEach((t) => B.tickets.refresh(t, t.state === 'queued' ? queued.indexOf(t) : 0));
      hud();
      B.scene.update();
    }
  });
  setInterval(() => S.started && boardTick(), 600);

  /* =================== controls =================== */
  function setSpeed(v) {
    const btns = B.$$('.speed button');
    const idx = [0, 1, 10, 60].indexOf(v);
    btns.forEach((b, i) => b.classList.toggle('on', i === idx));
    B.$('.speed-thumb').style.transform = `translateX(${idx * btns[0].offsetWidth}px)`;
    if (v === 0) {
      S.paused = true;
      B.wt.pause();
    } else {
      S.paused = false;
      S.speed = v;
      B.wt.timeScale(v);
      B.wt.resume();
    }
    B.audio.play('click');
  }
  B.$$('.speed button').forEach((b) => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));

  const menu = B.$('#policy-menu');
  Object.entries(POLICIES).forEach(([id, p]) => menu.appendChild(B.h(`<li role="option" data-id="${id}"><span class="pi">${p.icon}</span><b>${p.name}</b><span>${p.desc}</span></li>`)));
  B.$('#policy-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !menu.classList.contains('open');
    menu.classList.toggle('open', open);
    B.$('#policy-btn').setAttribute('aria-expanded', open);
    B.audio.play('click');
  });
  menu.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    setPolicy(li.dataset.id);
    menu.classList.remove('open');
    B.$('#policy-btn').setAttribute('aria-expanded', false);
  });
  document.addEventListener('click', () => { menu.classList.remove('open'); B.$('#policy-btn').setAttribute('aria-expanded', false); });
  B.$('#mute-btn').addEventListener('click', () => B.$('#mute-btn').classList.toggle('muted', B.audio.toggle()));

  window.addEventListener('keydown', (e) => {
    if (!S.started || B.menubook.isOpen) return;
    if (e.code === 'Space') { e.preventDefault(); setSpeed(S.paused ? S.speed || 1 : 0); }
    if (e.key === '1') setSpeed(1);
    if (e.key === '2') setSpeed(10);
    if (e.key === '3') setSpeed(60);
    if (e.key === 'm' || e.key === 'M') B.menubook.open();
    if (e.key === 'f' || e.key === 'F') B.$('#fridge').click();
  });

  /* =================== boot =================== */
  B.game = { placeOrder, serve, pay, review, voidTicket, spend, get tickets() { return tickets; } };

  function boot() {
    B.fit();
    window.addEventListener('resize', B.fit);
    B.board.init();
    B.room.init();
    B.fridge.build();
    B.scene.init();
    menuTick(true);
    setPolicy('balanced', true);
    hud(true);
    B.$('#world').classList.add('neon-off');
  }

  function start() {
    B.audio.init();
    const sign = B.$('#intro-sign');
    sign.classList.add('open');
    B.audio.play('open');
    setTimeout(() => {
      gsap.to('#intro', { opacity: 0, duration: 0.7, ease: 'power2.in', onComplete: () => B.$('#intro').remove() });
      B.camera.intro();
      setTimeout(() => {
        B.$('#door-sign').classList.add('open');
        B.audio.play('flap');
      }, 700);
      // the neon buzzes into life
      const w = B.$('#world');
      [0, 120, 200, 420, 520].forEach((d, i) => setTimeout(() => w.classList.toggle('neon-off', i % 2 === 1), 900 + d));
      setTimeout(() => w.classList.remove('neon-off'), 1500);
      setTimeout(() => B.board.sweep(), 1100);
      setTimeout(() => {
        S.started = true;
        nextWalkIn = 1.2;
        nextDelivery = 9;
        B.cust.spawn('commuter', { channel: 'take' });
        B.after(4, () => B.cust.spawn('leisurely', { channel: 'dine' }));
        B.after(8, () => B.cust.spawn('camper', { channel: 'dine' }));
        B.after(12, () => B.cust.spawn('commuter', { channel: 'dine' }));
        B.toast('☕', 'Doors open!', 'Morning rush starts at 8:30. Keep an eye on the rail.');
      }, 2200);
      setTimeout(() => B.$('#coach').classList.add('hide'), 40000);
    }, 900);
  }
  B.$('#open-btn').addEventListener('click', start);
  B.$('#coach').addEventListener('click', () => B.$('#coach').classList.add('hide'));
  boot();
})();
