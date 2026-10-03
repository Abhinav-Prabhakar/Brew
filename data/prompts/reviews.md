# Prompt: reviews  (run with BATCH = 01, 02, 03, ... - change BATCH every run)
## Save output to: data/synthetic/raw/reviews/batch_{BATCH}.jsonl
## Rows per run: 120   Target total: 3,000 (>= 25 runs)

> **How to use (human):** open a fresh chat with a strong LLM, set `BATCH` below, paste this whole file, save the reply
> exactly as the path above (replace `{BATCH}` with your number, e.g. `batch_03.jsonl`). Run it ~25 times (BATCH 01..25) to reach 3,000 rows; each batch emphasises a different theme so the data stays varied.
> Then run `uv run brew-synth validate reviews` and `uv run brew-synth status`.


**BATCH = 01**   <- change this number on every run (01, 02, 03, ...). Use it in every id (see "Id rule").

---

## Role

You are a careful **synthetic-data author**. You write short, realistic customer reviews of one specific cafe, the way
real people in Bengaluru type them on a phone, and you label each with structured metadata. The data trains a
text classifier ("which things is this review complaining about or praising?") and supplies review text to a cafe
simulator, so **label accuracy and variety matter more than polish**.

## Context: the cafe

**Brew** (the cafe is called just "brew", always lowercase in signage) is a small, cozy, pink-themed independent
cafe in **Indiranagar, Bengaluru**. It is open 08:00-22:00, has six small two-seat tables (two can be pushed together
for groups), a pastry fridge, a thermal bill printer, a split-flap "Now Brewing" board and kraft delivery bags with a
pink "brew" stamp. Prices are in Indian rupees (INR), GST 5%. The team: Meera and Kabir (baristas), Dev (cook), Zoya
(cashier/runner) and Raju (dishwasher). Customers order at the counter, wait for the paper ticket to be made, then take
their food to a table (dine-in), carry it away (takeaway) or receive it by rider (delivery apps).

### Menu (the only items that exist)

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

### Customer personas (who writes the review)

| persona key | who they are | what they write about / voice |
|---|---|---|
| `commuter` | Office-goer grabbing coffee before/after work; 4-minute patience; mostly takeaway. | speed, queue length, consistent espresso drinks, croissant; terse and busy |
| `student` | College/PU student on a budget, often in groups of 2-3; long hangouts. | price/value, chai, fries, cheese toast, seats, power plugs; casual, sometimes Hinglish |
| `leisurely` | Brunchers and couples with time to spare, mostly weekends. | ambience, music, plating, pastries, waffle, flat white; descriptive and warm |
| `remote_worker` | Laptop camper staying 2-3 hours, orders refills. | wifi, plugs, noise level, table availability, cold brew, not being rushed |
| `family` | Parents with kids, parties of 3-4, weekend and evening. | kid-friendly food, spice level, seating, patience of staff, shakes, fries, pasta |
| `office_bulk` | Admin ordering 8-20 items for a team (takeaway or delivery). | order accuracy, complete labelled bags, timeliness, packaging |
| `delivery_home` | Person ordering to their home through a delivery app. | arrival temperature, packaging, missing/wrong items, delivery time, portion vs price |
| `tourist` | Visitor to Bengaluru, first time at brew. | local flavour (filter coffee, chai), 'hidden gem' feel, friendly staff, value, photo-worthy |
| `regular` | Local who comes several times a week and knows the staff by name. | consistency, being remembered, small changes in quality/price; familiar and affectionate |

### Channels (how they got the food)

| channel (use EXACTLY) | meaning |
|---|---|
| `dine_in` | ate at the cafe |
| `takeaway` | ordered at the counter and left with it |
| `zomato` | delivered through a food-delivery app (generic: say "the delivery", never name the app) |
| `swiggy` | delivered through a second food-delivery app (same: never name the app) |

### Cause keys (what the review is about) - use ONLY these nine

