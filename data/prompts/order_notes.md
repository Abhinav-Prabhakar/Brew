# Prompt: order_notes  (run with BATCH = 01, 02, 03, ... - change BATCH every run)
## Save output to: data/synthetic/raw/order_notes/batch_{BATCH}.jsonl
## Rows per run: 200   Target total: 1,500 (>= 8 runs)

> **How to use (human):** open a fresh chat with a strong LLM, set `BATCH` below, paste this whole file, save the reply
> exactly as the path above (replace `{BATCH}` with your number, e.g. `batch_03.jsonl`). Run it ~8 times (BATCH 01..08) to reach 1,500 rows.
> Then run `uv run brew-synth validate order_notes` and `uv run brew-synth status`.


**BATCH = 01**   <- change this number on every run (01, 02, 03, ...). Use it in every id (see "Id rule").

---

## Role

You write **special-instruction notes that customers type on a cafe order** and label them with structured intents. The
data trains a small parser that turns a free-text ticket note into flags and modifiers (so the kitchen sees "NO NUTS"
in red and the system can add the right modifier), and it supplies notes to a cafe simulator.

## Context

**Brew** (the cafe is called just "brew", always lowercase in signage) is a small, cozy, pink-themed independent
cafe in **Indiranagar, Bengaluru**. It is open 08:00-22:00, has six small two-seat tables (two can be pushed together
for groups), a pastry fridge, a thermal bill printer, a split-flap "Now Brewing" board and kraft delivery bags with a
pink "brew" stamp. Prices are in Indian rupees (INR), GST 5%. The team: Meera and Kabir (baristas), Dev (cook), Zoya
(cashier/runner) and Raju (dishwasher). Customers order at the counter, wait for the paper ticket to be made, then take
their food to a table (dine-in), carry it away (takeaway) or receive it by rider (delivery apps).

### Menu

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

### Modifiers the system understands (the ONLY ids allowed in `modifiers`)

| modifier id (use EXACTLY) | what the customer is asking for | applies to |
|---|---|---|
| `oat` | oat milk | tags: milk_drink |
| `almond` | almond milk | tags: milk_drink |
| `shot` | extra shot | coldbrew; tags: espresso_based |
| `decaf` | decaf | tags: espresso_based |
| `lesssugar` | less sugar | chai, filtercoffee, hotchoc, matcha, rosemilk, strawberryshake, roselatte |
| `iced` | make it iced | latte, cappuccino, flatwhite, roselatte, matcha |
| `hot` | extra hot | cappuccino, flatwhite, latte, roselatte, chai, hotchoc, matcha, filtercoffee |
| `large` | large size | tags: milk_drink, black_coffee |
| `noonion` | no onion | sandwich, cheesetoast |
| `nonuts` | nut allergy | avotoast, muffin, cinnamon, cheesecake, waffle |
| `cheese` | extra cheese | sandwich, cheesetoast, avotoast, pasta |
| `jalapeno` | add jalapenos | sandwich, cheesetoast, avotoast, fries |

Notes: `noonion` and `nonuts` are *negations* (shown crossed-out on the ticket). `nonuts` is an **allergy-grade** modifier.
`iced` and `hot` ("extra hot") are mutually exclusive; `decaf` and `shot` are mutually exclusive; `oat` and `almond` are
mutually exclusive.

### Intents (what the note is trying to achieve; a note can have several)

| intent | meaning | example |
|---|---|---|
| `allergy` | an allergy / intolerance / dietary restriction the kitchen must respect | "allergic to nuts!!", "jain - no onion no garlic" |
| `modifier` | asks for a change that maps (fully or partly) to one of the modifiers above | "make it strong pls", "oat milk please" |
| `rush` | urgency / time pressure | "quick, train in 10!" |
| `gift_message` | a greeting, name, drawing or message for someone | "for Riya - happy bday!", "pls draw a heart" |
| `packaging` | bags/boxes/lids/straws/napkins/separating items | "separate bags pls", "no straw" |
| `cutlery` | cutlery on/off | "cutlery please" |
| `spice_level` | how spicy | "extra spicy", "mild for kids" |
| `other` | anything else (delivery directions, preferences with no modifier, chat) | "cut in half?", "ring the bell twice" |

## The task

Write **200 distinct ticket notes**, one JSON object per line.

### Distribution targets (over the 200 rows)

* Intents (a row may count for several): `modifier` ~30%, `packaging` ~15%, `allergy` ~10%, `rush` ~10%,
  `gift_message` ~10%, `cutlery` ~5%, `spice_level` ~7%, `other` ~13%. About 15% of rows have two or more intents.
