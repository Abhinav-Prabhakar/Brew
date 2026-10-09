# design/live — the client layer (contract)

Everything on the three screens comes from the backend through this layer. It has no DOM code except
`boot.js`; the room renderers (`../lobby.js`, `../kitchen.js`, `../pantry.js`, `../hud.js`, `../menu.js`) only read
state and listen on the bus.

```
WsSource (real) | ReplaySource (fixtures / offline demo)
        └──► BrewLive.ingest(envelope)
                 ├─► state = BrewStore.reduce(state, envelope)        (pure, tested)
                 └─► bus.emit(type, data, envelope)  then once per animation frame bus.emit('frame', state)
```

## Files (classic scripts, no bundler, load order matters)
| file | global | what |
|---|---|---|
| `bus.js` | `window.BREW_LIVE` | `on(type, fn)`, `off(type, fn)`, `emit(type, data, ev)`. `fn(data, ev)`; `'*'` gets `fn(type, data, ev)`. Same contract `menu.js` already uses. |
| `store.js` + `reduce/*.js` | `window.BrewStore` | pure `hydrate`, `reduce`, `reduceAll`, `select.*`, `HANDLED`, `IGNORED` |
| `sources.js` | `window.BrewSources` | `WsSource`, `ReplaySource` |
| `api.js` | `window.BrewApi` | REST client: `act(kind, payload)`, `chaos(kind, opts)`, `invest(key)`, `get(path)` |
| `boot.js` | `window.BrewLive` | boot flow, `state`, `now()`, `ingest()`, `ready` (Promise), `source`, `status` |

## Envelope
Every event: `{seq, sim_s, t, type, data}` exactly as the WebSocket sends it (backend.md §6.3). REST read models are
fed through the same reducer as **pseudo-events** `{seq: null, sim_s, t, type: 'rest.<name>', data: <response>}`
(e.g. `rest.inventory`, `rest.lots` (data = `{key, items}`), `rest.forecast`, `rest.bottlenecks`, `rest.advisor`,
`rest.impact`, `rest.comparison`, `rest.staff`, `rest.decision_explain`, `rest.purchasing`, `rest.usage`), so every
visible number goes through one tested path. Where they land:

| pseudo-event | source | store |
|---|---|---|
| `rest.inventory` | `GET /inventory` | `state.inventory[key]` (rows) + `state.rest.inventory_summary` (everything but `items`: freshness, value, co2e…) |
| `rest.lots` | `GET /inventory/{key}/lots` | `state.lots[key]` |
| `rest.usage` | `GET /inventory/{key}/forecast` (usage P50/P90 via the BOM; data carries `key`) | `state.rest.usage[key]` |
| `rest.purchasing` | `GET /purchasing/proposal` (the policy's own PO plan; `place_po` accepts it as is) | `state.rest.purchasing` |

## Store
- `BrewStore.hydrate(snapshot) → state` from `GET /worlds/{id}/state`.
- `BrewStore.reduce(state, ev) → state`. **Pure**: never mutates its inputs (tests deep-freeze them), no
  `Date.now()`, no randomness. Event types without a handler only advance `seq` / `sim_s` / `t` (so resume points stay right). Events with `seq <= state.seq` are ignored
  (replay/reconnect dedupe); pseudo-events (`seq: null`) are always applied and never move `state.seq`.
- Slice reducers live in `reduce/hud.js`, `reduce/lobby.js`, `reduce/kitchen.js`, `reduce/pantry.js` and are
  composed by `store.js`. `BrewStore.HANDLED` lists every event type with a reducer; `BrewStore.IGNORED` maps
  type → reason. Together they cover every type in `GET /api/v1/events/schema` (asserted by tests).
- Departed things are kept briefly so renderers can animate the exit: customers that left/balked/reneged and
  orders that were served/voided keep their final state plus `gone_s`, and are pruned on the next event whose
  `sim_s > gone_s + 90`.

### State shape (JSON, keyed objects; `null` when unknown)
```js
{
  seq, sim_s, t,
  world:    {id, policy, strategy, status, clock_mode, lagging, start_date},
  clock:    {day, hhmm, weekday, date, is_open, open_s, close_s},
  weather:  {state, temp_c, rain_mm_h},
  day:      {day, date, weekday, events[], ended: summary|null},
  kpis:     {cash, revenue_today, profit_today, rating, rating_n, load_pct, open_orders, walkouts_today},
  policy:   {policy, strategy, preset, throttles: {channel: level}},

  menu:     {[sku]: {sku, name, cat, price, base, min_price, max_price, staple, featured, hidden, hidden_reason,
                     dir: 'up'|'down'|null, note, changed_s}},
  combos:   {[id]:  {id, name, skus[], discount_pct, tagline, price, dir, changed_s, ...snapshot fields}},
  replate:  {mode, listings: {[listing_id]: {listing_id, sku, lot_id, units, made_at_s, use_by_s, discount_pct,
                     price, listed_s, outcome: null|'donated'|'wasted'|'sold_out', gone_s}}, sold_today, units_sold_today},

  orders:   {[order_no]: {order_no, order_id, channel, party_id, persona, name, items[{sku,qty,mods[],unit_price,
                     replate,combo}], note, note_flags[], placed_s, promised_s, priority, bumped,
                     status: 'queued'|'brewing'|'almost'|'ready'|'served'|'voided'|'rejected',
                     progress (0..1), ahead, ready_s, served_by, void_reason, batch_id, gone_s}},
  rail:     {order_nos[] (priority order), batches[{id, order_nos[]}]},
  batches:  {[batch_id]: {batch_id, station, step, order_nos[], size, started, saves_s, formed_s}},

  customers:{[party_id]: {party_id, customer_id, name, persona, party_size, channel, appearance_seeds[], laptop,
                     state: 'arrived'|'queued'|'ordering'|'waiting'|'seated'|'eating'|'lingering'|'paying'
                            |'left'|'balked'|'reneged',
                     queue_pos, order_no, patience_s, patience_deadline_s, patience_frac, tables[], seats[],
                     happy, pay_method, arrived_s, state_s, gone_s}},
  tables:   {[id]: {id, seats, state, occupants[], merged}},
  shelf:    {slots, bags: {[order_no]: {order_no, channel, slot, eta_s, quality,
                     rider: null|'assigned'|'arrived'|'picked_up', rider_eta_s, gone_s}}},
  receipts: [last 6 receipt.printed payloads, newest last],
  payments: [last 12 payment.received payloads + sim_s],
  reviews:  [last 12 review.posted payloads + sim_s],

  staff:    {[staff_id]: {id, name, role, present, on_break, absent, late, station, task, fatigue, shift[2],
                     break_due_s, break_end_s, state: 'working'|'idle'|'break'|'off'|'absent'}},
  tasks:    {[task_id]: {task_id, station, step, staff_id, order_no, est_s, started_s}}   // active only
  stations: {[station]: {station, util, queue, in_use, slots, status: 'up'|'down', down_until_s}},
  equipment:{[key]: {key, station, slots, slots_in_use, status, down_until_s, condition}},
  prep:     {[prep_key]: {prep_key, qty, state: 'cooking'|'ready'|'expired', s}},
  stock:    {[key]: {key, qty, low}},
  fridge:   {[sku]: {sku, key, qty, low, par, replate}},

  inventory:{[key]: <row of GET /inventory>},  lots: {[key]: [<GET /inventory/{key}/lots rows>]},
  pos:      {[po_id]: {po_id, supplier, lines[], eta_s, status: 'open'|'received', short, created_s}},

  decisions:[last 8 decision.made payloads + sim_s, newest last],
  bottleneck:{resource, rho, shadow_price},
  disruptions:{[id]: {id, kind, target, severity, until_s, source, active, started_s, resolved_s, cost_inr}},
  investments:[{catalog_key, effect, s}],

  rest: {forecast, bottlenecks, advisor, impact, comparison, purchasing, explain: {[decision_id]: ...}}
}
```

### Selectors (`BrewStore.select`, pure, used by renderers and tests)
`rail(state)` open tickets in rail order with their batch · `board(state)` `{brewing[], almost[], ready[]}` ·
`queue(state)` parties at the door/register in queue order · `seated(state)` · `crew(state)` staff sorted by role ·
`stationLoad(state)` · `freshness(state)` · `activeChaos(state)` · `menuItems(state)`.

## Sources and boot
- `WsSource({base, worldId, sinceSeq})`: opens `ws(s)://…/api/v1/ws/worlds/{id}?since_seq=`, handles `hello`,
  `frame`, `hb`, `pong`, `resync` (→ refetch `/state`, re-hydrate, resume). Exponential backoff reconnect
  (0.5 s → 8 s), `{op:'ping'}` every 10 s, `lagging` when no frame/hb for > 20 s. Resumes with the last applied
  `seq`, so a reconnect yields no gaps and no duplicates.
- `ReplaySource({url | lines, speed})`: plays a recorded fixture (`tests/fixtures/streams/*.jsonl`, or the
  offline demo `design/data/demo-stream.jsonl`): hydrate from its snapshot line, then emit events paced by `sim_s`
  at `speed` × real time (`speed: Infinity` = as fast as possible, synchronously in batches).
- Boot (`boot.js`): `?source=ws` (default): `GET /api/v1/worlds`, reuse the first live `clock:"wall"` world on
  policy D, else `POST /worlds {"policy":"D","clock":"wall","kind":"demo"}`; `POST /control {"action":"play"}`;
  `GET /state` → hydrate; stream. If the backend is unreachable, fall back to the offline demo replay and set
  `BrewLive.status = 'offline-demo'`. `?source=replay&fixture=<name>&speed=<n>` forces a replay;
  `?api=<origin>` points at another backend. The page is served by FastAPI at `/` (same origin), so `base` defaults
  to `location.origin`.
- `BrewLive.now()` = interpolated sim seconds between frames (for countdowns and patience rings).

## DOM hooks the rendering tests rely on (kept stable by the renderers)
| what | selector |
|---|---|
| ticket on the rail | `#lobby [data-ticket="<order_no>"]` (its order number text is `#<order_no>`) |
| menu-book price | `#mb [data-sku="<sku>"] .now` · combo `[data-combo="<id>"] .now` · rescue `[data-listing]` |
| lectern price | `#lobby-scene [data-lsku="<sku>"]` |
| HUD | `#hud .clock .time`, `#hud .money .amt` (profit), `#hud [data-live]` (live dot), `#hud .money [data-vs]` |
| customers | `#lobby [data-party="<party_id>"]` with `data-state` |
| stations | `#kitchen .board .cell[data-station="<station>"] .led` with class `g`/`a`/`r` |
| crew rows | `#kitchen .crew [data-staff="<staff_id>"]` |
| chaos buttons | `#kitchen .chaos [data-chaos="<kind>"]` |
| pantry item / lot | `#pantry [data-item="<key>"]`, lot tags `[data-lot="<lot_id>"]` with class `fresh`/`soon`/`bad` |
| action buttons | `[data-action="<kind>"]` |


## Implementation notes (the client layer as built; tests in `tests/frontend/`, see its README)
- **Registry.** Each `reduce/*.js` calls `BrewStore.register(file, {hydrate(snapshot, state) -> patch, on: {type: [slice, fn] | [[slice, fn], ...]}})`;
  a handler returns a patch of top-level keys. `BrewStore.describe()` is the source of truth for **`design/contract.json`**
  (regenerate with `uv run python scripts/build_contract.py`); `'*'` handlers run for every stream event (the HUD clock).
- **Customer states** are the contract's plus `seat_wait` (served at the counter, waiting for a table: no event, derived from
  `order.served`). The snapshot's `arriving` / `queueing` are normalised to `arrived` / `queued`. `reneged` is kept when
  `customer.left` follows it. `patience_frac` is a step function (1 -> .6 -> .3 -> .1): for a smooth ring use
  `patience_deadline_s` with `BrewLive.now()`.
