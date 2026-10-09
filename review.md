# review: the 2026-10-07 change set

Everything that changed in this round: what, why, the decisions behind it, and how to undo it. Ask for any item to be
changed or rolled back by its number (e.g. "roll back 3.2" or "make 5.1 quieter").

**Undoing.** Several items share a commit (noted per item), so `git revert` of a whole commit would take its
neighbours with it. To roll back one item, ask me and I'll back it out by hand. Commits are listed oldest first at the
end.

**Who did what.** UI, sound and visual design, the easter eggs and the polish were done by me (the lead). Backend and
client plumbing (fast-forward, price reasons), the functional audit, and the test suite and baselines were done by
Sonnet 5.5 sub-agents with the briefs written for them. I reviewed their work before relying on it.

---

## 1. Removed

### 1.1 The "live" pill in the top bar
- **What:** the green "live" dot and label next to the clock is gone (`design/brew.html`, `design/hud.js`).
- **Decision:** the connection status still exists, but it is invisible: it sits on the clock card as
  `data-status` / `data-conn`, used by tests and in the clock's tooltip when not live. The two cards that already
  existed still speak up when it matters: "we'll be right back" (lost connection for more than 6 s) and
  "offline · replay".
- **Commit:** `b8f4306`.

### 1.2 "live prices" labels
- **What:** the blinking "live prices" chip above the lobby lectern's menu, and the "live prices · policy D" chip in the
  open menu book, are both gone (`design/lobby.js`, `design/menu.js`).
- **Commit:** `b8f4306`.

## 2. The menu book: pictures, not paragraphs

### 2.1 Why a price moved, shown visually
- **Before:** every repriced item replaced its description with the whole RL decision, e.g. "▲ ₹35 · RL manager:
  plates prices +10%; prep coldbrew_concentrate at P90 (drivers: …); newsvendor prep: …".
- **Now:**
  - The description always stays: it's a menu.
  - A small inked arrow sits by the price: terra pointing up, sage pointing down.
  - Up to two tiny doodles after the item name show what drove the change: a clock (time of day), rain, a flame
    (kitchen load), a coin (cash), zzz (fatigue), people (demand), a leaf (stock/waste), a bag (delivery), a pen (you),
    a heart (happy hour), loop arrows (rescue).
  - The existing ink strike-through and handwritten new price still play when a price changes while the book is open.
- **Hover card:** hovering any item shows:
  - the old price struck through and the new one;
  - a slider of the charter's fair range (min to max), with the usual price as a faint tick and the current price as a
    dot;
  - up to 3 drivers, each with its doodle and a small ± bar;
  - one short handwritten line, e.g. "plates +10% · by the manager · 9:30 am". A staple item says "a staple: never
    priced up".
- **Screen readers:** each row carries the reason as hidden text.
- **Decisions:**
  - The words live on hover, never in a line on the page.
  - The fair-range slider makes the charter visible without a single number.
  - Driver bars are neutral pink/sage rather than "good/bad" colours. The sign of a driver is a feature value, not a
    verdict.
- **Files:** `design/menu.js`, `design/brew.html`.
- **Commit:** `b8f4306`.

### 2.2 Short, structured price reasons from the backend (sub-agent)
- **What:** `price.changed.reason_text` is now ≤ 30 characters ("plates +10%", "owner set it", "happy hour",
  "combo repriced", "promo price"). There is a new `drivers: [{name, label, value}]` (up to 3, from the decision's
  surrogate factors) and `decision_id`. Menu rows in `GET /state` mirror these fields. The long RL summary stays where
  it belongs, in `decision.made`.
- **Also changed:** the owner's default reason became "owner set it" (was "owner override").
- **Updated with it:** schema, `backend.md` §6, `contract.json`, the regenerated stream fixtures and the demo stream.
- **Files:** `src/brew/sim/world.py`, `combos.py`, `actions.py`, new `src/brew/analysis/drivers.py`,
  `src/brew/rl/surrogate.py`, `design/live/reduce/lobby.js`.
- **Commit:** `3eb088b` (shared with 4.1 and 6.x).
- **Fallback:** the menu also cuts down old-style reasons, so the menu stays readable even on a stream recorded before
  this change.

## 3. Sound

### 3.1 The bill prints for every customer, when the money lands
- **When:** dine-in customers pay at the end (`PAY_DONE`), takeaway at the counter, delivery through the app. Each
  payment emits `receipt.printed` followed by `payment.received`, and that is when the bill prints.
