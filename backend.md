# Brew backend — product & build spec

> **Status:** v1 · October 2026 · source of truth for the Python backend (simulator, ML/RL, API).
> **Companion docs:** `technical.md` (how to implement it), `plan.md` (the master plan this derives from).
> **Rule of precedence:** if `plan.md` and this file disagree, **this file wins**. If this file and `technical.md` disagree on an implementation detail, `technical.md` wins.

---

## 0. What we are building

Brew is an operating system for independent cafes packaged as a cozy restaurant game. The **frontend** (a real-time 3D lobby in `lobby/`) already exists and currently runs its own toy simulation in JavaScript. This backend replaces that toy with the real thing:

1. A **digital-twin simulator** of a cafe (customers with personas, a kitchen with stations/equipment/staff, perishable inventory, delivery aggregators and riders, reviews, money).
2. **Decision-making policies** that run the cafe: A naive, B heuristic, C solver, D learned (RL), E oracle.
3. **ML models** that inform those policies: demand forecasting, price elasticity, review-cause tagging, ticket-note parsing.
4. **Analysis services:** bottleneck detection, investment advisor (counterfactual simulation), Policy Arena evaluation, decision explanations, impact metrics.
5. A **FastAPI service** (REST + WebSocket) that streams the simulation as events the frontend can animate, and accepts player/owner actions.

**Not in scope now:** wiring the frontend to the API (we adapt the frontend later — do not edit `lobby/`), real Zomato/Swiggy integrations, auth, payments, real PII, the Kitchen/Pantry/Office/Arena *UIs* (their *data* must exist in the API though).

---

## 1. Principles

1. **One engine, two clocks.** The same simulator runs *headless* (as fast as possible: training, arena, counterfactuals) and *live* (paced against wall-clock × speed, streaming events). What the user sees is what the agent trained on.
2. **Deterministic and forkable.** Same config + seed + policy ⇒ byte-identical event stream. Any running world can be `fork()`ed. Common random numbers (CRN) across policies.
3. **Event-sourced.** The simulator emits an append-only, typed event stream. The API's WebSocket, the DB writer, KPI aggregation and telemetry are all consumers.
4. **Policy as a plugin.** Every policy implements one `Policy` protocol; arena, live demo and training share it.
5. **Hybrid AI.** RL decides *what matters strategically*; forecasters and solvers *inform and execute*.
6. **Everything has a test.** Invariants (inventory conservation, ledger balance, no capacity violations), determinism, API contracts and model smoke tests run in CI-like `uv run pytest`.
7. **Runs on a laptop.** Every pipeline has a **smoke** configuration that finishes in minutes on an 8 GB Apple-silicon laptop and a **full** configuration for the training desktop (RTX 3050, Linux, via SSH).
8. **Python via `uv` only.** No pip, no conda, no poetry. `uv sync`, `uv run`, `uv add`.

---

## 2. Users of the backend

| Consumer | Needs |
|---|---|
| The 3D lobby (later) | A WebSocket event stream rich enough to animate every visual it has today (see §6.3), a hydration snapshot, and endpoints for player actions (serve, bump, restock, policy). The café runs **live** (real time); there are no playback speeds. |
| Future rooms (Kitchen, Pantry, Office, Arena, Chaos) | Station/staff/equipment state, inventory lots, forecasts, decisions + explanations, bottlenecks, advisor, arena results, chaos triggers. |
| Training scripts | Headless sim at high throughput, Gymnasium env, datasets in Parquet. |
| Us (developers) | CLI tools, deterministic replays, good tests, readable logs. |

---

## 3. Domain model (what the sim knows about)

All seed data lives in YAML under `configs/cafe/` and is validated by Pydantic at load. Full field lists are in `technical.md §5`. Summary:

### 3.1 Cafe & time
- Demo cafe **"brew", Indiranagar, Bengaluru**. Timezone `Asia/Kolkata`. Currency INR. GST 5% (split CGST 2.5% + SGST 2.5% on receipts).
- **Opening hours 08:00–22:00** (matches the frontend clock). Sim time is in seconds since midnight of day 0, monotonically increasing across days.

### 3.2 Menu (canonical SKUs)
SKU ids are lowercase slugs. **The first 15 are exactly the frontend's ids** (it has 3D models for them); the rest come from `plan.md` Appendix A so every kitchen station gets used.

