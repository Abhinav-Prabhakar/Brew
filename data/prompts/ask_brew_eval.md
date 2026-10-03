# Prompt: ask_brew_eval  (run with BATCH = 01, 02, 03, ... - change BATCH every run)
## Save output to: data/synthetic/raw/ask_brew_eval/batch_{BATCH}.jsonl
## Rows per run: 75   Target total: 300 (>= 4 runs)

> **How to use (human):** open a fresh chat with a strong LLM, set `BATCH` below, paste this whole file, save the reply
> exactly as the path above (replace `{BATCH}` with your number, e.g. `batch_03.jsonl`). Run it ~4 times (BATCH 01..04) to reach 300 rows; each run should cover different intents.
> Then run `uv run brew-synth validate ask_brew_eval` and `uv run brew-synth status`.


**BATCH = 01**   <- change this number on every run (01, 02, 03, ...). Use it in every id (see "Id rule").

---

## Role

You write the **evaluation set for "Ask Brew"**, a future copilot that answers a cafe owner's questions by calling the Brew REST API. Each row is
one realistic owner question, the API endpoint(s) a correct agent would call, the parameters, and a sketch of what a correct answer must contain.
The set will later be used to grade whether the copilot picks the right endpoints and reports the right numbers.

## Context

**Brew** (the cafe is called just "brew", always lowercase in signage) is a small, cozy, pink-themed independent
cafe in **Indiranagar, Bengaluru**. It is open 08:00-22:00, has six small two-seat tables (two can be pushed together
for groups), a pastry fridge, a thermal bill printer, a split-flap "Now Brewing" board and kraft delivery bags with a
pink "brew" stamp. Prices are in Indian rupees (INR), GST 5%. The team: Meera and Kabir (baristas), Dev (cook), Zoya
(cashier/runner) and Raju (dishwasher). Customers order at the counter, wait for the paper ticket to be made, then take
their food to a table (dine-in), carry it away (takeaway) or receive it by rider (delivery apps).

The owner runs the cafe with an AI manager. They look at KPIs, change prices, hide items, handle delivery apps, buy equipment and worry about staff,
waste and reviews. They ask in plain language, sometimes in a hurry, sometimes in Hinglish.

### Menu (for realistic items in questions)

| sku (use EXACTLY this id) | name | category | base price (INR) | what it is |
|---|---|---|---|---|
| `cappuccino` | Cappuccino | coffee | 220 | Double ristretto under velvety microfoam. Poured with a heart. |
| `flatwhite` | Flat White | coffee | 240 | Silky, strong and small - our Chikmagalur house blend. |
| `icedlatte` | Iced Latte | coffee | 260 | Espresso over cold milk and big clear ice. |
| `coldbrew` | Cold Brew | coffee | 250 | 18-hour steep, chocolatey and low-acid. With an orange twist. |
| `chai` | Masala Chai | notcoffee | 140 | Assam, ginger, cardamom and clove - served in a kulhad. |
| `matcha` | Matcha Latte | notcoffee | 290 | Ceremonial-grade Uji matcha, whisked to order. |
| `hotchoc` | Hot Chocolate | notcoffee | 230 | 54% single-origin chocolate, marshmallows on top. |
| `rosemilk` | Rose Milk | notcoffee | 180 | Chilled rose milk with sabja seeds. A Chennai classic. |
| `croissant` | Butter Croissant | bakes | 180 | 72 layers, French butter, baked at 6 every morning. |
| `muffin` | Blueberry Muffin | bakes | 160 | Bursting with berries and a crunchy sugar top. |
| `cheesecake` | Strawberry Cheesecake | bakes | 290 | Baked Basque-style, Mahabaleshwar strawberry glaze. |
| `cinnamon` | Cinnamon Roll | bakes | 190 | Soft swirl, brown-butter cinnamon, cream cheese icing. |
| `avotoast` | Avocado Toast | plates | 380 | Sourdough, smashed avo, chilli crunch and microgreens. |
| `sandwich` | Paneer Tikka Sandwich | plates | 320 | Tandoori paneer, mint chutney, pickled onion, toasted. |
| `cheesetoast` | Chilli Cheese Toast | plates | 260 | Bombay-style, bubbling cheddar and green chilli. |
| `espresso` | Espresso | coffee | 140 | A double ristretto, nothing else. |
| `latte` | Latte | coffee | 230 | Smooth, milky and mellow. |
| `roselatte` | Rose Latte | coffee | 270 | Espresso, steamed milk and a rose petal syrup. |
| `filtercoffee` | Filter Coffee | coffee | 120 | South Indian decoction, frothed in a dabarah. |
| `strawberryshake` | Strawberry Shake | notcoffee | 240 | Mahabaleshwar strawberries, blended thick. |
| `waffle` | Waffle | bakes | 260 | Crisp-edged Belgian waffle, maple and berries. |
| `fries` | Fries | plates | 160 | Skin-on, salted, with peri-peri dust. |
| `pasta` | Pasta Arrabbiata | plates | 330 | Penne in a fiery tomato sauce, parmesan. |

