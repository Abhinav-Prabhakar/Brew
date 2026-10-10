/* brew — Kapi, the lobby waiter. A doodle with a notepad in front of the counter (bottom right). Click him (or Enter
   on his zoom target): the camera frames him (camera.js zone 'waiter') and a comic-strip chat opens — your bubbles on
   the left, his on the right with the tail towards him. He takes your order (a real ticket on the rail), answers
   questions, writes complaints on his pad and escalates what matters to the team.

   Talking goes through POST /worlds/{id}/waiter/chat (an LLM pool with a scripted stand-in on the server); the
   conversation lives here and is sent along each turn. Voice in: the browser's own speech recognition, with the
   transcript appearing live in a dashed bubble while you speak. Voice out is not wired yet — every reply is emitted
   as BREW_LIVE 'waiter.said' {text, mood} (and passed to BrewWaiter.speak if someone sets it) for that to hook into. */
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const scene = $('lobby-scene'), viewport = $('viewport');
  if (!scene || !viewport) return;
  const WX = 1540, WY = 808, WS = .92;   // head centre + scale: feet land on the floor line in front of the counter
  const HAIR = '#2b2326';

  /* ------------------------------------------------------------------ the doodle */
  const FACE = {happy: ['', 'smile'], neutral: ['', 'neutral'], worried: ['worried', 'frown'], delighted: ['', 'grin'], focused: ['flat', 'neutral']};
  const face = (mood) => { const [b, m] = FACE[mood] || FACE.happy;
    return eyes(0, 0, -2, 1) + brows(0, 0, b) + mouth(0, 0, m) + blush(0, 0)
      + `<path d="M-9 9q4.5-4 9 0q4.5-4 9 0" fill="none" ${st(2.4)}/>`; };   // a tidy moustache
  const g = document.createElementNS(NS, 'g'); g.id = 'l-waiter'; g.setAttribute('class', 'wt');
  const grain = scene.querySelector(':scope > rect[filter="url(#grain)"]');
  scene.insertBefore(g, grain);
  g.innerHTML = `<title>Kapi, your waiter — click to chat</title>
  <g transform="translate(${WX} ${WY}) scale(${WS})" filter="url(#wob)"><g class="wt-bob">
    <ellipse cx="0" cy="194" rx="40" ry="6" fill="${I}" opacity=".12"/>
    <path d="M-11 120L-13 188M11 120L13 188" fill="none" stroke="${I}" stroke-width="7" stroke-linecap="round"/>
    <ellipse cx="-18" cy="190" rx="10" ry="4.5" fill="${I}"/><ellipse cx="18" cy="190" rx="10" ry="4.5" fill="${I}"/>
    ${torso(0, 0, '#fffdf9')}
    <path d="M-7 27C-24 31 -31 41 -33 60L-36 124L-9 124L-3 60Z" fill="${C.navy}" ${st(2.6)}/><path d="M7 27C24 31 31 41 33 60L36 124L9 124L3 60Z" fill="${C.navy}" ${st(2.6)}/>
    <path d="M-36 98H36L40 150H-40Z" fill="${C.sage}" ${st(2.8)}/><path d="M-12 112h24v20h-24z" fill="none" ${st(2)} opacity=".7"/>
    <path d="M0 33L-11 27V39ZM0 33L11 27V39Z" fill="${C.pinkD}" ${st(2)}/><circle cx="0" cy="33" r="2.6" fill="${I}"/>
    ${head(0, 0)}<path d="M-27 -3C-31 -41 31 -41 27 -3C17 -20 -6 -22 -27 -3Z" fill="${HAIR}" ${st(2.6)}/>
    <g class="wt-face">${face('happy')}</g>
    ${arm(-28, 46, -52, 84, -38, 92)}
    <g transform="translate(-30 64) rotate(-9)"><rect x="-17" y="-6" width="34" height="46" rx="3" fill="#fffefb" ${st(2.6)}/>
      <path d="M-13 -6v-4M-6 -6v-4M1 -6v-4M8 -6v-4" ${st(2)}/>
      <g class="wt-lines" fill="none" stroke="${I}" stroke-width="1.8" stroke-linecap="round"><path d="M-11 6q5-3 9 0t9 0"/><path d="M-11 15q5-3 9 0t11 0"/><path d="M-11 24q4-3 8 0t6 0"/></g></g>
    <g class="wt-pen">${arm(28, 46, 46, 92, -8, 84)}<path d="M-8 84L-22 64" stroke="${C.mustard}" stroke-width="5" stroke-linecap="round"/><path d="M-22 64l-3-5" ${st(2.4)}/></g>
    <g class="wt-flag" hidden><circle cx="-52" cy="52" r="12" fill="${C.terra}" ${st(2.4)}/><text x="-52" y="57" text-anchor="middle" font-family="Gochi Hand" font-size="15" fill="#fff"></text></g>
  </g></g>`;
  const faceEl = g.querySelector('.wt-face'), flagEl = g.querySelector('.wt-flag');
  const setMood = (m) => { faceEl.innerHTML = face(m); };
  const writing = (on) => g.classList.toggle('writing', !!on);
  let flagged = 0;
  const flag = (n) => { flagged += n; flagEl.toggleAttribute('hidden', !flagged); flagEl.querySelector('text').textContent = flagged; };

  /* ------------------------------------------------------------------ the chat (a comic panel) */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const box = document.createElement('section');
  box.id = 'wt-chat'; box.hidden = true; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Chat with Kapi, the waiter');
  box.innerHTML = `<header><span class="wt-name">kapi</span><small>your waiter · takes orders, questions, complaints</small>
      <span class="wt-src" aria-live="polite"></span><button type="button" class="tab wt-x" aria-label="close the chat">✕</button></header>
    <div class="wt-log" role="log" aria-live="polite" aria-label="conversation"></div>
    <div class="wt-chips"></div>
    <form class="wt-form" autocomplete="off">
      <button type="button" class="wt-mic" aria-pressed="false" aria-label="${SR ? 'speak to Kapi' : 'voice input is not supported in this browser'}" title="${SR ? 'speak (your words show up as you talk)' : 'voice needs Chrome, Edge or Safari'}" ${SR ? '' : 'disabled'}>
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><rect x="8.5" y="2.5" width="7" height="12" rx="3.5" fill="currentColor"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5M8.5 21.5h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
      <input class="wt-in" type="text" maxlength="400" placeholder="say something to kapi…" aria-label="your message to Kapi" enterkeyhint="send">
      <button type="submit" class="btn wt-send">send</button>
    </form>`;
  viewport.appendChild(box);
  const log = box.querySelector('.wt-log'), input = box.querySelector('.wt-in'), mic = box.querySelector('.wt-mic'),
        chips = box.querySelector('.wt-chips'), src = box.querySelector('.wt-src');
  const history = [];   // [{role, content}] as sent to the server
  let busy = false, greeted = false;

  const scroll = () => { log.scrollTop = log.scrollHeight; };
  function bubble(who, html, cls = '') {
    const el = document.createElement('div'); el.className = `wt-b ${who} ${cls}`.trim();
    el.innerHTML = html; log.appendChild(el); scroll(); return el;
  }
  const rs = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
  function slip(o) {
    const rows = o.items.map((it) => `<span>${it.qty} × ${esc(String(it.name || it.sku).toLowerCase())}</span><span>${rs(it.unit_price * it.qty)}</span>`).join('');
    return `<div class="wt-slip" aria-label="order ${o.order_no}"><b>order pad · #${String(o.order_no).padStart(3, '0')}</b>${rows}<span class="tot">total</span><span class="tot">${rs(o.total)}</span><i>ticket's on the rail ✓</i></div>`;
  }
  const stamp = (n) => `<div class="wt-stamp ${n.escalated ? 'hot' : ''}">${n.escalated ? '⚑ escalated to the team' : '✎ noted'}<small>${esc(n.summary)}</small></div>`;

  function chipsShow(list) {
    chips.innerHTML = list.map((t) => `<button type="button" class="chip">${esc(t)}</button>`).join('');
  }
  chips.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) send(b.textContent); });

  async function ask(messages) {
    if (!window.BrewApi || !BrewApi.config.worldId) throw Object.assign(new Error('no backend'), {code: 'no_world'});
    return BrewApi.post('/waiter/chat', {messages});
  }
  async function send(text) {
    text = String(text || '').trim();
    if (!text || busy) return;
    busy = true; box.classList.add('busy'); chips.innerHTML = ''; input.value = '';
    bubble('me', esc(text));
    history.push({role: 'user', content: text});
    const dots = bubble('kapi', '<span class="wt-dots"><i></i><i></i><i></i></span>', 'thinking');
    writing(true); setMood('focused');
    let r;
    try { r = await ask(history.slice(-16)); }
    catch (e) {
      r = {say: e.code === 'no_world' ? "I can't reach the kitchen from here — this is a recording of the café, so I can only wave. Open the live café and I'm all yours!"
                                      : 'Sorry — I lost my train of thought (the line to the back dropped). Say that again?', mood: 'worried', offline: true};
    }
    dots.remove(); writing(false);
    const el = bubble('kapi', esc(r.say));
    if (r.order) el.insertAdjacentHTML('beforeend', slip(r.order));
    for (const n of r.notes || []) el.insertAdjacentHTML('beforeend', stamp(n));
    scroll();
    setMood(r.mood || 'happy');
    if (!r.offline) history.push({role: 'assistant', content: r.say});
    else history.pop();
    src.textContent = r.offline ? 'offline' : r.source === 'scripted' ? 'scripted' : r.source ? `via ${r.source}` : '';
    const hot = (r.notes || []).filter((n) => n.escalated);
    if (hot.length) { flag(hot.length); window.BrewToast?.(`⚑ kapi → team: ${hot[0].summary.slice(0, 70)}`, true); }
    window.BREW_LIVE?.emit?.('waiter.said', {text: r.say, mood: r.mood, order: r.order || null, notes: r.notes || []});
    try { window.BrewWaiter.speak?.(r.say, r); } catch (e) { /* voice out is optional */ }
    busy = false; box.classList.remove('busy');
    if (!box.hidden && !listening) input.focus();
  }
  box.querySelector('.wt-form').addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });

  /* ------------------------------------------------------------------ voice in: live transcript */
  let rec = null, listening = false, live = null, finalText = '';
  function stopListening(cancel) {
    if (!rec) return;
    if (cancel) finalText = '\u0000';
    try { rec.stop(); } catch (e) { /* already stopped */ }
  }
  function listen() {
    if (!SR || listening || busy) return;
    rec = new SR(); rec.lang = document.documentElement.lang || navigator.language || 'en-IN';
    rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    finalText = ''; listening = true;
    mic.setAttribute('aria-pressed', 'true'); box.classList.add('listening'); chips.innerHTML = '';
    live = bubble('me', '<span class="wt-hear">listening…</span>', 'live');
    rec.onresult = (e) => {
      let fin = '', interim = '';
      for (const res of e.results) (res.isFinal ? (fin += res[0].transcript) : (interim += res[0].transcript));
      if (finalText !== '\u0000') finalText = fin.trim();
      if (live) { live.innerHTML = `${esc(fin)}<span class="wt-hear">${esc(interim) || (fin ? '' : 'listening…')}</span>`; scroll(); }
      input.value = (fin + interim).trim();
    };
    rec.onerror = (e) => {
      const why = {'not-allowed': 'the microphone is blocked for this page', 'service-not-allowed': 'the microphone is blocked for this page',
        'no-speech': "I didn't hear anything", 'audio-capture': 'no microphone found', network: 'speech recognition needs a connection'}[e.error];
      if (why && live) { live.classList.add('err'); live.innerHTML = `<span class="wt-hear">${why}</span>`; const l = live; live = null; setTimeout(() => l.remove(), 2600); }
    };
    rec.onend = () => {
      listening = false; rec = null;
      mic.setAttribute('aria-pressed', 'false'); box.classList.remove('listening');
      const said = finalText === '\u0000' ? '' : (finalText || input.value.trim());
      if (live) { live.remove(); live = null; }
      if (said) send(said); else input.value = '';
    };
    try { rec.start(); } catch (e) { rec.onend(); }
  }
  mic.addEventListener('click', () => (listening ? stopListening(false) : listen()));

  /* ------------------------------------------------------------------ open / close with the camera */
  function open() {
    if (!box.hidden) return;
    box.hidden = false; g.classList.add('talking');
    if (!greeted) { greeted = true;
      bubble('kapi', "Hello hello! I'm Kapi. Pad's out, pencil's sharp — what can I get you?");
      chipsShow(["what's good today?", 'a latte, please', 'how long is the wait?', 'I have a complaint']); }
    setTimeout(() => { if (!box.hidden) input.focus({preventScroll: true}); }, R.reduced ? 0 : 500);
  }
  function close() {
    if (box.hidden) return;
    stopListening(true); box.hidden = true; g.classList.remove('talking'); setMood('happy');
  }
  window.BREW_LIVE?.on?.('camera.zoom', (z) => (z && z.zone === 'waiter' ? open() : close()));
  box.querySelector('.wt-x').addEventListener('click', () => window.BrewCamera?.unzoom());
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape' && listening) { e.stopPropagation(); stopListening(true); } }, true);

  window.BrewWaiter = {
    open: () => window.BrewCamera?.zoom('lobby', 'waiter'), close: () => window.BrewCamera?.unzoom(), send, listen,
    get isOpen() { return !box.hidden; }, get listening() { return listening; }, get history() { return history.slice(); },
    voiceIn: !!SR, speak: null,   // speak(text, reply): set by the voice-out layer when it lands
  };
})();