| Category (`cat`) | SKUs (base ₹) |
|---|---|
| `coffee` | `espresso` 140, `cappuccino` 220, `flatwhite` 240, `latte` 230, `roselatte` 270, `icedlatte` 260, `coldbrew` 250, `filtercoffee` 120 *(staple)* |
| `notcoffee` | `chai` 140 *(staple)*, `matcha` 290, `hotchoc` 230, `rosemilk` 180, `strawberryshake` 240 |
| `bakes` | `croissant` 180, `muffin` 160, `cheesecake` 290, `cinnamon` 190, `waffle` 260 |
| `plates` | `avotoast` 380, `sandwich` *(Paneer Tikka Sandwich)* 320, `cheesetoast` 260, `fries` 160, `pasta` *(Arrabbiata)* 330 |

Each item has: recipe (BOM + steps), station, price bounds (min/max), allergens, veg/vegan flags, CO₂e, hold time, quality half-life, deliverability, staples flag (no surge allowed).

**Modifiers** (ids match the frontend): `oat` (+40), `almond` (+50), `shot` (+40), `decaf` (0), `lesssugar` (0), `iced` (+20), `hot` (extra hot, 0), `large` (+40), `noonion` (0), `nonuts` (0, allergy flag), `cheese` (+30), `jalapeno` (+20). Each modifier declares which items allow it and its recipe delta / extra prep seconds.

### 3.3 Channels
`dine_in`, `takeaway`, `zomato`, `swiggy` (+ `own_app` reserved). Aggregators have commission (zomato 25%, swiggy 22%), packaging cost, gateway fee, acceptance timeout (90 s), throttle support. **Never** use platform logos/sounds; text labels only.

### 3.4 Personas
Keys and rough behaviour from `plan.md §9`: `commuter`, `student`, `leisurely`, `remote_worker`, `family`, `office_bulk`, `delivery_home`, `tourist`, `regular`.
- Frontend mapping (for later): `camper` ≡ `remote_worker`; the frontend's `group` icon = any party with size ≥ 3; `delivery` icon = aggregator channel.
- Every customer gets a deterministic **`appearance_seed`** (uint32) the frontend will use to build the 3D paper-doll consistently.

### 3.5 Kitchen
Stations: `espresso` (2-group machine ×1), `grinder`, `bar` (tea/chocolate), `blender`, `cold` (cold-brew tower, fridge pours), `oven` (2 trays), `press` (panini press 4 slots), `fryer` (2 baskets), `stove` (2 burners), `griddle` (waffle iron 2), `display` (pick from pastry fridge), `pass` (plating/bagging), `dishpit` (cups & plates pool).
Staff (default roster): 2 baristas, 1 cook, 1 cashier/runner, 1 dishwasher (part-time). Staff have skills, speed, error rate, fatigue, wages, shifts, breaks.

### 3.6 Inventory
Ingredients with base units (g/ml/pc), storage zones, sealed/opened shelf lives, lots with FEFO, quality curves, suppliers with lead times and fill rates, **prep items** (cold-brew concentrate 12 h lead, chai base, croissant dough proof, paneer marinade, cut fries), packaging as inventory (cups, lids, kraft bags, sleeves, straws). The **pastry fridge** in the frontend is a view onto finished-goods stock of `croissant, muffin, cheesecake, cinnamon` and bottled `coldbrew`.

### 3.7 Delivery
Aggregator order → acceptance decision (accept / reject / inflate prep time) within timeout → promised prep time → cook → bag on **pickup shelf** (capacity 6 slots) → rider arrives (ETA distribution affected by rain/peak/shortage) → pickup. Food quality decays while waiting; rider waiting is penalised by the platform score.

### 3.8 Money, reviews, reputation
Ledger with accounts from `plan.md §7.3 fin`. Satisfaction per order → review probability → star rating (1–5) + **review text** (sampled from the LLM-generated corpus, conditioned on persona/channel/stars/causes) → per-channel Bayesian reputation → demand multiplier.

### 3.9 Weather & calendar
Weather states identical to the frontend: `sunny`, `partly`, `cloudy`, `drizzle`, `rain` (Markov chain per hour, temperature curve). Calendar events (festivals, cricket matches, exam weeks, paydays, public holidays) from a **Bengaluru calendar** (LLM-generated, §8) affect demand per persona/channel/category.

### 3.10 Disruptions (chaos)
`staff_absent`, `staff_late`, `equipment_down`, `supplier_delay`, `supplier_short`, `rider_shortage`, `power_cut`, `demand_spike` (bus of tourists, cricket final), `price_shock`, `platform_outage`. Sources: `scenario` (YAML schedule), `adversary` (RL), `manual` (API/chaos console).