### The API (the only endpoints that exist; `{id}` is the world id)

| endpoint (write EXACTLY as `METHOD /path`, `{id}` stays literal) | answers questions about |
|---|---|
| `GET /cafe` | cafe profile, menu, channels, personas, stations, catalog of investments |
| `GET /worlds/{id}` | status of the running cafe: clock, speed, policy, strategy |
| `GET /worlds/{id}/state` | everything at once (menu, rail, board, customers, tables, fridge, shelf, staff, equipment, policy) |
| `GET /worlds/{id}/menu` | live prices, base prices, price-change chips, featured, hidden items and why |
| `GET /worlds/{id}/orders` | open/recent orders with items, modifiers, notes, promised time, progress, batch (params: `status`, `channel`) |
| `GET /worlds/{id}/rail` | ticket rail order, batch groups |
| `GET /worlds/{id}/board` | brewing / almost ready / ready columns |
| `GET /worlds/{id}/customers` | customers in the cafe with state, persona, patience, table |
| `GET /worlds/{id}/tables` | tables, seats, merged groups, occupancy |
| `GET /worlds/{id}/inventory` | ingredients and prep items: on hand, days of cover, expiring soon |
| `GET /worlds/{id}/inventory/{key}/lots` | lots of one ingredient with expiry and quality |
| `GET /worlds/{id}/fridge` | pastry-fridge finished goods stock |
| `GET /worlds/{id}/shelf` | delivery bags on the pickup shelf, rider ETA, food quality |
| `GET /worlds/{id}/staff` | staff, current task, fatigue, shift |
| `GET /worlds/{id}/equipment` | machine status, slots in use, breakdowns |
| `GET /worlds/{id}/kpis` | daily and rolling KPIs: revenue, profit, orders by channel, waits, SLA breaches, waste, CO2e (params: `from`, `to`) |
| `GET /worlds/{id}/impact` | triple-bottom-line scoreboard (profit, waste/CO2e/donations, overload/waits/rating) |
| `GET /worlds/{id}/forecast` | P10/P50/P90 demand forecast per item or channel (params: `target`, `key`, `horizon_min`) |
| `GET /worlds/{id}/decisions` | recent AI decisions (params: `since_seq`) |
| `GET /decisions/{id}/explain` | the reason behind one decision |
| `GET /worlds/{id}/bottlenecks` | what resource currently limits throughput |
| `GET /worlds/{id}/advisor` | ranked investment recommendations with payback |
| `POST /worlds/{id}/invest` | buy an investment (body: `catalog_key`) |
| `GET /worlds/{id}/reviews` | recent reviews with stars, text, causes (params: `limit`) |
| `GET /worlds/{id}/receipts/{order_no}` | itemised receipt with GST split |
| `POST /worlds/{id}/control` | play / pause / speed / step the simulation |
| `POST /worlds/{id}/policy` | switch policy A-E or manual strategy |
| `POST /worlds/{id}/fork` | clone the world for a what-if |
| `POST /worlds/{id}/chaos` | inject a disruption (staff absent, equipment down, supplier late, rider shortage...) |
| `POST /worlds/{id}/actions` | owner actions: set_price, feature_item, hide_item, throttle, place_po, restock_fridge, bump_order, serve_order |
| `POST /arena` | race policies on identical days |
| `GET /arena/{id}` | arena results with confidence intervals |
| `GET /models` | model registry and metrics |
| `GET /health` | service health |

Some read models return: KPIs `{revenue, net_profit, orders, orders_by_channel, avg_wait_s, p95_wait_s, sla_breach_rate, balks, reneges, rating, reviews_neg, waste_kg, waste_inr, donated_kg, energy_kwh, co2e_kg, overload_min, price_changes, batch_rate}`; menu items `{sku, price, base, chip, featured, hidden, hidden_reason}`; inventory items `{key, on_hand, days_of_cover, next_expiry_s}`; bottlenecks `{resource, rho, wait_attribution, shadow_price}`; advisor entries `{catalog_key, delta_profit_per_day, ci90, payback_days}`; reviews `{stars, text, causes}`.

## The task

Write **75 distinct owner questions** with labels.

### Intent taxonomy (`intent`, snake_case; use these and nothing else)