| cause key | meaning | typical negative phrasing | typical positive phrasing |
|---|---|---|---|
| `wait` | speed of service / time to receive the order | "took 40 minutes", "queue was endless" | "ready in two minutes", "quick even in the rush" |
| `cold_food` | food/drink arrived cold or soggy (mainly delivery, also slow-to-table food) | "lukewarm", "fries were soggy" | "still piping hot" |
| `price` | prices felt unfair, changed, or too high | "overpriced", "price went up again" | "fair prices", "pocket-friendly" |
| `quality` | taste / freshness / how well the item was made | "burnt coffee", "stale croissant" | "perfect flat white", "so fresh" |
| `ambience` | seating, noise, cleanliness, music, vibe, crowding | "no table", "too loud", "dirty table" | "cosy", "lovely music", "nice corner" |
| `staff` | behaviour and attentiveness of people | "rude cashier", "ignored us" | "kind", "remembered my order" |
| `accuracy` | the order matches what was asked (items, modifiers, notes) | "forgot my latte", "ignored no onion" | "exactly as I asked" |
| `packaging` | bag/box/lid/spill/neatness for takeaway & delivery | "leaked everywhere", "squashed" | "neatly packed", "nothing spilled" |
| `value` | worth the money / portion size | "tiny portion for the price" | "generous portions", "worth every rupee" |

## The task

Write **120 distinct reviews** (one JSON object per line). Each is a review a real customer might leave on a maps
page or a delivery-app rating screen after one specific visit/order at brew.

### Variety this run (BATCH-dependent emphasis)

Use `BATCH mod 5` to bias the *situations* (still keep the global targets below):

* 1 -> monsoon rain days, wet customers, delivery delays, hot drinks, "cosy rainy day" vibes.
* 2 -> crowded weekend brunch, no seats, long queue, families, waffle/pancake-style indulgence, ambience.
* 3 -> cricket match / festival evenings, delivery surges, rider waits, cold food, packaging.
* 4 -> exam weeks and work-from-cafe days, wifi/plugs/noise, cold brew, students, value for money.
* 0 -> quiet weekday mornings, commuters, regulars, consistency, staff names (Meera, Kabir, Zoya, Dev), small pricing complaints.

### Distribution targets over the 120 rows

* **Stars**: 1 star ~12%, 2 stars ~13%, 3 stars ~20%, 4 stars ~27%, 5 stars ~28%. (Every star level must be >= 10%.)
* **Channel**: `dine_in` ~45%, `takeaway` ~15%, `zomato` ~22%, `swiggy` ~18%.
* **Persona**: spread across all nine; make `delivery_home` appear mainly with `zomato`/`swiggy`, `office_bulk` with
  `takeaway`/`zomato`/`swiggy`, `remote_worker` only with `dine_in`; `regular` mostly `dine_in`/`takeaway`.
* **Language**: ~80% `en` (natural Indian English), ~20% `hinglish` (Hindi/Kannada words written in Roman letters mixed
  into English, e.g. "chai mast thi", "thoda late hua", "paisa vasool"). Never use Devanagari or Kannada script.
* **Length**: `text` is 8-280 characters; typically 60-180. Include a few very short ones ("Loved the chai.") and a few long.
* **Menu mentions**: about 70% of reviews mention 1-3 menu items by natural name; list their ids in `skus_mentioned`.
  The rest mention none (empty list).
* **Causes per row**: 1-3 keys. For stars 1-3 the causes are **what went wrong**; for stars 4-5 they are **what was good**;
  a 3-star review can have both a good and a bad cause. Weights are in 0..1; they should roughly add up to 1.0
  (the hard limit is 1.5). The cause with the highest weight must be the main theme of the text.
* Include a small share (~8%) of **tricky** rows: sarcasm ("Great, only 50 minutes for a toast"), mixed feelings, a
  complaint inside a 4-star review, a compliment inside a 2-star review, and typos/abbreviations ("pls", "gud", "v slow").

### Coherence rules

* Stars, sentiment of the text, and causes must agree. A 5-star review never complains; a 1-star never praises the same thing.
* Channel realism: delivery rows talk about arrival, packaging, rider wait, temperature, missing items - not tables or music.
  Dine-in rows may talk about seating, staff, ambience, waiting at the counter. Takeaway rows: queue speed, cup/lid, packing.
