# Brew backend — technical design

> Companion to `backend.md` (what/why). This file is the **how**: stack, layout, algorithms, schemas, parameters, tests.
> Audience: the engineers/agents implementing the backend. Be precise; when this file gives a number, use it as the default (all defaults are config, not constants).

---

## 1. Stack

| Concern | Choice | Notes |
|---|---|---|
| Python | **3.12** (`uv python pin 3.12`) | Do not use the system 3.14. |
| Packaging | **uv** (`pyproject.toml`, `uv.lock`, `[project.scripts]`) | `uv add` / `uv add --dev`; never pip. |
| Numerics | numpy, polars, pyarrow, duckdb, scipy | |
| Config | pydantic v2, pydantic-settings, pyyaml | |
| API | fastapi, uvicorn[standard], orjson, httpx (tests), websockets | |
| DB | sqlalchemy ≥ 2.0, alembic, aiosqlite; `psycopg[binary]` optional extra `postgres` | SQLite default. |
| ML | lightgbm, scikit-learn, joblib | |
| Optimisation | ortools (CP-SAT + GLOP/PDLP linear solver) | |
| RL | gymnasium, stable-baselines3, sb3-contrib, torch, onnx, onnxruntime | |
| CLI / logs | typer, rich, structlog (or stdlib logging with rich handler) | |
| Dev | pytest, pytest-asyncio, pytest-cov, pytest-timeout, hypothesis, ruff, mypy | |

`torch` comes from PyPI (CPU on macOS, CUDA-enabled wheels on Linux x86_64 — the RTX 3050 desktop just works with the same lock). Do **not** add a custom CUDA index unless a later step proves it necessary.

---

## 2. Repository layout

```
brew/
├── plan.md  backend.md  technical.md
├── lobby/                         # existing 3D frontend — DO NOT MODIFY in backend milestones
├── pyproject.toml  uv.lock  .python-version  docker-compose.yml  alembic.ini
├── configs/
│   ├── cafe/                      # seed: cafe.yaml menu.yaml modifiers.yaml recipes.yaml ingredients.yaml
│   │                              #       prep_items.yaml suppliers.yaml staff.yaml stations.yaml equipment.yaml
│   │                              #       tables.yaml channels.yaml personas.yaml catalog.yaml (investments)
│   ├── scenarios/                 # weekday_normal weekend_brunch rainy_delivery_surge festival exam_week
│   │                              # heatwave chaos_random chaos_adversary (.yaml)
│   ├── policies/                  # A.yaml B.yaml C.yaml D.yaml E.yaml strategies.yaml charter.yaml
│   └── train/                     # smoke.yaml full.yaml
├── data/
│   ├── prompts/                   # LLM prompt files (committed)
│   ├── synthetic/raw/{name}/      # human-saved LLM outputs (committed)
│   ├── synthetic/clean/           # validated datasets (committed)
│   └── runs/                      # parquet telemetry (gitignored)
├── models/                        # registry artifacts; small champions committed
├── migrations/                    # alembic
├── src/brew/
│   ├── __init__.py  version.py  settings.py  cli.py
│   ├── config/        loader.py  schemas.py          # YAML → pydantic models (§5)
│   ├── domain/        ids.py  money.py  timeutil.py  enums.py
│   ├── events/        schema.py  bus.py  ringbuffer.py  # §9
│   ├── sim/
│   │   ├── engine.py      # heap, clock, scheduling, decision points, fork()
│   │   ├── rng.py         # named RNG streams
│   │   ├── world.py       # World: owns all subsystems + state; step/run APIs
│   │   ├── calendar.py  weather.py
│   │   ├── arrivals.py  customers.py  choice.py  seating.py
│   │   ├── kitchen.py  dispatch.py  batching.py  staff.py  equipment.py
│   │   ├── inventory.py  suppliers.py
│   │   ├── delivery.py  reviews.py  finance.py  disruptions.py  kpis.py
│   │   ├── observation.py # named feature vector for policies/RL (§13.2)
│   │   └── telemetry.py   # parquet writers
│   ├── policies/  base.py  charter.py  strategies.py  A_fcfs.py  B_heuristic.py
│   │              C_solver.py  D_rl.py  E_oracle.py  registry.py
│   ├── forecast/  dataset.py  features.py  baselines.py  lgbm.py  nowcast.py  backtest.py
│   ├── models/    elasticity.py  prep_time.py  rider_eta.py  text_reviews.py  text_notes.py  registry.py
│   ├── opt/       newsvendor.py  pricing.py  capacity_lp.py  scheduler.py
│   ├── rl/        env.py  actions.py  masks.py  reward.py  wrappers.py  bc.py  train_ppo.py
│   │              adversary.py  export_onnx.py  surrogate.py
│   ├── analysis/  bottleneck.py  advisor.py  arena.py  stats.py  explain.py  impact.py
│   ├── synth/     schemas.py  validate.py  loaders.py      # LLM data (§15)
│   ├── db/        models.py  session.py  writer.py  repo.py
│   └── api/       app.py  deps.py  world_manager.py  pacing.py  ws.py  jobs.py
│                  routers/ worlds.py read.py actions.py arena.py models.py meta.py
│                  schemas.py
└── tests/  (mirrors src/brew; plus fixtures/, conftest.py)
```

**Console scripts** (`[project.scripts]`): `brew-api`, `brew-sim`, `brew-train`, `brew-eval`, `brew-synth`, `brew-seed` → all dispatch through `brew.cli` (Typer).

---

## 3. Tooling

```bash
uv python pin 3.12
uv sync                         # creates .venv
uv run pytest                   # default: unit + property + integration (not slow)
uv run pytest -m slow           # training smoke tests
uv run ruff check . && uv run ruff format --check .
uv run mypy src/brew
uv run brew-sim run --scenario weekday_normal --policy A --days 1 --seed 7 --out data/runs/demo
uv run brew-api --reload
uv run brew-train all --config configs/train/smoke.yaml
uv run brew-synth status | validate
```

`pyproject.toml` essentials:
- `[tool.pytest.ini_options]`: `markers = ["slow", "property", "integration"]`, `addopts = "-q -m 'not slow' --timeout=120"`, `asyncio_mode = "auto"`, `testpaths=["tests"]`.
- `[tool.ruff]` line-length 110, target py312, rules `E,F,I,B,UP,SIM,RUF` (ignore `E501` in tests).
- `[tool.mypy]` `python_version="3.12"`, `disallow_untyped_defs=true` for `brew.sim.*`, `brew.events.*`, `brew.api.*`, `brew.policies.*`; `ignore_missing_imports=true`.
- `[tool.coverage.run] source=["src/brew"]`.

---

## 4. Units & conventions

