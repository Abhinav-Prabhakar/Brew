# Polish plan (2026-10-06)

Executes `polish.md`. Order is chosen so later steps build on earlier ones: performance first (it changes how rooms are
layered), then motion and camera (built on the new layers), then sound (hooks into the same events), then
accessibility and resilience (touch every surface once more), and the README last (it captures the finished look).
Commit and push after each step. Visual baselines are regenerated only at the end of a step that changes the look.

## 0. Close the integration phase
- Full suite green on `main`; commit wave 2 (visual + perf tests, baselines, CI split); update `context.md`,
  `integration-status.md`, §5 of `frontend-backend-integration.md`.

## 1. Performance (16 ms p95 at 1600×1000)
Known: the lobby runs ~150 ms/frame because 18 `filter="url(#wob)"` groups get re-rasterised whenever something
animates near them. JS is 93 % idle.
- **Dev overlay** `?fps`: FPS + p95 frame time, bottom-left, ink style.
- **Grain:** the three full-screen `feTurbulence` grain rects → one static tiled noise background (CSS, generated once
  into a canvas data URL at boot).
- **Backdrops rasterised once:** each room's static wobbly groups (walls, counter, frame, chairs…) render into a
  single SVG that is turned into an `<image>` (SVG → blob URL), so the filter runs once per load, not per frame.
  Live layers stay as DOM on top.
- **Live layers:** drop `#wob` from layers that move every frame (`l-stand`, `l-seated`, `k-crew`, tech, bags);
  keep it on layers that change rarely (sign, decor, hopper). If the look suffers, use a cheap per-node static
  displacement instead.
- **Pause offscreen:** loops of rooms not on screen get `animation-play-state: paused`; everything pauses when the tab
  is hidden.
- **Guard:** `test_perf.py` drops the lobby xfail and adds the menu-book-open case; the limit is 16 ms locally and
  a CI tolerance (`BREW_PERF_LIMIT_MS`, 50 ms on CI).

## 2. Motion
- One easing set as CSS variables (`--ease-in`, `--ease-out`, `--ease-spring`, `--ease-cam`), durations 150–1100 ms;
  sweep existing hard-coded curves onto them.
- Audit what pops today (render.js keyed layers: enter/exit/move) and fill gaps: odometer numbers (profit, cash,
  counters), ticket FLIP + tear, customers walk in/out, lots fill/drain/expire + wiggling FEFO arrow, spring stamps.
- Profit card → comparison unfolds like paper (scaleY from the card + bars drawn with stroke-dashoffset).
- `prefers-reduced-motion`: movement → fades, information kept.

## 3. Camera
- Track slide gets a slight overshoot + backdrop/foreground parallax; doors swing as you pass.
- Focus zooms: click/Enter on a station, the rail, the fridge or a shelf → zoom/pan the room SVG to frame it; "back"
  chip, Esc, or outside click returns. ← → still change rooms.
- `chaos.triggered`: one rate-limited nudge toward the affected station, never while the user interacts.

## 4. Sound
- Port the Web Audio synth from `git show 76fb830:lobby/js/audio.js` into `design/audio.js` (no sample files: all
  generated, so no licensing; `design/audio/CREDITS.md` says so).
- Event → sound map from `contract.json` (door chime, slide, clip, bell, tear, printer, cash, scooter, pen scratch,
  page flip, stamp, fridge thunk/hum, station sounds on `task.started`, warning + sparks, huff).
- Mix: buses, ducking under the bell, pan by room x, per-sound rate limits, night mix; room tone per room; a
  generative lo-fi bed that follows kitchen load. Only the visible room's positional sounds play.
- HUD `bgm` → volume / mute / calm mode; starts after the first gesture; captions toggle ("🔔 order up").

## 5. Accessibility
- `aria-live` announcer (order ready, price change with the book open, chaos started/resolved).
- Rooms get `<title>`/`<desc>`; hot-spots are focusable buttons with labels; menu book focus trap/restore; chart
  text alternative; ok/warn/bad and freshness carry a shape or label (✓ ! ✕) not only hue; contrast ≥ 4.5:1.
- axe via Playwright (`tests/frontend/test_a11y.py`), fix every violation.

## 6. Resilience
- Backoff with jitter; "gap beyond buffer" → re-hydrate (exists, verify); HUD states live / reconnecting (dashed ink
  spinner) / offline (paper "we'll be right back" card) / lagging.
- Boot without backend → clearly labelled "replay" demo; action buttons disabled offline with a tooltip.
- e2e: kill `brew-api` mid-rush, restart, assert recovery with no duplicate tickets.

## 7. README
- Read Dock's README; capture pipeline `scripts/capture_readme_media.py` (Playwright stills → `docs/images/`,
  WebM → GIF with ffmpeg palettegen, ≤5 MB, 960 px); Dock-style README with real numbers from `technical.md` §9.12.

## 8. Close
- All suites green, baselines updated on purpose, `context.md` updated, pushed to `main`.
