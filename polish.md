# Handoff: polish (sound · motion · camera · performance · accessibility · resilience · README)

You are a fresh agent with **no memory of earlier sessions**. This file is your briefing: it carries everything the
previous session knew that matters for polish, and the direction to take. Explore the code and decide the details.

**Prerequisite:** the integration phase (`frontend-backend-integration.md`) should be done or well under way, with the
frontend (`design/`) driven by the live backend. If it isn't finished, polish only what's already wired and coordinate
through `context.md`.

**Goal:** make brew feel like a finished, cosy indie game that happens to be an ML system. Every state change should
be seen and heard; it should run smoothly on an 8 GB M2 MacBook; it should survive a flaky network; and it should
present itself on GitHub as well as `Abhinav-Prabhakar/Dock` does.

---

## 0. Read first
1. `plan.md`: master plan, scope, art direction and demo script (rewritten 2026-10-06; trust it).
2. `context.md`: current state and roadmap.
3. `frontend-backend-integration.md`: how the frontend is wired (bus, store, sources, renderers), what was built and
   what was left out.
4. `backend.md` §6.3 (every event and the visual it drives) and `technical.md` (judges' deep-dive; the README links
   to it).
5. `design/`: `brew.html` (tokens, CSS motion, HUD, rooms), `lobby.js`, `kitchen.js`, `pantry.js`, `menu.js`, plus
   the reference screenshots `lobby.png`, `kitchen.png` and `pantry.png`.
6. The style reference for the README: https://github.com/Abhinav-Prabhakar/Dock (read its `README.md` with
   `gh api repos/Abhinav-Prabhakar/Dock/readme --jq .content | base64 -d`).

## 1. Working rules (non-negotiable)
- **Commit and push to `main` frequently.** `main` is the only branch, locally and on GitHub. If a push times out,
  retry with `git -c http.version=HTTP/1.1 push origin main`.
- **Use Sonnet 5.5 sub-agents for everything that isn't UI or visual/sound design.** That includes the performance
  harness, test updates, the screenshot and GIF capture pipeline, reconnect logic, accessibility audits, CI and README
  mechanics (badges, tables, links). Keep the feel decisions for yourself (what a sound is like, how a transition
  moves, how the README reads), and review sub-agent work before merging.
- **uv for all Python.** Keep every test suite green (backend, frontend and visual). Update visual baselines on
  purpose, never casually.
- **Keep the hand-inked style exactly consistent.** Anything new must look drawn by the same hand.
- **Scope:** three screens only (**lobby, kitchen, pantry**) plus the menu book overlay and the HUD's expandable
  profit-comparison component. **No onboarding** (explicitly not wanted). No arena page, no back office, no LLM or
  voice chat, no QR page: those are future scope.
- The café runs **live in real time** (no playback speeds). Polish must work at real-time pacing: things happen every
  few seconds, not in fast-forward.
- The laptop is an M2 with 8 GB, and the owner dislikes fan noise. Keep background work light.

## 2. Design language (keep it)
- **Tokens:**
  - ink `#1d1a1c`, paper `#fbf7f1`, ground `#efe6dc`
  - pink `#f7c3a3`, pink-d `#e07e52`, pink-l `#fdeee4`
  - sage `#8fa585`, olive `#6f7a4c`, terra `#c0634f`, mustard `#e3b25a`, navy `#3d4556`, kraft `#c9a27a`
  - ok/warn/bad `#7fc37a` / `#f2b33d` / `#e2483d`
- **Fonts:** Gochi Hand (titles and numbers), Patrick Hand (body), Caveat (handwritten notes), Courier Prime
  (receipts).
- **Line work:** wobbly ink outlines (the `#wob` feTurbulence filter), 2.5–3.5 px strokes, offset ink shadows
  `4px 5px 0`, hand-drawn card radii, paper grain.
- **Existing motion vocabulary:**
  - kitchen CSS loops: steam, drips, bubbles, chopping, bell, door swing;
  - the room-track slide (`cubic-bezier(.7,0,.22,1)`, 1.1 s);
  - the menu book: flies off the lectern to full view, real 3D page-turn leaf, ink strike-through, the new price
    revealed like handwriting, marker-highlight swipe, stamps that pop.

  Extend this vocabulary; don't replace it.

## 3. Work items

