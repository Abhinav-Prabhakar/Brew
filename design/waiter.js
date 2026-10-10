/* brew — Kapi, the waiter. A doodle with a notepad in front of the lobby counter (bottom right) and a room of his
   own: the 4th tab, "kapi" (#waiter). Clicking the doodle (or Enter on it, or the tab, or key 4) walks there. The
   room is his stage — Kapi drawn large on the left ~60 %, the rest left empty. Prompt him (type or speak) and the illustration does the work: he looks up and
   thinks (a thought cloud with his dry inner monologue), acts (tears a ticket off the pad and sends it to the rail,
   stamps a note, flags the team), then says his answer in a speech bubble that types itself out. "chat" toggles the
   written history on the right.

   Talking goes through POST /worlds/{id}/waiter/chat (an LLM pool with a scripted stand-in on the server); the
   conversation lives here and is sent along each turn. The server answers in one piece ({thought, say, mood, order,
   notes}); the pacing — thought, actions, speech typed out — is staged here. Voice in: the browser's own speech
   recognition, with the transcript appearing live while you speak. Voice out: only for turns you spoke — his answer
   is read aloud by POST /waiter/speak (the server's TTS pool: ElevenLabs / OpenAI-style / … with rotating keys), and
   by the browser's own voice when no provider answers (GET /waiter/voice says whether that fallback is allowed).
   Every reply is also emitted as BREW_LIVE 'waiter.said' {text, mood, …}. */
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const scene = $('lobby-scene'), viewport = $('viewport');
  if (!scene || !viewport) return;
  const still = () => R.reduced;
  const wait = (ms) => new Promise((r) => setTimeout(r, still() ? 0 : ms));
  const WX = 1540, WY = 808, WS = .92;   // the small one: head centre + scale, feet on the floor in front of the counter
  const HAIR = '#2b2326';

  /* ------------------------------------------------------------------ the doodle (drawn twice: in the room, and large on the stage) */
  const FACE = {happy: ['', 'smile'], neutral: ['', 'neutral'], worried: ['worried', 'frown'], delighted: ['', 'grin'], focused: ['flat', 'neutral']};
  /** look: [dx, dy] of the pupils; talk: mouth override */
  const face = (mood, look = [-2, 1], talk) => { const [b, m] = FACE[mood] || FACE.happy;
    return eyes(0, 0, look[0], look[1]) + brows(0, 0, b) + mouth(0, 0, talk || m) + blush(0, 0)
      + `<path d="M-9 9q4.5-4 9 0q4.5-4 9 0" fill="none" ${st(2.4)}/>`; };   // a tidy moustache
  const figure = () => `<g class="wt-bob">
    <ellipse cx="0" cy="194" rx="40" ry="6" fill="${I}" opacity=".12"/>
    <path d="M-11 120L-13 188M11 120L13 188" fill="none" stroke="${I}" stroke-width="7" stroke-linecap="round"/>
    <ellipse cx="-18" cy="190" rx="10" ry="4.5" fill="${I}"/><ellipse cx="18" cy="190" rx="10" ry="4.5" fill="${I}"/>
    ${torso(0, 0, '#fffdf9')}
    <path d="M-7 27C-24 31 -31 41 -33 60L-36 124L-9 124L-3 60Z" fill="${C.navy}" ${st(2.6)}/><path d="M7 27C24 31 31 41 33 60L36 124L9 124L3 60Z" fill="${C.navy}" ${st(2.6)}/>
    <path d="M-36 98H36L40 150H-40Z" fill="${C.sage}" ${st(2.8)}/><path d="M-12 112h24v20h-24z" fill="none" ${st(2)} opacity=".7"/>
    <path d="M0 33L-11 27V39ZM0 33L11 27V39Z" fill="${C.pinkD}" ${st(2)}/><circle cx="0" cy="33" r="2.6" fill="${I}"/>
    <g class="wt-head">${head(0, 0)}<path d="M-27 -3C-31 -41 31 -41 27 -3C17 -20 -6 -22 -27 -3Z" fill="${HAIR}" ${st(2.6)}/>
      <g class="wt-face">${face('happy')}</g></g>
    ${arm(-28, 46, -52, 84, -38, 92)}
    <g transform="translate(-30 64) rotate(-9)"><rect x="-17" y="-6" width="34" height="46" rx="3" fill="#fffefb" ${st(2.6)}/>
      <path d="M-13 -6v-4M-6 -6v-4M1 -6v-4M8 -6v-4" ${st(2)}/>
      <g class="wt-lines" fill="none" stroke="${I}" stroke-width="1.8" stroke-linecap="round"><path d="M-11 6q5-3 9 0t9 0"/><path d="M-11 15q5-3 9 0t11 0"/><path d="M-11 24q4-3 8 0t6 0"/></g></g>
    <g class="wt-pen">${arm(28, 46, 46, 92, -8, 84)}<path d="M-8 84L-22 64" stroke="${C.mustard}" stroke-width="5" stroke-linecap="round"/><path d="M-22 64l-3-5" ${st(2.4)}/></g>
    <g class="wt-flag" hidden><circle cx="-52" cy="52" r="12" fill="${C.terra}" ${st(2.4)}/><text x="-52" y="57" text-anchor="middle" font-family="Gochi Hand" font-size="15" fill="#fff"></text></g>
  </g>`;
  const g = document.createElementNS(NS, 'g'); g.id = 'l-waiter'; g.setAttribute('class', 'wt');
  scene.insertBefore(g, scene.querySelector(':scope > rect[filter="url(#grain)"]'));
  g.dataset.go = 'waiter';   // brew.html's room switcher: a click on anything with data-go walks to that room
  Object.entries({role: 'button', tabindex: 0, 'aria-label': 'talk to Kapi, the waiter'}).forEach(([k, v]) => g.setAttribute(k, v));
  g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); g.dispatchEvent(new MouseEvent('click', {bubbles: true})); } });
  g.innerHTML = `<title>Kapi, your waiter — click to talk</title><g transform="translate(${WX} ${WY}) scale(${WS})" filter="url(#wob)">${figure()}</g>`;

  /* ------------------------------------------------------------------ the stage */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const box = document.createElement('section');
  box.id = 'wt-stage';
  box.innerHTML = `
    <div class="wt-show">
      <svg class="wt-big wt" viewBox="0 0 940 880" aria-hidden="true">
        <g class="wt-doodles" font-family="Gochi Hand" fill="${C.pinkD}"><text x="118" y="150" font-size="54">?</text><text x="62" y="236" font-size="34">?</text><text x="470" y="112" font-size="40">…</text></g>
        <g transform="translate(300 232) scale(3.1)">${figure()}</g>
        <g transform="translate(112 640)"><g class="wt-burst"><path d="M0 -92L22 -34L82 -52L44 -4L96 30L34 36L46 96L0 54L-46 96L-34 36L-96 30L-44 -4L-82 -52L-22 -34Z" fill="${C.terra}" stroke="${I}" stroke-width="5" stroke-linejoin="round"/><text y="16" text-anchor="middle" font-family="Gochi Hand" font-size="44" fill="#fff">team!</text></g></g>
      </svg>
      <div class="wt-cloud" aria-hidden="true"><i></i><i></i><p></p></div>
      <div class="wt-say" hidden><p aria-hidden="true"></p></div>
      <div class="wt-acts" aria-hidden="true"></div>
      <div class="wt-cap" aria-hidden="true"></div>
      <div class="wt-you" hidden></div>
      <div class="wt-chips"></div>
      <form class="wt-form" autocomplete="off">
        <button type="button" class="wt-mic" aria-pressed="false" aria-label="${SR ? 'speak to Kapi' : 'voice input is not supported in this browser'}" title="${SR ? 'speak (your words show up as you talk)' : 'voice needs Chrome, Edge or Safari'}" ${SR ? '' : 'disabled'}>
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><rect x="8.5" y="2.5" width="7" height="12" rx="3.5" fill="currentColor"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5M8.5 21.5h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
        <input class="wt-in" type="text" maxlength="400" placeholder="say something to kapi…" aria-label="your message to Kapi" enterkeyhint="send">
        <button type="submit" class="btn wt-send">send</button>
      </form>
    </div>
    <aside class="wt-side" hidden aria-label="conversation so far"><h3>the story so far</h3><div class="wt-log" role="log"></div></aside>
    <header><button type="button" class="tab wt-x">← back to the café</button><span class="wt-src"></span>
      <button type="button" class="tab wt-toggle" aria-pressed="false" aria-expanded="false">chat</button></header>
    <p class="wt-live" role="status" aria-live="polite"></p>`;
  const roomEl = $('waiter'); if (!roomEl) return;
  roomEl.appendChild(box);
  const here = () => document.body.dataset.room === 'waiter';
  const q = (s) => box.querySelector(s);
  const big = q('.wt-big'), cloud = q('.wt-cloud'), cloudP = q('.wt-cloud p'), sayBox = q('.wt-say'), sayP = q('.wt-say p'),
        acts = q('.wt-acts'), cap = q('.wt-cap'), you = q('.wt-you'), chips = q('.wt-chips'), input = q('.wt-in'), mic = q('.wt-mic'),
        side = q('.wt-side'), log = q('.wt-log'), toggle = q('.wt-toggle'), src = q('.wt-src'), liveEl = q('.wt-live');
  const faces = [g.querySelector('.wt-face'), big.querySelector('.wt-face')];
  const flags = [g.querySelector('.wt-flag'), big.querySelector('.wt-flag')];
  let mood = 'happy', look = [-2, 1], talkT = 0;
  const paint = (talk) => { for (const f of faces) f.innerHTML = face(mood, look, talk); };
  const setMood = (m, lk) => { mood = FACE[m] ? m : 'happy'; look = lk || [-2, 1]; paint(); };
  /** what he is doing: '' | thinking | writing | talking | alarm — drives the CSS of both drawings */
  function phase(p, caption) {
    for (const el of [g, big]) { el.classList.remove('thinking', 'writing', 'talking', 'alarm'); if (p) el.classList.add(p); }
    box.dataset.phase = p || ''; cap.textContent = caption || ''; cap.hidden = !caption;
    clearInterval(talkT);
    if (p === 'talking' && !still()) { let k = 0; talkT = setInterval(() => paint(++k % 2 ? 'o' : null), 150); } else paint();
  }
  let flagged = 0;
  const flag = (n) => { flagged += n; for (const f of flags) { f.toggleAttribute('hidden', !flagged); f.querySelector('text').textContent = flagged; } };

  /** type text into el, a few characters at a time (instant under reduced motion); resolves when done or cancelled */
  let turn = 0;
  async function type(el, text, cps = 46) {
    const mine = turn; el.textContent = '';
    if (still()) { el.textContent = text; return; }
    for (let i = 0; i < text.length;) {
      if (mine !== turn) return;
      i = Math.min(text.length, i + 2 + (text[i] === ' ' ? 1 : 0)); el.textContent = text.slice(0, i);
      await new Promise((r) => setTimeout(r, 2000 / cps * (/[.!?…—]$/.test(el.textContent) ? 3.5 : 1)));
    }
  }

  /* ------------------------------------------------------------------ the written history (toggled) */
  const history = [];   // [{role, content}] as sent to the server
  const rs = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
  const slip = (o) => `<div class="wt-slip" aria-label="order ${o.order_no}"><b>order pad · #${String(o.order_no).padStart(3, '0')}</b>`
    + o.items.map((it) => `<span>${it.qty} × ${esc(String(it.name || it.sku).toLowerCase())}</span><span>${rs(it.unit_price * it.qty)}</span>`).join('')
    + `<span class="tot">total</span><span class="tot">${rs(o.total)}</span><i>ticket's on the rail ✓</i></div>`;
  const stamp = (n) => `<div class="wt-stamp ${n.escalated ? 'hot' : ''}">${n.escalated ? '⚑ escalated to the team' : '✎ noted'}<small>${esc(n.summary)}</small></div>`;
  function entry(who, html, cls = '') {
    const el = document.createElement('div'); el.className = `wt-b ${who} ${cls}`.trim();
    el.innerHTML = html; log.appendChild(el); log.scrollTop = log.scrollHeight; return el;
  }
  function showSide(on) {
    side.hidden = !on; box.classList.toggle('with-side', on);
    toggle.setAttribute('aria-pressed', String(on)); toggle.setAttribute('aria-expanded', String(on));
    toggle.textContent = on ? 'hide chat' : 'chat';
    if (on) log.scrollTop = log.scrollHeight;
  }
  toggle.addEventListener('click', () => showSide(side.hidden));

  /* ------------------------------------------------------------------ a turn: think → act → speak */
  const MUSING = ['Ah. A customer. With words.', 'Consulting the sacred notepad…', 'Thinking. This is my thinking face. Admire it.',
    "One moment — pretending the espresso machine isn't screaming.", 'Let me check with my manager. (The pencil.)', 'Processing… like the fryer, but with opinions.',
    'Could be an order. Could be a riddle. Exciting.'];
  let busy = false, greeted = false;
  const chipsShow = (list) => { chips.innerHTML = list.map((t) => `<button type="button" class="chip">${esc(t)}</button>`).join(''); };
  chips.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) send(b.textContent); });

  async function ask(messages) {
    if (!window.BrewApi || !BrewApi.config.worldId) throw Object.assign(new Error('no backend'), {code: 'no_world'});
    return BrewApi.post('/waiter/chat', {messages});
  }
  function think(text) { cloud.classList.add('on'); return type(cloudP, text, 60); }
  async function act(card, cls, hold) {       // one action card pops by the pad, holds, then settles small
    const el = document.createElement('div'); el.className = `wt-act ${cls}`; el.innerHTML = card; acts.appendChild(el);
    await wait(hold); el.classList.add('done');
  }
  /* ---- voice out (spoken turns only) ---- */
  let voiceCfg = null, audio = null, voicedBy = '';
  const voiceConfig = async () => (voiceCfg ??= await BrewApi.get('/api/v1/waiter/voice').catch(() => ({providers: [], browser: {voice: '', pitch: .8, rate: 1.05}})));
  function hush() {
    if (audio) { audio.pause(); URL.revokeObjectURL(audio.src); audio = null; }
    try { window.speechSynthesis?.cancel(); } catch (e) { /* no synthesis */ }
  }
  /** read `text` aloud; resolves when he has finished (or could not): the server's TTS first, then the browser's voice */
  async function sayAloud(text) {
    hush(); voicedBy = '';
    const cfg = await voiceConfig();
    if (cfg.providers?.length) {
      try {
        const res = await fetch(BrewApi.config.base.replace(/\/$/, '') + '/api/v1/waiter/speak', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({text})});
        if (!res.ok) throw new Error('tts ' + res.status);
        const a = audio = new Audio(URL.createObjectURL(await res.blob()));
        voicedBy = res.headers.get('x-brew-tts') || 'tts';
        await new Promise((done) => { a.onended = a.onerror = a.onpause = done; a.play().catch(done); });
        if (audio === a) { URL.revokeObjectURL(a.src); audio = null; }
        return;
      } catch (e) { voicedBy = ''; /* fall through to the browser voice */ }
    }
    const synth = window.speechSynthesis, b = cfg.browser;
    if (!b || !synth) return;
    await new Promise((done) => {
      const u = new SpeechSynthesisUtterance(text), vs = synth.getVoices();
      const v = (b.voice && vs.find((x) => x.name.toLowerCase().includes(b.voice.toLowerCase()))) || vs.find((x) => /en-IN/i.test(x.lang)) || vs.find((x) => /^en/i.test(x.lang));
      if (v) u.voice = v;
      u.lang = v?.lang || 'en-IN'; u.pitch = b.pitch; u.rate = b.rate; u.onend = u.onerror = done;
      voicedBy = 'browser voice'; synth.speak(u); setTimeout(done, 30000);
    });
  }

  async function send(text, viaVoice = false) {
    text = String(text || '').trim();
    if (!text || busy) return;
    hush(); busy = true; const mine = ++turn; box.classList.add('busy'); chips.innerHTML = ''; input.value = '';
    you.hidden = false; you.className = 'wt-you'; you.textContent = text;
    entry('me', esc(text)); history.push({role: 'user', content: text});
    sayBox.hidden = true; acts.innerHTML = '';
    // 1 · thinking: eyes up, pencil tapping, a thought cloud that mutters until the answer is back
    setMood('focused', [3, -4]); phase('thinking', 'thinking…');
    let k = Math.floor(Math.random() * MUSING.length), waiting = true;
    (async () => { while (waiting && mine === turn) { await think(MUSING[k++ % MUSING.length]); await wait(1500); } })();
    let r;
    try { r = await ask(history.slice(-16)); }
    catch (e) {
      r = {say: e.code === 'no_world' ? "I can't reach the kitchen from here — this is a recording of the café, so I can only wave. Open the live café and I'm all yours!"
                                      : 'Sorry — I lost my train of thought (the line to the back dropped). Say that again?',
           thought: e.code === 'no_world' ? 'A recording. I am being haunted by my own shift.' : 'The line to the back is dead. Naturally.', mood: 'worried', offline: true};
    }
    waiting = false; turn++; const now = ++turn;   // (stops the muttering mid-word)
    const notes = r.notes || [], hot = notes.filter((n) => n.escalated);
    if (r.thought) { await think(r.thought); await wait(700 + r.thought.length * 14); }
    // 2 · actions, drawn out
    if (r.order) {
      setMood('focused', [-5, 4]); phase('writing', 'writing the ticket…');
      await wait(900);
      await act(slip(r.order) + '<em class="wt-to">→ to the rail</em>', 'ticket', 1900);
    }
    for (const n of notes) {
      if (n.escalated) { setMood('worried', [-2, 1]); phase('alarm', 'telling the team…'); flag(1); await act(stamp(n), 'note hot', 1700); }
      else { setMood('focused', [-5, 4]); phase('writing', 'noting it down…'); await wait(700); await act(stamp(n), 'note', 1200); }
    }
    if (hot.length) window.BrewToast?.(`⚑ kapi → team: ${hot[0].summary.slice(0, 70)}`, true);
    // 3 · the answer, said out loud
    cloud.classList.remove('on');
    setMood(r.mood || 'happy'); phase('talking', '');
    sayBox.hidden = false; liveEl.textContent = r.say;
    const el = entry('kapi', (r.thought ? `<span class="wt-th">(${esc(r.thought)})</span>` : '') + esc(r.say) + (r.order ? slip(r.order) : '') + notes.map(stamp).join(''));
    void el;
    window.BREW_LIVE?.emit?.('waiter.said', {text: r.say, thought: r.thought || '', mood: r.mood, order: r.order || null, notes});
    const aloud = viaVoice && !r.offline ? sayAloud(r.say) : null;   // you spoke, so he speaks
    await type(sayP, r.say);
    if (aloud) await aloud;                                          // (his mouth keeps moving until the audio ends)
    if (now === turn) phase('', '');
    if (!r.offline) history.push({role: 'assistant', content: r.say}); else history.pop();
    const fellBack = r.preferred_model && r.model && r.model !== r.preferred_model ? ` (${r.preferred_model} is down)` : '';
    src.textContent = (r.offline ? 'offline' : r.source === 'scripted' ? 'scripted answers' : r.source ? `${r.source} · ${r.model || ''}${fellBack}` : '')
      + (aloud && voicedBy ? ` · 🔊 ${voicedBy}` : '');
    busy = false; box.classList.remove('busy');
    if (here() && !listening) input.focus({preventScroll: true});
  }
  q('.wt-form').addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });

  /* ------------------------------------------------------------------ voice in: live transcript */
  let rec = null, listening = false, finalText = '';
  const CANCEL = '\u0000';
  function stopListening(cancel) {
    if (!rec) return;
    if (cancel) finalText = CANCEL;
    try { rec.stop(); } catch (e) { /* already stopped */ }
  }
  function listen() {
    if (!SR || listening || busy) return;
    hush();
    rec = new SR(); rec.lang = document.documentElement.lang || navigator.language || 'en-IN';
    rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    finalText = ''; listening = true;
    mic.setAttribute('aria-pressed', 'true'); box.classList.add('listening'); chips.innerHTML = '';
    you.hidden = false; you.className = 'wt-you live'; you.innerHTML = '<span class="wt-hear">listening…</span>';
    setMood('happy', [0, 3]); phase('', "I'm all ears…");
    rec.onresult = (e) => {
      let fin = '', interim = '';
      for (const res of e.results) (res.isFinal ? (fin += res[0].transcript) : (interim += res[0].transcript));
      if (finalText !== CANCEL) finalText = fin.trim();
      you.innerHTML = `${esc(fin)}<span class="wt-hear">${esc(interim) || (fin ? '' : 'listening…')}</span>`;
      input.value = (fin + interim).trim();
    };
    let failed = '';
    rec.onerror = (e) => {
      failed = {'not-allowed': 'the microphone is blocked for this page', 'service-not-allowed': 'the microphone is blocked for this page',
        'no-speech': "I didn't hear anything", 'audio-capture': 'no microphone found', network: 'speech recognition needs a connection'}[e.error] || '';
    };
    rec.onend = () => {
      listening = false; rec = null;
      mic.setAttribute('aria-pressed', 'false'); box.classList.remove('listening'); phase('', '');
      const said = finalText === CANCEL ? '' : (finalText || input.value.trim());
      if (said) return send(said, true);
      input.value = '';
      if (failed) { you.className = 'wt-you live err'; you.innerHTML = `<span class="wt-hear">${failed}</span>`; setTimeout(() => { if (!busy && !listening) you.hidden = true; }, 2800); }
      else you.hidden = true;
    };
    try { rec.start(); } catch (e) { rec.onend(); }
  }
  mic.addEventListener('click', () => (listening ? stopListening(false) : listen()));

  /* ------------------------------------------------------------------ arriving in / leaving his room */
  function open() {
    g.classList.add('talking-to');
    if (!greeted) { greeted = true;
      const hi = "Hello hello! I'm Kapi. Pad's out, pencil's sharp — what can I get you?";
      entry('kapi', esc(hi)); sayBox.hidden = false; liveEl.textContent = hi;
      wait(900).then(async () => { phase('talking', ''); await type(sayP, hi); if (!busy) phase('', ''); });
      chipsShow(["what's good today?", 'a latte, please', 'how long is the wait?', 'I have a complaint']); }
    setTimeout(() => { if (here()) input.focus({preventScroll: true}); }, still() ? 0 : 900);   // (after the walk over)
  }
  function close() {
    stopListening(true); hush(); g.classList.remove('talking-to'); input.blur();
    if (!busy) { setMood('happy'); phase('', ''); }
  }
  let was = here();
  new MutationObserver(() => { const now = here(); if (now === was) return; was = now; (now ? open : close)(); })
    .observe(document.body, {attributes: true, attributeFilter: ['data-room']});
  if (was) open();
  const walk = (room) => document.querySelector(`.tab[data-go="${room}"]`)?.click();
  q('.wt-x').addEventListener('click', () => walk('lobby'));
  box.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return;
    if (listening) { e.stopPropagation(); stopListening(true); } else walk('lobby'); }, true);

  window.BrewWaiter = {
    open: () => walk('waiter'), close: () => walk('lobby'), send, listen, showChat: showSide,
    get isOpen() { return here(); }, get listening() { return listening; }, get busy() { return busy; }, get history() { return history.slice(); },
    voiceIn: !!SR, sayAloud, hush,
  };
})();
