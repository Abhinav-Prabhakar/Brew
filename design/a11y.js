/* brew — accessibility glue that isn't part of any one room:
   - a polite live region that announces what matters (orders ready — coalesced, price changes while the menu book is
     open, disruptions starting/ending, equipment down/fixed, connection lost/back), never during catch-up bursts;
   - a <title>/<desc> for each room's SVG so a screen reader knows where it is;
   - a focus trap for the open menu book (dialog, aria-modal; focus is restored by menu.js on close). */
(() => {
  const live = document.createElement('div');
  live.id = 'announce'; live.className = 'sr-only'; live.setAttribute('aria-live', 'polite'); live.setAttribute('role', 'status');
  document.body.appendChild(live);
  let queue = [], flushT = 0;
  function say(text) {
    if (!text) return;
    queue.push(text); clearTimeout(flushT);
    flushT = setTimeout(() => { live.textContent = ''; requestAnimationFrame(() => { live.textContent = queue.join('. '); queue = []; }); }, 400);
  }
  window.BrewAnnounce = say;

  /* ---------- what gets announced ---------- */
  const L = () => window.BrewLive || {};
  const fresh = (ev) => { const st = L().status; if (st && !['live', 'replay', 'offline-demo', 'dev'].includes(st)) return false;
    return !ev || ev.sim_s == null || Math.abs(R.now() - ev.sim_s) < 45; };
  const name = (sku) => (L().state?.menu?.[sku]?.name || R.human(sku)).toLowerCase();
  let ready = [], readyT = 0;
  const ON = {
    'order.ready': (d) => { ready.push(d.order_no); clearTimeout(readyT);
      readyT = setTimeout(() => { say(ready.length === 1 ? `order ${ready[0]} is ready` : `orders ${ready.join(', ')} are ready`); ready = []; }, 3000); },
    'price.changed': (d) => { if (window.BREW_MENUBOOK?.isOpen) say(`${String(d.sku).startsWith('combo:') ? 'combo ' + R.human(d.sku.slice(6)) : name(d.sku)} now ${R.rs(d.new)}, was ${R.rs(d.old)}`); },
    'chaos.triggered': (d) => say(`disruption: ${R.human(d.kind)}${d.target ? ' at ' + R.human(d.target) : ''}`),
    'chaos.resolved': (d) => say(`resolved: ${R.human(d.kind)}${d.target ? ' at ' + R.human(d.target) : ''}`),
    'equipment.down': (d) => say(`${R.human(d.equipment)} is down`),
    'equipment.up': (d) => say(`${R.human(d.equipment)} is working again`),
  };
  const bus = window.BREW_LIVE;
  for (const [t, fn] of Object.entries(ON)) bus?.on?.(t, (d, ev) => { if (d && fresh(ev)) fn(d, ev); });
  let was = null;
  bus?.on?.('status', (d) => { const s = d?.status; if (!s || s === was) return;
    if (s === 'reconnecting' && was === 'live') say('connection lost, reconnecting');
    else if (s === 'live' && (was === 'reconnecting' || was === 'offline-demo')) say('live again');
    else if (s === 'offline-demo') say('the café server is unreachable: showing a recorded replay');
    was = s; });

  /* ---------- room titles ---------- */
  const ROOM = {
    lobby: ['Lobby', 'The front of the café: the door, the menu lectern, the counter with the pastry fridge and espresso machine, the ticket rail with every open order, queueing and seated customers, delivery bags on the pass.'],
    kitchen: ['Kitchen', 'The back of house: prep, oven, fryer, panini press, espresso, grinder, blender, cold-brew tower and dish pit, the crew at work, station load and the chaos buttons.'],
    pantry: ['Pantry', 'The walk-in fridge and dry store: every ingredient with its lots, freshness and days of cover, the waste chart, and the next purchase order to approve.'],
  };
  for (const [k, [title, desc]] of Object.entries(ROOM)) {
    const sc = document.getElementById(k + '-scene'); if (!sc) continue;
    sc.insertAdjacentHTML('afterbegin', `<title id="${k}-title">${title}</title><desc id="${k}-desc">${desc}</desc>`);
    sc.setAttribute('role', 'group'); sc.setAttribute('aria-labelledby', `${k}-title`); sc.setAttribute('aria-describedby', `${k}-desc`);
  }

  /* ---------- the menu book traps focus while open ---------- */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !window.BREW_MENUBOOK?.isOpen) return;
    const root = document.getElementById('mb'); if (!root) return;
    const f = [...root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], lastEl = f[f.length - 1];
    if (!root.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastEl.focus(); }
    else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
  });
})();
