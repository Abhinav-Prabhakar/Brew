# Prompt: explanations  (run with BATCH = 01, 02, 03, ... - change BATCH every run)
## Save output to: data/synthetic/raw/explanations/batch_{BATCH}.jsonl
## Rows per run: 100   Target total: 400 (>= 4 runs)

> **How to use (human):** open a fresh chat with a strong LLM, set `BATCH` below, paste this whole file, save the reply
> exactly as the path above (replace `{BATCH}` with your number, e.g. `batch_03.jsonl`). Run it ~4 times (BATCH 01..04) to reach 400 rows.
> Then run `uv run brew-synth validate explanations` and `uv run brew-synth status`.


**BATCH = 01**   <- change this number on every run (01, 02, 03, ...). Use it in every id (see "Id rule").

---

## Role

You write the **"why" sentences** shown next to every decision an AI cafe manager makes ("Raised iced latte by 10 rupees:
kitchen is 91% busy and it is 34 degrees"). You write them as **templates with `{slots}`** that code fills in with live
numbers. Quality bar: honest, specific, short, warm or crisp - never hype, never blame.

## Context

**Brew** (the cafe is called just "brew", always lowercase in signage) is a small, cozy, pink-themed independent
cafe in **Indiranagar, Bengaluru**. It is open 08:00-22:00, has six small two-seat tables (two can be pushed together
for groups), a pastry fridge, a thermal bill printer, a split-flap "Now Brewing" board and kraft delivery bags with a
pink "brew" stamp. Prices are in Indian rupees (INR), GST 5%. The team: Meera and Kabir (baristas), Dev (cook), Zoya
(cashier/runner) and Raju (dishwasher). Customers order at the counter, wait for the paper ticket to be made, then take
their food to a table (dine-in), carry it away (takeaway) or receive it by rider (delivery apps).

The manager (a program) can take these decision types. Each template you write is for exactly one `decision_type`:

| decision_type (use EXACTLY) | what happened | direction |
|---|---|---|
| `price_change` | price of an item moved by at most 10% (within the fair-pricing charter: staples such as chai and filter coffee never rise) | `up` or `down` |
| `feature_item` | an item was featured as "Today's Pick" | `none` |
| `hide_item` | an item was hidden ("sold out for now"), e.g. low stock or too slow for the rush | `none` |
| `prep_start` | the kitchen started prepping ahead (cold brew, chai base, croissants, paneer, fries) | `none` |
| `strategy_switch` | dispatch strategy changed (first-come-first-served, earliest-deadline, dine-in-first, delivery-just-in-time, batch-max, shortest-first) | `none` |
| `throttle` | delivery-app intake changed (open / +5 min / +10 min / paused) | `none` |
| `accept_order` | a delivery order was accepted with a promised time | `none` |
| `reject_order` | a delivery order was declined | `none` |
| `batch_hold` | the kitchen waited a short while to cook similar items together | `none` |
| `reorder` | stock was ordered from a supplier | `none` |

### Menu (for realistic item wording)

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

## The task

Write **100 distinct templates**. Spread them across the ten decision types (~10 each; `price_change` ~20, split evenly between
`up` and `down`), across `tone` = `warm` (friendly, one soft flourish allowed) and `crisp` (terse, numbers first), and across
different **factor combinations** (the data you cite). Vary sentence structure so they do not read like one template with words swapped.

### Allowed slots (use ONLY these; any other `{name}` will fail validation)

| slot | meaning / example value |
|---|---|
| `{sku}` | menu sku id, e.g. icedlatte |
| `{item}` | human item name, e.g. Iced Latte |
| `{category}` | coffee / notcoffee / bakes / plates |
| `{old}` | old price in rupees, e.g. 260 |
| `{new}` | new price in rupees, e.g. 270 |
| `{delta}` | rupee change magnitude, e.g. 10 |
| `{pct}` | percentage figure, e.g. 40 |
| `{load}` | kitchen load as a number, e.g. 91 |
| `{load_pct}` | kitchen load percent, e.g. 91 |
| `{forecast_delta}` | forecast demand change percent, e.g. 35 |
| `{temp}` | temperature in deg C, e.g. 34 |
| `{stock}` | units or amount in stock, e.g. 6 |
| `{stock_days}` | days of cover left, e.g. 0.6 |
| `{channel}` | dine_in / takeaway / zomato / swiggy |
| `{queue}` | open tickets in the queue, e.g. 14 |
| `{hour}` | time or daypart, e.g. 3 pm or the lunch rush |
| `{reason}` | short free-text reason |
| `{qty}` | quantity to prep or order, e.g. 4 L |
| `{prep_item}` | prep item name, e.g. cold brew concentrate |
| `{supplier}` | supplier name |
| `{strategy}` | dispatch strategy name, e.g. delivery-first |
| `{rain}` | rain intensity in mm/h, e.g. 6 |
| `{p90}` | pessimistic (P90) demand number |
| `{wait_min}` | expected wait in minutes |
| `{orders}` | number of orders, e.g. 9 |
| `{level}` | throttle level (open / +5 min / +10 min / paused) |
| `{ingredient}` | ingredient name, e.g. oat milk |

### Rules

* 10-300 characters. One or two short sentences. Use **at least two slots**; every slot you use must make sense for that decision type.
* `factors` lists the data the sentence is based on, as short snake_case keys; use only: `load`, `forecast_delta`, `temp`, `stock`,
  `queue`, `hour`, `channel`, `rain`, `p90`, `wait_min`, `orders`, `strategy`, `reason`, `price_index`, `shelf_life`. Every factor you list
  should appear (through its slot) in the template, and vice-versa.
* Slot values are inserted as plain text, so write units around them ("{load_pct}% busy", "Rs{delta}" or the rupee sign, "{wait_min} min").
  Do not put `%` or currency inside the slot itself. Never put a slot inside another word.
* `direction`: `up`/`down` for `price_change`; `none` for every other type.
* Tone: no exclamation marks in `crisp`; at most one in `warm`. No emojis. No blame ("because you were slow"). No claims of certainty about the
  future ("will definitely") - use "expected", "likely", "looks like".
* Keep the fairness stance visible where relevant: price rises are modest and never on staples; mention capacity or demand, never "because customers
  will pay".

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
| `decision_type` | string | one of the ten types above |
| `direction` | string or null | `up`, `down` or `none` |
| `factors` | array of strings | 1+ keys from the allowed factor list |
| `template` | string | 10-300 chars; only allowed `{slots}` |
| `tone` | string | `warm` or `crisp` |

### Id rule

`EXP-{BATCH}-{000..099}` - e.g. BATCH 01 -> `EXP-01-000`, zero-padded to three digits.

## Examples (format only - write your own)

{"id":"EXP-01-000","decision_type":"price_change","direction":"up","factors":["load","temp"],"template":"Raised {item} by Rs{delta}: kitchen is {load_pct}% busy and it is {temp} C outside, so cold drinks are in demand.","tone":"crisp"}
{"id":"EXP-01-001","decision_type":"price_change","direction":"down","factors":["hour","queue"],"template":"A small nudge on {item} - down Rs{delta} - while the {hour} lull keeps the bar quiet. Come on in!","tone":"warm"}
{"id":"EXP-01-002","decision_type":"hide_item","direction":"none","factors":["stock","shelf_life"],"template":"{item} is paused for now: only {stock_days} days of {ingredient} left and the next delivery is late.","tone":"warm"}
{"id":"EXP-01-003","decision_type":"throttle","direction":"none","factors":["orders","wait_min"],"template":"Delivery intake set to {level}: {orders} open delivery tickets would push promises past {wait_min} min.","tone":"crisp"}
{"id":"EXP-01-004","decision_type":"batch_hold","direction":"none","factors":["queue","strategy"],"template":"Holding the next {item} for a minute so it can steam with the {queue} similar tickets waiting - saves the barista time.","tone":"warm"}

## Before you answer (silent self-check - do not print it)

1. Every line parses as JSON on its own and matches the schema exactly (no extra keys, enums spelled exactly).
2. Ids follow the id rule and are unique and consecutive.
3. The distribution targets are met within about 5 percentage points over the whole reply.
4. No two rows share the same wording; no real brands, people, phone numbers, addresses or slurs appear.
5. There is no text outside the JSON lines.
