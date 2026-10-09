# Prompt: customer_names  (run with BATCH = 01, 02, 03, ... - change BATCH every run)
## Save output to: data/synthetic/raw/customer_names/batch_{BATCH}.jsonl
## Rows per run: 150   Target total: 600 (>= 4 runs)

> **How to use (human):** open a fresh chat with a strong LLM, set `BATCH` below, paste this whole file, save the reply
> exactly as the path above (replace `{BATCH}` with your number, e.g. `batch_03.jsonl`). Run it ~4 times (BATCH 01..04) to reach 600 rows; names must be new each run.
> Then run `uv run brew-synth validate customer_names` and `uv run brew-synth status`.


**BATCH = 01**   <- change this number on every run (01, 02, 03, ...). Use it in every id (see "Id rule").

---

## Role

You compile **first names and nicknames** of people who realistically visit a cafe in Indiranagar, Bengaluru - a very
cosmopolitan, pan-Indian city. The names go on paper tickets and on a retro split-flap board that shows at most 5 letters
(A-Z), so each row also needs a short board form.

## Context

**Brew** (the cafe is called just "brew", always lowercase in signage) is a small, cozy, pink-themed independent
cafe in **Indiranagar, Bengaluru**. It is open 08:00-22:00, has six small two-seat tables (two can be pushed together
for groups), a pastry fridge, a thermal bill printer, a split-flap "Now Brewing" board and kraft delivery bags with a
pink "brew" stamp. Prices are in Indian rupees (INR), GST 5%. The team: Meera and Kabir (baristas), Dev (cook), Zoya
(cashier/runner) and Raju (dishwasher). Customers order at the counter, wait for the paper ticket to be made, then take
their food to a table (dine-in), carry it away (takeaway) or receive it by rider (delivery apps).

## The task

Write **150 distinct first names / nicknames**, one JSON object per line.

### Diversity targets (over the 150 rows)

* ~18% Kannada / Karnataka (e.g. Kavya, Thimmaiah, Chinmay), ~12% Tamil, ~10% Telugu, ~8% Malayali, ~14% Hindi-belt / Punjabi / Gujarati /
  Marathi / Rajasthani, ~6% Bengali / Odia / Assamese / Northeastern (Naga, Khasi, Mizo...), ~8% Muslim names, ~6% Christian / Goan / Anglo-Indian
  names, ~3% Parsi / Sikh / Jain / Buddhist names where not already counted, ~15% international expats and visitors (Western European, American,
  East Asian, South-East Asian, African, Middle-Eastern - first names only).
* Gender balance: `f` ~45%, `m` ~45%, `n` (neutral/unisex) ~7%, `unspecified` ~3%.
* Mix of formal names ("Ananya"), nicknames ("Pinky", "Bunty", "Chotu" - gentle, non-offensive), diminutives ("Vik", "Sush") and genuinely common
  names. Roughly 70% of rows should be names common enough that several customers on a normal day might share them.
* Lengths: some very short (Om, Ira, Ali), some long (Lakshminarayan, Sebastian). The board form handles the long ones.

### Rules

* `name`: the name as it would be said or written on a ticket, 2-24 characters, Latin letters (accents allowed only if standard, avoid them mostly),
  Title Case, no surname, no spaces unless a genuine two-part first name ("Mary Ann").
* `short`: 1-5 characters, **UPPERCASE A-Z only** (no spaces, digits or punctuation), a recognisable board form of the name: the name itself if
  <= 5 letters, otherwise a natural truncation or abbreviation (`Lakshminarayan` -> `LAKSH`, `Sebastian` -> `SEBAS`, `Thimmaiah` -> `THIMM`).
* `region`: free text of at most 3 words naming the cultural origin ("Kodava", "Tamil", "Expat - German", "Bengali"), or `null`.
* `gender`: `f`, `m`, `n` or `unspecified`.
* **No duplicates** within the run (case-insensitive) and prefer names unlikely to have been produced by an earlier run of this prompt: lean toward
  less-obvious choices as BATCH grows (batch 03-04: include rarer regional names, but still real and respectful).
* Avoid: names of celebrities, politicians, sports stars, fictional-franchise characters; religious figures used as jokes; slurs or names that read
  as insults in any common language; deadnames of real individuals; anything sexual.

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
| `name` | string | 2-24 chars |
| `short` | string | 1-5 chars, A-Z only |
| `region` | string or null | <= 3 words |
| `gender` | string | `f` \| `m` \| `n` \| `unspecified` |

### Id rule

`NAME-{BATCH}-{000..149}` - e.g. BATCH 02 -> `NAME-02-000`, zero-padded to three digits.

## Examples (format only)

{"id":"NAME-01-000","name":"Thimmaiah","short":"THIMM","region":"Kodava","gender":"m"}
{"id":"NAME-01-001","name":"Kavya","short":"KAVYA","region":"Kannada","gender":"f"}
{"id":"NAME-01-002","name":"Ishaan","short":"ISHAA","region":"Hindi belt","gender":"m"}
{"id":"NAME-01-003","name":"Mary Ann","short":"MARYA","region":"Anglo-Indian","gender":"f"}
{"id":"NAME-01-004","name":"Linh","short":"LINH","region":"Expat - Vietnamese","gender":"n"}

## Before you answer (silent self-check - do not print it)

1. Every line parses as JSON on its own and matches the schema exactly (no extra keys, enums spelled exactly).
2. Ids follow the id rule and are unique and consecutive.
3. The distribution targets are met within about 5 percentage points over the whole reply.
4. No two rows share the same wording; no real brands, people, phone numbers, addresses or slurs appear.
5. There is no text outside the JSON lines.
