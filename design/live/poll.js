/* brew live — keeps the REST read models fresh. Everything the event stream doesn't carry (inventory + lots, usage
   forecast, purchasing proposal, impact, policy comparison, demand forecast, bottlenecks, investment advisor) is
   pulled through BrewLive.refresh(name, arg), which feeds it to the store as a 'rest.<name>' pseudo-event.
   Live (ws) mode only — replays carry no REST. BrewLive.refresh('pantry', keys) refreshes the pantry in one go. */
(() => {
  const EVERY = { inventory: 30, purchasing: 60, impact: 60, forecast: 300, bottlenecks: 30, advisor: 600, comparison: 0 };
  const last = {}, busy = {};
  const L = () => window.BrewLive;
  const online = () => L() && L().mode === 'ws' && L().state && ['live', 'reconnecting'].includes(L().status);
  async function pull(name, arg) {
    const k = name + (arg != null ? ':' + arg : '');
    if (busy[k] || !online()) return;
    busy[k] = true;
    try {
      const d = await L().refresh(name, arg);
      last[k] = performance.now();
      if (name === 'advisor' && d && d.status && !['done', 'error'].includes(d.status)) setTimeout(() => pull('advisor'), 5000);
    } catch (e) { /* retried on the next tick */ } finally { busy[k] = false; }
  }
  function tick() {
    if (!online()) return;
    const now = performance.now();
    for (const [n, sec] of Object.entries(EVERY)) if (last[n] == null || (sec > 0 && now - last[n] > sec * 1000)) pull(n);
  }
  function attach() {
    const live = L(); if (!live || !live.refresh) return setTimeout(attach, 100);
    const base = live.refresh;
    live.refresh = (name, arg) => {
      if (name === 'pantry') { (arg || []).forEach((key, i) => setTimeout(() => pull('lots', key), i * 60)); ['inventory', 'purchasing', 'impact'].forEach((n) => pull(n)); return Promise.resolve(null); }
      return base(name, arg);
    };
    const bus = window.BREW_LIVE;
    bus.on('hydrate', () => { for (const k in last) delete last[k]; setTimeout(tick, 50); });
    for (const t of ['po.created', 'po.received', 'lot.expired', 'lot.donated', 'replate.retired', 'investment.delivered']) bus.on(t, () => { last.inventory = 0; last.purchasing = 0; last.advisor = t === 'investment.delivered' ? 0 : last.advisor; });
    bus.on('bottleneck.changed', () => { last.bottlenecks = 0; });
    bus.on('day.ended', () => { last.impact = 0; });
    setInterval(tick, 2000);
  }
  attach();
})();
