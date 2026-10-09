# Frontend tests

Everything that pins down "the frontend is correctly wired to the backend", under one toolchain: pytest + Python
Playwright (headless Chromium). No Node, no bundler. The units under test are the classic scripts in `design/live/`.

```bash
uv run playwright install chromium                      # once
uv run pytest -m frontend                               # everything below, ~3 min (e2e needs a free port)
uv run pytest tests/frontend/test_store.py              # the fast pure-state suite, ~5 s
uv run pytest tests/frontend/test_render.py             # the real page replaying fixtures, ~35 s
uv run pytest -m visual --update-visual                 # (re)write the screenshot baselines, see below
uv run pytest -m slow tests/frontend/test_record_determinism.py   # re-records `closing` twice, byte compare
```

`uv run pytest -q` (the backend suite) also collects these; they are marked `frontend` (and `integration` for the
real-backend one) so CI can split them: `-m "not slow and not frontend"` / `-m "frontend and not slow"`. One Chromium at a
time, no xdist. The browser fixture is package-scoped on purpose (see `conftest.py`): Playwright's sync API would
otherwise leave an asyncio loop running and break the asyncio backend tests that follow.

## Golden event streams

`tests/fixtures/streams/*.jsonl` are the contract between backend and frontend: the real sim (policy D, seed fixed,
`2026-10-06` = Tuesday) recorded in-process by `scripts/record_stream.py`. One JSON object per line:

| line | content |
|---|---|
| `meta` | name, seed, policy, window, scripted `chaos` / `actions` (with the `after_seq` each landed at), `schema_sha256`, `n_events`, `recorded_with` |
| `snapshot` | `GET /worlds/{id}/state` at the start time |
| `event` ... | one per event, in the WebSocket envelope `{seq, sim_s, t, type, data}` |
| `checkpoint` | `{seq, data}`: the `/state` snapshot every 30 sim-min (when something happened) and at the end |
| `event` with `seq: null` | **REST snapshots**: `{kind:"event", seq:null, sim_s, t, type:"rest.<name>", data}`, written at the start and every 30 sim-min, with exactly the payloads `BrewLive.refresh()` fetches (same endpoints, served by the real FastAPI app in-process): `inventory`, `lots` (one per pantry slot key: `{key, items}`), `purchasing` (`/purchasing/proposal`), `impact`, `comparison`, `forecast` (horizon 120), `bottlenecks`, `usage` (`{..., key}` per pantry slot key). `advisor` is not recorded: it runs counterfactual forks for minutes and the UI polls a job. They are always applied by the store (never move `state.seq`), so a replay and the offline demo show everything the live app shows. |

Manual chaos and actions are recorded through `ManagedWorld.chaos` / `.act` (the code behind `POST /chaos` / `/actions`), so the
streams contain the shadow-fork `chaos.cost` and the immediate re-plan `decision.made` (with `headline` / `trigger`).

| fixture | window | contains |
|---|---|---|
| `morning_rush` | 07:55-10:30 | espresso machine down 08:30 (30 min), owner `set_price` 09:00, `serve_order` 09:15 (order no in meta) |
| `lunch_delivery` | 12:00-14:00 | `rider_shortage` 12:30, `rain_storm` 12:50, `supplier_delay` 13:00, `invest marketing_push` 12:10, bags + riders, `chaos.cost` (the 3rd disruption is not cost-tracked: 2 shadow worlds at most) |
| `closing` | 20:30 -> 07:10 | `day.ended`, closed night, `day.started`, weather |

`design/data/demo-stream.jsonl` is a copy of `morning_rush` (the offline demo of `BrewLive`).

### Regenerate

```bash
uv run python scripts/record_stream.py --all        # all fixtures + design/data/demo-stream.jsonl (~10 s)
uv run python scripts/record_stream.py --name closing --out-dir /tmp/x --recorded-with <sha>
uv run python scripts/build_contract.py              # design/contract.json after touching a reducer or a visual
```

Do this whenever an event or a read model changes (the staleness test tells you: "regenerate fixtures: ..."), then
re-run the suite and commit the new fixtures. Recording is deterministic (same args -> identical bytes, whatever
`PYTHONHASHSEED`); an earlier source of non-determinism (`World.recheck_availability` iterating a set of str keys) was fixed.

## What each file covers