- **Bill printer:** a new synthesised thermal receipt printer (`V.bill`, `design/audio.js`), about 1.5 s:
  - one stepper-motor voice for the whole job: a buzzy saw through the plastic body's resonance, chopped by the motor
    steps;
  - gated line by line, with the small stalls real printers make;
  - the QR printed slower and lower (dense graphics);
  - a smooth paper feed;
  - the auto-cutter: a motor grunt, the blade snap, and the slip dropping.
- **Money in:** after the cut comes the payment sound for its method:
  - cash: a drawer (lever clack, roll, bell "ching");
  - UPI: the two-tone soundbox chime every Indian counter has;
  - card: the terminal's double beep.
- **Sync:** the printed slip in the lobby now unrolls in 1.5 s to match the sound.
- **Mix:** heard from another room, the printer is muffled through the wall like the other sounds. It never overlaps
  itself (minimum gap), and catch-up bursts stay silent.
- **Decision:** still no samples. Everything is synthesised, as before.
- **Commit:** `b8f4306`.

### 3.2 "+₹" into today's profit
- **What:** as each bill is cut, its total floats up into the profit card in green and the amount gives a small hop.
  Bills that land together ride up as one sum (`design/hud.js`).
- **Commits:** `b8f4306`, moved under the card in `9e1825e`.