* `cold_food` and `packaging` are mostly delivery/takeaway causes; `ambience` is dine-in (or takeaway queue crowding).
* Prices must be plausible for the menu above (e.g. a cappuccino is about 220 rupees; do not quote impossible prices).
* Mention a staff member by first name (Meera, Kabir, Zoya, Dev) in at most ~5% of rows, and only in dine-in/takeaway.

### Things to avoid

No real restaurant, brand, app or product names (say "the delivery app" / "the rider"); no real people, celebrities or
addresses beyond "Indiranagar"/"Bengaluru"; no phone numbers or emails; no slurs, hate, sexual content or strong
profanity; no medical or food-safety claims ("gave me food poisoning"); no discounts/offers that are not on the menu;
no emojis except at most one in ~10% of rows.

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
| `persona` | string | one of the nine persona keys, exactly |
| `channel` | string | `dine_in` \| `takeaway` \| `zomato` \| `swiggy` |
| `stars` | integer | 1, 2, 3, 4 or 5 |
| `causes` | object | keys only from the nine cause keys; values numbers in 0..1; sum <= 1.5; 1-3 keys |
| `skus_mentioned` | array of strings | menu sku ids exactly as in the menu table, only items actually mentioned in `text`; `[]` allowed |
| `text` | string | 8-280 characters; no line breaks; escape quotes properly |
| `language` | string | `en` or `hinglish` |

### Id rule

`REV-{BATCH}-{000..119}` - the literal prefix `REV-`, your BATCH (two digits, e.g. `03`), a dash, and a zero-padded
three-digit counter starting at `000` and increasing by one per line. Example for BATCH 03: `REV-03-000`, `REV-03-001`, ...

## Examples (format only - write your own, never copy these)

{"id":"REV-01-000","persona":"leisurely","channel":"dine_in","stars":5,"causes":{"quality":0.6,"ambience":0.4},"skus_mentioned":["flatwhite"],"text":"Best flat white in Indiranagar, hands down. Pink walls, soft jazz, and nobody rushed us out on a Sunday.","language":"en"}
{"id":"REV-01-001","persona":"delivery_home","channel":"swiggy","stars":2,"causes":{"cold_food":0.7,"packaging":0.3},"skus_mentioned":["fries"],"text":"Fries were soggy and stone cold by the time they reached me, the box had trapped all the steam. Taste memory says they must be great fresh.","language":"en"}
{"id":"REV-01-002","persona":"student","channel":"dine_in","stars":4,"causes":{"value":0.5,"price":0.5},"skus_mentioned":["chai","cheesetoast"],"text":"chai aur cheese toast under 400, paisa vasool honestly. Sirf seats thodi kam hain after 5.","language":"hinglish"}
{"id":"REV-01-003","persona":"commuter","channel":"takeaway","stars":1,"causes":{"wait":0.8,"staff":0.2},"skus_mentioned":["cappuccino"],"text":"Missed my train waiting for a cappuccino. Ten minutes in the rush and the cashier just shrugged.","language":"en"}
{"id":"REV-01-004","persona":"office_bulk","channel":"zomato","stars":3,"causes":{"accuracy":0.5,"quality":0.5},"skus_mentioned":["sandwich","filtercoffee"],"text":"Ordered for 10 colleagues. Sandwiches were tasty, but two filter coffees were missing and we had to chase it.","language":"en"}
{"id":"REV-01-005","persona":"regular","channel":"dine_in","stars":5,"causes":{"staff":0.6,"quality":0.4},"skus_mentioned":["cappuccino"],"text":"Meera had my cappuccino ready before I reached the counter. This place feels like home.","language":"en"}

## Before you answer (silent self-check - do not print it)

1. Every line parses as JSON on its own and matches the schema exactly (no extra keys, enums spelled exactly).
2. Ids follow the id rule and are unique and consecutive.
3. The distribution targets are met within about 5 percentage points over the whole reply.
4. No two rows share the same wording; no real brands, people, phone numbers, addresses or slurs appear.
5. There is no text outside the JSON lines.
