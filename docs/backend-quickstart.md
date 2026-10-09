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
uv run brew-eval --policies A,B,C --seeds 3 --days 5 --replate-ab  # arena + paired CIs + Replate on/off
```

* Policies: `A` naive, `B` heuristic, `C` optimised (forecasts, newsvendor, pricing ladder, CP-SAT plan,
  replate markdown), `E` oracle (C with perfect information). `D` (RL) arrives in M3.
* Models live in `models/{kind}/{name}/{version}/` with `models/registry.json`; `GET /api/v1/models` lists the
  champions. Policy C falls back to built-in moving-average / default elasticities when no model is present.
* Replate: `replate.yaml`, the `replate:` blocks in `menu.yaml`, actions `premake`, `replate_list`,
  `replate_mode`, `GET /worlds/{id}/replate`.
* Analysis endpoints: `/forecast`, `/bottlenecks`, `/advisor` (job), `/invest`, `/arena` (job),
  `/decisions/{id}/explain`, `/models`, `/reviews` (with the cause tagger's reading).
* `uv run python -c "from brew.synth.catalog import calibrate_suppliers"` re-seeds suppliers from the
  LLM supplier catalogue (opt-in; the default cafe is unchanged).
