# Prompt: supplier_catalog  (run with BATCH = 01, 02, 03, ... - change BATCH every run)
## Save output to: data/synthetic/raw/supplier_catalog/batch_{BATCH}.jsonl
## Rows per run: 50   Target total: 50 (one per ingredient; optional second batch for alternatives)

> **How to use (human):** open a fresh chat with a strong LLM, set `BATCH` below, paste this whole file, save the reply
> exactly as the path above (replace `{BATCH}` with your number, e.g. `batch_03.jsonl`). Run once (BATCH 01) for one row per ingredient; optionally run BATCH 02 for a second, different supplier per ingredient.
> Then run `uv run brew-synth validate supplier_catalog` and `uv run brew-synth status`.


**BATCH = 01**   <- change this number on every run (01, 02, 03, ...). Use it in every id (see "Id rule").

---

## Role

You are a **procurement analyst for independent cafes in Bengaluru**. For every ingredient below you describe a realistic wholesale offer in
**2026 INR**: pack size, price per pack, lead time, minimum order, how far the supplier is. The numbers calibrate the inventory part of a cafe
simulator, so they must be plausible and internally consistent, not exact quotes.

## Context

**Brew** (the cafe is called just "brew", always lowercase in signage) is a small, cozy, pink-themed independent
cafe in **Indiranagar, Bengaluru**. It is open 08:00-22:00, has six small two-seat tables (two can be pushed together
for groups), a pastry fridge, a thermal bill printer, a split-flap "Now Brewing" board and kraft delivery bags with a
pink "brew" stamp. Prices are in Indian rupees (INR), GST 5%. The team: Meera and Kabir (baristas), Dev (cook), Zoya
(cashier/runner) and Raju (dishwasher). Customers order at the counter, wait for the paper ticket to be made, then take
their food to a table (dine-in), carry it away (takeaway) or receive it by rider (delivery apps).

### Ingredients (write exactly ONE row for EACH key in this table, in this order)

| ingredient key (use EXACTLY) | name | base unit | storage | shelf life sealed (h) | current model unit cost (INR per base unit) |
|---|---|---|---|---|---|
| `coffee_beans` | Coffee beans (Chikmagalur) | g | ambient | 4320 | 1.65 |
| `decaf_beans` | Decaf beans | g | ambient | 4320 | 2.25 |
| `filter_coffee_powder` | Filter coffee powder | g | ambient | 4320 | 1.05 |
| `milk` | Milk (toned) | ml | chilled | 96 | 0.09 |
| `oat_milk` | Oat milk | ml | chilled | 4320 | 0.45 |
| `almond_milk` | Almond milk | ml | chilled | 4320 | 0.54 |
| `sugar` | Sugar | g | ambient | 8760 | 0.075 |
| `ice` | Ice | g | frozen | 168 | 0.015 |
| `rose_syrup` | Rose syrup | ml | ambient | 4320 | 0.525 |
| `dark_choc` | Dark chocolate 54% | g | ambient | 4320 | 1.35 |
| `marshmallow` | Marshmallow | g | ambient | 4320 | 0.75 |
| `matcha_powder` | Matcha (Uji) | g | chilled | 4320 | 11.25 |
| `strawberry_puree` | Strawberry puree | ml | chilled | 168 | 0.375 |
| `vanilla_icecream` | Vanilla ice cream | g | frozen | 2160 | 0.42 |
| `chai_leaves` | Assam CTC tea | g | ambient | 4320 | 0.675 |
| `ginger` | Ginger | g | chilled | 240 | 0.3 |
| `spice_mix` | Chai spice mix | g | ambient | 4320 | 1.8 |
| `sabja_seeds` | Sabja seeds | g | ambient | 4320 | 0.9 |
| `croissant_dough` | Croissant dough (frozen) | pc | frozen | 2160 | 39 |
| `butter` | Butter | g | chilled | 1440 | 0.93 |
| `muffin_fg` | Blueberry muffin (bakery) | pc | ambient | 48 | 93 |
| `cheesecake_slice` | Strawberry cheesecake slice (bakery) | pc | chilled | 72 | 147 |
| `cinnamon_roll_fg` | Cinnamon roll (bakery) | pc | ambient | 36 | 87 |
| `waffle_mix` | Waffle batter mix | g | ambient | 4320 | 0.27 |
| `maple_syrup` | Maple syrup | ml | ambient | 8760 | 1.35 |
| `sourdough` | Sourdough slice | pc | ambient | 72 | 13.5 |
| `avocado` | Avocado | pc | chilled | 120 | 105 |
| `chilli_crunch` | Chilli crunch | g | ambient | 4320 | 1.5 |
| `microgreens` | Microgreens | g | chilled | 96 | 3.75 |
| `sandwich_bread` | Sandwich bread slice | pc | ambient | 96 | 6 |
| `mint_chutney` | Mint chutney | g | chilled | 120 | 0.375 |
| `pickled_onion` | Pickled onion | g | chilled | 336 | 0.225 |
| `cheddar` | Cheddar | g | chilled | 1440 | 1.125 |
| `green_chilli` | Green chilli | g | chilled | 168 | 0.225 |
| `jalapeno` | Jalapeno slices | g | chilled | 720 | 0.75 |
| `potato` | Potato | g | ambient | 336 | 0.06 |
| `oil` | Frying oil | ml | ambient | 4320 | 0.195 |
| `seasoning` | Peri-peri seasoning | g | ambient | 4320 | 1.2 |
| `pasta_dry` | Penne (dry) | g | ambient | 8760 | 0.165 |
| `arrabbiata_sauce` | Arrabbiata sauce | ml | chilled | 168 | 0.3 |
| `parmesan` | Parmesan | g | chilled | 2160 | 2.4 |
| `paneer` | Paneer | g | chilled | 120 | 0.54 |
| `tikka_masala` | Tikka marinade spices + curd | g | chilled | 168 | 0.45 |
| `cup_paper_m` | Paper cup 12oz | pc | ambient | 17520 | 4.8 |
| `lid` | Cup lid | pc | ambient | 17520 | 1.65 |
| `sleeve` | Cup sleeve | pc | ambient | 17520 | 1.35 |
| `straw` | Paper straw | pc | ambient | 17520 | 1.2 |
| `kraft_bag` | Kraft bag (brew stamp) | pc | ambient | 17520 | 5.25 |
| `food_box` | Food box | pc | ambient | 17520 | 9 |
| `cutlery_set` | Cutlery set | pc | ambient | 17520 | 3.75 |