`profit_diagnosis`, `kpi_lookup`, `menu_pricing`, `inventory_stockouts`, `waste_and_sustainability`, `staffing_and_fatigue`, `delivery_management`,
`reviews_sentiment`, `forecast_demand`, `bottleneck_analysis`, `investment_advice`, `policy_comparison`, `chaos_response`, `fairness_charter`,
`receipts_and_gst`, `live_status`, `how_to_control`, `explain_decision`.

### Distribution targets (over 75 rows)

* About 4 rows per intent (some more for `kpi_lookup`, `menu_pricing`, `bottleneck_analysis`, `investment_advice`).
* ~55% need **one** endpoint, ~35% need **two**, ~10% need three (multi-step: e.g. look up bottlenecks, then advisor).
* ~20% mix in Hinglish (Roman script), ~15% are vague or underspecified ("why was yesterday bad?") and the sketch must say what the agent should
  assume (e.g. "use the last completed day"), ~10% are action requests ("pause zomato for an hour", "hide the pasta") -> `POST` endpoints with
  the exact body in `params`.
* ~5% are **traps**: questions that sound answerable but where the correct behaviour is to say the data is not available yet (forecasts and the
  advisor may be unavailable) - the sketch must say so; still list the endpoint the agent should try.

### Rules

* `endpoints`: 1+ strings of the form `METHOD /path` copied from the table above (keep `{id}`/`{key}`/`{order_no}` placeholders literal).
* `params`: an object with query parameters or the JSON body, e.g. `{"limit": 20}`, `{"action":"speed","speed":10}`, `{"kind":"set_price","sku":"icedlatte","price":270}`.
  Use real sku ids from the menu. Empty `{}` is fine. Charter rules to respect in actions: price steps <= 10% of base, once per 2 hours, no
  increases on chai or filtercoffee.
* `answer_sketch`: 10-400 chars: the facts the right answer must contain and which fields to read ("Compare net_profit for yesterday vs the previous
  7-day mean; name the top bottleneck from rho and the main cause among wait/waste/price"). Do not invent numbers.
* Questions are in the owner's voice, 8-300 chars, no personal data. Avoid brands and real people.

## Output format (strict)

* **JSON Lines**: exactly one JSON object per line, UTF-8, double-quoted keys and strings, no trailing commas.
* **No prose before or after, no explanations, no markdown, no code fences, no comments, no blank lines, no numbering.**
  Your entire reply is the data - the human will save it to a file byte-for-byte.
* Output exactly the requested number of lines. If you run out of room, stop at a complete line - never cut a JSON
  object in half - and the human will run you again with the next BATCH.
* Do not repeat any row, near-duplicate sentence template, or id.

## Schema (field by field)

| field | type | rules |
|---|---|---|
| `id` | string | Id rule below |
| `question` | string | 8-300 chars |
| `intent` | string | one of the taxonomy values |
| `endpoints` | array of strings | `METHOD /path` strings from the API table |
| `params` | object | query params or body |
| `answer_sketch` | string | 10-400 chars |

### Id rule

`ASK-{BATCH}-{000..074}` - e.g. BATCH 03 -> `ASK-03-000`, zero-padded to three digits.

## Examples (format only)

{"id":"ASK-01-000","question":"Why was my profit low yesterday?","intent":"profit_diagnosis","endpoints":["GET /worlds/{id}/kpis","GET /worlds/{id}/bottlenecks"],"params":{"from":-1},"answer_sketch":"Compare yesterday's net_profit with the trailing average; attribute the gap to the top bottleneck (rho, wait attribution) and to waste_inr or price changes."}
{"id":"ASK-01-001","question":"pause zomato for the next hour, kitchen is dying","intent":"delivery_management","endpoints":["POST /worlds/{id}/actions"],"params":{"kind":"throttle","channel":"zomato","level":"pause"},"answer_sketch":"Confirm the throttle action succeeded and note that pausing costs platform ranking (about 3% per paused hour)."}
{"id":"ASK-01-002","question":"Which beans are running out first and when do I need to order?","intent":"inventory_stockouts","endpoints":["GET /worlds/{id}/inventory"],"params":{},"answer_sketch":"List items with the lowest days_of_cover, highlight coffee_beans and milk, and say the order deadline from supplier cutoff."}

## Before you answer (silent self-check - do not print it)

1. Every line parses as JSON on its own and matches the schema exactly (no extra keys, enums spelled exactly).
2. Ids follow the id rule and are unique and consecutive.
3. The distribution targets are met within about 5 percentage points over the whole reply.
4. No two rows share the same wording; no real brands, people, phone numbers, addresses or slurs appear.
5. There is no text outside the JSON lines.
