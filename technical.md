# brew: technical deep-dive

> A live digital twin of an independent Bengaluru café, run by a reinforcement-learning manager that beats a naive
> owner, a rules-of-thumb heuristic and an operations-research optimiser on profit, while cutting waste and respecting
> fair-pricing and staff-wellbeing rules.

This document is for **judges and technical reviewers**. It explains what we built, why we made each choice, which
alternatives we considered, and exactly how the main algorithms work, with most of the space given to the RL manager.
The product plan is in `plan.md`. The backend product spec (domain, API, events) is in `backend.md`. The full
low-level implementation spec that the code was built against is in `docs/implementation-spec.md`.

**Headline numbers.** All figures are profit per café-day over 10 paired seeds × 7 simulated days, with identical
customers for every policy (common random numbers).

| Policy | What it is | Profit/day | vs naive | Worst-10 % day (CVaR) | Waste kg/day | SLA breach | Walk-outs/day |
|---|---|---:|---:|---:|---:|---:|---:|
| **A** naive | first-come-first-served, static prices, fixed weekly orders | ₹62,112 | — | ₹10,357 | 41.3 | 13.9 % | 119 |
| **B** heuristic | batching, happy hour, (s,S) ordering, aggregator pause | ₹73,465 | +18 % | ₹25,974 | 23.9 | 13.5 % | 112 |
| **C** optimiser | LightGBM forecasts + newsvendor + pricing MILP + CP-SAT scheduler | ₹96,948 | +56 % | ₹64,075 | 6.4 | 11.1 % | 72 |
| **D** learned (RL) | MaskablePPO manager on top of C's executor, ONNX at runtime | **₹104,885** | **+69 %** | **₹66,037** | 10.4 | **8.8 %** | **65** |

D vs A: +₹42,773/day, 95 % bootstrap CI [₹38,540, ₹47,333], Wilcoxon p = 0.002, and D wins on **10/10 seeds**.
D vs C: **+8.2 %** profit, a 21 % lower SLA-breach rate and 10 % fewer walk-outs. D's waste is higher than C's (10.4
vs 6.4 kg); the honest read is in §9.12.

---