(`pc` = piece; `g` = gram; `ml` = millilitre. "Current model unit cost" is a rough anchor so you stay in the right magnitude - your price may differ by up to
+/-40% if you can justify it, and should differ on a few rows.)

## The task

Write **50 rows** (one per ingredient, same order as the table). Invent **fictional supplier names** (e.g. "Nandi Fresh Dairy", "KR Market Produce",
"Sunrise Bakehouse") - never real companies or brands. Reuse a supplier name across several of its natural products (a dairy supplies milk, butter, cheese;
a roaster supplies beans and tea; a packaging company supplies cups, lids and bags; produce wholesaler supplies vegetables and fruit).

### Rules and realism

* `pack_size` and `pack_uom`: **convert to the ingredient's base unit shown in the table** - `pack_uom` must be exactly `g`, `ml` or `pc` as in the "base unit"
  column (5 kg of sugar -> `5000`, `g`). Typical wholesale packs: milk 1 L, beans 1 kg, packaging 50-100 pcs, produce 1-5 kg, frozen 2-5 kg, finished
  bakery goods boxes of 6.
* `price_inr`: price **per pack** in INR (a number), consistent with the pack size and the anchor unit cost.
* `lead_time_h_mean` / `lead_time_h_sd`: hours from order to delivery. Local fresh suppliers 6-12 h (sd 1-3); regional dry goods 24-48 h (sd 4-8);
  distant specialty (coffee roaster ~240 km away, matcha importer) 30-72 h (sd 6-12).
* `min_order_packs`: integer >= 1 (e.g. milk 6 packs, produce 1, packaging 2).
* `is_local`: true if within ~25 km of Indiranagar; `distance_km`: realistic number (local 5-20, regional 20-60, distant 100-350).
* `notes`: one short sentence (storage, delivery days, any caution), <= 120 chars, no marketing claims or certifications you cannot back up.
* Perishables (milk, avocado, paneer, microgreens, fresh produce, bakery) need short lead times and local suppliers; imported or dry staples can be distant.
* No real brands, people, phone numbers or addresses.

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
| `ingredient` | string | the ingredient key from the table, exactly |
| `supplier_name` | string | fictional supplier |
| `pack_size` | number | > 0, in the ingredient's base unit |
| `pack_uom` | string | `g`, `ml` or `pc` (same as the base unit) |
| `price_inr` | number | > 0, per pack |
| `lead_time_h_mean` | number | > 0 |
| `lead_time_h_sd` | number | >= 0 |
| `min_order_packs` | integer | >= 1 |
| `is_local` | boolean | true/false |
| `distance_km` | number | >= 0 |
| `notes` | string | <= 120 chars |

### Id rule

`SUP-{BATCH}-{000..049}` - e.g. BATCH 01 -> `SUP-01-000` ... `SUP-01-049`, in table order.

## Examples (format only)

{"id":"SUP-01-000","ingredient":"coffee_beans","supplier_name":"Chikmagalur Roasters","pack_size":1000,"pack_uom":"g","price_inr":1150,"lead_time_h_mean":30,"lead_time_h_sd":6,"min_order_packs":3,"is_local":false,"distance_km":240,"notes":"Vacuum-packed medium roast; dispatches Mon-Sat."}
{"id":"SUP-01-003","ingredient":"milk","supplier_name":"Nandi Fresh Dairy","pack_size":1000,"pack_uom":"ml","price_inr":62,"lead_time_h_mean":10,"lead_time_h_sd":2,"min_order_packs":6,"is_local":true,"distance_km":12,"notes":"Crate delivery before 7 am; use within 4 days sealed."}
{"id":"SUP-01-045","ingredient":"cup_paper_m","supplier_name":"GreenPack Supplies","pack_size":100,"pack_uom":"pc","price_inr":330,"lead_time_h_mean":48,"lead_time_h_sd":8,"min_order_packs":2,"is_local":false,"distance_km":30,"notes":"Delivers Tue and Fri; 12 oz paper cups."}

## Before you answer (silent self-check - do not print it)

1. Every line parses as JSON on its own and matches the schema exactly (no extra keys, enums spelled exactly).
2. Ids follow the id rule and are unique and consecutive.
3. The distribution targets are met within about 5 percentage points over the whole reply.
4. No two rows share the same wording; no real brands, people, phone numbers, addresses or slurs appear.
5. There is no text outside the JSON lines.