### 3.1 Sound design
- **Start from `lobby/js/audio.js`** (the retired 3D prototype). It has a complete **Web Audio synthesiser**: paper
  tear, thermal printer, split-flap clatter, scooter, rain, bell, cash, mixed through master, SFX and ambience buses.
  Port and extend it into `design/` rather than starting over. `lobby/` is due for deletion, so copy what you need
  first.
- **Map events to sounds** using backend.md §6.3 and the `design/contract.json` the integration phase produced. At
  minimum:
  - door chime on `customer.arrived`
  - ticket slide on `order.placed`
  - paperclip snap on `batch.formed`
  - the "order up" bell on `order.ready`
  - tear on `order.served`
  - printer on `receipt.printed`
  - cash on `payment.received`
  - scooter on `rider.picked_up`
  - a pen scratch on `price.changed` (menu book open), page flip on menu turns, a stamp thunk on `replate.marked_down`
  - fridge door thunk and hum in the pantry
  - espresso hiss, grinder, fryer sizzle and blender in the kitchen, tied to `task.started` at that station
  - a warning blip plus sparks on `equipment.down`
  - a soft "huff" on `customer.reneged`
- **Mix:** per-bus gain, ducking (music under the bell), spatial pan by x-position in the room, per-sound rate limits
  (a rush must not become noise), and a quieter mix at night.
- **Ambience and music:** a café room-tone bed per room (lobby chatter, kitchen extraction, pantry compressor hum),
  plus a lo-fi music loop or generative bed that reacts to kitchen load. Use only CC0 or your own sources, and add
  `design/audio/CREDITS.md`.
- **Controls:** the HUD "bgm" control becomes a real volume/mute control with a "calm mode" (no music, softer SFX).
  Audio starts after the first user gesture, as browsers require.

### 3.2 Animated transitions (within and between screens)
- **Rule: nothing pops.** Every enter, exit, move and value change animates.
  - Numbers roll like an odometer: profit, cash, counters.
  - Tickets slide in, reorder with FLIP, and tear off when served.
  - Customers walk in and out.
  - Lots fill, drain and expire, with a colour change and a "use first" FEFO arrow that wiggles.
  - Stamps, chips and badges pop with a spring.
- Use one easing set, defined as CSS variables (in, out, spring), and keep durations at 150–1,100 ms.
- **The HUD profit component expanding** into the D vs A/B/C comparison should feel like a card unfolding: a paper
  card that grows, with bars drawn in ink.
- **Reduced motion:** honour `prefers-reduced-motion`. Keep information changes, but replace movement with fades.

### 3.3 Camera moves between rooms (2D "camera")
The rooms already slide on one track. Make it feel like a camera:
- A slight ease-out overshoot, a tiny parallax between the backdrop and foreground layers, and the door swinging as
  you pass (`k-door` / `p-door` already exist).
- **Focus zooms:** clicking a station, the ticket rail, the fridge or a pantry shelf smoothly zooms and pans the room
  (transform on the room SVG) to frame it, with a "back" affordance. Esc or a click outside returns. Keyboard: ← → to
  change rooms (already there); Enter on a focused hot-spot to zoom.
- Event-driven attention: on `chaos.triggered`, optionally nudge the camera towards the affected station once (rate
  limited, never while the user is interacting).

### 3.4 Performance: a 16 ms frame budget on an M2 with 8 GB
- **Measure first.** Add a dev overlay (FPS and p95 frame time) and a Playwright perf test that replays a busy fixture
  stream (the morning rush) and records frame times.
- **Target:** p95 ≤ 16 ms at 1600×1000 on the M2, with the live stream on, all three rooms built and the menu book
  open.
- **Likely hot spots:**
  - `feTurbulence` + `feDisplacementMap` (`#wob`) applied to huge SVG groups. These filters are very expensive per
    frame when anything inside the group animates. Options: apply wobble only to static backdrop layers rasterised
    once (or cache them as an image or canvas), and keep animated layers unfiltered or pre-wobbled paths.
  - The full-screen `#grain` filter rect: replace it with a static tiled PNG or CSS background.
  - Box-shadow and blur during the track slide: use `will-change: transform` and avoid layout thrash.
  - Too many simultaneous CSS animations offscreen: pause the loops of rooms that aren't visible, and pause
    everything when the tab is hidden.
- **Memory:** no leaks over a 30-minute live session (detach listeners, recycle ticket and customer nodes).
- **Guard:** make the perf test enforce the budget in CI (with a sensible tolerance for CI hardware), or at minimum run
  it locally before each release.