## Contents
1. [The problem](#1-the-problem)
2. [System overview](#2-system-overview)
3. [Key design decisions and the alternatives we rejected](#3-key-design-decisions-and-the-alternatives-we-rejected)
4. [The digital twin (simulator)](#4-the-digital-twin-simulator)
5. [Synthetic data with an LLM in the loop](#5-synthetic-data-with-an-llm-in-the-loop)
6. [Supervised models](#6-supervised-models)
7. [Operations-research layer and Policy C](#7-operations-research-layer-and-policy-c)
8. [Replate and meal combos](#8-replate-and-meal-combos)
9. [The reinforcement-learning manager (Policy D)](#9-the-reinforcement-learning-manager-policy-d)
10. [Evaluation methodology](#10-evaluation-methodology)
11. [Serving it live](#11-serving-it-live)
12. [The frontend](#12-the-frontend)
13. [Engineering quality](#13-engineering-quality)
14. [Impact](#14-impact)
15. [Limitations and future work](#15-limitations-and-future-work)
16. [Appendix: file map, glossary, reproduce](#16-appendix)

---

## 1. The problem

An independent café runs a hidden, high-dimensional control problem every minute of the day:

- **What to make ahead of demand** (cold-brew concentrate, chai base, croissant dough, pre-made sandwiches), and how much.
- **What to charge**, now that delivery apps, weather and rush hours swing demand. This must stay fair, because
  regulars notice surge pricing.
- **In which order to cook**, and when to batch three oat lattes into one steam.
- **Whether to accept** a Zomato order when the espresso machine is already at 94 %.
- **How to rescue food** that is about to be thrown away, and **how to up-sell** without annoying anyone.
- **How to staff** without burning people out.

Chains solve this with operations-research teams. Independents run on gut feel. brew is a laptop-sized decision
system for them, and the case for it rests on measurement, not assertion: every claim in this document comes from
paired, seed-controlled experiments in a faithful simulator of the café.

Why a **simulator** rather than a real café's data? You cannot A/B test four management policies on the same Tuesday
morning in a real café. A digital twin with **common random numbers** (CRN) can: the same customers walk in, order
the same way and run out of patience at the same moments, and only the policy changes. That makes "D beats C" a
causal statement rather than a correlation.

---

## 2. System overview

```
              configs/cafe/*.yaml (menu, recipes, personas, staff, stations, suppliers, combos, replate…)
                                   │ pydantic-validated
                                   ▼
 ┌────────────────────────────── DIGITAL TWIN (src/brew/sim) ─────────────────────────────────┐
 │ discrete-event engine (t, prio, seq) · 17 named RNG streams (CRN) · fork() in ~15 ms         │
 │ arrivals (NHPP thinning) → customers (patience, seating) → MNL choice → orders → kitchen     │
 │ (stations, staff, fatigue, batching, errors) → inventory (lots, FEFO, prep, suppliers)       │
 │ → delivery (aggregators, riders, shelf) → reviews/reputation → finance (GST ledger)          │
 │ + weather/calendar · disruptions (chaos) · Replate (rescue menu) · meal combos · KPIs        │
 └───────────▲───────────────────────────────┬──────────────────────────────────────────────────┘
             │ decisions (policy protocol)    │ typed events (60+ kinds, pydantic)
 ┌───────────┴───────────┐                    ├──► Parquet telemetry (training data)
 │ POLICIES               │                    ├──► SQLite (orders, reviews, decisions)
 │ A naive · B heuristic  │                    └──► FastAPI + WebSocket (live, real time)
 │ C optimiser ──────────►│ forecasts (LightGBM quantile) · elasticity (Poisson GLM)          │
 │ D RL (ONNX) ──────────►│ newsvendor · pricing ladder/MILP · CP-SAT scheduler · LP duals    │
 │ E oracle               │                                                                     │
 └────────────────────────┘                                                                     ▼
                                                          design/ — hand-inked café UI (lobby · kitchen · pantry)
 Training (offline, desktop RTX 3050/WSL2): history → M2 models → BC from C → MaskablePPO curriculum → (RARL) → ONNX
```

| Layer | Tech | Size |
|---|---|---|
| Simulator + policies + ML + API | Python 3.12, uv, numpy, pydantic, FastAPI, SQLAlchemy, LightGBM, OR-Tools, scikit-learn | ~125 modules |
| RL | Gymnasium, Stable-Baselines3 + sb3-contrib (MaskablePPO), PyTorch, ONNX/onnxruntime | 14 modules |
| Tests | pytest, Hypothesis, httpx | 281 tests in 26 files, ruff + mypy (strict) clean |
| Frontend | hand-drawn SVG + vanilla JS (`design/`), no build step | 3 rooms + the menu book |

---

## 3. Key design decisions and the alternatives we rejected

| Decision | Why | Alternatives considered | Why not |
|---|---|---|---|
| **Discrete-event simulation** (event heap keyed `(t, prio, seq)`) | Cafés are queues. DES is exact and fast: one sim day takes 0.13 s for A/B and about 4 s for C. | Fixed time-step simulation; agent-based frameworks (Mesa, SimPy) | Time-steps waste cycles on idle minutes and blur ordering. SimPy's generator processes are harder to fork and pickle, and slower. |
| **Common random numbers**: 17 named PCG64 streams; who the customers are is pre-sampled per day | Paired comparisons need far fewer seeds, which makes policy differences causal | One global RNG | One global RNG lets a policy change shift every later draw, so the comparison measures noise. |
| **Hierarchical control**: the RL "manager" acts every 15 sim-minutes; event-level dispatch is done by C's solver-backed executor | A café day has about 15,000 events and 56 manager ticks. RL over 56 steps per day is learnable; over 15k micro-decisions it is not. | Flat RL over every event; pure OR (C) | Flat RL: credit assignment over 10⁴ steps, with huge, sparse action sets. Pure OR: no adaptive strategy, and myopic about prices and prep. |
| **MaskablePPO** with a `MultiDiscrete` action space and action masks | Stable on-policy learning that handles a factored discrete action of 18 dimensions; masks enforce hard rules | DQN, SAC-discrete, A2C, evolution strategies, MPC | DQN can't factorise 5⁸·6·4³·24·2³·4² joint actions. SAC-discrete is unstable with masks. A2C has higher variance. MPC needs a differentiable or fast model of a stochastic queue. |
| **Behaviour cloning warm start** from Policy C | PPO from scratch starts at ₹75k/day; BC starts at about ₹96k. Exploration then builds on a competent policy. | Pure RL; DAgger; offline RL (CQL/IQL) | Pure RL wastes compute rediscovering basics. DAgger needs an interactive expert (possible, but BC was already 99.99 % accurate). Offline RL adds complexity with no gain over BC + PPO here. |
| **Hard constraints in masks and a shield, never in the reward** | The fair-pricing charter and food safety are non-negotiable | Penalty terms in the reward | Penalties are soft: an agent can learn that breaking a rule pays. Masks make violations impossible. |
| **LightGBM quantile forecasting** (P10/P50/P90) | Tabular, fast, strong; quantiles feed the newsvendor directly | Prophet, DeepAR/TFT, plain ARIMA | Prophet is per-series and slow for 23 SKUs × channels. Deep models are overkill for 180 days of 15-minute slots and harder to ship. ARIMA has no exogenous richness. |
| **Poisson GLM for price elasticity**, with category shrinkage | Interpretable β per item; recovers known ground truth (median abs. error 0.09) | Double-ML, GBM with monotone constraints | Fine, but we needed signs and magnitudes we can explain to an owner. |
| **CP-SAT scheduler with a deterministic time budget** and a greedy fallback | Near-optimal sequencing and batching in milliseconds, reproducible | Pure heuristics, MILP | Heuristics leave throughput on the table. MILP is slower on disjunctive scheduling. A wall-clock time limit is not reproducible, so we use a deterministic one. |
| **ONNX export** of the policy, with onnxruntime on the CPU | Microsecond inference with no PyTorch at runtime; parity tested to under 1e-4 | Ship SB3 and torch | Heavier, slower start-up, and OpenMP conflicts with LightGBM on macOS (we hit this). |
| **LLM-generated synthetic text data** (reviews, order notes, calendar, names, suppliers), with a strict validator | Realism and variety (8,310 rows) without scraping or PII | Hand-written templates; scraping real reviews | Templates are repetitive. Scraping raises ToS and PII problems. |
| **Real-time live backend** (`clock: "wall"`: today's date, synced to Asia/Kolkata) | The demo is a café that is open *right now*, not a replay | Speed controls (1×/10×/60×) | Removed on purpose: live is the story, and training uses headless runs anyway. |
| **Hand-inked 2D frontend** (`design/`) | Warmth and readability. Every decision is visible as a doodle on a ticket, a menu book or a pantry lot. | Photoreal 3D (we built two prototypes: `lobby/` and `kitchen/`) | 3D was beautiful but heavy on an 8 GB MacBook and hid the information behind spectacle. |

---

## 4. The digital twin (simulator)

### 4.1 Engine
- **Event heap** of `(t, prio, seq, kind, payload)`. The priority order is: clock/day boundaries 0, disruptions 1,
  completions 2, arrivals 3, patience/timeouts 4, decision points 5, telemetry 9. `seq` breaks ties deterministically.
- **Decision points:**
  - `MANAGER_TICK`: every 900 s, 56 per day. Strategic decisions are made here.
  - `ORDER_ARRIVED`: aggregator acceptance.
  - `DISPATCH`: whenever a staff member, slot or task frees up, batched to one pass per timestamp.
  - `DAY_START` and `DAY_END`.
- **Fork** (`World.fork()`, about 15 ms mid-day): pickles the world while *sharing* immutable config objects
  through `persistent_id`, so a counterfactual ("what if Replate were off from 9 am?") branches from the exact same
  state and RNG positions. This powers CRN counterfactuals, the investment advisor and cannibalisation measurement.
- **Performance:** one day of A or B takes 0.13–0.25 s headless with telemetry on, and one day of C about 4 s. The RL
  environment step (one manager tick) takes about 27 ms on the desktop after the optimisation in §9.9.

### 4.2 Customers and demand
- **Nine personas:** commuter, student, leisurely, remote_worker, family, office_bulk, delivery_home, tourist and
  regular. Each has arrival curves per weekday and weekend, a channel mix, party sizes, item affinities, price
  sensitivity β, patience, dwell time and review propensity.
- **Arrivals:** a non-homogeneous Poisson process via **thinning with CRN**. Candidate times and every latent draw
  (persona, party, patience quantile, Gumbel noise, note, name, appearance seed) are pre-sampled at day start.
  Acceptance uses `λ_p(t) = slot_rate × day-of-week × weather × calendar × reputation^2 × price_index^-0.6 × trend ×
  lognormal day noise`.
- **Choice:** a multinomial logit per basket slot:
  `U_j = ln(pop_j) + aff_pj + β_p·ln(p_j/ref_j) + γ·featured + δ·weather_fit + η·calendar − λ_loss·max(0, ln(p_j/ref_j)) + ε`.
  `ref_j` is a 7-day EMA of the live price, so the model has a **fairness memory**. Loss aversion
  (`λ_loss = 1`) makes surges hurt more than discounts help. An outside option is calibrated so that about 5 % walk
  out at base prices.
- **In venue:** queue → order → wait → seat → eat → linger → pay → leave.
  - Balking is a sigmoid of queue length.
  - Patience is lognormal per persona; reneging or a bad review fires on expiry.
  - Tables merge for groups.
  - A remote worker may order a refill.

### 4.3 Kitchen
- Each item expands into a **task DAG** from its recipe: grind → pull → steam → pour, plus modifier extra seconds
  and bagging for takeaway or delivery.
- **Resources:** 13 stations (espresso with 2 groups, grinder, bar, blender, cold, oven with 2 trays, press with 4
  slots, fryer, stove, griddle, display, pass, dish pit), equipment slots and staff. Each staff member has skills,
  speed, error rate, fatigue and enforced breaks.
- **Task duration:** `lognormal × speed⁻¹ × (1 + 0.25·fatigue) × learning × batch_factor`.
- **Errors** are load-dependent and cause remakes, which consume ingredients twice.
- **Quality** decays after an item is ready: `q(t) = 2^(−t/half_life)`.
- **Cups and plates** are a finite pool, so the dish pit can become the bottleneck.

### 4.4 Inventory, suppliers, delivery, money
- **Inventory:**
  - **Lots** with sealed and opened shelf lives, consumed FEFO.
  - **Auto-86** removes an item when its recipe can't be met for one unit, and **restore** brings it back on restock.
  - Prep batches (cold-brew concentrate on a 12-hour lead, chai base, dough proof, paneer marinade, cut fries) create
    lots with hold expiries. Packaging is inventory too.
  - A conservation invariant is checked by Hypothesis: `initial + Σreceive − Σconsume − Σwaste − Σdonate = on_hand`.
- **Suppliers:** lead times, delivery days, fill rates and on-time draws. These come from an LLM-generated catalogue,
  validated and calibrated.
- **Aggregators** (Zomato, Swiggy) differ in:
  - commission (25 % / 22 %), packaging cost and gateway fees;
  - a 90 s acceptance timeout and throttles (+5 min, +10 min, pause);
  - riders dispatched at `promise − ETA`, with ETA ×1.3 in rain and ×1.2 at peak;
  - a 6-slot pickup shelf, where food quality decays while it waits;
  - a platform score that reacts to rider wait time.
- **Reviews:** satisfaction S ∈ [0,1] blends lateness vs patience, quality, value for money, accuracy, ambience and
  perceived unfairness. Stars come from S plus noise. Review **text** is sampled from the synthetic corpus,
  conditioned on stars, top cause and channel. Reputation per channel is a Bayesian average (prior 4.3, weight 50)
  and feeds back into arrivals.
- **Finance:** a double-entry-style ledger covering revenue, discounts, GST split CGST/SGST (a liability, excluded
  from profit), COGS, commission, payment fees, packaging, labour, energy, waste, rent, maintenance, depreciation and
  donation write-offs. A test checks that the ledger sum equals the daily net profit.

### 4.5 The fair-pricing charter (a hard shield for every policy)
- A price change is at most ±10 % of base per step.
- At most one change per item per 2 sim-hours.
- Prices stay within each item's [min, max].
- No increases ever on staples (masala chai and filter coffee).
- Placed orders keep their price.

Replate markdowns and combo derivations follow their own discount-only rules. The charter is enforced in
`policies/charter.py`. Policies **cannot** violate it: the RL agent's masks hide violating actions, and a shield
rejects anything that slips through.

### 4.6 Weather, calendar, chaos
- **Weather:** an hourly Markov chain over sunny, partly, cloudy, drizzle and rain, with a temperature curve. Rain
  shifts demand from dine-in to delivery; heat lifts cold drinks.
- **Calendar:** a Bengaluru calendar (360 LLM-generated events: festivals, cricket matches, exam weeks, paydays)
  applies multipliers by persona × channel × category.
- **Disruptions** (from scenarios, an adversary or the chaos console): staff absent or late, equipment down (with an
  MTTR draw), supplier delay or shortage, rider shortage, power cut, demand spike, price shock and platform outage.

---

## 5. Synthetic data with an LLM in the loop

1. We wrote **seven self-contained prompt files** (`data/prompts/*.md`). Each one includes the menu, personas,
   enums, a JSON-Lines schema, examples and an id rule.
2. A human ran them in a strong LLM and saved the raw output.
3. `brew-synth validate` then:
   - schema-checks every line, reporting errors with line numbers;
   - de-duplicates;
   - checks distributions (for example, every star level must be at least 10 % of reviews);
   - writes `data/synthetic/clean/`.

| Dataset | Rows | Used for |
|---|---:|---|
| reviews | 3,000 | review-text sampling; review-cause tagger training |
| order_notes | 1,600 | ticket notes; note-parser training (allergy, modifiers, rush…) |
| calendar_bengaluru | 360 | demand multipliers |
| explanations | 400 | template bank for "why" notes |
| customer_names | 600 | tickets, receipts |
| ask_brew_eval | 300 | reserved for a future copilot (out of scope) |
| supplier_catalog | 50 | lead times, fill rates, prices |

There were zero validation errors after cleaning. Everything also works without these files, falling back to built-in
templates.

---

## 6. Supervised models

All supervised models train on **simulated history**. The full run uses 4 scenarios × 180 days plus price-exploration
worlds. Every model registers in a model registry (`models/registry.json`) with params, metrics, git SHA and lineage.
The full-run metrics below are from `docs/training/full-20261005/`.

| Model | Method | Full-run result |
|---|---|---|
| Demand forecaster (item × channel × 15 min, 0–6 h ahead) | Global LightGBM, quantile objectives P10/P50/P90 plus a mean model; features are calendar, weather, lags, rolling means, live prices and promos; in-world calibration with a Gamma–Poisson nowcast and day-bias EMA | WAPE P50 **0.896 vs 1.142** for seasonal-naive (**21.5 % better**); hourly WAPE 0.569 vs 0.731; P10–P90 coverage 93.6 % |
| Price elasticity | Penalised Poisson GLM, log-price, category shrinkage, on CRN price experiments | All β signs correct; median abs. error **0.091** vs ground truth |
| Prep-time | LightGBM quantile | P50 MAE 7.5 s (13.5 %) vs 11.8 s naive |
| Rider ETA | LightGBM quantile | P50 MAE 187 s; P90 coverage 90.4 % |
| Replate sell-through | Poisson LightGBM | Deviance 31 % better than baseline |
| Review-cause tagger | TF-IDF + one-vs-rest logistic regression | Macro-F1 **0.709** (wait 0.80, ambience 0.88, packaging 0.81) |
| Ticket-note parser | Rules + TF-IDF classifier | Macro-F1 **0.956** (allergy 0.99) |

The forecaster's job is to drive decisions, not to win a leaderboard. Its quantiles feed the newsvendor (§7.1) and
the RL observation (§9.3).

---

## 7. Operations-research layer and Policy C

Policy C is a strong, hand-engineered expert. It is both a baseline to beat and the **teacher** for behaviour cloning.

### 7.1 Perishable newsvendor (prep and purchasing)
Order or prep quantity is `q* = F⁻¹(c_u/(c_u+c_o))`.
- `F` is the forecast distribution over the cover horizon, built by interpolating P10/P50/P90 with a fitted log-normal.
- `c_u` is the expected lost margin plus a wait penalty.
- `c_o` is unit cost plus a CO₂e shadow price, net of the expected Replate recovery.
- Perishable purchase orders cover demand until the next delivery, plus safety stock at P90, minus *usable* on-hand
  stock (lots expiring before use are excluded).

### 7.2 Pricing
Every hour, a ladder search or small MILP over charter-feasible price steps per category maximises expected
contribution, `Σ (p − c)·q(p)` with `q` from the elasticity model and forecasts. It is penalised for change count
(customers dislike churn) and loss-aversion effects.

### 7.3 Scheduling and batching
CP-SAT schedules ready tasks onto stations, slots and staff to minimise persona-weighted lateness plus makespan,
with batching (the same step on the same station inside a window). It uses a **deterministic time budget** so runs
are reproducible, with a greedy EDF fallback.

### 7.4 Capacity LP and the bottleneck analyzer
An LP over station capacities gives **shadow prices**: the rupee value of one more unit of each resource. Combined
with recent utilisation, they name the binding constraint ("espresso machine 94 % ← bottleneck"). The **investment
advisor** prices candidate purchases (a second espresso group, a dish rack, a morning barista) by running CRN forks
with and without the upgrade, giving Δprofit/day, payback and a CI.

### 7.5 Policy E (oracle)
Policy E is Policy C with perfect knowledge of future arrivals. It gives an upper reference for how much better
forecasting could ever be worth.

---

## 8. Replate and meal combos

### 8.1 Replate: the rescue menu
**Replate is the feature that stops food being thrown away.** Food made ahead of demand that is nearing its use-by
is listed in its own menu category at a **monotone markdown ladder**. The standard ladder is 30 % → 50 % → 70 %, with
a floor of 0.5 × unit cost; prices only ever go *down*.
- **What gets listed:**
  - pre-made finished goods: bakes and bottled cold brew;
  - pre-made plates: sandwich, cheese toast, pasta and avo toast;
  - **prep-backed dishes**: an expiring prepped intermediate becomes discounted dishes (chai base → chai, cut fries →
    fries, paneer marinade → sandwich, cold-brew concentrate → cold brew, ripe avocado → avo toast).
- **Surplus only:** a listing covers only the units the forecast says won't sell at full price before use-by, so
  rescue sales don't cannibalise full-price ones.
- **How customers buy it:** a listing joins the customer's choice set as an alternative, using a persona affinity and
  a "made earlier" penalty φ. There is also a **counter impulse add-on**: about 10 % of customers at 30 % off and 20 %
  at 50 % off add one rescued item. This is the main source of *incremental* rescue demand. A spec-pure logit alone
  only moves demand between items, which gave 24 % less waste but cost ₹3.2k/day.
- **At use-by:** sealed bakes are donated and everything else is wasted. Every unit is accounted for by a per-lot
  invariant.
- **Result (full run, C, 10 seeds × 7 days):** waste **13.9 → 6.5 kg/day (−53 %)**, profit **₹96.5k → ₹96.9k (not
  lower)**, and ₹11.9k/day of rescued revenue.

### 8.2 Meal combos: the up-spend
Two-item bundles, such as *Morning Fuel* (cappuccino + croissant) at 12 % off, priced **off the components' live
prices**: `round_5(Σ live prices × (1 − d))`. When a component is repriced, the combo reprices too and emits
`price.changed` with `sku: "combo:<id>"`.
- **Pairing:** a basket that already holds both halves gets the combo price.
- **Up-sell:** a basket holding one half adds the other with probability
  `p = min(0.32, 0.08 + 0.012·saving%) × persona factor` (students ×1.4, delivery ×0.8). The draw comes from its own
  RNG stream, so it is CRN-safe.
- **Measured effect** (C, 2 days): revenue **+5.2 %**, profit **+₹3.9k/day**, and average ticket **₹500 → ₹521**.

---

## 9. The reinforcement-learning manager (Policy D)

This section is the core of the project.

### 9.1 Formulation: a hierarchical, semi-Markov MDP
- **Agent:** the café **manager**. It acts at every manager tick (900 sim-seconds), 56 decisions per day.
- **Executor:** between ticks, all event-level decisions (which task next, batching, aggregator acceptance) are made
  by **C's solver-backed executor**, parametrised by the manager's current strategy, batch window, throttles and
  prep levels.
  - **Why:** this turns a 15,000-event day into a 56-step episode, which is learnable. The agent still controls
    everything that matters strategically, while microsecond-level sequencing stays with a proven optimiser.
- **Episodes:** 1, 7 or 28 days by curriculum stage. Evaluation uses 7 days, about 392 decisions.
- **Environment:** `BrewManagerEnv(gymnasium.Env)`. It passes `gymnasium.utils.env_checker`, is deterministic for a
  given seed, and supports domain randomisation (scenario mix, demand noise) and chaos episodes.

### 9.2 What the agent controls: action space
`MultiDiscrete([5,5,5,5, 5,5,5,5, 6, 4,4, 4, 24, 2,2,2, 4, 4])`: 18 heads, 113 logits.

| Dims | Meaning | Values |
|---|---|---|
| 0–3 | price step per category (coffee, not-coffee, bakes, plates) | −10 %, −5 %, 0, +5 %, +10 % of the current price; staples excluded |
| 4–7 | prep service level κ per prep class (cold-brew concentrate, chai base, baked croissants, paneer marinade) | off, P50, P65, P80, P90 of the forecast (newsvendor quantile) |
| 8 | dispatch strategy | fcfs, edf, dine_first, delivery_jit, batch_max, throughput |
| 9–10 | aggregator throttles (Zomato, Swiggy) | open, +5 min, +10 min, pause |
| 11 | batch window | 0, 30, 60, 120 s |
| 12 | featured item | none or one of 23 SKUs |
| 13–15 | 86 toggles for the slow plates (pasta, sandwich, avo toast) | show or hide |
| 16 | Replate mode | off, gentle, standard, aggressive |
| 17 | plate pre-make level | 0, P50, P70 or P85 of the next-2-hour forecast |

**Masks** (`rl/masks.py`), recomputed every tick:
- price steps that break the charter (bounds, cooldown, staples) are masked;
- κ above "off" is masked when ingredients are insufficient;
- featuring a hidden or sold-out item is masked;
- hiding an item that has unstarted tasks is masked;
- pause is masked after 2 hours paused in a day.

Each head always keeps its "no change" index valid, so a mask is never all-false (tested over random play). The
**shield** re-checks every action against the charter before applying it.

### 9.3 What the agent sees: observation (183 named floats)

| Group | Size | Content |
|---|---:|---|
| time | 11 | sin/cos time of day, weekday one-hot, episode progress, weekend flag |
| weather | 6 | state one-hot, normalised temperature |
| calendar | 4 | active event multipliers |
| demand forecast | 52 | P50 for the next 4 slots × 4 categories × 3 channel groups (48) + P90−P10 spread per category (4) |
| nowcast | 1 | intraday Gamma–Poisson demand level |
| queues | 11 | open orders per channel, slack histogram (5 bins), low-patience waiting count, register queue |
| resources | 45 | 13 station utilisations, 13 station queue lengths, 13 equipment-down flags, staff present, fatigue mean/max, tables free/occupied/dirty |
| inventory | 16 | days of cover for 10 key ingredients, ₹ value expiring < 4 h, 5 prep stock levels |
| economics | 10 | price index per category, today's profit, cash, reputation (offline, Zomato, Swiggy), recent price changes |
| disruptions | 10 | one flag per chaos kind |
| current controls | 13 | κ per prep class, strategy one-hot, throttles, batch window |
| Replate | 4 | listed units, ₹ expiring < 2 h, sell-through today, current mode |

- **Scaling:** fixed scalers bring every feature roughly into [−1, 1], then **VecNormalize** keeps running mean and
  variance (frozen and exported at deployment).
- **No leakage:** the observation uses the *trained forecaster*, never the simulator's ground truth. Only Policy E
  sees the future.
- **Named features** (`ObservationBuilder.names`) make explanations human-readable.

### 9.4 What the agent wants: reward
Per tick, scaled by 1/1000:

```
r = Δprofit
    − shape·λ_late · Σ w_persona · late_minutes
    − λ_walk · Σ LTV_persona · walkouts
    − shape·λ_price · price_changes
    − λ_waste · (waste_₹ + ₹8/kg · CO₂e_kg)
    − shape·λ_staff · overload_minutes
    + terminal: salvage(usable stock) − open obligations
```

| Term | Weight | Why it's there |
|---|---|---|
| Δprofit | 1 | The ledger's net profit change: revenue − COGS − commission − labour − energy − waste … |
| lateness | ₹6/min × persona weight (commuter 1.5, family 1.4, office bulk 2.0) | People with trains to catch matter more. It also proxies future lost demand. |
| walk-outs | LTV per persona (commuter ₹600, regular ₹1,500, others ₹400) | A walk-out costs more than one order: it costs the relationship. |
| price changes | ₹20 each | Churning prices erodes trust; prices should change only when it pays. |
| waste | ₹ value + ₹8/kg CO₂e shadow | Environmental cost is on the books. |
| staff overload | ₹10/min of sustained over-95 % utilisation | Staff wellbeing is in the objective. |

**Shaping anneal:** the shaping terms are multiplied by `shaping_scale`. It is 1.0 in the 1-day stage, 0.65 in the
7-day stage and 0.3 in the 28-day stage. Early learning gets dense guidance; later learning optimises closer to
pure economics.

### 9.5 Warm start: behaviour cloning from Policy C
1. Roll out C for **200 days** across six scenarios (weekday, weekend brunch, rainy delivery surge, heatwave, exam
   week, festival) with domain randomisation.
2. At each tick, record `(obs, C's manager decision encoded into the 18 heads)`: **11,571 samples**.
3. Train MaskablePPO's actor heads with masked cross-entropy, and its value head on discounted returns (γ 0.995,
   scaled).

Over 80 epochs at batch 512, the policy loss fell from **21.0 to 0.0033** with **99.9995 % action accuracy**, and the
value loss from 0.99 to 0.008. PPO starts from these weights, with a short **critic warm-up** (policy frozen for the
first updates) so the value head adapts to the reward before the policy moves.

**Why warm-start:** a PPO-from-scratch smoke run went from ₹75k to ₹84k/day in 30k steps, which shows the learning
signal works, but it starts far below C. BC hands PPO a policy at C's level (₹95.8k/day at step 0 of the full run),
so all PPO compute goes into improving on the expert.

### 9.6 PPO: algorithm and hyperparameters
MaskablePPO (sb3-contrib) uses PPO's clipped surrogate objective. Invalid actions get −∞ logits **before** the softmax
in every head, so they are never sampled and never receive gradient.

| Parameter | Full run (desktop) | Smoke (laptop) |
|---|---|---|
| network | MLP 256-256 (separate policy and value heads), tanh | same |
| envs | 6 × SubprocVecEnv (spawn) | 4 × DummyVecEnv |
| n_steps × envs (rollout) | 512 × 6 = 3,072 | 128 × 4 |
| batch size / epochs | 4,096 (whole rollout) / 10 | 256 / 4 |
| γ / GAE λ | 0.995 / 0.95 | 0.99 / 0.95 |
| learning rate | 3e-4 → 1e-4, linear | 1e-4 |
| clip / entropy coef | 0.2 / 0.01 | 0.2 / 0.01 |
| curriculum | 1-day episodes (20 %, shaping 1.0) → 7-day (40 %, 0.65) → 28-day (40 %, 0.3) | 1-day |
| planned steps | 2,000,000 (trimmed from the spec's 5 M for a < 12 h budget) | 20,000 |
| evaluation | every ~100k steps, 10 held-out seeds × 7-day episodes | every 5k, 5 seeds × 1 day |
| checkpoints | every 100k steps, including VecNormalize stats, for exact resume | every 10k |

The planned schedule also included **RARL** (robust adversarial RL): an adversary PPO picks disruptions (kind,
target, start slot) under a budget of 3 per day with plausibility masks, rewarded with the negative of the
protagonist's profit, alternating k=2 iterations with episodes mixed 50 % random chaos, 30 % adversary and 20 % calm.
It is implemented and tested (`rl/adversary.py`, `rl/rarl.py`), but **skipped in the final run** (see §9.10).

### 9.7 Training infrastructure
- **Hardware:** a desktop with an i5-11400 (6 cores, 12 threads), an RTX 3050 (8 GB) and WSL2 Ubuntu 24.04 with 10
  GiB RAM. It is reached from the development laptop over Tailscale and SSH, with key-only login.
- **`scripts/desktop/overnight.sh`** is an offline-first runner:
  - `prepare` runs `uv sync`, a GPU check and the tests, and is the only step that needs the network;
  - `start` runs fully offline under `setsid nohup` and keeps Windows awake;
  - logs are committed locally and pushed best-effort every 30 minutes, and a failed push never stops training;
  - the final push retries with backoff;
  - `--resume` continues from the latest checkpoint in the same run directory.
- **GPU:** torch is installed from the CUDA 12.6 index (the driver supports CUDA 12.8). The GPU only speeds up the
  learner; the work is **simulation-bound** (§9.9).
- **Pipeline:** `brew-train all --config configs/train/full.yaml --run-dir …` runs 13 stages: history, forecast,
  elasticity, prep_time, rider_eta, text, replate, M2 arena, bc, ppo, adversarial, export and final arena. Each stage
  writes a marker so `--resume` can skip it. `progress.json` carries step, steps/s, ETA and last evaluation.

### 9.8 The training run
Run `20261005_063045`, started 2026-10-05:
- The M2 stages plus BC took **1 h 18 min**.
- PPO started at 07:48. A slowdown was found and fixed at 404k steps (see §9.9) and the run resumed from that
  checkpoint.
- The machine was shut down overnight at 1.1M steps, and the run resumed from that checkpoint the next morning.
- The run was stopped deliberately at 1.6M steps.

Evaluation (10 held-out seeds × 7-day episodes):

| PPO step | Curriculum stage | Eval reward | Profit/day | Walk-outs/day |
|---:|---|---:|---:|---:|
| 0 (= BC) | 1-day | 294.3 | ₹95,786 | 72.1 |
| 102k | 1-day | 360.4 | ₹102,121 | 66.7 |
| **205k** | 1-day | **396.6** | **₹105,337** | **63.6** |
| 302k | 1-day | 371.7 | ₹102,232 | 64.4 |
| 404k | 7-day | 362.7 | ₹101,288 | 64.8 |
| 601k | 7-day | 347.0 | ₹99,856 | 63.9 |
| 1.00M | 7-day | 345.8 | ₹99,048 | 62.3 |
| 1.20M | 28-day | 333.5 | ₹98,778 | 64.2 |
| 1.60M | 28-day | 330.1 | ₹98,287 | 64.0 |

In 205k steps, PPO improved on its BC teacher by **+10 % profit and −12 % walk-outs**. It peaked inside the 1-day
curriculum stage, then drifted down by about 7 % and plateaued through the long-episode stages.

### 9.9 Making the environment fast enough
The first full-run attempt ran at **27 steps/s** with 10 workers, an ETA of about 46 hours. Profiling showed:
1. **LightGBM prediction was about 2/3 of every environment step.** C's executor re-predicted a 24-slot × all-SKU
   forecast (4 quantile models, about 3,500 rows) at every tick.
2. **The workers didn't scale:** 10 workers gave 2.4× one worker, because concurrent tree traversals thrashed the
   i5's shared L3 cache.

The fixes:
- Inside the training environment only, the raw forecast is re-predicted **hourly** and sliced in between, while the
  calibration multiplier still updates every tick (`EnvConfig.forecast_refresh_slots = 4`). Policies outside training
  keep per-tick forecasts, because the stale version costs C about 2.3 % profit.
- **6 workers** (measured 112 env-steps/s) instead of 10 (98).
- A single env step went **87 → 27 ms**. With the learner included the run reached 46–60 steps/s.

Two more bugs were found and fixed on the way:
- On macOS, importing torch before LightGBM segfaults because the two ship different OpenMP runtimes. The fix is a
  forkserver that preloads LightGBM, OR-tools and onnxruntime, plus a fixed import order.
- On Linux, `fork`-ing a process pool after torch had started its thread pool deadlocked the arena. Pools now use
  `spawn`.

### 9.10 Why we stopped at 1.6M steps and skipped RARL
- After 205k steps, the evaluation never recovered. Over 1.4M steps across the 7-day and 28-day stages, profit stayed
  flat at ₹98–99k, below the peak.
- The remaining 400k steps of the 28-day stage were very unlikely to change that.
- RARL would have started from the post-peak weights, hardening a weaker policy, for about 1.5 hours of compute.

The export stage compares **every candidate** on calm *and* chaos days and picks the best: `ppo_best` (205k) scored
₹105.2k calm and ₹96.8k chaos, against ₹98.3k and ₹91.6k for `ppo_final`. The skipped stages are recorded in the run
metrics with their reasons.

**Diagnosis and next steps.** The long-episode stages lowered `shaping_scale` and changed the effective return scale,
and the learning rate (still above 2e-4 at that point) moved a near-optimal policy away from its optimum. Next time:
a lower LR and entropy in later stages, a `target_kl` early stop, and fine-tuning from the champion. RARL should then
start from the champion, which would improve chaos-day CVaR.

### 9.11 Export, runtime and explanations
- **ONNX:**
  - The policy's feature extractor, MLP and action nets are wrapped as `obs → concatenated logits`.
  - It is exported with `torch.onnx.export` (opset 17), together with `obs_norm.json` (VecNormalize mean, var and clip).
  - **Parity:** max |Δlogit| = 5.7e-6 on 256 observations, with 100 % argmax agreement.
- **Runtime D** (`policies/D_rl.py`): onnxruntime on the CPU, with one intra-op thread. At each tick it normalises the
  observation, applies the masks, takes the argmax per head, decodes the action, passes it through the shield and
  hands it to the executor. There is no PyTorch at runtime.
- **Explainability:**
  - A **surrogate decision tree** (depth 4, one per action head) is trained on 2,394 of the champion's own decisions.
  - Mean fidelity is **97.7 %**: price heads about 99 %, prep heads 89–96 %.
  - Each decision gets an explanation built from its tree path, over named features, filled into a template from the
    synthetic explanation bank. For example: *"cold brew +₹10: kitchen 92 % · 34 °C · demand ▲"*.
  - These feed the "policy D · learned" card in the lobby and the reason notes in the menu book.

### 9.12 Results and honest read
Final arena: 10 seeds × 7 days, `weekday_normal`, CRN-paired. All figures are per day.

| | A | B | C | **D** |
|---|---:|---:|---:|---:|
| Mean profit | ₹62,112 | ₹73,465 | ₹96,948 | **₹104,885** |
| Seed range | 58.0k–66.6k | 64.1k–80.8k | 87.4k–109.3k | **92.7k–117.5k** |
| Δ vs A (95 % CI) | — | +11.4k [8.7k, 13.9k] | +34.8k [31.5k, 38.3k] | **+42.8k [38.5k, 47.3k]** |
| Wilcoxon p vs A / win rate | — | 0.002 / 10/10 | 0.002 / 10/10 | **0.002 / 10/10** |
| CVaR 10 % (worst days) | ₹10,357 | ₹25,974 | ₹64,075 | **₹66,037** |
| Revenue | ₹131.6k | ₹155.3k | ₹191.3k | **₹197.2k** |
| Waste kg | 41.3 | 23.9 | **6.4** | 10.4 |
| SLA breach | 13.9 % | 13.5 % | 11.1 % | **8.8 %** |
| Walk-outs | 119 | 112 | 72 | **65** |
| Rating | 4.43 | 4.42 | 4.40 | 4.39 |

- **Where D wins:** throughput and service. It has the fewest late orders and walk-outs, the highest revenue and the
  best worst-day profit. It learned to trade pricing, prep levels and dispatch strategy *jointly* through the day,
  which C optimises separately and myopically.
- **Where D doesn't:** waste is 4 kg/day higher than C's. C's newsvendor is explicitly waste-averse; D's reward prices
  waste at ₹-value plus CO₂e, and D judged the extra prep worth it for speed. With a higher waste weight or the next
  RARL round we expect D to close that gap. Ratings are statistically flat across all policies.
- **Why the gap is real:** every policy faced the *same* customers, weather and disruptions (CRN), on held-out seeds
  never used in training.

---

## 10. Evaluation methodology
- **CRN pairing:** all policies run on identical seeds, and the per-seed difference is the unit of analysis.
- **Statistics:**
  - paired bootstrap 95 % CI on the mean difference;
  - Wilcoxon signed-rank test (p = 0.002 is the minimum attainable with n = 10 and every sign the same);
  - win rate;
  - **CVaR 10 %**: the mean of the worst 10 % of days, which is what decides whether a small café survives a month.
- **Hold-out:** evaluation seeds (base 1000+) are never used in training rollouts.
- **Counterfactual measurement:**
  - Replate cannibalisation and the investment advisor use **forks** of the same world: same state, same RNG
    positions, one change.
  - Replate on vs off: −53 % waste, +₹351/day profit on C.

---

## 11. Serving it live
- **The café runs live:** `BREW_LIVE_RATE = 1.0`, real time, with no playback speeds.
  - A `clock: "wall"` world starts on **today's date** and fast-forwards to the current time in Asia/Kolkata on
    create and play, then stays locked to the wall clock.
  - `clock: "open"` starts at opening time (used by tests).
- **Pacer:** every 50 ms of wall time, events up to the target are processed in a worker thread with a 30 ms CPU
  budget. If it lags, it catches up and reports `lagging`.
- **API:** FastAPI under `/api/v1`, 42 routes.
  - Worlds: create, list, state, control, policy, fork, chaos, actions.
  - Read models: menu, combos, Replate, orders, rail, board, customers, tables, inventory and lots, fridge, shelf,
    staff, equipment, KPIs, impact, reviews, receipts, decisions and explanations, disruptions.
  - Analysis: forecast, bottlenecks, advisor and invest, arena jobs.
  - Meta: models, health, event schema.
- **WebSocket:** `/api/v1/ws/worlds/{id}?since_seq=` sends batched frames every 50–100 ms. A 10,000-event ring buffer
  allows replay after a reconnect, and there are resync and heartbeat messages. More than 60 typed events (pydantic,
  schema served at `/events/schema`) each map to a visual: `order.placed` puts a ticket on the rail, `price.changed`
  triggers the ink strike in the menu book, `replate.listed` adds a rescue-shelf entry, and so on (backend.md §6.3).
- **Persistence:** SQLite by default (orders, reviews, decisions, model registry; Postgres-ready through SQLAlchemy
  and alembic). Telemetry goes to Parquet for training. An async batched writer keeps the event loop free.

---

## 12. The frontend
`design/` is the final direction: **hand-inked 2D** in the "Strawberry Milk" palette.
- **Palette:** ink `#1d1a1c`, paper `#fbf7f1`, pink `#f7c3a3` / `#e07e52`, sage, terra, mustard.
- **Type:** Gochi Hand, Patrick Hand, Caveat, Courier Prime.
- **Line work:** wobbly SVG ink lines through a turbulence filter, and offset ink shadows.

There are three rooms on one sliding track, with a shared HUD:
- **Lobby:**
  - a ticket rail with stamped channels and wait bars, and a batch paperclip;
  - customers with persona tags and patience bars;
  - the receipt printer, the espresso machine's busy tag and delivery bags;
  - the RL decision card, the "now brewing" KDS and the bottleneck card;
  - the **menu book**: click the lectern and it flies to full view, with real 3D page turns. Live prices change with
    an ink strike-through, a handwritten new price and a reason note. Spreads cover coffee, not-coffee, bakes, plates,
    **meal combos** and the **rescue shelf** (Replate).
- **Kitchen:** live station cards, crew with fatigue and enforced breaks, a stations board, and the chaos card.
- **Pantry:** walk-in fridge and dry store with lots, FEFO and freshness colours; lot cards with forecast P50/P90 and
  days of cover; the freshness bar; waste vs naive; and the newsvendor-sized next delivery.

The **profit component** in the HUD expands into range and bar charts of D vs A/B/C: *what you'd otherwise make*.
That chart replaces a separate arena screen. Integration with the live backend is the next phase
(`frontend-backend-integration.md`); the menu book already consumes backend-shaped events.

---

## 13. Engineering quality
- **Tests: 281 in 26 files** (pytest, with Hypothesis for invariants). They cover:
  - engine ordering, fork independence and determinism, plus CRN identity across policies;
  - kitchen capacity under random configurations;
  - inventory conservation, FEFO and auto-86;
  - ledger = profit and the GST split;
  - every charter rule;
  - Replate ladder monotonicity and the floor, and combo pricing, pairing and up-sell;
  - every event against its schema;
  - every API route, including the WebSocket (replay and resync);
  - the RL environment checker, masks never all-false, BC loss reduction, ONNX parity, and the end-to-end training
    CLI contract offline with resume and failure handling.
- **Static checks:** ruff and mypy clean on 126 source files.
- **Reproducibility:**
  - seeds everywhere, plus a deterministic CP-SAT time budget;
  - the model registry records git SHA and data lineage;
  - full-run metrics and an excerpt of the training log are committed under `docs/training/full-20261005/`;
  - small champion models (about 11 MB) are committed, so the demo never depends on retraining.
- **Agentic engineering:** the backend was built milestone by milestone (M1 foundation, M2 intelligence + Replate, M3
  RL) by Claude sub-agents working against written specs (`backend.md`, `docs/implementation-spec.md`). Each milestone
  had acceptance criteria and was verified independently before merging.

---

## 14. Impact
- **Economic:** +69 % profit vs naive operation and +8 % vs a strong optimiser. Worst-day profit (CVaR) is 6× the
  naive café's, which matters more for survival than the mean. Combos lift the average ticket by 4 %.
- **Environmental:** waste falls from 41 kg/day (naive) to 6–10 kg/day. Replate alone cuts the optimiser's waste by
  53 % at no profit cost. CO₂e is priced into the reward and the newsvendor, and donations are tracked. This ties to
  SDG 12.3 (halve food waste) and SDG 13.
- **Social:**
  - staff overload is part of the objective, and breaks are enforced;
  - the fair-pricing charter (±10 %, cooldowns, no staple increases, explained live on the menu) is enforced as a
    hard constraint;
  - persona-aware service protects people who can't wait;
  - every decision is explained, and the owner can override any of them.

---

## 15. Limitations and future work
- **The simulator is calibrated, not fitted to a specific real café.** Next: digital-twin calibration from a real
  POS CSV.
- **PPO plateaued in the long-episode stages.** Next: LR and entropy annealing, target_kl, fine-tuning from the
  champion, and RARL for chaos robustness.
- **D carries more waste than C.** Next: tune the waste weight, or add a waste-aware auxiliary head.
- **Out of scope for this build, kept as future work:** the LLM copilot (its eval set exists), voice, a customer QR
  page, multi-café inventory sharing and live weather.

---

## 16. Appendix
**Reproduce** (laptop smoke run, about 15 min; full run on the desktop, about 10 h):
```bash
uv sync && uv run pytest -q
```

```bash
uv run brew-train all --config configs/train/smoke.yaml --run-dir runs/smoke
```

```bash
uv run brew-eval --policies A,B,C,D --seeds 10 --days 7 --workers 4
```

```bash
uv run brew-api
```
The API docs are then at `http://localhost:8000/docs`.

**Where things live:**

| Path | What |
|---|---|
| `src/brew/sim/` | engine, world, arrivals, choice, customers, kitchen, inventory, delivery, reviews, finance, replate, combos, KPIs |
| `src/brew/policies/` | A, B, C (`C_solver.py`), D (`D_rl.py`), E, charter, strategies |
| `src/brew/forecast/`, `models/`, `opt/` | LightGBM forecaster, elasticity, prep/ETA/sell-through, newsvendor, pricing, CP-SAT, capacity LP |
| `src/brew/rl/` | env, actions, masks, reward, BC, PPO trainer, adversary/RARL, ONNX export/runtime, surrogate, pipeline |
| `src/brew/api/` | FastAPI app, world manager, live pacer, routers, WebSocket |
| `configs/` | café, scenarios, policies, training configs |
| `models/` | committed champions + `registry.json` |
| `design/` | the frontend (lobby, kitchen, pantry, menu book) |
| `docs/training/full-20261005/` | full-run config, metrics, eval, log excerpt |

**Glossary:**
- **CRN:** common random numbers.
- **CVaR:** conditional value at risk, the mean of the worst α of outcomes.
- **FEFO:** first-expired, first-out.
- **86:** remove an item from the menu.
- **κ:** service-level quantile.
- **BC:** behaviour cloning.
- **RARL:** robust adversarial RL.
- **WAPE:** weighted absolute percentage error.
- **Replate:** brew's rescue menu.