### 3.11 Replate (rescue menu)
Food that was **pre-prepped / pre-made ahead of demand** and is nearing the end of its safe hold window is moved onto a special menu category, **`replate`**, at a heavy discount instead of being thrown away. It is a first-class feature, not a pricing hack:
- **What can be replated:** (1) finished goods made ahead in batches (`croissant`, `muffin`, `cheesecake`, `cinnamon`, bottled `coldbrew`); (2) **pre-made plates** that a policy chose to make ahead of orders (`sandwich`, `cheesetoast`, `pasta` portions, `avotoast` bases); (3) **prep-backed dishes**: when a *prepped intermediate or short-life perishable* is nearing its use-by, the dish it feeds is listed as replate and each sale draws on that expiring lot — `chai_base → chai`, `fries_cut → fries`, `croissant_dough → croissant` (bake-and-list), `paneer_marinade → sandwich`, `coldbrew_concentrate → coldbrew`, ripe `avocado → avotoast`. Listing units = what the expiring lot can make. A unit is eligible only while it is still food-safe (inside its hold window, quality ≥ `replate.min_quality`). Made-to-order items that went unserved (walkouts, remakes) are **never** replated — only ahead-of-demand stock.
- **Listing:** each eligible lot becomes a listing `replate:{sku}` with `units`, `made_at`, `use_by`, `discount_pct`, `price`. Listings are shown as their own menu category ("Replate — still lovely, just made earlier") with honest disclosure (made-at time).
- **Markdown ladder:** discounts only ever **increase** as `use_by` approaches (default ladder by fraction of hold time remaining: ≤ 50 % → 30 % off, ≤ 25 % → 50 % off, last 45 min → 70 % off; floor = unit cost × 0.5, never above base). At `use_by`: sealed bakery → donation, everything else → waste.
- **Charter:** replate prices are exempt from the 10 %/2 h step rules (they are clearance, not surge) but bound by: discount-only, monotone markdown, never below the floor, staples allowed (discount only), and placed orders unaffected.
- **Demand:** replate listings join the customer's choice set as extra alternatives. Personas have a `replate_affinity` (students and value-seekers high, leisurely/tourists lower) and a small "made earlier" penalty; cannibalisation of full-price items is real and must be measured.
- **Counter impulse add-on:** after choosing, a customer may add one listed rescue unit on top of their basket (calibrated ≈ 10 % of customers at 30 % off, ≈ 20 % at 50 % off; `replate.yaml: addon_*`, switch `addon_enabled`). This is the main source of *incremental* rescue demand — without it a discounted listing mostly cannibalises other full-price items (spec-pure logit: −24 % waste at −₹3.2k/day; with add-on: −47 % waste at +₹0.6k/day).
- **Policy role:** pre-making is a decision (how many units ahead, when). Replate turns over-prep from pure waste into recovered revenue, so C/D can pre-make more aggressively for speed. A: replate off. B: fixed ladder. C: optimised markdown (expected sell-through vs. waste cost). D: RL chooses replate aggressiveness. E: oracle.
- **KPIs / impact:** replate units sold, revenue recovered, waste kg & CO₂e avoided, **cannibalisation** (CRN counterfactual: same seed with replate off), net effect on profit.
- **Frontend (later):** a "Replate" section in the menu book, green "replate" tags on fridge items, a rescue counter on the HUD.

### 3.12 Meal combos (up-spend bundles)
Two-item combos (`configs/cafe/combos.yaml`, e.g. *Morning Fuel* = cappuccino + croissant, 12 % off) are a menu category of their own.
- **Live price:** `round_to_5(sum of the components' live prices × (1 − discount))`, so a combo reprices whenever a component does (`price.changed` with `sku: "combo:<id>"`). Never below the floor of a sensible saving, never above the à-la-carte sum.
- **Up-sell (the point of combos):** a customer whose basket holds one half may add the other half at the combo price with `p = min(0.32, 0.08 + 0.012 × saving%) × persona factor` (students 1.4 … delivery 0.8). One draw per customer from the `combos` RNG stream (CRN-safe). A basket that already holds both halves simply gets the combo price.
- **Order lines** carry `combo: <id>`; the combo price is split pro rata over its component lines. Replate-priced units are never part of a combo; a hidden/sold-out component makes the combo unavailable.
- **KPIs:** `combo_orders`, `combo_revenue`, `combo_upsells`, `combo_paired`. Measured effect (Policy C, 2 days): revenue +5 %, profit +₹3.9k/day, average ticket ₹500 → ₹521.
- **API:** `GET /worlds/{id}/combos`; `combos` in the `/state` snapshot.

---

## 4. Policies

