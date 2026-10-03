# Synthetic-data prompts

Seven prompts, one per dataset. Each is a **self-contained** prompt (menu, personas, channels, enums, schema, examples, id rule) that you paste into a
fresh chat with a strong LLM. The reply is machine-readable JSON Lines that Brew validates and ingests.

1. Pick a prompt (`reviews.md` first - it is the biggest) and open a **new chat** with a strong LLM.
2. Edit the `BATCH = 01` line near the top (and `YEAR` in `calendar_bengaluru.md`) - **use a new number on every run** so ids never collide.
3. Paste the entire file as the message. Do not add instructions.
4. Save the reply, exactly as returned, to the path in the file's `## Save output to:` line, e.g. `data/synthetic/raw/reviews/batch_01.jsonl`.
5. Repeat step 2-4 until `uv run brew-synth status` shows each dataset at or above its minimum (rows per run x runs = target).
6. Run `uv run brew-synth validate` - it reports every bad line (`file:line: message`), removes duplicates, checks distributions (e.g. every
   star level >= 10% of reviews) and writes clean data to `data/synthetic/clean/{name}.jsonl`. Fix or regenerate bad lines, validate again, commit the clean files.
7. Everything works without these files (built-in fallbacks); with them the simulator's review text, ticket notes, names and calendar get much richer.

| dataset | rows per run | target total | runs |
|---|---|---|---|
| `reviews` | 120 | 3,000 | ~25 |
| `order_notes` | 200 | 1,500 | ~8 |
| `calendar_bengaluru` | 120 (one `YEAR` per run) | 360 (>= 150) | 3 |
| `explanations` | 100 | 400 | 4 |
| `customer_names` | 150 | 600 | 4 |
| `ask_brew_eval` | 75 | 300 | 4 |
| `supplier_catalog` | 50 | 50 (one per ingredient) | 1 |

Tips: if a reply stops early, save what you got (the validator accepts partial files) and run again with the next BATCH; if the model wraps the
output in code fences the validator strips them, but prose lines are reported as errors.
