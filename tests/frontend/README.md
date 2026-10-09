# Frontend tests

Everything that pins down "the frontend is correctly wired to the backend", under one toolchain: pytest + Python
Playwright (headless Chromium). No Node, no bundler. The units under test are the classic scripts in `design/live/`.

```bash
uv run playwright install chromium                      # once
uv run pytest -m frontend                               # everything below, ~35 s (e2e needs a free port)
uv run pytest tests/frontend/test_store.py              # the fast pure-state suite, ~5 s
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

| fixture | window | contains |
|---|---|---|
| `morning_rush` | 07:55-10:30 | espresso machine down 08:30 (30 min), owner `set_price` 09:00, `serve_order` 09:15 (order no in meta) |
| `lunch_delivery` | 12:00-14:00 | `rider_shortage` 12:30, `supplier_delay` 13:00, `invest marketing_push` 12:10, bags + riders |
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
| `test_contract.py` (no browser) | every fixture event validates against its pydantic model; seq strictly increasing and gap-free; fixtures not stale vs `event_json_schema()`; `demo-stream.jsonl == morning_rush.jsonl`; **`design/contract.json`**: every backend event type (and every one in `backend.md` section 6.3) is handled or explicitly ignored, each handled one says what it drives on screen, every `snapshot_fields` path exists in the fixture snapshots. Reducers for events the backend does not emit yet (`station.load`, `staff.status`, `chaos.cost`) are tolerated and reported as "pending backend". |
| `test_store.py` | the pure store over the fixtures: **event sourcing == snapshot** at every checkpoint (rail, orders, customers, tables, menu, combos, rescue listings, fridge, kpis, equipment/stations, staff, disruptions, shelf, last seq); purity (deep-frozen inputs and intermediate states), idempotence, reconnect-overlap dedupe, pruning at gone+90 sim-s; selectors on known moments of `morning_rush`; synthetic events for the types no fixture contains; `contract.json` == `BrewStore.describe()`; every backend type handled or ignored. |
| `test_sources.py` | `WsSource` against a fake in-page `WebSocket` + mocked `fetch` (hello, frames, disconnect -> reconnect with `since_seq`, backoff, resync, gap -> resync, dedupe, heartbeat/lagging, ping); `ReplaySource` (`speed: Infinity` deterministic, paced, loop); `BrewApi` request shapes and `BrewApiError`; boot fallback to the offline demo; frame coalescing; bus compatibility with `menu.js`. |
| `test_e2e.py` (`integration`) | a real `brew-api` subprocess (`BREW_DB_ENABLED=0`, `BREW_LIVE_RATE=60`) + the harness page: WS connects, hydrates, events flow; `set_price`, `serve_order`, `chaos` round trips; forced socket close -> reconnect with `since_seq`, store seqs gap- and duplicate-free; store equals the server's `/state` once paused; boot creates a world when none matches. |
| `test_record_determinism.py` (`slow`) | re-records `closing` in a temp dir with two hash seeds and compares bytes. |

`helpers.js` is injected into the test pages as `window.T` (diffing, fixture loading); the heavy loops run in the browser and
only small results cross the wire. `design/live/harness.html` loads just the live scripts (no rooms, no CSS).

## Known gaps: where the stream cannot equal the snapshot

Documented in `design/contract.json` -> `known_gaps` (source: `scripts/build_contract.py`) and asserted by tag in
`test_store.py` (a new, undocumented difference fails the test):

- `patience-coarse`: `customer.patience` fires only at the 60/30/10 % thresholds.
- `fatigue`: staff fatigue is not streamed until `staff.status` exists.
- `staff-task`, `weather-temp`, `coldbrew`, `replate-units`, `fridge-replate`, `bag-quality`, `kpis`, `table-clean`, `bump`: see the file.
