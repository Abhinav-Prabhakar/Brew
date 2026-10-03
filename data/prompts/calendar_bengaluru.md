# Prompt: calendar_bengaluru  (run with BATCH = 01, 02, 03, ... - change BATCH every run)
## Save output to: data/synthetic/raw/calendar_bengaluru/batch_{BATCH}.jsonl
## Rows per run: 120   Target total: 360 (>= 150 rows covering at least 2 years)

> **How to use (human):** open a fresh chat with a strong LLM, set `BATCH` below, paste this whole file, save the reply
> exactly as the path above (replace `{BATCH}` with your number, e.g. `batch_03.jsonl`). Run it three times per year-set: BATCH 01 with YEAR = 2025, BATCH 02 with YEAR = 2026, BATCH 03 with YEAR = 2027 (more batches may add detail).
> Then run `uv run brew-synth validate calendar_bengaluru` and `uv run brew-synth status`.


**BATCH = 01**   <- change this number on every run (01, 02, 03, ...). Use it in every id (see "Id rule").

---

**YEAR = 2026**   <- change together with BATCH: 2025, 2026 or 2027. Every event in this run must fall in that calendar year
(multi-day events may start in that year and end in the next).

## Role

You are a **local-knowledge calendar compiler for Bengaluru**. You list dated events that change how many people walk
into a cafe in Indiranagar and what they order, and you give estimated **demand multipliers**. The cafe simulator reads
these rows to scale arrivals by customer persona, channel and menu category on the given dates.

## Context

**Brew** (the cafe is called just "brew", always lowercase in signage) is a small, cozy, pink-themed independent
cafe in **Indiranagar, Bengaluru**. It is open 08:00-22:00, has six small two-seat tables (two can be pushed together
for groups), a pastry fridge, a thermal bill printer, a split-flap "Now Brewing" board and kraft delivery bags with a
pink "brew" stamp. Prices are in Indian rupees (INR), GST 5%. The team: Meera and Kabir (baristas), Dev (cook), Zoya
(cashier/runner) and Raju (dishwasher). Customers order at the counter, wait for the paper ticket to be made, then take
their food to a table (dine-in), carry it away (takeaway) or receive it by rider (delivery apps).

### Personas (multiplier keys under `persona`)

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

### Channels (multiplier keys under `channel`)

`dine_in`, `takeaway`, `zomato`, `swiggy` (delivery apps; `zomato` and `swiggy` usually move together).

### Menu categories (multiplier keys under `category`)

`coffee` (espresso drinks, cold brew, filter coffee), `notcoffee` (chai, matcha, hot chocolate, rose milk, shakes),
`bakes` (croissant, muffin, cheesecake, cinnamon roll, waffle), `plates` (avocado toast, sandwiches, cheese toast, fries, pasta).

## The task

For the given `YEAR`, list **120 events** that affect cafe demand in Bengaluru, as accurately as you can from memory.

Cover ALL of these kinds (guidance on how many):

| kind (use EXACTLY) | what to include | approx. rows |
|---|---|---|
| `public_holiday` | gazetted holidays observed in Karnataka (Republic Day, Ugadi, Ambedkar Jayanti, Good Friday, Independence Day, Gandhi Jayanti, Kannada Rajyotsava on 1 Nov, Christmas, Eid dates, etc.) | 14-18 |
| `festival` | Sankranti, Ugadi, Ganesh Chaturthi, Dasara/Navaratri, Diwali days, Karaga, Onam, Christmas season, New Year's Eve | 14-18 |
| `cricket_match` | home matches of the franchise T20 league at the Chinnaswamy stadium and any international/domestic fixtures in Bengaluru; give `start_time`/`end_time` (evening games ~19:30-23:30, afternoon ~15:30-19:30) | 12-20 |
| `exam_season` | board exams (SSLC/PUC), university semester exam windows, entrance exams - multi-day ranges | 6-10 |
| `payday` | month-end and first-of-month salary windows (one row per month: the last working day to the 2nd) | 12 |
| `marathon` | city marathons / runs with early-morning road closures near Indiranagar | 2-4 |
| `long_weekend` | holiday + weekend combinations (Friday/Monday holidays) | 6-10 |
| `concert` | large concerts/festivals/exhibitions in the city (do NOT name performers - write "major music festival at a large ground (approx.)") | 6-10 |
| `other` | monsoon peaks, major road/Metro disruptions, school holidays, college fest weeks, IT-company offsite seasons | 10-20 |

**Honesty rule:** if you are not certain of an exact date (moving festivals, match schedules, exam timetables), give your
best estimate AND start `source_note` with `approximate:` and say why. Never fabricate a precise-looking schedule. It is
better to under-fill a kind than to invent specifics.

### Multiplier guidance (keys optional; omit anything that is roughly 1.0)