* Every modifier id appears at least 3 times in the batch; roughly 40% of rows have a non-empty `modifiers`.
* **Language/style**: terse, typed on a phone at a counter or in a delivery app. ~70% Indian English, ~25% Hinglish
  (Roman script only, e.g. "bhaiya thoda strong banana", "jaldi chahiye"), ~5% very short ("no ice"). Typos, missing
  punctuation, ALL CAPS shouting for allergies, occasional "pls/plz/thx". Max one emoji per ten notes.
* `text` is 3-120 characters, no line breaks.

### Labelling rules (this is the valuable part - be exact)

* `modifiers` lists **only** modifier ids that the text clearly asks for ("oat milk" -> `oat`, "no onion" -> `noonion`,
  "nut allergy" -> `nonuts`, "extra shot"/"make it strong" -> `shot`, "xtra hot"/"warm it up" -> `hot`, "less sugar"/
  "half sugar" -> `lesssugar`, "iced"/"on ice" -> `iced`, "bigger"/"large" -> `large`, "extra cheese" -> `cheese`,
  "jalapenos" -> `jalapeno`). If the note asks for something with no matching id (less ice, sauce on the side, well done),
  use intent `modifier` or `other` but leave `modifiers` empty or partial. Never invent ids.
* `allergy` is `null` unless the note states an allergy, intolerance or strict dietary rule; then a short lowercase
  noun such as `nuts`, `peanuts`, `gluten`, `lactose`, `egg`, `onion`, `garlic`, `soy`, `shellfish`, `sesame`.
  A nut allergy must also put `nonuts` in `modifiers`.
* `urgency` (0..1): allergy 0.8-1.0; rush 0.7-1.0; "no rush" 0.0; everything else 0.0-0.4.
* `gift_message`: set `gift_name` to the first name addressed in the text (e.g. "Riya"); otherwise `null`. Use varied
  Indian and international first names. No surnames, no real public figures.
* Include ~10% **negative / confusing** notes that look like instructions but map to nothing (`intents:["other"]`,
  `modifiers:[]`), and ~5% where the note contradicts the menu (asks for something the cafe does not sell) - label those
  `other` with empty modifiers.

### Things to avoid

No real brand names, no real people, no phone numbers/addresses/emails, no slurs or sexual content, no medical advice.

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
| `text` | string | 3-120 characters |
| `intents` | array of strings | 1 or more of: `allergy`, `modifier`, `rush`, `gift_message`, `packaging`, `cutlery`, `spice_level`, `other` |
| `modifiers` | array of strings | subset of the twelve modifier ids; `[]` allowed |
| `allergy` | string or null | see labelling rules |
| `urgency` | number | 0..1 |
| `gift_name` | string or null | see labelling rules |

### Id rule

`NOTE-{BATCH}-{000..199}` - e.g. BATCH 02 -> `NOTE-02-000`, `NOTE-02-001`, ... zero-padded to three digits.

## Examples (format only - write your own)

{"id":"NOTE-01-000","text":"make it strong pls","intents":["modifier"],"modifiers":["shot"],"allergy":null,"urgency":0.2,"gift_name":null}
{"id":"NOTE-01-001","text":"ALLERGIC TO NUTS!! please use clean utensils","intents":["allergy"],"modifiers":["nonuts"],"allergy":"nuts","urgency":1.0,"gift_name":null}
{"id":"NOTE-01-002","text":"for Riya - happy bday! can u draw a heart","intents":["gift_message"],"modifiers":[],"allergy":null,"urgency":0.1,"gift_name":"Riya"}
{"id":"NOTE-01-003","text":"oat milk and half sugar, quick pls train in 10","intents":["modifier","rush"],"modifiers":["oat","lesssugar"],"allergy":null,"urgency":0.85,"gift_name":null}
{"id":"NOTE-01-004","text":"bhaiya thoda spicy rakhna, cutlery nahi chahiye","intents":["spice_level","cutlery"],"modifiers":[],"allergy":null,"urgency":0.1,"gift_name":null}
{"id":"NOTE-01-005","text":"leave at gate 2, guard will collect","intents":["other"],"modifiers":[],"allergy":null,"urgency":0.2,"gift_name":null}

## Before you answer (silent self-check - do not print it)

1. Every line parses as JSON on its own and matches the schema exactly (no extra keys, enums spelled exactly).
2. Ids follow the id rule and are unique and consecutive.
3. The distribution targets are met within about 5 percentage points over the whole reply.
4. No two rows share the same wording; no real brands, people, phone numbers, addresses or slurs appear.
5. There is no text outside the JSON lines.
