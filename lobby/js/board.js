/* brew · board.js — the customer-facing split-flap ("Solari") board */
(function () {
  const B = window.B;
  const CHARS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#·-';
  const COLS = [
    { id: 'brewing', label: 'Now Brewing', c: '#f6a3b8' },
    { id: 'almost', label: 'Almost Ready', c: '#f3b45a' },
    { id: 'ready', label: 'Ready for Pickup', c: '#6fe0a4' },
  ];
  const ROWS = 4, W = 9;
  const cells = {}; // col -> [row][i] cell
  const counts = {};
  let pendingFlaps = 0;

  function makeCell() {
    const el = B.h(`<span class="flap"><span class="top"><i> </i></span><span class="bot"><i> </i></span><span class="ft"><i> </i></span><span class="fb"><i> </i></span></span>`);
    const [top, bot, ft, fb] = el.children;
    return { el, top: top.firstChild, bot: bot.firstChild, ftEl: ft, fbEl: fb, ft: ft.firstChild, fb: fb.firstChild, cur: ' ', target: ' ', busy: false };
  }

  function nextChar(cur, target) {
    const a = CHARS.indexOf(cur), b = CHARS.indexOf(target);
    if (a < 0 || b < 0) return target;
    let d = (b - a + CHARS.length) % CHARS.length;
    if (d > 5) return CHARS[(b - 4 + CHARS.length) % CHARS.length]; // skip ahead, keep the last few flaps visible
    return CHARS[(a + 1) % CHARS.length];
  }

  async function flipOnce(c, from, to) {
    c.top.textContent = to;
    c.ft.textContent = from;
    c.fb.textContent = to;
    c.bot.textContent = from;
    c.ftEl.style.display = 'block';
    c.fbEl.style.display = 'block';
    try {
      await c.ftEl.animate([{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(-90deg)' }], { duration: 46, easing: 'ease-in', fill: 'forwards' }).finished;
      c.ftEl.style.display = 'none';
      await c.fbEl.animate([{ transform: 'rotateX(90deg)' }, { transform: 'rotateX(0deg)' }], { duration: 52, easing: 'cubic-bezier(.3,1.6,.6,1)', fill: 'forwards' }).finished;
    } catch (e) { /* animation interrupted */ }
    c.bot.textContent = to;
    c.fbEl.style.display = 'none';
    pendingFlaps++;
  }

  async function run(c) {
    if (c.busy) return;
    c.busy = true;
    while (c.cur !== c.target) {
      const n = nextChar(c.cur, c.target);
      await flipOnce(c, c.cur, n);
      c.cur = n;
    }
    c.busy = false;
  }

  function setRow(col, r, text) {
    const s = (text || '').toUpperCase().padEnd(W, ' ').slice(0, W);
    let changed = 0;
    cells[col][r].forEach((c, i) => {
      const ch = CHARS.includes(s[i]) ? s[i] : ' ';
      if (c.target !== ch) {
        c.target = ch;
        changed++;
        setTimeout(() => run(c), i * 22 + r * 40);
      }
    });
    return changed;
  }

  B.board = {
    init() {
      const box = B.$('#board-cols');
      COLS.forEach((col) => {
        const el = B.h(`<div class="bcol ${col.id}" style="--c:${col.c}"><div class="bcol-h"><i></i>${col.label}<span class="n" data-n="${col.id}">0</span></div></div>`);
        cells[col.id] = [];
        for (let r = 0; r < ROWS; r++) {
          const row = B.h('<div class="brow"></div>');
          const rc = [];
          for (let i = 0; i < W; i++) {
            const c = makeCell();
            row.appendChild(c.el);
            rc.push(c);
          }
          cells[col.id].push(rc);
          el.appendChild(row);
        }
        box.appendChild(el);
        counts[col.id] = el.querySelector('[data-n]');
      });
      // clatter sound, batched so a big update sounds like a real board
      setInterval(() => {
        if (pendingFlaps > 0) {
          B.audio.play('clatter', Math.min(18, pendingFlaps));
          pendingFlaps = 0;
        }
      }, 260);
    },
    /** lists: {brewing:[...], almost:[...], ready:[...]} of short strings */
    update(lists) {
      COLS.forEach((col) => {
        const arr = lists[col.id] || [];
        counts[col.id].textContent = arr.length;
        for (let r = 0; r < ROWS; r++) {
          let txt = arr[r] || '';
          if (r === ROWS - 1 && arr.length > ROWS) txt = `+${arr.length - ROWS + 1} MORE`;
          setRow(col.id, r, txt);
        }
      });
    },
    foot(load, clock) {
      B.$('#board-load').textContent = `KITCHEN ${load}% · 3 STATIONS`;
      B.$('#board-clock').textContent = clock;
    },
    /** startup sweep: run every flap through a few characters */
    sweep() {
      COLS.forEach((col) => cells[col.id].forEach((row, r) => row.forEach((c, i) => {
        c.target = CHARS[B.ri(1, 26)];
        setTimeout(() => run(c), r * 60 + i * 30);
      })));
    },
  };
})();