All multiplier values must be between **0.3 and 3.0**. Typical effects:

* Public holiday / festival: `commuter` 0.3-0.6, `office_bulk` 0.3-0.5, `family` 1.3-1.8, `leisurely` 1.2-1.5, `tourist` 1.1-1.5,
  `zomato`/`swiggy` 1.1-1.4, `bakes` 1.2-1.5 on sweet festivals.
* Cricket match day (evening window): `delivery_home` 1.4-2.0, `zomato`/`swiggy` 1.4-2.0, `plates` 1.2-1.5, `leisurely` 0.7-0.9, `dine_in` 0.8-1.0.
* Exam season: `student` 1.3-1.8, `remote_worker` 1.1-1.3, `coffee` 1.1-1.3, `commuter` 0.9-1.0.
* Payday window: `leisurely` 1.1-1.3, `student` 1.0-1.15, `bakes` 1.05-1.2.
* Marathon morning: `commuter` 0.4-0.7, `tourist` 1.2-1.6, `coffee` 1.1-1.3, `dine_in` 0.7-1.2.
* Long weekend: `tourist` 1.3-2.0, `family` 1.2-1.6, `commuter` 0.3-0.6.
* Heavy-rain/monsoon peaks: `dine_in` 0.8, `zomato`/`swiggy` 1.3-1.6, `notcoffee` 1.1.

Use `start_time`/`end_time` (24h `HH:MM`) only when the effect is limited to part of the day (match nights, marathon mornings,
New Year's Eve evening); otherwise `null`.

### Things to avoid

No real people, no performers/artists/athletes by name, no brands, no political events, no claims about attendance numbers.

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
| `date` | string | `YYYY-MM-DD`, inside your YEAR (2025-01-01..2027-12-31 overall) |
| `end_date` | string | `YYYY-MM-DD`, same as `date` for single-day events, never earlier than `date` |
| `name` | string | 3-100 chars, plain description ("Ganesh Chaturthi", "RCB home match vs ... (approx.)" - no opponents unless sure) |
| `kind` | string | `public_holiday` \| `festival` \| `cricket_match` \| `exam_season` \| `payday` \| `marathon` \| `long_weekend` \| `concert` \| `other` |
| `start_time` | string or null | `HH:MM` or `null` |
| `end_time` | string or null | `HH:MM` or `null` |
| `multipliers` | object | optional dimensions `persona`, `channel`, `category`, each an object of key -> number 0.3..3.0 (keys exactly as listed above). `{}` allowed |
| `source_note` | string | one sentence on basis/certainty; start with `approximate:` if uncertain |

### Id rule

`CAL-{BATCH}-{000..119}` - e.g. BATCH 02 -> `CAL-02-000`, `CAL-02-001`, ... zero-padded to three digits. Rows must be
sorted by `date` ascending.

## Examples (format only - verify every date yourself)

{"id":"CAL-02-000","date":"2026-01-26","end_date":"2026-01-26","name":"Republic Day","kind":"public_holiday","start_time":null,"end_time":null,"multipliers":{"persona":{"commuter":0.4,"office_bulk":0.3,"family":1.4,"tourist":1.2}},"source_note":"National holiday observed in Karnataka."}
{"id":"CAL-02-001","date":"2026-03-28","end_date":"2026-03-28","name":"Home T20 match night at the Chinnaswamy stadium (approx.)","kind":"cricket_match","start_time":"19:00","end_time":"23:30","multipliers":{"persona":{"delivery_home":1.6},"channel":{"zomato":1.6,"swiggy":1.6},"category":{"plates":1.3}},"source_note":"approximate: league fixtures are published close to the season; evening slot is typical."}
{"id":"CAL-02-002","date":"2026-02-27","end_date":"2026-03-14","name":"Board exam fortnight (approx.)","kind":"exam_season","start_time":null,"end_time":null,"multipliers":{"persona":{"student":1.4,"remote_worker":1.15},"category":{"coffee":1.15}},"source_note":"approximate: typical PUC/SSLC exam window."}
{"id":"CAL-02-003","date":"2026-03-30","end_date":"2026-04-02","name":"Month-end payday window","kind":"payday","start_time":null,"end_time":null,"multipliers":{"persona":{"leisurely":1.2,"student":1.05},"category":{"bakes":1.1}},"source_note":"Salary credits cluster around month end."}

## Before you answer (silent self-check - do not print it)

1. Every line parses as JSON on its own and matches the schema exactly (no extra keys, enums spelled exactly).
2. Ids follow the id rule and are unique and consecutive.
3. The distribution targets are met within about 5 percentage points over the whole reply.
4. No two rows share the same wording; no real brands, people, phone numbers, addresses or slurs appear.
5. There is no text outside the JSON lines.
