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
  replate markdown), `D` learned RL manager (M3, below), `E` oracle (C with perfect information).
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

## M3 - learning (Policy D)

```bash
uv run brew-train all --config configs/train/smoke.yaml --run-dir runs/smoke_test     # ~20 min on the laptop
uv run brew-train all --config configs/train/full.yaml --dry-run                      # validate the desktop plan
uv run brew-train all --config configs/train/full.yaml --run-dir runs/full --device auto --resume   # desktop
uv run brew-train ppo --config configs/train/smoke.yaml --run-dir runs/smoke_test --resume          # one stage
uv run brew-eval --policies A,B,C,D --seeds 3 --days 3                                # D = models/rl_policy/D champion
uv run tensorboard --logdir runs/smoke_test/tb
```

* Stages (after the M2 stages): `bc` (behaviour cloning of Policy C) -> `ppo` (MaskablePPO, curriculum 1 -> 7 -> 28
  days, VecNormalize) -> `adversarial` (RARL: adversary vs frozen protagonist, then protagonist vs a
  50 % random / 30 % adversary / 20 % calm mix) -> `export` (best candidate on calm + chaos, ONNX, parity check,
  surrogate tree, registry) -> `arena` (A/B/C/D).
* Run directory: `config.yaml` (resolved), `progress.json` (heartbeat <= 60 s: stage, step, steps/s, eta,
  last eval), `metrics.json`, `train.log`, `eval/*.json`, `tb/`, `checkpoints/` (resumable), `markers/` (completed
  stages for `--resume`), `champion/{policy.onnx,obs_norm.json,meta.json,surrogate.joblib}`.  The champion is
  copied to `models/rl_policy/D/<version>/` and registered; `GET /api/v1/cafe` lists `D` as available once it exists.
* The env (`brew.rl.env.BrewManagerEnv`): one step = one manager tick (900 sim-s, 57 ticks/day), 183-float named
  observation, `MultiDiscrete([5,5,5,5, 5,5,5,5, 6, 4,4, 4, 24, 2,2,2, 4, 4])`, `action_masks()` (96 flat),
  reward in `brew.rl.reward`.  The executor (`brew.policies.D_rl.ManagerExecutor`) turns an action into Policy C's
  machinery: price steps through the charter shield, kappa-quantile prep, make-ahead level, Replate ladder mode,
  strategy preset + batch window for C's weighted-EDF dispatch, throttles; purchasing and intake stay with C.
* Everything is offline (no wandb, no downloads).  `--device auto` uses CUDA when torch sees it (the RTX 3050
  desktop), otherwise the CPU; PPO with small MLPs is simulation-bound, so `--workers N` (SubprocVecEnv) matters more.
* macOS note: `brew.rl.torch_setup` imports LightGBM and OR-tools before torch and pins torch to one thread - the
  other import order segfaults LightGBM (duplicate OpenMP runtimes).  Always import torch through `brew.rl`.