| file | what |
|---|---|
| `test_contract.py` (no browser) | every fixture event validates against its pydantic model; seq strictly increasing and gap-free (the `rest.*` lines are separate); fixtures not stale vs `event_json_schema()`; scenarios contain what they promise (`chaos.cost`, `station.load`, `staff.status`, one re-plan decision per manual chaos, `rain_storm`); **REST snapshots** at the start and every 30 sim-min with a stable set of models, and every `rest.*` type in the fixtures has a reducer + a visual in `contract.json`; `demo-stream.jsonl == morning_rush.jsonl`; **`design/contract.json`**: every backend event type (and every one in `backend.md` section 6.3) is handled or explicitly ignored, each handled one says what it drives on screen, every `snapshot_fields` path exists in the fixture snapshots. |
| `test_store.py` | the pure store over the fixtures: **event sourcing == snapshot** at every checkpoint (rail, orders, customers, tables, menu, combos, rescue listings, fridge, kpis, equipment/stations, staff, disruptions, shelf, last seq); purity (deep-frozen inputs and intermediate states), idempotence, reconnect-overlap dedupe, pruning at gone+90 sim-s; selectors on known moments of `morning_rush`; synthetic events for the types no fixture contains; `contract.json` == `BrewStore.describe()`; every backend type handled or ignored. |
| `test_sources.py` | `WsSource` against a fake in-page `WebSocket` + mocked `fetch` (hello, frames, disconnect -> reconnect with `since_seq`, backoff, resync, gap -> resync, dedupe, heartbeat/lagging, ping); `ReplaySource` (`speed: Infinity` deterministic, paced, loop); `BrewApi` request shapes and `BrewApiError`; boot fallback to the offline demo; frame coalescing; bus compatibility with `menu.js`. |
| `test_e2e.py` (`integration`) | a real `brew-api` subprocess (`BREW_DB_ENABLED=0`, `BREW_LIVE_RATE=60`) + the harness page: WS connects, hydrates, events flow; `set_price`, `serve_order`, `chaos` round trips; forced socket close -> reconnect with `since_seq`, store seqs gap- and duplicate-free; store equals the server's `/state` once paused; boot creates a world when none matches. Then **the real page served by FastAPI at `/`** (`?world=<id>&clock=open&play=0`, a paused policy-A world the test steps through `/control`, so nothing races the runners): a chaos button downs the oven (LED red, chaos card lists it, the re-plan decision with its `trigger` shows as "RL: ..."), `serve_order` tears the ticket off the rail, `set_price` rewrites the menu-book `.now`, "approve order" -> `po.created`, the profit card opens `#cmp` with 4 policy rows, a forced socket close -> `reconnecting` -> `live` with a gap-free store. ~25 s. |
| `test_render.py` | **rendering**: `brew.html?source=replay&fixture=<name>&speed=0&still` (a paused `ReplaySource`; `BrewLive.source.stepTo(sim_s)` delivers events up to a sim time, helpers in `appkit.py`) and the DOM asserted against the store at fixed moments: rail tickets == `select.rail` (order by x), a serve tears its ticket off, customers in the venue drawn with their `data-state`, menu-book prices == `state.menu` over all three spreads (+ combos, lectern), HUD profit / clock / rating, profit card -> comparison with A..D rows, station LEDs through the espresso outage, crew rows + fatigue bars, the 6 chaos buttons, the chaos card's re-plan / cost, pantry lot tags vs the backend freshness rule, the approve-order button vs the proposal, plus a dozen slices through each whole fixture across all rooms. **Every test fails on a page error, a console error or `NaN` / `undefined` / `[object` in any DOM attribute or text.** |
| `test_nomock.py` | none of the old mock strings (`#041 #043 #044 #045 #046 #038`, `asha`, `ravi`, `₹18,420`, `day 12 of 30`, `38 orders/hr`, `tech called · 08:31`, `₹6,840`, `GreenLeaf`, `tomorrow 07:30`, `seed 7`, and `tue · 08:42 am` unless the sim clock is 08:42) renders in `#viewport`: hydrated, at 8 moments of the 3 fixtures, with the menu book and the comparison open. `08:42`, `meera`, `kabir` are legitimate live values. |
| `test_visual.py` (`visual`) | screenshot regression of lobby, kitchen, pantry, the menu book and the profit comparison at fixed fixture moments, `?still`, 1632x1040, against `tests/visual/<platform>-<scene>.png` (256-colour palette PNGs). A pixel differs when a channel moves by more than 24/255; fail above **1.5 %** differing pixels (`tests/visual/_diff/` gets the actual + a red diff). `--update-visual` or `BREW_UPDATE_VISUAL=1` rewrites baselines. Fonts come from Google Fonts: the test waits for `document.fonts.ready` and **skips** with a reason if they did not load. Baselines are per platform (macOS and Linux rasterise text differently): the committed ones are `darwin-*`; where none exist the scene is rendered twice and must be identical (determinism guard), then the test skips. |
| `test_perf.py` | replays `lunch_delivery` at speed 60 for 8 s in the lobby and the kitchen with a `requestAnimationFrame` probe: fails if p95 frame time > 50 ms; prints p50 / p95 / max (`-s`). Kitchen: 16.7 ms. **Lobby is an `xfail` (known, polish phase):** ~150 ms frames in headless software rendering, caused by the 18 animated `filter="url(#wob)"` groups of the lobby scene (remove the filters and it is 16.7 ms; JS is 93 % idle). |
| `test_record_determinism.py` (`slow`) | re-records `closing` in a temp dir with two hash seeds and compares bytes. |

`T.load(name)` returns `{snapshot, events (backend, integer seq), rest (rest.* pseudo-events), all (stream order), checkpoints}`;
`T.stateAt` ignores the REST lines, `T.stateAtWithRest` applies the ones that precede the event.

`helpers.js` is injected into the test pages as `window.T` (diffing, fixture loading); the heavy loops run in the browser and
only small results cross the wire. `design/live/harness.html` loads just the live scripts (no rooms, no CSS).

## Known gaps: where the stream cannot equal the snapshot

Documented in `design/contract.json` -> `known_gaps` (source: `scripts/build_contract.py`) and asserted by tag in
`test_store.py` (a new, undocumented difference fails the test):

- `patience-coarse`: `customer.patience` fires only at the 60/30/10 % thresholds.
- `fatigue`: staff fatigue is streamed by `staff.status` every 60 sim-s only (a checkpoint falls between ticks).
- `staff-task`, `weather-temp`, `coldbrew`, `replate-units`, `fridge-replate`, `bag-quality`, `kpis`, `table-clean`, `bump`: see the file.
