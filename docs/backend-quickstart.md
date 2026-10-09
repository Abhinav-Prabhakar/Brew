# Brew backend quickstart

```bash
uv sync
uv run pytest -q                      # unit + property + integration (not slow)
uv run pytest -q -m slow              # tiny training pipeline + C-vs-A/B acceptance (a few minutes)
uv run brew-sim run --policy C --days 1 --seed 7
uv run brew-sim bench                 # sec/day per policy A/B/C + fork latency
uv run brew-api --reload              # http://127.0.0.1:8000/docs
```

## M2 - intelligence

```bash
uv run brew-train all --config configs/train/smoke.yaml   # history -> forecast -> elasticity -> prep_time
                                                          # -> rider_eta -> text -> replate -> eval (~5 min)
uv run brew-train forecast --config configs/train/smoke.yaml       # one stage
uv run brew-eval --policies A,B,C --seeds 5 --days 5 --replate-ab --waste-breakdown --workers 4
                                                          # arena + paired CIs + Replate on/off + per-item waste kg
uv run brew-eval --policies C --seeds 5 --replate-ab --params '{"replate": {"list_frac": 0.35}}'   # C overrides
```

* Policies: `A` naive, `B` heuristic, `C` optimised (forecasts, newsvendor, pricing ladder, CP-SAT plan,
  replate markdown), `E` oracle (C with perfect information). `D` (RL) arrives in M3.
* Models live in `models/{kind}/{name}/{version}/` with `models/registry.json`; `GET /api/v1/models` lists the
  champions. Policy C falls back to built-in moving-average / default elasticities when no model is present.
* Replate: `replate.yaml`, the `replate:` blocks in `menu.yaml`, actions `premake`, `replate_list`,
  `replate_mode`, `GET /worlds/{id}/replate`.  Three kinds of listing (`kind` in the lot view): `stock`
  (bakery / bought-in finished goods), `premade` (plates made ahead) and `backed` (prep-backed: an expiring
  prepped intermediate or perishable, `replate.yaml: prep_backed`, e.g. `chai_base -> chai`; the listing's
  units are the lot's yield minus the full-price demand expected before use-by, and a rescue sale draws the
  backing lot first).  Ladder modes (`gentle|standard|aggressive`) list only that surplus; C sizes the rescue
  bag itself (`replate_mode = custom`) and, with Replate on, bakes a batch from dough that would expire
  (bake-and-list).
* Rescue demand (documented extension to backend.md 3.11): a listing is an extra choice alternative, but with
  a pure logit that only *reallocates* demand between items (outside option 5 %), so rescuing chai or fries
  costs more in displaced lattes than it recovers.  `replate.yaml: addon_*` adds a counter impulse add-on
  (after choosing, a customer may add one listed unit; ~10 % at 30 % off, ~20 % at 50 % off) which is the
  only incremental rescue demand.  `addon_enabled: false` gives the spec-pure behaviour.  The full-price
  demand history (`DemandLog.counts`, forecaster inputs) excludes rescue units.
* Analysis endpoints: `/forecast`, `/bottlenecks`, `/advisor` (job), `/invest`, `/arena` (job),
  `/decisions/{id}/explain`, `/models`, `/reviews` (with the cause tagger's reading).
* `uv run python -c "from brew.synth.catalog import calibrate_suppliers"` re-seeds suppliers from the
  LLM supplier catalogue (opt-in; the default cafe is unchanged).