| Code | Name | Intake | Dispatch | Pre-prep | Pricing | Purchasing |
|---|---|---|---|---|---|---|
| **A** | Naive | accept all | FCFS per station | none | static | fixed weekly |
| **B** | Heuristic | accept all; pause aggregators if open orders > N | FCFS + batch same step within 60 s; dine-in priority | fixed P50 morning prep | static + happy hour in dead hours | (s,S) |
| **C** | Optimised | feasibility check | EDF/weighted lateness scheduler with batching (CP-SAT with tight time limit, greedy fallback) | newsvendor quantile from forecasts | MILP/ladder search every hour using elasticity | perishable newsvendor |
| **D** | Learned (RL) | RL throttle + feasibility | C's scheduler parametrised by RL strategy weights + batch window | RL κ (quantile) + timing | RL price steps / feature / 86 (shielded) | newsvendor |
| **E** | Oracle | knows future arrivals | C scheduler with perfect info + long time limit | perfect | ladder search with true demand | perfect |

**Player/owner strategy override** (what the frontend's "Policy" chip shows today — `balanced`, `delivery_first`, `rush_menu`, `happy_hour`) is a separate concept: a *manual strategy* that adjusts the active policy's weights/menu. All policies must honour it.

**Fair pricing charter (hard shield for all policies):** |Δp| ≤ 10 % of base per change, ≤ 1 change per item per 2 sim-hours, price ∈ [min, max], **no increases on staples** (`chai`, `filtercoffee`), prices never change for an order already placed.

---

## 5. ML & analysis components

| Component | Purpose | Model | Trained on | Smoke target | Full target |
|---|---|---|---|---|---|
| Demand forecaster | item × channel demand per 15 min, P10/P50/P90, 0–6 h | Global LightGBM quantile (3 models) + seasonal-naive baseline | Sim history (Parquet) | 14 days, < 60 s | 180 days, beats baseline WAPE by ≥ 10 % |
| Arrival nowcast | intraday level multiplier | Gamma–Poisson update | online | — | — |
| Price elasticity | β per item (pooled by category) | Penalised Poisson GLM, log-price, category shrinkage | History with ±10 % price exploration | recovers sign of all β | |β̂ − β_true| median < 0.25 |
| Prep-time model | task duration quantiles | LightGBM quantile | task telemetry | trains | P50 MAE < 15 % |
| Rider ETA model | rider arrival quantiles | LightGBM quantile | delivery telemetry | trains | P90 coverage 85–95 % |
| Review-cause tagger | multi-label causes from review text | TF-IDF + one-vs-rest logistic regression | **LLM synthetic reviews** | trains on fixture | macro-F1 ≥ 0.75 |
| Ticket-note parser | special instructions → structured flags/modifiers | rules + TF-IDF classifier | **LLM synthetic notes** | trains on fixture | macro-F1 ≥ 0.8 |
| RL manager (Policy D) | strategic decisions every 15 sim-min | MaskablePPO (MLP), BC warm-start from C | Sim env | 20k steps, beats A on 3 seeds | curriculum 1d→7d→28d, beats C on calm + chaos |
| Adversary | chaos with budget | PPO | Sim env | runs 5k steps | RARL alternation |
| Bottleneck analyzer | binding constraint now | utilisation + active-period + LP shadow prices | live state | unit tests | — |
| Investment advisor | ranked purchases with Δprofit CI | counterfactual forks × seeds | sim | 3 seeds × 1 day | 20 seeds × 7 days |
| Explainer | "why" for each decision | top factors (surrogate tree / gradient×input) + template bank | policy decisions | — | — |

All trained artifacts register in a **model registry** (DB table + files under `models/`), with params, metrics, git SHA and data lineage. Small champion artifacts (ONNX policy, LightGBM text models, sklearn pickles < 5 MB) are committed so the demo never depends on training.

---

## 6. API contract

FastAPI app `brew.api.app:app`, served by `uv run brew-api` on `:8000`. OpenAPI at `/docs`. JSON everywhere (orjson). Times: sim time is an **ISO-8601 timestamp in Asia/Kolkata** *and* `sim_s` (float seconds since day-0 midnight) on every payload. Money: numbers in INR rupees (2 decimals). All ids: UUIDv7 strings except SKUs/modifiers/personas/channels/stations (slugs) and `order_no` (int).

### 6.1 REST (v1, prefix `/api/v1`)

**Worlds & control**
```
GET    /cafe                                   → cafe profile, menu, channels, personas, stations, catalog
POST   /worlds            {kind, scenario, policy, seed, speed, start_day?, cash_start?} → World
GET    /worlds                                  → list
GET    /worlds/{id}                             → World (status, clock, speed, policy, strategy)
DELETE /worlds/{id}
GET    /worlds/{id}/state                       → full hydration snapshot (§6.4)
POST   /worlds/{id}/control  {action: play|pause|step, step_s?}   # live: real time, no playback speeds
       (POST /worlds takes clock: "wall" (today, synced to real local time) | "open" (start at opening))
POST   /worlds/{id}/policy   {policy?: A|B|C|D|E, strategy?: balanced|delivery_first|rush_menu|happy_hour}
POST   /worlds/{id}/fork     {at?: "now", kind?: counterfactual} → World
POST   /worlds/{id}/chaos    {kind, target?, severity?, duration_min?} → Disruption
POST   /worlds/{id}/actions  {kind, ...}   (player/owner actions, §6.2)
```
**Read models**
```
GET /worlds/{id}/menu                     live prices, base, chip {dir, text}, featured, hidden(+reason)
GET /worlds/{id}/orders?status=&channel=  open/recent orders with items, mods, notes, promise, progress, batch
GET /worlds/{id}/rail                     ticket rail order (priority sorted, batch groups) — what the frontend's FLIP uses
GET /worlds/{id}/board                    split-flap columns {brewing, almost, ready}
GET /worlds/{id}/customers                customers in the venue with state, persona, patience, table
GET /worlds/{id}/tables                   tables, seats, merged groups, occupancy
GET /worlds/{id}/inventory                ingredients & prep items: on-hand, lots summary, days of cover
GET /worlds/{id}/inventory/{key}/lots     lots with expiry, quality, status
GET /worlds/{id}/fridge                   pastry-fridge finished goods stock
GET /worlds/{id}/shelf                    delivery shelf bags {order_no, channel, rider_eta, quality}
GET /worlds/{id}/staff                    staff, station, task, fatigue, shift
GET /worlds/{id}/equipment                status, slots in use, condition
GET /worlds/{id}/kpis?from=&to=           daily + rolling KPIs
GET /worlds/{id}/impact                   triple-bottom-line scoreboard
GET /worlds/{id}/forecast?target=&key=&horizon_min=   P10/P50/P90 buckets + actuals
GET /worlds/{id}/decisions?since_seq=     policy decisions
GET /decisions/{id}/explain               top factors + natural-language note
GET /worlds/{id}/bottlenecks              current ranked resources (ρ, wait attribution, active share, shadow price)
GET /worlds/{id}/advisor                  ranked investment recommendations (async job status if running)
POST /worlds/{id}/invest {catalog_key}    buy (spends sim cash; delivered after lead time)
GET /worlds/{id}/reviews?limit=           reviews with stars, text, causes (tagger output)
GET /worlds/{id}/receipts/{order_no}      receipt lines + GST breakdown + QR payload
```
**Arena, models, data**
```
POST /arena            {policies, scenario, seeds, days} → job id   (runs in a process pool)
GET  /arena/{id}       → progress, per-policy KPIs, paired bootstrap CIs vs A, Wilcoxon p
GET  /models           → registry (champions + metrics)
GET  /health           → {status, version, git_sha, models_loaded}
```

### 6.2 Player / owner actions (`POST /worlds/{id}/actions`)
Mirrors what the lobby lets you do today plus owner overrides. Every action produces events and is validated (409 on invalid state).
| `kind` | Payload | Effect |
|---|---|---|
| `serve_order` | `{order_no}` | Hand over a **ready** order now (otherwise a runner does it after `auto_serve_delay_s`). Delivery orders → bag to shelf. |
| `bump_order` | `{order_no, on: bool}` | Toggle priority bump for a queued order. |
| `restock_fridge` | `{}` | Buy bakery top-up for finished goods (costed). |
| `set_price` | `{sku, price}` | Owner price override (charter-checked). |
| `feature_item` / `hide_item` | `{sku, on}` | Owner menu interventions. |
| `throttle` | `{channel, level: open|plus5|plus10|pause}` | Aggregator throttle. |
| `place_po` | `{supplier, lines}` | Manual purchase order. |
| `premake` | `{sku, units}` | Make units ahead of demand (eligible SKUs only); unsold units flow into Replate. |
| `replate_list` | `{sku, discount_pct?}` | List / deepen the markdown of an eligible lot now (monotone, floor-checked; 422 on violation). |
| `replate_mode` | `{mode: off|gentle|standard|aggressive}` | Owner override of the active policy's replate ladder. |

### 6.3 WebSocket `/api/v1/ws/worlds/{id}?since_seq=`
Server → client: **batched frames** every 50–100 ms wall time: `{"frame": n, "events": [Event, ...]}`. Each event: `{"seq", "sim_s", "t", "type", "data"}`. Client → server: `{"op": "ping"}`, `{"op": "subscribe", "types": [...]}` (optional filter). On reconnect the client fetches `/state` and resumes with `since_seq` (server keeps a ring buffer of the last 10 000 events per world).

**Event types** (complete list; payload schemas are Pydantic models in `brew.events`, see `technical.md §9`). The right column is the lobby visual each must be able to drive:

| Type | Key payload fields | Drives (frontend) |
|---|---|---|
| `clock.tick` (every sim minute) | `day, hhmm, weekday` (+ `speed` = live rate, 1.0) | HUD clock, wall clock, board clock |
| `weather.changed` | `state, temp_c, rain_mm_h` | sky, rain, HUD weather |
| `day.started` / `day.ended` | `day, summary` | intro / closing card |
| `customer.arrived` | `customer_id, party_id, persona, party_size, channel, appearance_seeds[]` | door opens, people spawn |
| `customer.queued` | `party_id, position` | queue slots |
| `customer.balked` | `party_id, reason` | turns away at door |
| `customer.ordering` | `party_id` | at register, bubble |
| `customer.waiting` | `party_id, order_no, patience_s, patience_deadline_s` | pickup zone + patience ring |
| `customer.patience` (only at 60/30/10 % thresholds) | `party_id, frac` | ring colour |
| `customer.reneged` | `party_id, order_no?` | grey cloud, huff, walks out |
| `customer.seated` | `party_id, table_ids[], seats[], merged: bool` | walk to table; tables push together |
| `customer.eating` / `customer.lingering` | `party_id, laptop: bool` | sip loop; laptop opens |
| `customer.paying` | `party_id, method` | UPI bubble |
| `customer.left` | `party_id, happy: bool` | exit |
| `order.placed` | `order_no, order_id, channel, party_id?, persona, name, items[{sku, qty, mods[], unit_price}], note?, note_flags[], promised_s, priority` | ticket slides onto rail |
| `order.accepted` / `order.rejected` | `order_no, promised_s? / reason` | PAUSED stamp |
| `order.progress` (≤ 1 per order per 5 % step) | `order_no, state: queued|brewing|almost|ready, progress, ahead` | ticket bar + board columns |
| `rail.reordered` | `order_nos[] (priority order), batches[{id, order_nos[]}]` | FLIP + paperclips |
| `batch.formed` / `batch.started` | `batch_id, station, order_nos[], size` | paperclip snap |
| `order.ready` | `order_no, ready_s` | READY stamp, pass bell |
| `order.served` | `order_no, by: player|runner` | ticket torn off |
| `order.voided` | `order_no, reason` | VOID tear |
| `bag.shelved` / `rider.assigned` / `rider.arrived` / `rider.picked_up` | `order_no, channel, slot, eta_s, quality` | bag drop, tag, rider walk, scooter |
| `receipt.printed` | `order_no, lines[], subtotal, cgst, sgst, round_off, total, payment, qr` | thermal printer |
| `payment.received` | `order_no, amount, method` | cash fly-out |
| `review.posted` | `review_id, party_id?, order_no, stars, text, causes{}` | star to HUD (cracks ≤ 2) |
| `price.changed` | `sku, old, new, base, dir, reason_text, by` | handwritten price edit + chip |
| `menu.featured` / `menu.hidden` / `menu.restored` | `sku, reason` | sticker / ribbon |
| `replate.listed` / `replate.marked_down` | `listing_id, sku, lot_id, units, made_at_s, use_by_s, discount_pct, price` | Replate section in menu book, fridge tag |
| `replate.sold` | `listing_id, order_no, units, price` | rescue counter |
| `replate.retired` | `listing_id, units, outcome: donated|wasted|sold_out` | tag removed |
| `stock.changed` (finished goods & key ingredients) | `key, qty, low: bool` | fridge items + tags |
| `lot.opened` / `lot.expired` / `po.created` / `po.received` | … | pantry (later) |
| `task.started` / `task.finished` | `task_id, station, staff_id, order_no?, est_s` | espresso steam, kitchen (later) |
| `prep.started` / `prep.ready` / `prep.expired` | `prep_key, qty` | kitchen/pantry |
| `staff.*`, `equipment.down/up` | … | kitchen / chaos |
| `kpi.tick` (every 5 sim min) | `cash, revenue_today, profit_today, rating, rating_n, load_pct, open_orders, walkouts_today` | HUD numbers |
| `decision.made` | `decision_id, type, summary, policy` | office sticky notes |
| `bottleneck.changed` | `resource, rho, shadow_price` | office gauge |
| `chaos.triggered` / `chaos.resolved` | `kind, target, until_s` | chaos console |
| `strategy.changed` / `policy.changed` | … | HUD policy chip |
| `investment.delivered` | `catalog_key, effect` | item drops in |

### 6.4 Hydration snapshot (`GET /worlds/{id}/state`)
One JSON with everything the lobby needs to rebuild the scene without replaying events: `world, clock, weather, kpis, menu, replate (listings), rail (orders + batches), board, customers (with state + appearance + patience + table), tables, fridge, shelf, staff, equipment, policy, strategy, last_seq`.

---

## 7. Storage

- **Simulation state lives in memory** (Python objects). The simulator never touches the DB.
- **Operational DB:** SQLAlchemy 2.0 models; **SQLite file by default** (`data/brew.db`), PostgreSQL 16 via `DATABASE_URL` + `docker-compose.yml` for production-like runs. Portable column types only (JSON, UUID-as-string, Numeric). Alembic migrations.
- Live/demo worlds persist orders, items, reviews, price history, decisions, daily KPIs, investments through an **async batched event writer**.
- **Telemetry & training data:** Parquet under `data/runs/{world_id}/` (`events.parquet`, `orders.parquet`, `tasks.parquet`, `demand_15m.parquet`, `kpis.parquet`, `trajectories/*.parquet`), queried with DuckDB/Polars.
- **Models:** `models/{kind}/{name}/{version}/` + registry rows. Champions committed when small.

---

## 8. Synthetic data from LLM prompts (human-in-the-loop)

Some realism needs natural language or world knowledge that the simulator can't produce. We **write prompts to files**; the human runs them on their LLM and saves outputs; our code validates and ingests them.

- Prompts live in **`data/prompts/{name}.md`**. Each prompt is fully self-contained (role, context about Brew, exact output schema, counts, diversity rules, an example, and the **exact output path**). Each declares a `BATCH` variable so the human can run it multiple times for more data without duplicate ids.
- The human saves raw outputs to **`data/synthetic/raw/{name}/batch_{NN}.jsonl`** (or `.json`/`.csv` where the prompt says so).
- `uv run brew-synth validate` checks every raw file against its Pydantic schema, reports errors per line, deduplicates, and writes clean datasets to **`data/synthetic/clean/{name}.jsonl`** (committed).
- `uv run brew-synth status` lists which datasets are missing / how many rows / whether minimum counts are met.
- **Everything must work without these files** (tests use small hand-written fixtures in `tests/fixtures/synthetic/`), but quality improves when present.

**Required prompt files** (minimum rows across batches in brackets):

| Name | What the LLM produces | Used by |
|---|---|---|
| `reviews` [3 000] | Short cafe reviews in Indian English/Hinglish, each labelled with persona, channel, stars 1–5, cause weights (`wait, cold_food, price, quality, ambience, staff, accuracy, packaging, value`) | review text sampling in sim; review-cause tagger |
| `order_notes` [1 500] | Ticket special instructions ("allergic to nuts!!", "make it strong pls", "for Riya — happy bday!") with labels: intents (`allergy`, `modifier`, `rush`, `gift_message`, `packaging`, `cutlery`, `spice_level`, `other`), mapped modifier ids, urgency 0–1 | note sampling; note parser |
| `calendar_bengaluru` [≥ 2 years of events] | Dated events for Bengaluru 2025–2027: public holidays, festivals, IPL/international cricket match days in Bengaluru, exam seasons, paydays, marathons, long weekends — with demand multipliers per persona/channel/category | arrival & choice models |
| `explanations` [400] | Natural-language decision-explanation **templates** with `{slots}` per decision type and factor combination, warm and concise | explainer |
| `customer_names` [600] | Diverse first names/nicknames common in Bengaluru (pan-Indian + expats), with an optional short-name for the flap board (≤ 5 chars, A–Z) | ticket names, board |
| `ask_brew_eval` [300] | Owner questions + the API endpoint(s) and parameters that would answer them + a reference answer sketch | future "Ask Brew" copilot eval |
| `supplier_catalog` [1 per ingredient] | Realistic Bengaluru wholesale pack sizes, prices (INR 2026), lead times, local/distance for every ingredient in our seed list | inventory seed calibration |

**Workflow gate:** after the prompts are written the build **pauses**; the human runs them; then validation + smoke training continue.

---

## 9. Training workflow

All training is driven by `uv run brew-train <stage> --config configs/train/<smoke|full>.yaml`.

| Stage | What | Smoke (laptop) | Full (RTX 3050 desktop) |
|---|---|---|---|
| `history` | Generate synthetic POS history with policy A/B and price exploration | 14 days × 1 seed | 180 days × 4 scenarios |
| `forecast` | LightGBM quantile + baselines + backtest | minutes | ~15 min |
| `elasticity` | Poisson GLM | seconds | seconds |
| `prep_time`, `rider_eta` | quantile GBMs | seconds | minutes |
| `text` | review tagger + note parser | seconds (fixtures or clean data) | seconds |
| `bc` | behaviour cloning of Policy C | 5 days of C | 200 days |
| `ppo` | MaskablePPO curriculum 1d → 7d → 28d | 20k steps, 1d | 5M steps |
| `adversarial` | RARL alternation | 5k steps | 1M steps |
| `eval` | Arena: A–E × seeds × scenarios, CIs | 3 seeds × 1 day × 1 scenario | 30 seeds × 14 days × 8 scenarios |
| `export` | ONNX export + parity check + registry | yes | yes |

`uv run brew-train all --config configs/train/smoke.yaml` runs the entire pipeline end to end and must finish in **< 20 min** on the laptop. Full runs happen later over SSH on the desktop (Linux, RTX 3050); see `technical.md §13` for device handling, run directories, resumability and how artifacts come back.

---

## 10. Milestones & acceptance criteria

The build is done by sub-agents in this order. Each milestone ends with green tests, a commit and a push.

**M1 — Foundation** (agent 1)
- uv project (Python 3.12), lint/test tooling, package layout, CLI entry points.
- YAML seed (§3) + Pydantic validation.
- Simulator: engine, RNG streams, fork, arrivals, choice, kitchen (stations/equipment/staff/batching/quality), inventory (lots/FEFO/prep/suppliers), delivery, reviews/reputation, finance, weather/calendar, disruptions, KPIs.
- Policies **A** and **B**; manual strategies.
- Event schema + Parquet telemetry + `brew-sim` CLI.
- DB models + migrations + async writer; API (worlds, control, state, read models, actions, chaos, WS).
- Synthetic-data prompt files + `brew-synth validate/status` + fixtures.
- ✅ Accept when: one sim day of A runs headless in < 2 s on the laptop; determinism and CRN tests pass; all invariants pass under Hypothesis; API + WS integration tests pass; prompts exist for all 7 datasets.
- **⏸ Pause: human runs prompts.**

**M2 — Intelligence** (agent 2)
- **Replate** (§3.11): pre-make decisions, listings, markdown ladder, choice-set integration, events, `premake`/`replate_list`/`replate_mode` actions, `GET /worlds/{id}/replate`, KPIs + cannibalisation counterfactual; ladder in B, optimised markdown in C.
- History generator, forecasting + backtests, elasticity, prep-time & ETA models, text models (on clean synthetic data), newsvendor, pricing ladder/MILP, capacity LP with shadow prices, scheduler (CP-SAT + greedy fallback), **Policy C**, **Policy E**.
- Bottleneck analyzer, investment advisor, arena runner + statistics, impact metrics, explainer.
- API endpoints for forecast/decisions/explain/bottlenecks/advisor/invest/arena/models/reviews.
- ✅ Accept when: C beats A and B on mean profit over 3 smoke seeds; with Replate on, C cuts total waste kg ≥ 30 % vs. Replate off (5 seeds × 5 days, CRN) without lowering mean profit, and reports a per-item waste breakdown (rescuable vs. not); forecaster beats seasonal-naive WAPE on the smoke backtest; elasticity recovers β signs; all endpoints tested.

**M3 — Learning** (agent 3)
- Gymnasium env (manager), observation builder with named features, action space + masks + shield, reward, VecEnv, BC from C, MaskablePPO curriculum, adversary + RARL, ONNX export + runtime **Policy D**, explanations via surrogate tree.
- `brew-train all --config smoke` end to end.
- ✅ Accept when: env passes `gymnasium.utils.env_checker`; smoke PPO run improves mean episode reward over its first evaluation; D (smoke) ≥ A on 3 seeds; ONNX parity max abs diff < 1e-4; full config validated by a dry run.

**M4 — Smoke training & hardening** (main agent)
- Ingest the human-generated synthetic data, re-train text models, run full smoke pipeline locally, fix issues, write `docs/training-runbook.md` for the desktop.

---

## 11. Quality bar

- `uv run pytest -q` green; `uv run ruff check` clean; `uv run mypy src/brew` passes for `sim/`, `events/`, `api/` (strict-ish, see technical.md).
- Coverage ≥ 85 % on `sim/`, `policies/`, `api/`; ≥ 70 % overall.
- Test tiers: `unit` (fast, default), `property` (Hypothesis), `integration` (API/WS/DB), `slow` (training smoke; run with `-m slow`). Default `uv run pytest` runs everything except `slow` in < 3 min.
- No network access in tests. No GPU required for tests.
- Every public function in `sim/` and `policies/` has a docstring stating units.