### 3.3 Other new voices
- a tape-motor whirr when fast-forwarding (speeding up, or winding down to 1×);
- the music runs about 12 % quicker while fast-forwarded;
- the voices used by the easter eggs (§7).
- **Debugging:** `?audiodebug` logs any voice that throws (they're silent otherwise).
- **Commits:** `b8f4306`, `9474fb8`.

## 4. Fast-forward

### 4.1 Tap the clock
- **What:** tapping the HUD clock (or pressing <kbd>f</kbd>) cycles 1× → 5× → 20× → 60× → 1×.
  - A pink `»N×` badge pops in while the café runs fast.
  - Hovering the clock shows "tap to fast-forward »".
  - The clock, the lobby wall clock, wait timers and every event run at that rate.
- **Backend (sub-agent):**
  - `POST /worlds/{id}/control {"action":"speed","rate":N}` (rates 1/5/20/60; anything else returns 422).
  - A new `world.speed {rate, detached}` event; `rate` and `detached` are in the world JSON and `/state`.
  - The pacer re-anchors on every change, so time never jumps.
  - `BrewLive.now()` interpolates at the current rate.
  - A reload reattaches to the same fast-forwarded café instead of starting a new one.
- **Decision (as asked):** the first time it goes above 1×, the café detaches from the wall clock for good. Sim time
  can't run backwards, so 1× afterwards just runs at real-time pace from wherever it got to. The clock's time gets a
  dotted underline as a quiet "not real time" mark.
- **Measured:** 60× runs at 59.8–60.7 sim-seconds per second with no lag, through the lunch peak, with policy D. I
  checked it in a real browser against a real server: three taps reach 60×, the fourth returns to 1×, a reload keeps
  the same café, and there are no page errors.
- **Commits:** `3eb088b` (backend and client), `b8f4306` (UI).

## 5. Keyboard

### 5.1 1 · 2 · 3
- **What:** <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> jump to lobby, kitchen and pantry, closing the menu book first if
  it's open. Pressing the key for the room you're already in gives the tab a little "nope" shake.
- **Discoverability:** tiny keycaps appear under the room tabs while you hover them.
- **Commit:** `b8f4306`.

### 5.2 Fix: the arrow keys inside controls
- **What:** <kbd>←</kbd> <kbd>→</kbd> used to change rooms even while you were dragging the volume slider. Shortcuts
  now ignore keys typed into inputs.
- **Commit:** `b8f4306`.

### 5.3 More keys
- <kbd>m</kbd> opens the menu book.
- <kbd>?</kbd> shows a hand-drawn keys card ("some keys aren't on this card…").
- The README has a "Keys" section.
- **Commit:** `23fedac`.

## 6. Making it actually work (sub-agent audit, plus my follow-ups)

The audit ran the real backend and produced numbers. The full table is in the agent's report; here are the outcomes.

### 6.1 Kitchen workers vs their tasks: was partly broken, fixed
- **Not broken:** the simulation does assign tasks to everyone on shift. In a live run, barista 192 tasks, cashier 136,
  cook 76, dishwasher 6. Meera works 07:30–16:30, so in the evening she is correctly off.
- **What was broken:**
  - The crew card used the oldest task, the figure the newest, and the store the latest, so they disagreed.
  - A snapshot taken mid-task showed "ready".
  - A periodic status message could overwrite the task stream.
  - At real-time pace tasks last seconds, so most of the time the label you saw was "ready".
- **Now:** all three agree, and the card names the step and the ticket, e.g. "pour #423 ×2"; its tooltip lists every
  task.
- **Files:** `design/live/reduce/kitchen.js`, `design/kitchen.js`.
- **Commit:** `e55cd3b`.

### 6.2 "Everything is assigned to Meera and Kabir": was a display bug, fixed
- **Cause:** the lobby's "now brewing" board printed the baristas on shift as its header, and nothing per ticket.
- **Now:** each row names who is actually on that ticket, e.g. "#423 · masala chai + rose milk · dev + kabir". The
  header reads "N on it", and falls back to the on-shift list only when nobody is assigned yet.
- **Commit:** `e55cd3b`.

### 6.3 Inventory really goes down: it did, but the pantry froze between polls; fixed
- **Already correct:** recipes (BOM) consume stock correctly (from 07:30 to 12:00, milk went 90,000 → 75,439 and beans
  8,600 → 7,156), and stock balances: initial + received − used − wasted − donated = on hand.
- **What was wrong:** raw ingredients were only streamed when they crossed a reorder point, so the shelves sat still
  between the 30 s REST polls.
- **Now:** they stream at most once per key per sim-minute, and the shelves visibly drain.
- **Files:** `src/brew/sim/kpis.py`, `world.py`.
- **Commit:** `3eb088b`.

### 6.4 Money: profit and cash were stale or wrong; fixed
- **What was wrong:**
  - Profit and cash only refreshed every 5 sim-minutes (5 real minutes at 1×).
  - After closing, today's profit subtracted rent twice (₹6,000 off until midnight).
  - It also left out energy, maintenance and depreciation.
- **Now:**
  - A `kpi.tick` follows every payment, refund, PO receipt, investment and restock.
  - The HUD profit matches the books exactly after close (within 0.4 % before close).
  - `backend.md` and the implementation spec note the extra ticks.
- **Unchanged:** the RL observation and reward still use the old profit function, so the trained policy is unaffected.
- **Commits:** `3eb088b`, docs in `258d9dc`.

### 6.5 "We lose money when we buy": now visible
- **How the books work:** buying stock lowers **cash**, not profit; the ingredients are an asset until they're used,
  which is correct accounting. Stock is paid for when the delivery arrives (`po.received`); approving an order commits
  to it. Investments spend cash immediately.
- **The gap:** the HUD only ever showed profit, so you never saw purchases.
- **Decision (mine):** I added a small "· cash ₹1.48L" next to "today's profit". Whenever cash drops (a delivery paid
  for, an investment, a refund, the close-out costs), a red "−₹16,476" floats out of the card, the mirror of the green
  "+₹".
- **Commit:** `258d9dc`.

### 6.6 Invest button
- **What:** an investment you just bought is no longer offered again while it's on its way. Before, a second click got
  an error toast.
- **Commit:** `258d9dc`.

## 7. Easter eggs (`design/eggs.js`, listed with spoilers in README → "Easter eggs")

Fifteen of them, all small, drawn in the same ink and none of them touching the simulation. Each one found shows a
quiet "🥚 3 of 15"; progress is kept in `localStorage` under `brew.eggs`.

1. biscuit the café cat on the window sill;
2. the cuckoo in the wall clock (three quick taps; it calls the sim hour);
3. a tip jar that remembers your coins;
4. the radio with three real stations that change the music;
5. the Konami code (barista mode);
6. type `chai` for a kulhad;
7. type `upi` for the soundbox voice ("₹415 received");
8. a rubber duck in the dish pit;
9. a mouse peeking out of the pantry baseboard;
10. the logo's heart cycling taglines;
11. <kbd>s</kbd> in the menu book for a secret-menu sticky note;
12. a shooting star at 11:11;
13. dizzy room-hopping;
14. the "your latte's getting cold…" tab title;
15. festive dressing by the sim date: coffee-day bunting on 1 Oct, a marigold toran and diyas at Diwali, a Santa hat on
    the bell at Christmas.

There's also a hand-drawn cup and a hint in the devtools console.

- **Decisions:**
  - Hit areas carry `data-action` but are deliberately not focusable, so they stay hidden from tab order.
  - The cat appears on one day in four (seeded by the sim date) and every night, so it feels like a visit, not a
    fixture.
  - The mouse only peeks while you're in the pantry, and never in `?still` (test) mode.
- **Commits:** `cebe52f`, README in `23fedac`.

## 8. Polish I added

### 8.1 Closing-time Z-report
- **What:** at closing (`day.ended`), the day's report prints itself out of the printer, with the full printer sound,
  as a long thermal slip. It shows orders by channel, revenue, food cost, labour, rent, **net profit**, late orders,
  walk-outs, rating, waste, rescued plates and combos. Click it to tear it off; it also goes away by itself after 25 s.
- **Commit:** `9c1c962`.

### 8.2 Profit milestones
- **What:** the first time today's profit crosses ₹10k, 25k, 50k and ₹1L, the card throws a little paper confetti.
  Never on reload or catch-up.
- **Commit:** `b8f4306`.

### 8.3 Smaller touches
- **Toasts stack** instead of overlapping, and a repeated message shows once. (`d01b91a`)
- **Favicon:** the cup. (`23fedac`)
- **Forecast chip fix:**
  - The chip by the clock was being laid out as the pantry's 38 px forecast grid (both used the class `.fc`), which is
    why it was clipped ("~1 iter…"). Renamed to `.fcst`.
  - It also hides the number when the forecast's horizon is almost used up, where one 15-min slot ×4 was misleading
    ("~1/hr" mid-rush).
  - Shortened to "morning rush · ~41/hr", with the detail in the tooltip.
  - (`b8f4306`, `9474fb8`)
- **Bottleneck card:** shows "chai base stock" instead of "ingredient:chai base". (`d01b91a`)
- **Menu rows:** a soft marker highlight on hover; text selection in the paper pink. (`b8f4306`)

## 9. Tests

- **Result:** `uv run pytest -q` (not slow): **495 passed, 0 failed**. ruff and mypy are clean. The README badge now
  says 495 (was 469).
- **New backend tests:**
  - `tests/test_speed.py`: rates, 422s, the event, detaching, no time jump.
  - `tests/test_price_reasons.py`.
  - `tests/test_money_stock_live.py`: consumption, raw stock streaming, a tick after every payment, PO cash and stock,
    invest, refund, expiry, HUD profit against the closed books.
- **New frontend tests:**
  - `tests/frontend/test_crew_kds_live.py`.
  - `tests/frontend/test_ui_round.py`: 1/2/3 keys, menu doodles and the hover card, eggs loaded and not focusable, the
    Z-report.
- **a11y:** now also axe-checks the menu hover card, the keys card and the Z-report.
- **Updated:** `test_resilience` now reads the connection status from the clock card (no pill any more).
- **Two contrast fixes from the a11y run (sub-agent):**
  - the struck-through old price in the hover card is a little darker;
  - the Z-report's "thank u" signature is terra-ink, not pink.
- **Visual baselines:** all five regenerated on purpose, after checking each diff showed only the intended changes
  (`e55cd3b`, `ad7b46e`; tests in `38e7dba`).
- **Not done:** the README screenshots and GIFs (`docs/images/`) still show the old HUD with the "live" pill.
  `uv run python scripts/capture_readme_media.py` regenerates them; it was skipped to keep the laptop quiet. Say the
  word and I'll run it.

## Commits, oldest first

| commit | what |
|---|---|
| `b8f4306` | 1.1, 1.2, 2.1, 3.1–3.3, 4.1 (UI), 5.1, 5.2, 8.2, the menu-row hover and selection colour |
| `cebe52f` | 7 (eggs) |
| `23fedac` | 5.3, favicon, README keys + eggs + principles |
| `9474fb8` | forecast-horizon fix, `?audiodebug` |
| `9c1c962` | 8.1 Z-report |
| `3eb088b` | 4.1 (backend and client), 2.2, 6.3, 6.4 (sub-agents; this commit swept in both agents' sim work) |
| `e55cd3b`, `65ea7dd` | 6.1, 6.2 and their tests, kitchen and pantry baselines (sub-agent) |
| `9e1825e` | 3.2 float position |
| `d01b91a` | toast stacking, bottleneck labels |
| `258d9dc` | 6.5 cash, 6.6 invest, docs for 6.3 and 6.4 |
| `38e7dba`, `ad7b46e` | §9 tests, two contrast fixes, all visual baselines, badge (sub-agent) |
| this commit | review.md |