- **Time:** `sim_s: float` seconds since **day-0 00:00 local**. Helpers: `day_of(sim_s)`, `tod_s(sim_s)`, `hhmm(sim_s)`, `iso(sim_s, start_date)`. Day-0 date = `world.start_date` (default `2026-10-03`, a Saturday). Opening 08:00–22:00 → `[d*86400+28800, d*86400+79200)`.
- **Money:** Python `float` rounded to 2 dp at boundaries (orders, ledger). Use `brew.domain.money.round2`. (Decimal is unnecessary for a sim; DB stores `Numeric(12,2)`.)
- **Quantities:** base units `g`, `ml`, `pc` per ingredient.
- **IDs:** `uuid7()` strings for entities; deterministic within a world (generated from the world's `ids` RNG stream so replays match).
- **Logging:** never print in library code.
- **Determinism:** no `random` module, no `time.time()` inside `sim/`; only `world.rng.<stream>`; iterate dicts/sets in sorted/insertion order only.

---

## 5. Configuration & seed data

Loader: `brew.config.loader.load_cafe(path="configs/cafe") -> CafeConfig` (pydantic, frozen). Cross-validation at load: every SKU's recipe references existing ingredients/prep items/stations; every modifier's `applies_to` references SKUs; persona affinities reference SKUs/categories; stations reference equipment types; no orphan ids.

### 5.1 Menu item (`menu.yaml`)
```yaml
- sku: cappuccino
  name: Cappuccino
  cat: coffee                # coffee | notcoffee | bakes | plates
  base_price: 220
  min_price: 190
  max_price: 260
  staple: false
  station: espresso          # primary station (for 86/load logic)
  deliverable: true
  hold_time_s: 300           # max ready→handoff before quality penalty
  quality_half_life_s: 600   # q(t)=2^(-t/half_life) after ready
  temp: hot                  # hot | cold | ambient  (weather fit)
  allergens: [milk]
  veg: true
  vegan: false
  co2e_g: 410
  popularity_prior: 1.0      # α_j intercept scale in MNL
  replate:                   # omit for made-to-order-only items
    eligible: false          # true for croissant, muffin, cheesecake, cinnamon, coldbrew, sandwich, cheesetoast, pasta, avotoast
    premake_hold_s: 0        # safe hold of a pre-made unit (bakes 10 h, coldbrew 24 h, sandwich 3 h, pasta 2 h, toasts 1.5 h)
    min_quality: 0.6
  desc: Double ristretto under velvety microfoam. Poured with a heart.
```

### 5.2 Recipes (`recipes.yaml`) — BOM + steps (task DAG)
```yaml
cappuccino:
  components:                     # ingredient or prep item, qty in base unit
    - {ingredient: coffee_beans, qty: 18}
    - {ingredient: milk, qty: 150}
    - {ingredient: cup_ceramic_m, qty: 1, returnable: true}   # dish pit
  steps:
    - {name: grind,  station: grinder,  duration: [12, 3],  attention: 1.0, batchable: false}
    - {name: shot,   station: espresso, duration: [28, 4],  attention: 0.3, uses_slot: true, depends_on: [grind]}
    - {name: steam,  station: espresso, duration: [35, 6],  attention: 1.0, batchable: true, max_batch: 3, batch_factor: 0.35}
    - {name: pour,   station: espresso, duration: [12, 3],  attention: 1.0, depends_on: [shot, steam]}
    - {name: hand,   station: pass,     duration: [8, 2],   attention: 1.0, depends_on: [pour]}
```
`duration: [mean_s, sd_s]` → lognormal with that mean/sd. `attention ∈ (0,1]`: share of a staff member it occupies. `uses_slot`: occupies an equipment slot (espresso groups, press slots, oven trays, fryer baskets, blender jar). Batch time: `t·(1 + f·(n−1))`.

**Default step timings (mean s)** — keep realistic:
| SKU | Path |
|---|---|
| espresso | grind 12 → shot 28 → hand 8 |
| cappuccino/flatwhite/latte/roselatte | grind 12 → shot 28 ∥ steam 35 (batch ≤3) → pour 12 → hand 8 (rose: +syrup 6) |
| icedlatte | grind → shot 28 → build-on-ice 20 (cold) → hand |
| coldbrew | pour from **prep item** `coldbrew_concentrate` 20 (cold) → hand; if concentrate out → 86 |
| filtercoffee | pour from decoction 25 (bar) → hand |
| chai | pour from **prep item** `chai_base` 40 (bar, kulhad) → hand; base brewed in batches of 2 L, 15 min, hold 3 h |
| matcha | whisk 60 (bar) → steam 35 → pour 12 |
| hotchoc | melt 45 (bar) → steam 35 → pour 12 |
| rosemilk | build 35 (cold) |
| strawberryshake | blend 75 (blender, slot) |
| croissant/cinnamon | pick from display 15 → warm 150 (oven tray, batch ≤6, f 0.1) → plate 10 |
| muffin/cheesecake | pick 15 → plate 12 |
| waffle | batter 20 → iron 240 (griddle slot) → plate 25 |
| avotoast | toast 120 (press slot) ∥ smash 60 (prep) → assemble 45 |
| sandwich | assemble 60 (prep, uses `paneer_marinade`) → press 300 (press slot, batch shares press 4 slots) → cut 20 |
| cheesetoast | assemble 40 → oven 240 (tray batch ≤4) |
| fries | fry 210 (fryer basket, batch ≤2 portions/basket) → season 15 |
| pasta | boil+sauce 480 (stove burner) → plate 30 |

Delivery/takeaway orders add `bag` (pass, 25 s, needs `kraft_bag`) and cups/lids for drinks.

### 5.3 Modifiers (`modifiers.yaml`)
```yaml
- id: oat
  label: oat
  long: oat milk
  price_delta: 40
  applies_to_tags: [milk_drink]
  recipe_delta: [{replace: {from: milk, to: oat_milk}}]
  extra_prep_s: 0
  overlay_icon: oat
  pick_prob: {default: 0.12, student: 0.2, remote_worker: 0.18}
```
Ids: `oat, almond, shot, decaf, lesssugar, iced, hot, large, noonion, nonuts, cheese, jalapeno`. `noonion`/`nonuts` are `negation: true` (rendered crossed out).

### 5.4 Ingredients, prep items, suppliers
Ingredient fields: `key, name, category, base_uom, zone(ambient|chilled|frozen), shelf_life_sealed_h, shelf_life_opened_h, perishability (A-D), co2e_kg_per_kg, is_packaging, par, reorder_point, safety_stock, unit_cost (₹/base unit), initial_qty`.
Prep items: `key, recipe (components + steps), batch_size, lead_time_min, hold_time_min, quality_half_life_min, zone`. Defaults: `coldbrew_concentrate` (batch 4 L, lead 720 min, hold 72 h), `chai_base` (2 L, 15 min, hold 3 h), `croissant_baked` (tray 12, proof+bake 110 min, hold 10 h — displayed in fridge/cabinet), `paneer_marinade` (1.5 kg, 30 min, hold 24 h), `fries_cut` (frozen, no prep — ingredient), `cheesecake_slice`/`muffin`/`cinnamon_roll` are **bought-in finished goods** (bakery supplier, delivered 07:30 and 13:00).
Suppliers: `key, name, items[{ingredient, pack_size, pack_uom, price, moq_packs}], lead_time_h [mean, sd], on_time_rate, fill_rate, delivery_days [0..6], cutoff "HH:MM", is_local, distance_km`. (Will be refined from the LLM `supplier_catalog` dataset.)

### 5.5 Staff, stations, equipment, tables
- `staff.yaml`: `key, name, role, wage_per_h, skills{station: 0..1}, speed (×), error_rate, fatigue_rate, recovery_rate, shift ["HH:MM","HH:MM"], break_min`.
- `equipment.yaml` (types): `key, station, slots, warmup_s, kw_active, kw_idle, mtbf_h, mttr_h, capex, footprint_m2`.
- `stations.yaml`: `key, max_staff, equipment: [type keys]`.
- `tables.yaml`: ids **`T1..T6`** (2-tops) matching the lobby; `combinable: [[T1,T2]]`; plus `bar` stools (4) if catalog adds them. Cleaning time 90 s (runner).
- `catalog.yaml` (investments): `table_2top`, `espresso_2nd`, `press_2nd`, `fridge_bigger`, `barista_morning`, `dishwasher_upgrade`, `oatmilk_standing`, `marketing_push`, `bar_stools` with `capex, opex_per_day, lead_time_h, effect`.

### 5.6 Personas (`personas.yaml`)
```yaml
commuter:
  name: Commuter
  icon: briefcase
  arrivals:                       # expected parties per 15-min slot, by day-type, before multipliers
    weekday: {"08:00": 2.2, "08:30": 3.4, "09:00": 3.0, "09:30": 1.6, "17:30": 1.2, "18:00": 1.4, "18:30": 0.9}
    weekend: {"09:00": 0.6, "10:00": 0.5}
  party_size: {1: 0.95, 2: 0.05}
  channels: {takeaway: 0.7, dine_in: 0.3}
  price_beta: -1.2               # log-price elasticity in MNL utility
  patience_s: [240, 80]          # lognormal mean, sd (offline, queue+wait)
  dwell_min: [8, 4]
  laptop_prob: 0.0
  basket: {drinks: [1, 0.0], food_prob: 0.35}
  affinity: {cappuccino: 1.2, flatwhite: 1.0, espresso: 0.8, coldbrew: 0.7, croissant: 0.9, filtercoffee: 0.6}
  review_prob: 0.04
  negativity_bias: 1.3
  weather: {rain: {dine_in: 0.8}, hot: {cold_items: 1.3}}
```
Slot interpolation: arrival rate per persona is piecewise-linear between listed times, zero outside listed range ± 30 min. Tune all personas so a **weekday ≈ 300–380 orders** (≈ 120–160 delivery on rainy evenings) and **weekend ≈ 350–450**.

---

## 6. Simulation engine

### 6.1 Core
```python
@dataclass(slots=True, order=True)
class Ev:
    t: float          # sim_s
    prio: int         # lower first at equal t (see PRIO table)
    seq: int          # insertion counter, tie-breaker
    kind: str = field(compare=False)
    payload: Any = field(compare=False)
```
- `Engine.schedule(t, kind, payload, prio)`, `Engine.cancel(handle)` (lazy: mark dead), `Engine.run_until(t_end)`, `Engine.step()` (pop one).
- Handlers: `World.dispatch(ev)` → method table `self._h[kind](payload)`.
- **PRIO:** `0` clock/day boundaries, `1` disruptions, `2` completions (task_done, rider_arrive), `3` arrivals, `4` patience/timeout, `5` decision points (manager tick, dispatch), `9` telemetry.
- **Decision points** (the policy is called synchronously): `MANAGER_TICK` every 900 s from opening (56 per day), `ORDER_ARRIVED` (aggregator acceptance + manual-strategy hooks), `DISPATCH` (whenever a staff member/slot frees or a task becomes ready — batched: at most one dispatch pass per sim timestamp), `DAY_START`, `DAY_END`.
- **Headless:** `world.run(days=1)` loops events until end. **Live:** `world.advance_to(t)` processes events with `ev.t ≤ t` (used by the pacer).
- **Fork:** `world.fork() -> World` = `copy.deepcopy(world)` with a fresh event-sink and `world_id`; RNG streams deep-copied so the child continues the identical stream unless `reseed=True`. Must not hold references to sockets/files/DB sessions (keep sinks outside, attach after fork).

### 6.2 RNG streams (`sim/rng.py`)
`RngStreams(seed)` spawns via `np.random.SeedSequence(seed).spawn(n)` named, fixed-order streams: `arrivals, customers, choice, modifiers, notes, durations, errors, failures, riders, reviews, weather, inventory, ids, adversary, policy`. **CRN rule:** draws that define *who the customers are* (arrival times, persona, party size, latent patience quantile, utility noise seed, dwell quantile, note) are pre-sampled per day at `DAY_START` from `arrivals`/`customers`/`notes` streams so they are identical regardless of policy. Policy-dependent consumption happens only in later streams.

### 6.3 World state (in memory)
`World` holds: config, clock, `rng`, `engine`, `menu_state` (live prices, featured, hidden + reasons, cooldowns), `customers: dict[id, Customer]`, `parties`, `orders: dict[order_no, Order]`, `tasks`, `batches`, `stations`, `equipment`, `staff`, `tables`, `inventory` (ingredients → lots), `prep_items`, `shelf`, `riders`, `ledger`, `reputation`, `weather`, `calendar`, `disruptions`, `kpis`, `strategy`, `policy`, `event_sink`, `seq`.
Use `@dataclass(slots=True)` for all hot objects. Keep collections small (purge finished orders to a compact archive after day end; telemetry already captured).

---

## 7. Subsystems (algorithms & defaults)

### 7.1 Weather & calendar
- Hourly Markov chain over `sunny, partly, cloudy, drizzle, rain` with transition matrix in `scenarios/*.yaml` (default monsoon-ish October). Temperature `T(h) = 26 + 6·sin(π(h−8)/12) + Δ_weather`, Δ = `{sunny:+1, partly:0, cloudy:−1, drizzle:−3, rain:−5}`. Rain intensity mm/h for drizzle 0.8, rain 6.
- Emit `weather.changed` on state change. Weather multipliers: rain → dine-in arrivals ×0.75, delivery ×1.5, rider ETA ×1.3; hot (T ≥ 31) → cold items utility +0.4; cold/rain → hot drinks +0.3.
- Calendar: load `data/synthetic/clean/calendar_bengaluru.jsonl` if present, else `configs/cafe/calendar_fallback.yaml` (a dozen hand-written events). Event schema in §15. Applies `persona × channel × category` multipliers between `start`/`end`.

### 7.2 Arrivals (`arrivals.py`)
NHPP per persona via **thinning with CRN**:
1. At `DAY_START`, for each persona p: `λ_max = max_slot_rate × 2.5`, sample candidate times on [open, close) as a Poisson process with rate `λ_max/900` per second; draw `u ~ U(0,1)` per candidate. Store candidates + all latent draws (persona, channel (from mix), party size, patience quantile, dwell quantile, utility-noise seed, note draw, name draw, appearance seeds).
2. At candidate time t, accept iff `u < λ_p(t)/λ_max`, where `λ_p(t) = slot_rate(t) × dow × weather × calendar × reputation_mult(channel) × price_index_mult × trend × day_noise` (`day_noise ~ lognormal(0, 0.1)` drawn at day start).
3. `reputation_mult = clip((rating/4.3)^2.0, 0.6, 1.25)`; `price_index_mult = (price_index)^(-0.6)` where price_index is the avg live/base price ratio of the persona's affinity items.
- Delivery personas generate **aggregator orders** directly (no party in venue).
- **Groups:** `office_bulk` = one order of 8–20 items, takeaway/delivery.

### 7.3 Customers in venue
States: `arriving → queueing → ordering → waiting → seated → eating → lingering → paying → left` (+ `balked`, `reneged`). Mirrors the lobby state machine.
- **Balking** on arrival: `P(balk) = sigmoid(a_p·(queue_len − q0_p) + b·(no_free_table & dine_in))`, defaults `a=0.6, q0` per persona (commuter 3, others 5).
- **Ordering:** at the register (cashier station, 25–45 s, lognormal). Builds basket via choice (§7.4). Takeaway pays now; dine-in pays at the end (table service, matches lobby); delivery prepaid.
- **Patience:** offline personas draw `patience_s` (lognormal) at arrival from the pre-drawn quantile; clock runs while queueing (×0.6 rate) and waiting for food (×1.0). Expiry → `renege` with `P=0.55` else **stay unhappy** and post a bad review (lobby behaviour). Emit threshold events at 60/30/10 %.
- **Seating:** dine-in parties claim a table after receiving their order (lobby flow): parties of 1–2 → any free 2-top (prefer non-combinable); 3–4 → merge `T1+T2` if both free (emit `merged: true`), else wait up to 3 min then convert to takeaway (`order.channel` stays dine-in; flag `no_table`); singles may share a half-free table if no free table.
- **Dwell:** eating `max(prep-dependent 10–25 min)`, lingering by persona (`remote_worker` 90–150 min with refill probability 0.35 per 45 min → new order event).
- **Pay & leave:** `paying` 40 s → receipt → `left`. Table becomes dirty → runner cleans (90 s) → free.

### 7.4 Choice model (`choice.py`)
Multinomial logit over **visible** (not hidden/86'd, in stock) items, per "slot" in the basket (drink slot, food slot):
```
U_j = ln(popularity_prior_j) + aff_{p,j} + β_p · ln(price_j / ref_price_j) + γ·featured_j
      + δ·weather_fit_j + η·calendar_j − λ_loss·max(0, ln(price_j/ref_j)) + ε_j
outside option U_0 = κ_p (calibrated so ~5% of arrivals leave on seeing menu prices at base)
```
`ε` Gumbel from the customer's pre-drawn noise seed (CRN). Defaults: `γ=0.35`, `λ_loss=1.0` (loss aversion makes surge pricing hurt), `ref_price` = 7-day EMA of the live price (fairness memory), starting at base. Food slot taken with persona `food_prob`. Party size n → n drink slots (+ shared food per 2 people). Modifiers sampled per item from `pick_prob` (CRN stream `modifiers`), max 2 per item; incompatible pairs excluded (`decaf`+`shot`). Notes: with prob 0.12 attach a note from the notes corpus (CRN `notes` stream); parsed flags may add modifiers (`nonuts`).

### 7.5 Kitchen (`kitchen.py`, `dispatch.py`, `batching.py`)
- Each order item expands into **tasks** from its recipe steps (+ modifier `extra_prep_s`, + bagging for delivery/takeaway). Task readiness = all `depends_on` done. Item ready = last step done; order ready = all items ready → `order.ready`.
- Resources: **station** (max staff), **equipment slot** (if `uses_slot`), **staff** with skill ≥ 0.3 for the station and available attention.
- **Dispatch pass** (decision point): gather ready tasks; ask the policy for an ordering via `policy.dispatch(view) -> list[TaskChoice]` where a choice may be a single task or a batch of compatible tasks (same step name & station, `batchable`, size ≤ `max_batch`), plus an optional **hold** (wait up to `batch_window_s` for more compatible tasks). Assign greedily in the returned order while resources allow.
- **Duration:** `lognormal(mean, sd) × staff.speed⁻¹ × (1 + 0.25·fatigue) × learning(exp_days) × batch_factor`.
- **Fatigue:** +`fatigue_rate`·attention per busy minute, −`recovery_rate` per idle/break minute, clipped [0,1]. Breaks enforced from shift config.
- **Errors:** `P(error) = staff.error_rate × (1 + 2·max(0, load−0.85))` → remake (re-queue item tasks, consume inventory again, `remake_count++`).
- **Quality:** after an item is ready `q(t) = 2^(−t/half_life)`; captured at handoff.
- **Dish pit:** ceramic cups/plates are a finite pool (`cup_ceramic_m` 40, `plate` 30); dine-in returns them dirty at table bus; dishwasher task returns them clean (racks of 20, 120 s). If none clean → serving task waits (dish pit can bottleneck).
- **Auto-serve:** ready dine-in/takeaway orders are handed over by the runner after `auto_serve_delay_s = 20` sim s unless the player `serve_order`s first (then 0). Delivery: bagged → shelf.
- **Load %** (for UI/menu chips): `load = min(100, 100·(busy_slot_weighted_util over last 10 min) + 6·queued_tasks/stations)`.

### 7.6 Inventory (`inventory.py`, `suppliers.py`)
- Lots: `{lot_id, key, qty_initial, qty_remaining, unit_cost, received_s, opened_s|None, expires_s, quality, status}`. Opening recalculates expiry `min(expires, opened + shelf_life_opened)`.
- **Consume** FEFO across lots; if insufficient → item unavailable: auto-86 any SKU whose recipe can't be satisfied for 1 unit (`menu.hidden` reason `Sold out for now`), restore when restocked (`menu.restored`).
- Expiry check at each `MANAGER_TICK` and `DAY_END`: expired lots → `waste_expiry` movement + `lot.expired`.
- **Prep batches:** `start_prep(prep_key, qty)` creates tasks; on completion creates a lot of the prep item with hold expiry.
- **Suppliers & POs:** `place_po` → delivery at `now + lead_time` (respect delivery days/cutoff; fill-rate & on-time draws from `inventory` stream) → `po.received` lots. Policies decide POs at `DAY_END` (A: fixed weekly order on day 0/3; B: (s,S); C/D: newsvendor).
- **Donation:** at `DAY_END` sealed bakery finished goods with < 24 h shelf life left → `donate` movement (impact metric).
- **Invariant:** for every key, `initial + Σreceive − Σconsume − Σwaste − Σdonate = on_hand` (± 1e-6).

### 7.7 Delivery (`delivery.py`)
- Aggregator order arrives (from `delivery_home` / `office_bulk` personas or calendar spikes) with `acceptance_timeout_s = 90`. Policy `accept(order_view) → Accept(promise_s)|Reject|Delay`. Throttle level `plus5/plus10` adds to promise; `pause` auto-rejects (and costs platform ranking: delivery arrival multiplier ×0.97 per pause hour, recovering 1 %/h).
- Promise default `= est_prep_time(order) + queue_ahead_work/stations + 300`.
- **Rider:** dispatched by the platform at `promise − ETA` (ETA ~ lognormal(mean 9 min, sd 3), ×1.3 rain, ×1.2 peak 12–14 & 19–22, × rider_shortage); arrival time recorded. Rider waits at shelf if order not ready (rider_wait_s accrues); otherwise picks up on arrival.
- **Shelf:** 6 slots; if full, bagging waits. Quality decays on shelf; tag shows ETA & quality (lobby).
- Platform score per aggregator updates from `rider_wait_s` and lateness → `reputation_mult` for that channel.

### 7.8 Reviews & reputation (`reviews.py`)
- Satisfaction `S ∈ [0,1]`: `S = 0.35·(1 − min(1, lateness/patience)) + 0.25·quality + 0.2·value_for_money + 0.1·accuracy + 0.1·ambience − 0.15·unfairness`, where `value_for_money = clip(1 − (paid/ref_total − 1)·2, 0, 1)`, `unfairness = max(0, ln(price/ref))` averaged, `ambience` from occupancy & table wait.
- Review probability `= review_prob_p × (1 + 3·|S − 0.6|) × channel_factor` (aggregators ×1.5).
- Stars: `1 + round(4·S + noise(0, 0.35))` clipped 1–5, with `negativity_bias` shifting S down by `0.1·(bias−1)` for lateness-dominated cases.
- **Causes** vector = normalised deficits per component (wait, cold_food (quality on delivery), price, quality, ambience, staff (errors), accuracy, packaging, value).
- Text: sample from `reviews` corpus filtered by `(stars, top cause, channel group)` with nearest match, then name-free. Fallback templates if corpus missing.
- Reputation per channel group (`offline`, `zomato`, `swiggy`): Bayesian average with prior mean 4.3, prior weight 50 reviews. HUD rating = weighted overall.
- **Loyalty:** `regular` persona customers carry `satisfaction_ema`; churn after 2 visits with S < 0.4 (reduces that persona's base rate by 1 % each, floor 70 %).

### 7.9 Finance (`finance.py`)
Ledger entries with accounts: `revenue, discount, gst_collected (liability, excluded from profit), cogs, commission, payment_fee, packaging, labour, energy, waste, rent, maintenance, capex, depreciation, refund, donation_writeoff`. Labour accrues per staffed minute; energy from equipment kW active/idle × ₹9/kWh; rent ₹6,000/day; maintenance per equipment/day. **Profit today = revenue − discount − cogs − commission − payment_fee − packaging − labour − energy − waste − rent_share − maintenance − depreciation.** Receipts: GST 5% computed on subtotal after discount, split CGST/SGST 2.5 % each, `round_off` to nearest rupee (same shape the lobby printer already renders).
**Invariant:** `Σ ledger(day) == daily_kpi.net_profit` (excluding liabilities/capex correctly).

### 7.10 Disruptions (`disruptions.py`)
Each disruption = `{kind, target, severity, start_s, end_s, source}` scheduled as events. Effects: `staff_absent` (staff unavailable for shift), `staff_late` (shift start + delay), `equipment_down` (slots unavailable; MTTR draw), `supplier_delay` (+h to POs), `supplier_short` (fill rate × severity), `rider_shortage` (ETA × (1+severity)), `power_cut` (all electric equipment down, card payments fail → cash only), `demand_spike` (arrival multiplier for persona/channel), `price_shock` (ingredient unit_cost × (1+severity)), `platform_outage` (aggregator orders stop). Random failures from MTBF (`failures` stream). Emit `chaos.triggered/resolved`, `equipment.down/up`, `staff.*`.

### 7.11 Replate (`sim/replate.py`, config `replate.yaml`)
- **Pre-make:** `premake(sku, units)` schedules the recipe's tasks with `order_no=None`; on completion creates a finished-goods lot `{lot_id, sku, units, made_s, use_by_s = made_s + premake_hold_s, quality}`. Normal orders for that SKU consume pre-made units first (FEFO, skipping the kitchen) — this is what makes pre-making faster at peak.
- **Listing tick** (every `MANAGER_TICK` and on lot creation): for each pre-made lot with `frac_left = (use_by − now)/premake_hold_s`, compute the target discount from the active ladder; if higher than the current one → `replate.marked_down` (first time → `replate.listed`). Ladders (`replate.yaml`): `gentle {0.5:20, 0.25:35, last45m:50}`, `standard {0.5:30, 0.25:50, last45m:70}`, `aggressive {0.75:25, 0.5:45, 0.25:65, last45m:80}`. `price = max(floor, round_to_5(base × (1 − d)))`, `floor = 0.5 × unit_cost`. A listed unit is sold at the listing price only when the customer chose the replate alternative; full-price orders still draw pre-made stock at full price (listing units decrement either way).
- **Prep-backed listings** (`replate.yaml: prep_backed: {prep_or_ingredient_key: sku}`): at each listing tick, for every lot of a mapped key with `frac_left ≤ 0.5` (or < 3 h to expiry for raw perishables) compute `units = floor(lot.qty / per_unit_usage(sku, key))`, minus what the forecast says will be consumed at full price before use-by (surplus only). List `replate:{sku}` backed by that lot; a replate sale consumes the backing lot first (FEFO override) and the rest of the recipe normally. Staples (`chai`) may be listed — discount only. Same ladder/floor/monotonicity rules; units cap = surplus.
- **Choice integration (§7.4):** each listing is an extra alternative `j' = replate:{sku}` with `U_j' = U_j(price=listing price) + ρ_p − φ·(1 − quality)` where `ρ_p` = persona `replate_affinity` (default: student +0.3, delivery_home +0.1, commuter 0, regular 0, remote_worker 0, office_bulk −0.2, family −0.1, leisurely −0.3, tourist −0.4) and `φ = 1.2`. Delivery channels may order replate only if `deliverable`. Same CRN Gumbel draws as the parent SKU (+ one extra draw from stream `replate`) so on/off comparisons stay paired.
- **Impulse add-on** (after the basket is chosen, CRN stream `replate`): `P(add) = addon_base · (d / 0.3)^addon_elasticity` capped at `addon_max`, one unit of the deepest-discount listed rescue item the customer's persona/channel allows (affinity-weighted). Rescue units are excluded from `DemandLog` full-price counts so forecasts don't learn from clearance demand.
- **Retire:** at `use_by` → `replate.retired` with `donated` (sealed bakery) or `wasted` (inventory movements `donate` / `waste_replate`), or `sold_out`.
- **Policies:** `PolicyDecision.premake: dict[sku,int]` (at manager ticks) and `replate_mode`. A: no premake, mode off. B: premake P50 forecast of bakes at open, `standard`. C: premake `q* = F⁻¹(c_u/(c_u+c_o'))` where `c_o'` = expected loss **after** replate recovery (`unit_cost − E[replate revenue]`, estimated from the sell-through model below) → pre-makes more when replate recovers value; markdown chosen per lot by maximising `E[rev] − waste_cost` over ladder options using a logistic sell-through model on telemetry (`replate_sellthrough` LightGBM classifier: features frac_left, discount, hour, weather, footfall nowcast, competing listings). E: perfect info.
- **KPIs:** `replate_units_sold`, `replate_revenue`, `replate_waste_avoided_kg`, `replate_co2e_avoided_kg`, `replate_cannibalised_rev` (computed in `analysis/impact.py` by a CRN fork with `replate_mode=off` from day start).
- **Invariant:** for each pre-made lot `units = sold_full + sold_replate + donated + wasted + remaining`.

### 7.12 KPIs (`kpis.py`)
Rolling (5-min `kpi.tick`) and daily: revenue, net profit, orders by channel, avg/P95 wait by channel, SLA breach rate, balks, reneges, rating, reviews_neg, table turns, labour hours, revenue/labour hour, food cost %, waste kg & ₹, donated kg, energy kWh, CO₂e kg, staff overload minutes (util > 95 % sustained 10+ min), price changes, batch rate.

---

## 8. Policies

### 8.1 Interface (`policies/base.py`)
```python
class Policy(Protocol):
    code: str                                   # "A".."E"
    def reset(self, world: "WorldView", seed: int) -> None: ...
    def on_manager_tick(self, obs: Observation, view: WorldView) -> ManagerAction: ...
    def accept(self, order: OrderView, view: WorldView) -> AcceptDecision: ...
    def dispatch(self, ready: list[TaskView], view: WorldView) -> list[TaskChoice]: ...
    def on_day_end(self, view: WorldView) -> DayEndAction: ...          # POs, roster tweaks
    def explain(self, decision_id: str) -> Explanation | None: ...
```
- `WorldView` is a **read-only facade** (no mutation possible) built cheaply each call.
- `ManagerAction` (dataclass) — **the same representation the RL agent outputs** (§13.3): price steps per category, κ per prep class, strategy, throttles, batch window, featured SKU, 86 toggles, plus optional explicit `prep_now: dict[prep_key, qty]`. `World.apply_manager_action()` passes it through the **charter shield** (§8.3) which masks/clips invalid parts and records what was clipped.
- Every applied non-trivial action → `policy_decision` record + `decision.made` event with `top_factors` (§14.4).

### 8.2 Strategies (`strategies.py`)
Strategy = dispatch priority weights: `priority = w_late·slack⁻ + w_age·age + w_channel[channel] + w_persona[persona] + w_batch·batchable_peers + w_bump·bumped`. Six presets: `fcfs` (age only), `edf` (slack), `dine_first`, `delivery_jit` (cook delivery so ready ≈ rider ETA), `batch_max`, `throughput` (shortest processing time). **Manual strategies** from the HUD map onto these + menu tweaks: `balanced → edf`, `delivery_first → delivery_jit + aggregator weight +`, `rush_menu → throughput + hide slow plates (pasta, sandwich, avotoast) + prep 15% faster? (no — speed is physical; instead hide items)`, `happy_hour → drinks −15 % (charter allows as a promotion; promotions may exceed the 10 % step but not min_price)`.

### 8.3 Charter shield (`charter.py`)
Enforced for every price change from any source: new price on the ₹5 grid, `min ≤ p ≤ max`, `|p − p_prev| ≤ 0.10·base` unless `promotion=True` (decreases only), cooldown 7,200 s per SKU, staples never increase, no change to placed orders (prices snapshot on `order_item`). Feature: ≤ 2 featured at once. 86: never hide an item that is in an open order's *unstarted* tasks unless out of stock.

### 8.4 Implementations
- **A FCFS:** accept all, dispatch by age, no prep except mandatory minimum (chai base & cold brew made when out → long waits), static prices, fixed weekly PO.
- **B Heuristic:** pause aggregators if open aggregator orders > 8, resume < 4; dispatch dine-in first then age, hold ≤ 60 s to batch same step; morning prep to P50 of a moving-average estimate; happy hour 15:00–17:00 −10 % drinks; (s,S) purchasing.
- **C Solver:** acceptance feasibility (simulate projected completion with current queue via a fast list-schedule; accept if all existing promises remain within +2 min slack); dispatch from a **rolling plan**: at each manager tick and whenever the ready set changes by ≥ 5 tasks, solve CP-SAT (§12.4) over the next ≤ 40 tasks with **20 ms** limit (configurable), else greedy EDF with batching; pre-prep newsvendor on forecast quantile `q* = c_u/(c_u+c_o)`; hourly pricing via ladder search with elasticity (§12.2); newsvendor POs.
- **D RL:** ONNX manager policy → `ManagerAction` (masked argmax per dimension), dispatch delegated to C's scheduler with the strategy's weights and the chosen batch window; acceptance = C feasibility + RL throttle.
- **E Oracle:** constructed with the day's pre-sampled arrival list (CRN) → knows exact future demand per slot; uses C with `forecast=truth`, CP-SAT limit 200 ms, pricing with true demand. Upper bound only; never used live.

All policies are pure w.r.t. RNG except via `world.rng.policy`.

---

## 9. Events (`events/`)

- `schema.py`: one Pydantic model per event type (`model_config = ConfigDict(frozen=True, extra="forbid")`) and a discriminated union `Event = Annotated[Union[...], Field(discriminator="type")]`. Field names are **snake_case**, money floats, times `sim_s` floats (+ ISO `t` added by the envelope).
- Envelope: `{"seq": int, "sim_s": float, "t": str, "type": str, "data": {...}}`. `seq` strictly increasing per world from 1.
- `bus.py`: `EventSink` protocol with `emit(ev)`; implementations: `ListSink` (tests), `RingBufferSink(maxlen=10_000)`, `ParquetSink` (buffered, flush on day end), `FanoutSink`.
- **Emission throttles** (keep the stream lean): `order.progress` only at state change or every 5 % progress; `customer.patience` at 60/30/10 %; `clock.tick` per sim minute; `kpi.tick` every 5 sim minutes; `rail.reordered` only when the order/batches actually change (compare tuple).
- Serialisation: `orjson.dumps(envelope)`; WS frames aggregate events produced during a wall-clock 75 ms window.
- `GET /api/v1/events/schema` returns JSON Schema of the union (frontend codegen later).

Full list & payloads: `backend.md §6.3`. Add `appearance_seeds: list[int]` (one per party member) to `customer.arrived` — derive from `customers` RNG stream so the 3D doll is stable across replays.

---

## 10. API implementation

### 10.1 App
`brew.api.app:create_app(settings) -> FastAPI`; routers under `/api/v1`. CORS allow `http://localhost:*`. Exception handlers → `{"error": {"code", "message", "details"}}` with 400/404/409/422. Settings via `BREW_` env vars (`BREW_DATABASE_URL`, `BREW_CONFIG_DIR`, `BREW_MODELS_DIR`, `BREW_RUNS_DIR`, `BREW_LIVE_BASE_RATE=20`).

### 10.2 WorldManager (`world_manager.py`)
Holds `dict[world_id, ManagedWorld]`. `ManagedWorld` = `World` + `Pacer` + `RingBufferSink` + subscriber queues + action queue + lock. Creation builds the world from config + scenario + policy + seed.

### 10.3 Pacing (`pacing.py`)
One asyncio task per live world. **The café runs live; there are no playback speeds.** Every **50 ms** wall: `target = anchor_sim + (wall − anchor_wall) × live_rate` (`BREW_LIVE_RATE`, default **1.0 = real time**; a larger value is a dev-only override). `clock="wall"` worlds start on **today's date** (`BREW_LIVE_TZ`, default Asia/Kolkata), fast-forward to the current local time on create/play and stay locked to the wall clock (they catch up after a lag). `clock="open"` worlds start at opening and skip the closed night. Process events up to `target` **in a worker thread** via `asyncio.to_thread` with a max of 30 ms CPU per tick (if it can't keep up, `lagging: true`). Controls: play / pause / step; `step` advances `step_s` synchronously (tests and debugging — **tests never sleep on wall time**).
Player actions are queued and applied at the start of the next tick, stamped with the current `sim_s`, and logged as events (`action.applied`) — replays reproduce them.

### 10.4 WebSocket (`ws.py`)
On connect: validate world, send `{"hello": {...world, last_seq}}`, then replay from `since_seq` if still in the ring buffer (else send `{"resync": true}` → client fetches `/state`). Each subscriber has an `asyncio.Queue(maxsize=200 frames)`; slow consumers get dropped frames replaced by a `resync` marker. Heartbeat every 15 s.

### 10.5 Jobs (`jobs.py`)
Arena runs, advisor counterfactuals and training-free evaluations run in a `ProcessPoolExecutor(max_workers=os.cpu_count()-1)`; job registry in memory + DB; `GET` polls progress.

### 10.6 Persistence (`db/`)
SQLAlchemy 2.0 typed models for: `cafe, scenario, world, channel, menu_item, price_history, menu_intervention, order, order_item, review, policy, policy_decision, disruption, daily_kpi, investment, model_registry, evaluation, counterfactual, training_run, sim_event` (sim_event only for `live`/`demo`). Column types: `String(36)` ids, `JSON`, `Numeric(12,2)`, `Float`, `DateTime(timezone=True)`. `writer.py`: an `EventSink` that buffers and bulk-inserts every 1 s / 500 events via `aiosqlite`/asyncpg-compatible session. Migrations via Alembic (`uv run alembic upgrade head`); tests use a temp SQLite file with `Base.metadata.create_all`.

---

## 11. Telemetry (Parquet)

`data/runs/{world_id}/`: `events.parquet` (seq, sim_s, type, data JSON string), `orders.parquet` (one row per order item: sku, channel, persona, price, base, mods, placed/ready/handoff s, wait, quality, cogs), `demand_15m.parquet` (day, slot, sku, channel, qty, price, base, featured, hidden, weather, temp, calendar flags, rating), `tasks.parquet` (step, station, staff, batch size, load, fatigue, duration), `deliveries.parquet` (eta_pred, eta_actual, rain, hour, platform), `kpis.parquet` (daily), `decisions.parquet`, `trajectories/` (RL). Written with pyarrow, zstd. Schema versions in a `_meta.json`.

---

## 12. ML & optimisation

### 12.1 Forecasting (`forecast/`)
- **Dataset:** from `demand_15m.parquet`; target `qty` per (sku, channel_group ∈ {offline, delivery}) per 15-min slot within opening hours.
- **Features:** `sku` (categorical), `cat`, `channel_group`, `slot_idx`, `dow`, `is_weekend`, `weather_state` (cat), `temp_c`, `rain_mm_h`, calendar flags (holiday, festival, cricket, exam, payday), `price_ratio` (= price/base), `featured`, `hidden`, lags: `same_slot_lag_1d`, `same_slot_lag_7d`, `rolling_7d_mean_same_slot`, `today_so_far_ratio` (nowcast), `rating`.
- **Model:** three LightGBM regressors `objective="quantile", alpha∈{0.1,0.5,0.9}`, `num_leaves=31, learning_rate=0.05, n_estimators=600 (full) / 120 (smoke), min_data_in_leaf=20, feature_fraction=0.9`, early stopping on last 10 % time-split. Enforce monotone quantiles post-hoc (sort).
- **Baselines:** seasonal naive (same slot last week, fallback yesterday), moving average.
- **Backtest:** rolling origin, 3 folds; metrics WAPE (P50), pinball per quantile, P10–P90 coverage, bias. Save `metrics.json`.
- **Nowcast:** Gamma–Poisson: prior `Gamma(a=20, b=20)` on today's level multiplier; update with realised vs forecast counts each tick.
- Inference API: `Forecaster.predict(view, horizon_slots=16) -> DataFrame[sku, channel_group, slot, p10, p50, p90]`.

### 12.2 Elasticity & pricing
- **Elasticity:** per SKU Poisson regression `log E[q] = a_sku,slot-features + β_sku · ln(price_ratio)` fitted with sklearn `PoissonRegressor(alpha)` on one-hot + log price ratio interactions; **shrink** β toward the category mean: `β̂ = (n·β_sku + k·β_cat)/(n + k)`, `k=200` obs. Output `elasticity.json {sku: beta, se}`.
- **Pricing (C, hourly):** for each category choose a step ∈ {−10,−5,0,+5,+10 %} maximising Σ_items (p − c)·q̂(p) − capacity_penalty, where `q̂(p)=q̂_p50 · (p/p0)^β` and capacity_penalty uses station load forecasts (if forecast load > 90 % at a station, penalise demand that adds to it). 5⁴ = 625 combos → brute force (fast). Apply charter.

### 12.3 Newsvendor & purchasing
`q* = F⁻¹(c_u/(c_u+c_o))` using the forecast's quantiles (interpolate P10/P50/P90 with a fitted log-normal). Prep classes: costs from config (`c_u` = expected lost margin + wait penalty, `c_o` = unit cost + waste CO₂e shadow ₹). Perishable PO: cover demand until next delivery + safety at P90, minus usable on-hand (excluding lots expiring before use).

### 12.4 Scheduler (`opt/scheduler.py`)
CP-SAT model over the next N ≤ 40 ready/near-ready tasks: interval vars per task on its station's staff (cumulative with attention ×100) and equipment slots (cumulative), precedence within items, optional batching (boolean "merge with predecessor of same step"), objective `Σ w_i·max(0, end_i − due_i) + μ·Σ (quality loss proxy for early-ready delivery items) − ν·Σ batch merges`. Time limit 20 ms (C), 200 ms (E); `num_workers=1` (determinism); `random_seed` from `rng.policy`. Return a priority order + batch groups; the dispatcher executes greedily. If no solution in time → greedy EDF fallback. Unit tests on tiny instances compare against brute force.

### 12.5 Capacity LP & shadow prices (`opt/capacity_lp.py`)
Fluid LP over next 4 h: variables `x_j` (units of SKU j served), maximise Σ (p_j − c_j)·x_j s.t. Σ_j t_{j,r}·x_j ≤ cap_r for each resource r (station-minutes, slot-minutes, staff-minutes by role, seat-minutes, clean cups), x_j ≤ D_j(P90), inventory constraints. Solve with OR-Tools GLOP; read duals → **shadow price per resource** (₹/minute). Tests: a 2-resource toy where the binding constraint's dual is analytically known.

### 12.6 Prep-time & rider ETA models
LightGBM quantile on `tasks.parquet` / `deliveries.parquet` with features listed in §11. Used for promise times (C/D) and `delivery_jit`.

### 12.7 Text models
- **Review cause tagger:** `TfidfVectorizer(ngram_range=(1,2), min_df=2, sublinear_tf=True)` + `OneVsRestClassifier(LogisticRegression(C=4, max_iter=2000))` over causes with weight ≥ 0.3 as positive labels; threshold 0.35. Metrics: per-label F1, macro-F1. Artifact: joblib pipeline + `labels.json`.
- **Note parser:** regex rules for high-precision intents (allergy keywords, "no onion", "extra hot", "less sugar", "oat") + TF-IDF/LR multi-label for intents; maps to modifier ids. Metrics macro-F1.
- Both must train on `tests/fixtures/synthetic/*.jsonl` (≈ 60 rows each) for tests, and on `data/synthetic/clean/*.jsonl` when present.

---

## 13. Reinforcement learning

### 13.1 Environment (`rl/env.py`)
`BrewManagerEnv(gymnasium.Env)`: one step = one **manager tick (900 sim-s)**. `reset(seed, options={scenario, days, domain_randomisation})` builds a World with policy D's executor (C scheduler parametrised by the action) and runs to the first tick. `step(action)` → apply `ManagerAction` (via shield) → `world.run_until(next_tick)` (all event-level decisions inside are handled by C-executor using the current strategy/batch window/throttles) → return `obs, reward, terminated (episode days done), truncated, info{kpis, masks, clipped}`. `action_masks()` for MaskablePPO. Must pass `gymnasium.utils.env_checker.check_env`.

### 13.2 Observation (`sim/observation.py`) — 183 floats, named
`ObservationBuilder.names: list[str]` (used by explanations and tests). Groups (sizes): time 11 (sin/cos tod, dow one-hot 7, day_frac_of_episode, is_weekend) · weather 6 (one-hot 5, temp_norm) · calendar 4 · demand 52 (P50 next 4 slots × 4 categories × 3 channel groups {dine/take, zomato, swiggy} = 48, + P90−P10 spread per category 4) · nowcast 1 · queues 11 (open orders per channel 4, slack histogram 5, low-patience waiting count, register queue) · resources 45 (13 station utilisations, 13 station queue lengths, 13 equipment-down flags, staff present, fatigue mean, fatigue max, tables free/occupied/dirty) · inventory 16 (days of cover for 10 key ingredients, expiring-<4h value, 5 prep-item stock levels) · economics 10 (price index per category 4, profit today, cash, reputation offline/zomato/swiggy, price changes last 2 h) · disruptions 10 (one flag per kind) · current controls 13 (κ per prep class 4, strategy one-hot 6, throttle levels 2, batch window) · **replate 4** (listed units, ₹ value expiring < 2 h, sell-through today, current mode index). All scaled to roughly [−1, 1] by fixed scalers in config + `VecNormalize` during training (stats saved with the model).

### 13.3 Action space (`rl/actions.py`) — `MultiDiscrete([5,5,5,5, 5,5,5,5, 6, 4,4, 4, 24, 2,2,2, 4, 4])`
| Dims | Meaning |
|---|---|
| 0–3 | price step per category {−10,−5,0,+5,+10 %} relative to current price (coffee, notcoffee, bakes, plates); staples excluded |
| 4–7 | κ per prep class {off, P50, P65, P80, P90} for `coldbrew_concentrate, chai_base, croissant_baked, paneer_marinade` |
| 8 | strategy {fcfs, edf, dine_first, delivery_jit, batch_max, throughput} |
| 9–10 | throttle zomato, swiggy {open, plus5, plus10, pause} |
| 11 | batch window {0, 30, 60, 120 s} |
| 12 | featured SKU {none} ∪ 23 SKUs |
| 13–15 | 86 toggles for {pasta, sandwich, avotoast} (0 = show, 1 = hide) |
| 16 | replate mode {off, gentle, standard, aggressive} |
| 17 | pre-make level for plates {0, P50, P70, P85} of next-2 h forecast (sandwich, cheesetoast, pasta, avotoast) |
**Masks** (`rl/masks.py`): price steps violating charter (bounds, cooldown, staples) masked; κ>off masked if ingredients insufficient; featured masked if hidden/out of stock; 86 masked if the item has open unstarted tasks; throttle `pause` masked if paused > 2 h today. A mask is never all-false (index for "no change" always valid).

### 13.4 Reward (`rl/reward.py`)
Per step: `r = Δprofit − λ_late·Σ w_persona·late_min − λ_walk·walkouts·LTV_persona − λ_price·price_changes − λ_waste·waste_kg·(₹/kg + CO₂e shadow) − λ_staff·overload_min`, scaled by `1/1000`. Defaults (₹): `λ_late=6/min` with `w_persona` (commuter 1.5, family 1.4, office_bulk 2.0, others 1.0), `λ_walk=1.0` with `LTV` (commuter 600, regular 1500, others 400), `λ_price=20`, `λ_waste=1.0`, CO₂e shadow ₹8/kg, `λ_staff=10/min`. Replate revenue counts in Δprofit; waste is charged at retirement, so the agent learns the pre-make ↔ replate trade-off. Terminal: `+ salvage(usable stock) − open obligations`. Shaping weights annealed by curriculum stage (`shaping_scale` 1.0 → 0.3).

### 13.5 Training (`rl/train_ppo.py`, `rl/bc.py`, `rl/adversary.py`)
- **BC:** roll out Policy C for N days (smoke 5, full 200), record `(obs, ManagerAction→MultiDiscrete)` at each tick, train the MaskablePPO policy network's action heads with cross-entropy (+ value head on discounted returns) for E epochs; save as initial weights.
- **PPO (sb3-contrib MaskablePPO, `MlpPolicy`, net_arch `[256,256]`):**

| Param | smoke | full |
|---|---|---|
| n_envs | 4 (DummyVecEnv) | `min(16, cpu−2)` SubprocVecEnv |
| n_steps | 128 | 512 |
| batch_size | 256 | 4096 |
| total_timesteps | 20 000 | 5 000 000 (curriculum split 20/40/40 %) |
| episode days | 1 | 1 → 7 → 28 |
| gamma / gae_lambda | 0.99 / 0.95 | 0.995 / 0.95 |
| lr | 3e-4 | 3e-4 → 1e-4 linear |
| ent_coef / clip | 0.01 / 0.2 | 0.01 / 0.2 |
| eval | every 5k steps, 3 seeds | every 100k steps, 10 held-out seeds |

- **Adversary (RARL):** `AdversaryEnv` where the agent picks `(disruption kind 10, target idx 4, start slot 56)` with budget 3/day and plausibility masks; reward = −protagonist profit. Alternate k=2 iterations; mix 50 % random disruptions / 30 % adversary / 20 % calm.
- **Device:** `--device auto` (CUDA if available). Note: PPO with small MLPs is usually *simulation-bound*; on the desktop the win comes mostly from more parallel envs — don't expect GPU to dominate. Log env-steps/s.
- **Runs:** `runs/{stage}/{timestamp}_{gitsha}/` with `config.yaml`, TensorBoard logs, checkpoints every N steps, `VecNormalize` stats, `metrics.json`; `--resume` picks the last checkpoint. Champion copied to `models/rl_policy/D/{version}/`.
- **Export (`export_onnx.py`):** wrap the policy's `features_extractor + mlp_extractor.policy_net + action_net` into a `torch.nn.Module` taking normalised obs → concatenated logits; `torch.onnx.export(opset=17)`; save `obs_norm.json` (mean/var/clip). Runtime `D_rl.py` uses onnxruntime CPU, applies normalisation + masks + per-dimension argmax. **Parity test:** max |logit diff| < 1e-4 on 256 random obs.

### 13.6 Desktop (SSH) workflow — for later
`git pull && uv sync && uv run brew-train all --config configs/train/full.yaml --device auto --workers 14 2>&1 | tee runs/full.log` inside `tmux`. Artifacts pushed back via `git add models/<champions>` (small) or `rsync` for large runs. `docs/training-runbook.md` (written in M4) has the exact steps.

---

## 14. Analysis

### 14.1 Bottleneck (`analysis/bottleneck.py`)
Every manager tick over a 30-min window per resource (station, equipment type, staff role, tables, dish pool, cashier, shelf, each ingredient that caused an 86): utilisation ρ, average queue length, **wait attribution** (seconds of order lateness spent waiting on that resource — tracked by tagging each task's wait reason), **active-period share** (Roser), and **shadow price** from §12.5. Primary bottleneck = argmax of normalised score `0.4·wait_attr + 0.3·active_share + 0.3·shadow_price_norm`. Emit `bottleneck.changed`.

### 14.2 Investment advisor (`analysis/advisor.py`)
For each catalog item pre-screened by shadow price (> 0 on its resource, or always for staffing/marketing): fork the current world K times (smoke 3, full 20) with seeds, apply the effect, run H days (smoke 1, full 7) under the current policy, compare to un-forked baseline with the **same seeds** (CRN). Report `Δprofit/day mean, 90 % CI (bootstrap), payback_days = capex/Δprofit, Δwait_p95, Δwaste_kg, ΔCO₂e`. Run in the job pool.

### 14.3 Arena (`analysis/arena.py`, `stats.py`)
Runs policies × seeds × scenarios headless in a process pool; per (policy, seed) daily KPIs; paired differences vs A; **paired bootstrap 95 % CI** (10 000 resamples, fixed RNG), **Wilcoxon signed-rank** (scipy); CVaR₁₀% of daily profit. Results to Parquet + `evaluation` rows. CLI `brew-eval --policies A,B,C,D --seeds 3 --days 1 --scenario weekday_normal`.

### 14.4 Explanations (`analysis/explain.py`)
For each decision: top factors = for D, gradient×input on the ONNX-equivalent torch module (or a surrogate depth-4 decision tree fitted on BC/PPO rollouts → path features); for C, the solver/pricing inputs that changed the choice (load, forecast delta, stock, weather). Render with the `explanations` template bank (fallback built-ins), e.g. *"Raised iced latte +₹10: kitchen 91 % busy, P90 cold-drink demand +40 % (34 °C), stock fine."* Templates are filled by name; unknown slots fail loudly in tests.

### 14.5 Impact (`analysis/impact.py`)
Economic (net profit/day, CVaR, rev/labour-hour, replate revenue & cannibalisation), environmental (waste kg & ₹, CO₂e, kWh, donated kg, replate waste avoided), social (overload minutes, P95 offline wait, walkouts, rating, charter-compliant price changes) — absolute and vs a baseline world.

---

## 15. Synthetic LLM data (`synth/`, `data/prompts/`)

### 15.1 Prompt file template (`data/prompts/{name}.md`)
```
# Prompt: {name}  (run with BATCH = 01, 02, … — change BATCH each run)
## Save output to: data/synthetic/raw/{name}/batch_{BATCH}.jsonl
## Rows per run: {n}   Target total: {total}

<role & context: what Brew is, Bengaluru cafe, pink cozy brand, our menu/personas/channels (inlined lists)>
<the task, diversity requirements, distribution targets (e.g. star histogram), tone rules, things to avoid
 (no real brand logos/claims, no real people, no slurs, no medical claims)>
<EXACT output format: JSON Lines, one object per line, no prose, no code fences>
<field-by-field schema with allowed enums and ranges>
<2–3 example lines>
<id rule: "{prefix}-{BATCH}-{000..}">
```
Each prompt inlines everything the LLM needs (menu items, persona keys, cause keys…) — the human will paste it into a fresh chat.

### 15.2 Schemas (`synth/schemas.py`, Pydantic)
- `ReviewRow{id, persona ∈ personas, channel ∈ {dine_in,takeaway,zomato,swiggy}, stars 1..5, causes: dict[cause, float 0..1] (keys ⊆ CAUSES, sum ≤ 1.5), skus_mentioned: list[sku] (⊆ menu), text 8..280 chars, language ∈ {en, hinglish}}`
- `NoteRow{id, text 3..120, intents: list[intent] (≥1), modifiers: list[modifier_id], allergy: str|None, urgency 0..1, gift_name: str|None}`
- `CalendarRow{id, date YYYY-MM-DD (2025-01-01..2027-12-31), end_date, name, kind ∈ {public_holiday, festival, cricket_match, exam_season, payday, marathon, long_weekend, concert, other}, start_time?, end_time?, multipliers: {persona?: {..}, channel?: {..}, category?: {..}} values 0.3..3.0, source_note}`
- `ExplanationRow{id, decision_type ∈ {price_change, feature_item, hide_item, prep_start, strategy_switch, throttle, accept_order, reject_order, batch_hold, reorder}, direction?, factors: list[str] (factor keys), template (uses only {slot} names from an allowed list), tone ∈ {warm, crisp}}`
- `NameRow{id, name, short ≤5 A–Z, region?, gender? ∈ {f,m,n,unspecified}}`
- `AskRow{id, question, intent, endpoints: list[str] (must match API routes), params: dict, answer_sketch}`
- `SupplierRow{ingredient (must match our keys), supplier_name (fictional), pack_size, pack_uom, price_inr, lead_time_h_mean, lead_time_h_sd, min_order_packs, is_local, distance_km, notes}`

### 15.3 Validation (`synth/validate.py`)
`brew-synth validate`: read every `raw/{name}/*`, tolerate code fences/blank lines, parse JSONL (and JSON arrays), validate rows, collect errors (file:line: message), dedupe by id and by normalised text, enforce distribution checks (e.g. reviews: every star level ≥ 10 % of rows), write `clean/{name}.jsonl` sorted by id, print a Rich table summary, non-zero exit if a dataset has 0 valid rows *and* raw files exist. `brew-synth status` shows present/missing/min-count per dataset.

---

## 16. Testing strategy (required tests)

Organise under `tests/` mirroring `src/brew`. Use fixtures `cafe_cfg`, `small_world(seed)`, `api_client`, `ws_client`. Mark slow ones.

**Config:** loads; cross-reference validation catches a broken SKU reference (negative test); every SKU has a recipe; prices within bounds.
**Engine:** event ordering by (t, prio, seq); cancel; run_until boundaries; fork independence (mutating child doesn't affect parent) and equality (unforked child replays identically).
**Determinism:** two runs same seed → identical event hash (sha256 of serialised stream); different seed → different; **CRN:** policies A vs B on same seed see identical arrival candidate lists and customer latent draws.
**Arrivals:** expected daily orders within config range over 5 seeds; rain reduces dine-in and raises delivery; slot profile peaks at commuter hours.
**Choice:** probabilities sum to 1; raising price lowers share (monotone); hidden items never chosen; loss aversion makes +10 % hurt more than −10 % helps.
**Kitchen:** capacity never exceeded (slots, station max staff, attention ≤ 1 per staff) — Hypothesis over random small configs; batching time formula; dependencies respected; errors cause remakes and extra consumption.
**Inventory (Hypothesis):** conservation invariant; no negative lots; FEFO picks earliest expiry; opened expiry recalculation; auto-86 when insufficient and restore on restock.
**Replate:** ladder monotone (discount never decreases); floor respected; only pre-made, food-safe units listed (made-to-order leftovers never); retire → donate/waste movements; per-lot unit invariant (Hypothesis over random premake/order sequences); replate alternative raises share as discount deepens; `mode=off` on a CRN fork reproduces the no-replate world exactly; API actions 422 on floor/monotonicity violation.
**Delivery:** acceptance timeout cancels; pause throttle rejects; rider waits if not ready; shelf capacity respected; quality decays by half-life.
**Reviews:** stars distribution responds to lateness; reputation Bayesian average math; causes normalised.
**Finance:** order total = lines + mods − discount + GST + round_off; ledger sum == daily net profit; GST split.
**Charter:** every rule (bounds, step, cooldown, staples, promotions, placed orders unaffected).
**Policies:** each satisfies the protocol and runs a full day; B batches more than A; C (milestone 2) ≥ A/B profit on smoke seeds; D parity with ONNX.
**Events:** every emitted event validates against its schema; `seq` strictly increasing; throttling rules respected; `customer.arrived` has one appearance seed per member.
**Telemetry:** parquet files written with expected columns; demand_15m aggregates equal orders.
**API (integration):** create world → step → state snapshot coherent with events; control play/pause/step (no speeds; `speed` action → 422); wall-clock world starts today at the local time; actions (serve_order on ready order succeeds, on non-ready → 409; bump; set_price charter violation → 422; throttle); chaos creates disruption + event; fork; error envelope shape; OpenAPI builds.
**WebSocket:** hello + replay from `since_seq`; frames batched; resync when beyond buffer; multiple subscribers.
**DB:** writer persists orders/reviews/decisions; migrations upgrade on empty DB.
**Synth:** validator accepts good fixtures, rejects bad rows with line numbers, dedupes, writes clean files; prompts directory contains all 7 prompts each with "Save output to" and schema sections.
**ML (M2/M3):** forecaster trains on tiny data and returns monotone quantiles; beats naive on synthetic seasonal data; elasticity recovers β sign/magnitude on generated data with known β; newsvendor quantile formula; scheduler optimal on tiny brute-force instances; LP duals on toy; text models F1 on fixtures > 0.6; env_checker; masks never all-false; BC reduces loss; ONNX parity; arena CI math on synthetic paired data; advisor CRN (same seeds) and ranking sanity (adding an espresso machine helps when espresso is the bottleneck).
**Performance (`slow`, but also a fast guard):** 1 sim day Policy A < 2 s; fork < 50 ms.

---

## 17. Performance budgets

| Operation | Budget (M-series laptop) |
|---|---|
| 1 sim day, Policy A/B, headless, telemetry on | < 2.0 s (target 0.5 s) |
| 1 sim day, Policy C (20 ms solver cap) | < 8 s |
| `world.fork()` | < 50 ms |
| Env step (1 manager tick) incl. D executor | < 40 ms average |
| Live pacing tick at 60× | < 30 ms CPU |
Profile with `uv run python -m cProfile -o prof.out -m brew.cli sim run …` and `snakeviz` (dev dep optional).

---

## 18. Git workflow for agents

- Work on the branch provided (worktree). **Commit after every coherent step** (config, engine, each subsystem, tests, API…) with conventional messages (`feat(sim): …`, `test(api): …`, `fix: …`) and the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Push the branch after each commit (`git push -u origin HEAD`).
- Never commit `.venv`, `data/runs/`, large model zips, secrets. Keep commits passing `uv run pytest -q` when feasible (at minimum at milestone boundaries).
- Don't touch `lobby/`, `plan.md`, `backend.md`, `technical.md` (propose spec changes in your final report instead).

## 19. Coding conventions

- Small modules, pure functions where possible, dataclasses with `slots=True` in the sim hot path, Pydantic at boundaries (config, API, events, synth).
- Type hints everywhere; docstrings with units for public functions.
- No global state; everything hangs off `World` or app state.
- Errors: raise specific exceptions (`InvalidAction`, `CharterViolation`, `NotFound`) mapped to HTTP codes in the API layer.
- Keep the sim free of I/O; sinks are injected.