### 3.5 Accessibility
- **Keyboard:** every interactive thing is reachable and operable (tabs, hot-spots, menu book page turns, profit
  expand, chaos buttons, action buttons), with a visible focus ring (`:focus-visible` already uses pink-d).
- **Screen readers:**
  - `aria-live="polite"` announcements for key events (order ready, price changes while the book is open,
    chaos started/resolved);
  - SVG rooms get `<title>`/`<desc>` and labelled hot-spots;
  - the menu book is a dialog with focus trap and restore (partly done);
  - charts in the profit expansion get text alternatives.
- **Colour:** the ok/warn/bad and freshness colours must not rely on hue alone. Add shapes or labels (✓ ! ✕, stripes)
  for colour-blind users, and keep text contrast at least 4.5:1 on paper.
- Captions for sounds: a small "🔔 order up" style caption track, togglable.
- Run axe (via Playwright) and fix every violation.

### 3.6 Reconnect and offline states
- **Connection states** in the HUD: live (red dot pulse), reconnecting (dashed ink spinner and "reconnecting…"),
  offline (a paper "we'll be right back" card) and lagging (the backend's `lagging` flag).
- **Reconnect:** exponential backoff with jitter; resume with `since_seq`; and when the server says the gap is beyond
  its buffer, re-hydrate from `/state` and replay. There must be no duplicate tickets or jumps; test this with a
  killed backend mid-rush.
- **Offline fallback:** if the backend is unreachable at boot, offer **demo replay mode** using `ReplaySource` and a
  recorded fixture day, clearly labelled "replay", never pretending to be live.
- Actions while offline are disabled, with a tooltip explaining why.

### 3.7 The README: GitHub showcase in the style of Dock
Rewrite `README.md` to the standard of https://github.com/Abhinav-Prabhakar/Dock. Read that README first: centred hero
with a one-line pitch, badges, a big hero image, a screens table with captions, an ASCII decision-stack diagram,
design principles, highlights, an honest results table with a candid read, a quickstart and a docs index.
- **Hero:** the lobby screenshot or a short GIF of a live morning rush (tickets sliding in, a batch paperclip, the
  menu book flipping a price).
- **Badges:** pytest count (281+ and growing; use the real number), MaskablePPO, ONNX, uv, FastAPI.
- **Screens table:** lobby, kitchen, pantry, menu book (open, mid page-turn), the profit-comparison expansion, chaos
  in the kitchen. Use stills plus 2–3 GIFs.
- **Capture pipeline** (delegate to a sub-agent):
  - Playwright drives the real app against a recorded fixture or the live backend, and saves PNG stills to
    `docs/images/`.
  - Record short WebM clips, then make GIFs with **ffmpeg (installed at `/opt/homebrew/bin/ffmpeg`)** using palette
    generation, about 10–15 s, 960 px wide, under about 5 MB each.
  - Add `scripts/capture_readme_media.py` so the media can be regenerated.
- **Content:**
  - "Why this exists": the independent café's hidden optimisation problem.
  - The decision stack: digital twin → forecasts → OR (C) → the RL manager (D) → shield/charter → live UI.
  - Highlights: Replate rescue shelf, meal combos, live real-time café, CRN-paired evaluation, explainable decisions.
  - **The results table**, per day: A ₹62.1k, B ₹73.5k, C ₹96.9k, D ₹104.9k; CVaR, waste, SLA and walk-outs. Take
    the numbers from `technical.md` §9.12 and `docs/training/full-20261005/`, and include the honest read (D carries
    more waste than C).
  - Quickstart with `uv`; a docs index (`plan.md`, `technical.md`, `backend.md`, `docs/implementation-spec.md`).
- Keep the README in the hand-drawn spirit where it makes sense (doodle dividers, warm tone), but readable first.

## 4. Definition of done
- Every event that changes something on screen has motion, and the important ones have sound. Calm mode and mute
  work.
- Room changes and focus zooms feel like camera moves; there is no onboarding.
- p95 frame time ≤ 16 ms on the M2 during a live rush with the menu book open; no memory growth over 30 minutes.
- axe-clean; full keyboard path; announcements; colour-blind-safe signals.
- Kill the backend mid-rush and the UI degrades gracefully, then recovers on its own with no duplicates.
- The README is Dock-calibre, with regenerable screenshots and GIFs.
- All suites green, `context.md` updated, and everything pushed to `main`, the only branch.
