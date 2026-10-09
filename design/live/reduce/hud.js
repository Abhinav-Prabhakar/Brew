/* brew live — HUD slices: world, clock, weather, day, kpis, policy, disruptions, investments, decisions,
   bottleneck, reviews and the REST read models that feed the profit / bottleneck cards. */
(() => {
  const { U } = BrewStore;

  const clockFrom = (c) => ({
    day: c.day, hhmm: c.hhmm, weekday: c.weekday, date: c.date, is_open: c.is_open,
    open_s: c.open_s, close_s: c.close_s, speed: c.speed,
    open_tod: c.open_s - c.day * U.DAY_S, close_tod: c.close_s - c.day * U.DAY_S, // so is_open can follow clock.tick
  });

  const disruptionRow = (d) => ({
    id: d.id, kind: d.kind, target: d.target, severity: d.severity, until_s: d.end_s, source: d.source,
    active: !!d.active, started_s: d.start_s, resolved_s: null, cost_inr: null,
    profit_actual: null, profit_counterfactual: null,
  });

  BrewStore.register('hud', {
    hydrate(snap) {
      const w = snap.world;
      const disruptions = {};
      for (const d of snap.disruptions) disruptions[d.id] = disruptionRow(d);
      return {
        world: {
          id: w.id, policy: w.policy, strategy: w.strategy, status: w.status, clock_mode: w.clock_mode,
          lagging: !!w.lagging, start_date: w.start_date, kind: w.kind, scenario: w.scenario, seed: w.seed,
        },
        clock: clockFrom(snap.clock),
        weather: { ...snap.weather },
        day: { day: snap.clock.day, date: snap.clock.date, weekday: snap.clock.weekday, events: [], ended: null },
        kpis: { ...snap.kpis },
        policy: { ...snap.policy, throttles: { ...snap.policy.throttles } },
        disruptions,
        investments: [],
        decisions: [],
        bottleneck: null,
        reviews: [],
        rest: { forecast: null, bottlenecks: null, advisor: null, impact: null, comparison: null, purchasing: null, explain: {} },
      };
    },
    on: {
      'clock.tick': ['clock', (s, ev) => {
        const d = ev.data;
        const tod = U.todS(ev.sim_s);
        return {
          clock: {
            ...s.clock, min: Math.floor(ev.sim_s / 60), day: d.day, hhmm: d.hhmm, weekday: d.weekday, speed: d.speed,
            date: U.addDays(s.world.start_date, d.day),
            open_s: d.day * U.DAY_S + s.clock.open_tod, close_s: d.day * U.DAY_S + s.clock.close_tod,
            is_open: s.clock.open_tod <= tod && tod < s.clock.close_tod,
          },
        };
      }],
      // the clock follows sim_s on every event (the sim sends no clock.tick overnight, but the HUD still shows the time)
      '*': ['clock', (s, ev) => {
        const min = Math.floor(ev.sim_s / 60);
        if (s.clock.min === min) return null;
        const tod = U.todS(ev.sim_s);
        const hh = Math.floor(tod / 3600);
        const mm = Math.floor((tod % 3600) / 60);
        return { clock: { ...s.clock, min, hhmm: String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0'), is_open: s.clock.open_tod <= tod && tod < s.clock.close_tod } };
      }],
      'weather.changed': ['weather', (s, ev) => ({ weather: { state: ev.data.state, temp_c: ev.data.temp_c, rain_mm_h: ev.data.rain_mm_h } })],
      'day.started': ['day', (s, ev) => {
        const d = ev.data;
        return {
          day: { day: d.day, date: d.date, weekday: d.weekday, events: d.events, ended: null, weather: d.weather },
          clock: { ...s.clock, day: d.day, date: d.date, weekday: d.weekday, open_s: d.day * U.DAY_S + s.clock.open_tod, close_s: d.day * U.DAY_S + s.clock.close_tod },
          kpis: { ...s.kpis, revenue_today: 0, profit_today: 0, walkouts_today: 0 },
        };
      }],
      'day.ended': ['day', (s, ev) => ({ day: { ...s.day, ended: { day: ev.data.day, ...ev.data.summary } } })],
      'kpi.tick': ['kpis', (s, ev) => ({ kpis: { ...ev.data } })],
      'decision.made': ['decisions', (s, ev) => ({ decisions: U.tail(s.decisions, { ...ev.data, sim_s: ev.sim_s }, 8) })],
      'bottleneck.changed': ['bottleneck', (s, ev) => ({ bottleneck: { resource: ev.data.resource, rho: ev.data.rho, shadow_price: ev.data.shadow_price } })],
      'chaos.triggered': ['disruptions', (s, ev) => {
        const d = ev.data;
        return {
          disruptions: U.upd(s.disruptions, d.disruption_id, {
            id: d.disruption_id, kind: d.kind, target: d.target, severity: d.severity, until_s: d.until_s, source: d.source,
            active: true, started_s: ev.sim_s, resolved_s: null,
          }, true),
        };
      }],
      'chaos.resolved': ['disruptions', (s, ev) => {
        const d = ev.data;
        return {
          disruptions: U.upd(s.disruptions, d.disruption_id, { id: d.disruption_id, kind: d.kind, target: d.target, active: false, resolved_s: ev.sim_s }, true),
        };
      }],
      // pending backend (backend.md 6.3): what the disruption cost vs the counterfactual world without it
      'chaos.cost': ['disruptions', (s, ev) => {
        const d = ev.data;
        return {
          disruptions: U.upd(s.disruptions, d.disruption_id, {
            id: d.disruption_id, kind: d.kind, cost_inr: d.cost_inr, profit_actual: d.profit_actual, profit_counterfactual: d.profit_counterfactual,
          }, true),
        };
      }],
      'strategy.changed': ['policy', (s, ev) => ({
        policy: { ...s.policy, strategy: ev.data.strategy },
        world: { ...s.world, strategy: ev.data.strategy },
      })],
      'policy.changed': ['policy', (s, ev) => ({
        policy: { ...s.policy, policy: ev.data.policy },
        world: { ...s.world, policy: ev.data.policy },
      })],
      'throttle.changed': ['policy', (s, ev) => ({
        policy: { ...s.policy, throttles: { ...s.policy.throttles, [ev.data.channel]: ev.data.level } },
      })],
      'investment.delivered': ['investments', (s, ev) => ({
        investments: s.investments.concat([{ catalog_key: ev.data.catalog_key, effect: ev.data.effect, s: ev.sim_s }]),
      })],
      'review.posted': ['reviews', (s, ev) => ({ reviews: U.tail(s.reviews, { ...ev.data, sim_s: ev.sim_s }, 12) })],

      // client-side pseudo event from boot.js: connection state
      'client.status': ['world', (s, ev) => ({ world: { ...s.world, lagging: !!ev.data.lagging, status: ev.data.status || s.world.status } })],

      // REST read models (pseudo events)
      'rest.forecast': ['rest', (s, ev) => ({ rest: { ...s.rest, forecast: ev.data } })],
      'rest.bottlenecks': ['rest', (s, ev) => ({ rest: { ...s.rest, bottlenecks: ev.data } })],
      'rest.advisor': ['rest', (s, ev) => ({ rest: { ...s.rest, advisor: ev.data } })],
      'rest.impact': ['rest', (s, ev) => ({ rest: { ...s.rest, impact: ev.data } })],
      'rest.comparison': ['rest', (s, ev) => ({ rest: { ...s.rest, comparison: ev.data } })],
      'rest.decision_explain': ['rest', (s, ev) => {
        const id = ev.data && ev.data.decision_id;
        return id ? { rest: { ...s.rest, explain: { ...s.rest.explain, [id]: ev.data } } } : null;
      }],
    },
  });
})();
