/* brew live — event sources (window.BrewSources): WsSource (the real backend) and ReplaySource (fixtures / offline demo).
   Both speak the same small interface so boot.js treats them alike:
     new Source({ ...options, onSnapshot(snapshot), onEvents(envelopes[]), onStatus(status) })
     .start()  .stop()  .status  .lastSeq
   A source delivers whole batches (one WebSocket frame, or one replay tick) so the store can reduce them and the
   page can render once per animation frame. */
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ================================================================== WsSource */
  /** ws(s)://host/api/v1/ws/worlds/{id}?since_seq=N from an http(s) base */
  function wsUrl(base, worldId, sinceSeq) {
    const u = new URL(base || location.origin, location.href);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = '/api/v1/ws/worlds/' + encodeURIComponent(worldId);
    u.search = sinceSeq != null ? '?since_seq=' + sinceSeq : '';
    u.hash = '';
    return u.toString();
  }

  class WsSource {
    /**
     * @param {object} o  base, worldId, sinceSeq, onSnapshot, onEvents, onHello, onStatus, onLagging, and for tests:
     *   WebSocket, fetch, now (injected implementations); backoffMin/backoffMax/pingMs/laggingMs/tickMs (ms)
     */
    constructor(o) {
      this.o = { backoffMin: 500, backoffMax: 8000, jitter: .3, pingMs: 10000, laggingMs: 20000, tickMs: 1000, ...o };
      this.lastSeq = o.sinceSeq != null ? o.sinceSeq : null; // last seq handed to onEvents (or the snapshot's)
      this.status = 'idle'; // connecting | live | reconnecting | closed
      this.everLive = false;
      this.lagging = false;
      this.attempt = 0;
      this.ws = null;
      this.stopped = true;
      this.resyncing = false;
      this.buffer = null;
      this.lastMsgAt = 0;
      this.lastPingAt = 0;
      this.urls = []; // every URL we connected to (tests)
    }

    _now() { return (this.o.now || Date.now)(); }

    _setStatus(s) {
      if (s === this.status) return;
      this.status = s;
      if (this.o.onStatus) this.o.onStatus(s);
    }

    start() {
      if (!this.stopped) return this;
      this.stopped = false;
      this.lastMsgAt = this._now();
      this._connect();
      this.timer = setInterval(() => this._tick(), this.o.tickMs);
      return this;
    }

    stop() {
      this.stopped = true;
      clearInterval(this.timer);
      clearTimeout(this.retry);
      if (this.ws) { this.ws.onclose = null; try { this.ws.close(); } catch (e) { /* already closed */ } this.ws = null; }
      this._setStatus('closed');
    }

    _connect() {
      clearTimeout(this.retry);
      const WS = this.o.WebSocket || window.WebSocket;
      const url = wsUrl(this.o.base, this.o.worldId, this.lastSeq);
      this.urls.push(url);
      this._setStatus(this.everLive ? 'reconnecting' : 'connecting');
      let ws;
      try { ws = new WS(url); } catch (e) { this._scheduleReconnect(); return; }
      this.ws = ws;
      ws.onopen = () => { this.lastMsgAt = this._now(); };
      ws.onmessage = (m) => this._message(m.data);
      ws.onclose = (ev) => {
        if (this.ws !== ws) return;
        this.ws = null;
        // 4404: the server no longer knows this world (it restarted). Retrying the same id is pointless: hand it to
        // the owner (boot.js finds or creates the live world again and re-hydrates).
        if (ev && ev.code === 4404 && this.o.onGone) { this.stopped = true; clearInterval(this.timer); this._setStatus('reconnecting'); this.o.onGone(); return; }
        this._scheduleReconnect();
      };
      ws.onerror = () => { /* onclose follows */ };
    }

    _scheduleReconnect() {
      if (this.stopped) return;
      this._setStatus('reconnecting');
      // exponential, capped, plus up to `jitter` extra so a room full of tabs doesn't reconnect in lockstep
      const wait = Math.min(this.o.backoffMax, this.o.backoffMin * 2 ** this.attempt) * (1 + this.o.jitter * Math.random());
      this.attempt += 1;
      this.retry = setTimeout(() => this._connect(), wait);
    }

    _message(raw) {
      let msg;
      try { msg = JSON.parse(raw); } catch (e) { return; }
      this.lastMsgAt = this._now();
      this._setLagging(false);
      if (msg.hello) {
        this.attempt = 0;
        this.everLive = true;
        this._setStatus('live');
        if (this.o.onHello) this.o.onHello(msg.hello);
      } else if (msg.frame != null) {
        this._frame(msg.events || []);
      } else if (msg.resync) {
        this._resync();
      }
      // hb / pong / subscribed: liveness only
    }

    _frame(events) {
      if (this.resyncing) { this.buffer.push(...events); return; }
      this._deliver(events);
    }

    /** hand over events newer than lastSeq; a hole in the sequence triggers a resync instead */
    _deliver(events) {
      const fresh = this.lastSeq == null ? events : events.filter((e) => e.seq > this.lastSeq);
      if (!fresh.length) return;
      if (this.lastSeq != null && fresh[0].seq > this.lastSeq + 1) { this.buffer = fresh; this._resync(true); return; }
      this.lastSeq = fresh[fresh.length - 1].seq;
      if (this.o.onEvents) this.o.onEvents(fresh);
    }

    /** the server cannot replay from our seq (or we saw a gap): refetch /state, re-hydrate, resume after its last_seq */
    async _resync(keepBuffer) {
      if (this.resyncing && !keepBuffer) return;
      this.resyncing = true;
      this.buffer = keepBuffer && this.buffer ? this.buffer : [];
      for (let i = 0; !this.stopped; i++) {
        try {
          const snap = await this._fetchState();
          this.lastSeq = snap.last_seq;
          if (this.o.onSnapshot) this.o.onSnapshot(snap);
          break;
        } catch (e) {
          await sleep(Math.min(this.o.backoffMax, this.o.backoffMin * 2 ** i));
        }
      }
      const buf = this.buffer || [];
      this.buffer = null;
      this.resyncing = false;
      this._deliver(buf);
    }

    async _fetchState() {
      const f = this.o.fetch || window.fetch.bind(window);
      const r = await f(this.o.base.replace(/\/$/, '') + '/api/v1/worlds/' + encodeURIComponent(this.o.worldId) + '/state');
      if (!r.ok) throw new Error('state ' + r.status);
      return r.json();
    }

    _setLagging(v) {
      if (v === this.lagging) return;
      this.lagging = v;
      if (this.o.onLagging) this.o.onLagging(v);
    }

    _tick() {
      const now = this._now();
      if (this.ws && this.ws.readyState === 1 && now - this.lastPingAt >= this.o.pingMs) {
        this.lastPingAt = now;
        try { this.ws.send(JSON.stringify({ op: 'ping' })); } catch (e) { /* closing */ }
      }
      if (now - this.lastMsgAt > this.o.laggingMs) this._setLagging(true);
    }
  }

  /* ================================================================== ReplaySource */
  /** parse a recorded stream (tests/fixtures/streams/*.jsonl): meta, snapshot, events, checkpoints */
  function parseStream(text) {
    const out = { meta: null, snapshot: null, events: [], checkpoints: [] };
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      if (r.kind === 'meta') out.meta = r;
      else if (r.kind === 'snapshot') out.snapshot = r.data;
      else if (r.kind === 'event') { const { kind, ...ev } = r; out.events.push(ev); }
      else if (r.kind === 'checkpoint') out.checkpoints.push(r);
    }
    return out;
  }

  class ReplaySource {
    /**
     * @param {object} o  url | text | lines, speed (sim seconds per real second; Infinity = as fast as possible; 0 = paused,
     *   advanced by stepTo(sim_s)),
     *   loop, batch, onSnapshot, onEvents, onStatus, onDone
     */
    constructor(o) {
      this.o = { speed: 1, loop: false, batch: 500, tickMs: 50, ...o };
      this.speed = this.o.speed;
      this.status = 'idle';
      this.lastSeq = null;
      this.stopped = true;
      this.pos = 0;
      this.stream = null;
      this.done = new Promise((r) => { this._resolveDone = r; });
    }

    _setStatus(s) { this.status = s; if (this.o.onStatus) this.o.onStatus(s); }

    async start() {
      this.stopped = false;
      this._setStatus('connecting');
      let text = this.o.text;
      if (text == null && this.o.lines) text = this.o.lines.join('\n');
      if (text == null) {
        const f = this.o.fetch || window.fetch.bind(window);
        const r = await f(this.o.url);
        if (!r.ok) { this._setStatus('closed'); throw new Error('replay ' + r.status + ' ' + this.o.url); }
        text = await r.text();
      }
      this.stream = parseStream(text);
      if (!this.stream.snapshot) throw new Error('replay stream has no snapshot');
      this._begin();
      return this;
    }

    _begin() {
      const { snapshot, events } = this.stream;
      this.pos = 0;
      this.lastSeq = snapshot.last_seq;
      if (this.o.onSnapshot) this.o.onSnapshot(snapshot);
      this._setStatus('live');
      if (!Number.isFinite(this.speed)) {
        for (let i = 0; i < events.length; i += this.o.batch) this._emit(events.slice(i, i + this.o.batch));
        this.pos = events.length;
        this._finish();
        return;
      }
      this.simStart = snapshot.clock.sim_s;
      if (this.speed === 0) { this.stepped = true; return; } // paused: stepTo(sim_s) drives the stream (rendering / visual tests)
      this.wallStart = performance.now();
      this.timer = setInterval(() => this._tick(), this.o.tickMs);
    }

    _emit(batch) {
      if (!batch.length) return;
      for (let i = batch.length - 1; i >= 0; i--) if (batch[i].seq != null) { this.lastSeq = batch[i].seq; break; } // rest.* pseudo-events have seq null
      if (this.o.onEvents) this.o.onEvents(batch);
    }

    _tick() {
      const events = this.stream.events;
      const simNow = this.simStart + ((performance.now() - this.wallStart) / 1000) * this.speed;
      const from = this.pos;
      while (this.pos < events.length && events[this.pos].sim_s <= simNow) this.pos += 1;
      if (this.pos > from) this._emit(events.slice(from, this.pos));
      if (this.pos >= events.length) { clearInterval(this.timer); this._finish(); }
    }

    /** speed 0 only: deliver (one batch) every not yet delivered event with sim_s <= simT; returns how many. A
        rest.* pseudo-event that shares the sim time of a stream event is delivered with it. */
    stepTo(simT) {
      const events = this.stream.events;
      const from = this.pos;
      while (this.pos < events.length && events[this.pos].sim_s <= simT) this.pos += 1;
      if (this.pos > from) this._emit(events.slice(from, this.pos));
      if (this.pos >= events.length && !this.finished) { this.finished = true; this._finish(); }
      return this.pos - from;
    }

    _finish() {
      if (this.o.loop && !this.stopped) { setTimeout(() => !this.stopped && this._begin(), 1000); return; }
      this._setStatus('done');
      if (this.o.onDone) this.o.onDone();
      this._resolveDone(this);
    }

    stop() {
      this.stopped = true;
      clearInterval(this.timer);
      this._setStatus('closed');
    }
  }

  window.BrewSources = { WsSource, ReplaySource, parseStream, wsUrl };
})();