- **Clock.** `clock.hhmm` / `is_open` follow `sim_s` of every event (the sim sends no `clock.tick` overnight); `day` / `date` /
  `weekday` follow `clock.tick` / `day.started` (the sim's day counter flips at 07:00). Extra internal keys: `clock.min`,
  `open_tod`, `close_tod`.
- **Orders.** A ticket stays in `orders` (status `served` / `voided` / `rejected`, `gone_s`) for 90 sim-s but leaves `rail`
  at once. Aggregator orders announce their lines before acceptance; the receipt printed at acceptance corrects `items`.
  `batches` only keep groups that are on the rail (`rail.reordered` drops the rest); a one-order batch (3 units) has no
  paperclip. `select.rail()` puts `.batch = {id, order_nos, size, index}` on tickets only when 2+ of the group are on the rail.
- **Tables** have no "cleaned" event: `dirty -> free` is inferred from a finished `pass/clean` task (FIFO).
- **Staff** `station` / `task` come from the active `tasks`; `state` is `absent | off | break | working | idle`; `break_due_s` /
  `break_end_s` and `fatigue` only fill in with `staff.status` (pending backend) or `rest.staff`.
- **Shelf** also carries `riders` (rider.assigned/arrived arrive before the bag exists) and `waiting_for_slot`.
- **Internal keys** (not for renderers): `_next_prune_s`, `_dirty_tables`.
- **Pseudo events** `rest.<name>` (listed above) and `client.status` (`{lagging}`, from boot.js).
- **Pending backend** (reducers exist; mark in `contract.json`): `station.load`, `staff.status`, `chaos.cost`, `saves_s` on `batch.*`.
- **Boot params**: `?source=ws|replay &api= &world=<id> &clock=wall|open &policy=D &play=0 &fixture=<name> &replay=<url> &speed=<n> &loop=1`;
  `window.BREW_LIVE_AUTOBOOT = false` skips auto boot (`BrewLive.boot(params)` by hand). Statuses: `booting | live | reconnecting |
  replay | offline-demo | closed`; bus also emits `hydrate`, `frame`, `status`. `BrewLive.refresh(name, arg)` fetches a read model
  and feeds it through the reducer as `rest.<name>`.
