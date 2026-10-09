# brew: handoff context (written 2026-10-04 by Opus 5.5 for a fresh Sonnet 5.5 chat)

## Project
- **Repo:** `/Users/abhinav/Projects/brew`. The remote is `github.com/Abhinav-Prabhakar/Brew` (public). Work on `main`, and commit and push often.
- **Specs** (read these first):
  - `backend.md`: product spec. §3.11 is **Replate**; §10 lists milestones M1–M4.
  - `technical.md`: implementation spec. §13 is RL; §16 is tests.
  - `plan.md`: original design notes.
- **Frontends:**
  - `lobby/`: the pink 3D café (three.js + pmndrs postprocessing). Finished; leave it alone.
  - `kitchen/`: the new night-kitchen revamp. A **separate chat** is building it from `docs/revamp-prompt.md`.
  - Do **not** wire either frontend to the backend yet.
- **Backend:** `src/brew/`, Python 3.12, always run with **uv** (`uv run pytest -q`, `uv run ruff check .`, `uv run mypy src`). Quickstart: `docs/backend-quickstart.md`.
- **User preferences:**
  - Use Sonnet 5.5 sub-agents in worktrees for big builds.
  - Commit and push frequently.
  - Keep a good test suite.
  - Training must work offline.
  - This Mac (M2, 8 GB) gets loud: cap experiments at 2 worker processes.

## Milestone status
- **M1, foundation: merged.** Sim, CRN, policies A/B, DB, FastAPI + WebSocket, synth tooling.
- **Synthetic data: done.** The user ran the prompts. `data/synthetic/clean/*.jsonl` holds 8,310 rows, validated with 0 errors.
- **M2, intelligence + Replate: merged** (`0479150`). 254 tests pass.
  - **Profit, 5 seeds × 5 days:** C ₹84.3k/day vs B ₹67.8k vs A ₹65.8k.
  - **Replate (C):** waste 11.8 → 6.2 kg/day (−47%), profit +₹0.6k/day.
  - **Replate scope:** prep-backed listings (chai_base→chai, fries_cut→fries, …) plus a counter impulse add-on (`addon_enabled` in `replate.yaml`). Both are documented in the specs.
  - **Forecasting:** WAPE 0.93 vs 1.12 for seasonal-naive.
  - **Text models:** F1 0.72 (review tagger) and 0.95 (note parser).
  - **Open spec questions:** should milk waste (3.2 kg/day) be rescuable? Should the choice model become a nested logit?
- **M3, RL: in progress.** A background Sonnet agent is working in worktree `.claude/worktrees/agent-a736d2c0744d84c2f`, branch `worktree-agent-a736d2c0744d84c2f`.
  - Commits so far: env/actions/masks/reward, BC, MaskablePPO, RARL, ONNX + runtime Policy D, surrogate, pipeline + CLI, smoke/full configs, D wired into the API, mypy fixes.
  - **Agent stopped at handoff.** Its last commit is `a2fde65`, "wip(rl): RL tests", and it is pushed to `origin/worktree-agent-a736d2c0744d84c2f`. `tests/test_rl.py` and `tests/test_rl_slow.py` were never run. `models/rl_policy/` (564 KB) is untracked in that worktree; it is probably a smoke artifact, so decide whether to commit it. Finish M3 from here: work in that worktree, or merge the branch into `main` and fix things there.
  - **Required CLI contract** (the desktop script depends on it): `uv run brew-train all --config <yaml> --run-dir <dir> [--resume] [--dry-run]`. It must write:
    - `progress.json` (stage, step, total, steps_per_s, eta, last_eval)
    - `metrics.json`, `config.yaml`, `eval/`, `tb/`, `checkpoints/`
    - `champion/{policy.onnx, obs_norm.json, meta.json}`
  - Training must make no network calls.
  - Tracked artifacts under `models/` must not be overwritten by smoke runs.
  - **Acceptance:** env passes `env_checker`; masks never all-false; smoke PPO improves; D ≥ A on 3 seeds; ONNX parity < 1e-4; `full.yaml --dry-run` OK; smoke end to end OK; env step < 40 ms.

## Rules for the next chat (from the user)
- **Do not monitor ML training.** Once full training is started on the desktop and confirmed running (`overnight.sh status` shows `training`), give the user the morning-check commands and **end the chat**. Don't poll, don't schedule wake-ups, don't loop. The user will come back and say when training is done; only then inspect the logs (`git fetch origin training-logs`, or SSH in and run `overnight.sh status`).
- **Before ending**, finish every pending task below (steps 1–4).
- **Sub-agents:** all were stopped at handoff (2026-10-04). None are running. Spawn new ones only if needed (Sonnet 5.5, worktree isolation, at most 2 worker processes on this Mac).
- **Permissions:** `.claude/settings.json` pre-allows uv, git, gh, the desktop `ssh`/`scp` with the brew key, `overnight.sh`, and the common read/edit tools, so you can run what you need without prompts.

## Next steps (in order)
1. **Verify M3 yourself:** tests, ruff, mypy, `brew-train all --config configs/train/smoke.yaml --run-dir runs/smoke_test`, and the arena including D. Then merge into `main` and push.
2. **M4** (main agent, per backend.md §10): fix any issues from the smoke run, then write `docs/training-runbook.md` for the desktop.
3. **Desktop smoke test:** run `brew-train all` with the smoke config on the desktop (CUDA) through `scripts/desktop/overnight.sh`. Test offline behaviour (kill the network mid-run) and the final push retries.
4. **Hand the user the overnight command**, roughly:
   `cd ~/brew && git pull && bash scripts/desktop/overnight.sh prepare && bash scripts/desktop/overnight.sh start configs/train/full.yaml`
   Morning check: `bash scripts/desktop/overnight.sh status`. Logs are pushed to the `training-logs` branch, so you can read them from the Mac with `git fetch origin training-logs`.

## Desktop (training machine)
- **SSH:** `ssh -i ~/.ssh/brew_desktop_ed25519 -p 2222 abhinav@100.72.93.7`. That's WSL2 Ubuntu 24.04 over Tailscale; the machines are on different LANs. Key-only login.
- **Hardware:** i5-11400 (12 threads), RTX 3050 8 GB (CUDA 12.8, driver 572.70), WSL RAM 10 GiB (`.wslconfig memory=11GB`), 915 GB free disk.
- **Repo:** cloned at `~/brew`. `gh` is logged in and `gh auth setup-git` has been run, so pushes work.
- **WSL quirks:**
  - `nvidia-smi` lives in `/usr/lib/wsl/lib`.
  - `powershell.exe` must be called by full path.
  - The script handles both.
- **DNS:** fixed. The user ran `tailscale set --accept-dns=false` and `--operator=$USER`.
- **Git identity:** set repo-locally in `~/brew`, so log commits work.
- **Last state:** `overnight.sh prepare` succeeded (2026-10-04 17:12). Tests pass on the desktop, the RTX 3050 is detected, and the `training-logs` worktree has been initialised locally at `.overnight/logs` but not pushed yet. Torch isn't installed yet because it arrives with the M3 merge. After merging M3, run `git pull && bash scripts/desktop/overnight.sh prepare` on the desktop, which installs torch with CUDA; then check that `torch.cuda.is_available()` is `True`.

## `scripts/desktop/overnight.sh` (offline-first runner)
- **Commands:** `prepare | start [config] [--resume] [--push-model] | status | tail | push | stop`.
- **How a run works:** detached with `setsid nohup`, run under `UV_OFFLINE=1`, and keeps Windows awake through `SetThreadExecutionState`.
- **Logs:** written to `.overnight/runs/<stamp>/` and committed to a local `training-logs` worktree (`.overnight/logs`). Pushes are best-effort every 30 minutes; the final push makes 8 attempts with exponential backoff. Checkpoints are never pushed (only a champion ONNX under 5 MB, with `--push-model`).
- **Testing:** only syntax-checked plus the `prepare` path. Still to verify: the `start`/`status` flow, the offline path and `cp --parents` on GNU.

## Estimates (to give the user)
- **Full training on the M2 Mac:** about 12–30 h, CPU-bound.
- **On the desktop:** expect it to be faster mainly from more parallel envs (about 10), not from the GPU. Measure steps/s in the smoke run and give the user a real estimate.

## Status update (2026-10-05, Opus resumed after Sonnet struggled; the user wants Opus to drive and only give Sonnet easy sub-tasks)
- **M3 branch `worktree-agent-a736d2c0744d84c2f`** (head `9187d3a`, includes `main`): **not merged yet**. Fast tests, ruff and mypy pass.
  - **Fixes since handoff:**
    - macOS forkserver for SubprocVecEnv (torch and LightGBM OpenMP clash).
    - Registered the shipped D champion.
    - Torch comes from the **CUDA 12.6 index on Linux**, because the desktop driver (572.70) only supports CUDA 12.8 and the PyPI cu13 build failed.
    - The smoke config now writes models to `data/runs/smoke/models`, so it no longer overwrites the committed `models/`.
    - Added `docs/training-runbook.md`.
  - **Local smoke run** (`brew-train all --config configs/train/smoke.yaml`): all 13 stages pass in 14 min. ONNX parity is 2.9e-6. On the 3-day arena D ≥ A (79.4k vs 75.1k); on the 1-day arena it isn't.
  - **PPO from the BC start** did not improve in 20k steps (43.0 → 39.7). A run from scratch, however, **does learn**: 20.5 → 35.0 reward and ₹75k → ₹84k profit in 30k steps. The pipeline keeps the best checkpoint.
- **Desktop:**
  - Checked out at the M3 branch (detached). `torch 2.14.1+cu126` works with CUDA on the RTX 3050.
  - `overnight.sh` passed its offline test: with the remote broken, snapshots were committed locally, training continued and the push failed gracefully. The remote URL has been restored.
  - A smoke run via `overnight.sh start configs/train/smoke.yaml` was in progress, but the desktop went unreachable at the 2026-10-05 stop. Next time, run `overnight.sh status` and `stop` if needed. Also check that the `training-logs` push backlog got uploaded.
- **Next:**
  1. Finish or redo the desktop smoke run and confirm the final push with retries.
  2. Merge M3 into `main`.
  3. On the desktop, `git checkout main && git pull` and run `prepare`.
  4. Start `full.yaml`, give the user the morning commands, and **end the chat** (no monitoring).
- **Uncommitted `kitchen/` and `design/` changes on `main`** belong to the separate revamp chat. Leave them alone.


## Status (2026-10-05 06:31): FULL TRAINING RUNNING on the desktop
- `main` = `cf21a5b`: M1 + M2 + M3 all merged. Agent branches have been deleted locally and on GitHub. Remote branches left: `main` and `training-logs`.
- **Desktop smoke run passed:** PPO 43.0 → 44.5, D ≥ A on both arenas, ONNX parity 3.8e-6, 24 min on CUDA, logs pushed.
- **Fixes in this session:**
  - Spawn/forkserver process pools. Forking after torch had started threads hung the arena on Linux.
  - `overnight.sh --resume` now reuses the run dir, and `status` flags interrupted runs.
  - Log snapshot paths are relative.
  - full.yaml uses fewer eval workers (RAM).
- **Full run:** `20261005_063045_cf21a5b` (`configs/train/full.yaml --push-model`), started 06:30 desktop time. Expected to take about 8–10 h; the desktop runs about 27 env steps/s per core.
- **Do not monitor.** When the user says it's done:
  1. Run `git fetch origin training-logs` and read `runs/20261005_063045_cf21a5b/{status.json,metrics.json,train.log.excerpt}` on that branch, or SSH in and run `overnight.sh status`.
  2. Review D vs A/B/C.
  3. Copy the champion under `models/rl_policy/D/<version>/` together with its registry entry.
  4. Commit.
- If the desktop rebooted mid-run, continue with `bash scripts/desktop/overnight.sh start --resume`.

## Update (2026-10-05 13:40 UTC): run resumed after a speed fix
- **First attempt was too slow:** 27 steps/s, an ETA of about 46 h. LightGBM forecast predict was about 2/3 of every env step, and the workers thrashed the shared cache.
- **Fix:** the RL training env now re-predicts hourly (`EnvConfig.forecast_refresh_slots=4`, applied in `PolicyC.reset`). Policies and the arena still predict every tick; the hourly refresh would cost C about 2.3% profit.
- **Desktop measurements:** one env 87 → 27 ms/step; 6 workers reach 112 env-steps/s.
- **full.yaml trimmed for the < 12 h budget:**
  - PPO 2.0M steps (the spec said 5M), `n_envs` 6.
  - RARL 150k adversary steps and 2×50k protagonist steps.
- **Same run** `20261005_063045_cf21a5b`, resumed with `--resume --push-model` from the 404k checkpoint. It runs at about 46 steps/s. ETA ≈ 11–11.5 h, finishing around 01:00 UTC on 2026-10-06 (≈ 06:30 IST).
- **Do not monitor.** The user will ping when it's done.

## Update (2026-10-06 05:00 UTC)
- The desktop was shut down overnight. The run was resumed from checkpoint 1,101,824 (curriculum stage 2, the 7-day episodes). It runs at about 56 steps/s, ETA ≈ 6–6.5 h in total (PPO about 4.4 h, then RARL, export and arena). It should finish around 11:30 UTC (≈ 17:00 IST).
- **Watch:** eval profit/day peaked at ₹105.3k at 205k steps, then drifted down to ~₹99k by 1.1M during the 7-day curriculum stage. The champion is picked from the best checkpoints, so check whether the late PPO or RARL checkpoints beat the 205k one. Consider a lower LR or `ent_coef` for future runs.

## DONE (2026-10-06): full training complete, champion committed (`5fc9951`)
- **How the run ended:** PPO was stopped at 1.6M steps. Eval profit peaked at 205k steps (₹105.3k/day), then plateaued around ₹98–99k. RARL was skipped. Both are recorded as `skipped` markers in the run.
- **Champion:** `ppo_best` @205k, now `models/rl_policy/D/full-5033b06`. Calm profit ₹105.2k/day, chaos ₹96.8k/day. ONNX parity 5.7e-6; surrogate fidelity 0.977.
- **Final arena (10 seeds × 7 days):** A ₹62.1k | B ₹73.5k | C ₹96.9k | **D ₹104.9k** per day. D beats C by 8%.
- All full-run M2 models (`*/full`) are committed and are the registry champions.
- **Next ideas:**
  - Lower LR / `ent_coef` for the 7- and 28-day curriculum stages (they didn't improve on the 205k peak).
  - Run RARL starting from the champion.
  - Wire the backend to the `kitchen/` frontend (not started; the user will ask).

---

# ROADMAP: from here to a polished demo (written 2026-10-06)

**Bottom line:** the backend is close to demo-complete (sim, policies A–E, ML, trained D, about 40 REST endpoints plus WebSocket). Wiring the frontend to it is the largest single job, but **not the only one**. Still missing: one frontend direction to commit to, the screens behind the demo script (Arena, Chaos, Back office, Pantry), the "Ask Brew" copilot, sound, and demo packaging.

Effort: S ≈ under ½ day, M ≈ 1–2 days, L ≈ 3+ days. `plan.md` is mostly outdated; its §1.3 definition of done and §22 demo script are still the best yardstick.

**Current frontend state:**
- **`lobby/`:** pink 3D café, complete. It has its own in-browser sim and is not wired to the backend.
- **`kitchen/`:** night-kitchen 3D revamp from the separate chat.
  - Scaffold committed (`05b2d0f`); `events.js`, `fx.js`, `hud.js`, `studio.js` and `tablet.js` are uncommitted, plus edits to `food.js`, `lights.js` and `props.js`.
  - Driven by a `MockSource` emitting backend-shaped events.
  - Its menu has frontend-only dinner SKUs (ribeye, margherita) that the backend doesn't have.
- **`design/`:** untracked hand-inked 2D mockups (`brew.html`, lobby/kitchen/pantry). They look like another visual exploration.

## Phase 0: Decisions (the user's call; blocks everything below)
1. **Frontend direction:** night-kitchen 3D (`kitchen/`), pink café 3D (`lobby/`), the hand-inked 2D rooms (`design/`), or a hybrid (for example, 3D hero room plus 2D/glass panels for the office, arena and pantry). The rest of this roadmap assumes **one** primary frontend.
2. **Menu:** either keep the café menu (23 backend SKUs) or add dinner plates to the backend (`configs/cafe/menu.yaml`, recipes, stations such as grill and pizza oven), then retrain the M2 models and run a short PPO fine-tune.
3. **Demo format:** live laptop demo or recorded video, its length (plan says 5 min), offline-capable or not, and whether it needs a public URL.
4. **Housekeeping:** commit or discard the uncommitted `kitchen/` work and the untracked `design/` folder (coordinate with the kitchen chat). Decide whether `lobby/` stays as a second room or goes into an archive. Check the `.claude/launch.json` change.

## Phase 1: Integration (backend ↔ frontend). L
1. **Backend client layer:**
   - Write a `WsSource` (`/api/v1/ws/worlds/{id}?since_seq=`) with the same `onFrame` contract as `MockSource`, so the mock is a drop-in swap. Keep `MockSource` as an offline fallback.
   - Hydrate from `GET /worlds/{id}/state`, then resume with `since_seq`. Handle reconnects and resync.
   - Add a thin REST client for actions and controls (`/control`, `/actions`, `/policy`, `/chaos`, `/fork`).
2. **One-command dev and demo run:**
   - FastAPI also serves the static frontend, or `serve.py` proxies `/api`.
   - Add a `launch.json` entry and a `brew-demo` CLI that starts the API, creates a demo world and opens the browser.
3. **Event → visual coverage audit:** walk every event in `backend.md §6.3` and map each one to a visual and a sound (`plan.md §18` is the juice table). Fill the gaps on both sides. Backend events the 3D kitchen probably needs:
   - per-station `task.started`/`task.finished` carrying a staff id;
   - staff positions;
   - plating or pass events;
   - a `price.changed` reason text that's good enough to display.
4. **Pacing:** keep visuals smooth at 1×, 10× and 60× (frame batching, interpolation, skipping minor animations at high speed). Use the backend's lagging flag.
5. **Actions from the UI:** serve or bump an order, `set_price`, feature or hide items, throttle, premake, Replate mode, invest, chaos. Show 409/422 errors as friendly toasts.
6. **Contract tests:** a frontend fixture recorded from the real WS stream; a JSON-schema check against `GET /events/schema`.

## Phase 2: The demo-script screens (each maps to `plan.md §22`)
1. **Hero room** (lobby or kitchen), driven live. Customers, tickets, cooking, receipts, bags and riders all come from real events. **M**
2. **Menu book with live prices:**
   - The price strike-through animation plus a reason from `price.changed`.
   - A **Replate section** (discounted pre-made food) with made-at times.
   - Carbon labels per item (CO₂e is already in the menu config). **M**
3. **Back office ("the brain"):** **L** in total.
   - Forecast fan charts (`/forecast`).
   - A decision feed as sticky notes (`/decisions` plus `/decisions/{id}/explain`, which uses D's surrogate tree and the synthetic explanation templates).
   - The bottleneck gauge (`/bottlenecks`).
   - The investment shop (`/advisor` → `/invest`), showing the purchase dropping into the 3D scene.
   - A ledger waterfall (`/kpis`, `/impact`).
4. **Policy Arena:** A/B/C/D side by side on the same seed, run as 4 parallel worlds with a live cumulative-profit race and a podium. **L** in total.
   - A "Run 30 seeds" button (`POST /arena` as a job) filling a CI table.
   - Backend need: a way to stream 4 CRN worlds at once. Either a multi-world WS or 4 sockets, plus a "create arena worlds" helper.
5. **Chaos console:** big buttons → `POST /worlds/{id}/chaos`. The world must *visibly* adapt (tickets reshuffle, throttle stamps, an 86 ribbon, an explanation note). **M**
6. **Pantry / walk-in:** lots, FEFO, freshness colours, the Replate and donation crates, supplier deliveries (`/inventory`, `/fridge`, `/replate`). **M–L**
7. **Impact board:** waste kg, CO₂e, donated kg, overload minutes, rating, profit vs baseline (`/impact`). **S–M**
8. **Optional:** customer QR page (live menu, ETA, Now Brewing) **S**; owner daily digest card **S**; replay / time-machine scrubber using the event log and `/fork` **M**.

## Phase 3: Backend features still missing for the demo
1. **"Ask Brew" copilot** (`plan.md §19.1`): **M**
   - Claude API with tool use over the read-only analytics endpoints, under a new `/api/v1/ask` route.
   - The eval set already exists: `data/synthetic/clean/ask_brew_eval.jsonl` (300 rows). Add an eval harness.
   - Needs an API key, and a graceful offline fallback.
2. **Arena streaming helper:** create N worlds with CRN on the same seed and step them in lockstep (see Phase 2.4). **M**
3. **Invest → visual:** make sure `investment.delivered` carries enough to spawn the 3D object, and that the next sim day shows the throughput gain. **S**
4. **Demo scenario presets:** a curated seed or day where the morning rush, a Zomato batch, a price change, chaos recovery and an obvious bottleneck all happen in the first few sim-minutes at 10–60×. **M**
5. **Recorded-replay fallback:** export a demo day's event stream to JSON so the frontend can play it with no backend (`plan.md §20.3`). **S**
6. **If dinner plates are added (Phase 0.2):** add the SKUs, recipes and stations, retrain the M2 models and fine-tune D. **M**
7. **Optional, from `plan.md §19`:** POS-CSV twin calibration, live weather (Open-Meteo), multi-cafe. These are vision items; skip unless there's time.

## Phase 4: ML quality follow-ups (optional but valuable)
1. **PPO plateau:** the best checkpoint was at 205k steps, and the 7- and 28-day curriculum stages didn't improve on it. Try a lower LR and `ent_coef`, keep 1–7-day episodes, and use KL or target_kl early stopping. Fine-tune from the champion.
2. **RARL from the champion:** improves chaos-day profit and CVaR, which is the "visibly adapts to chaos" story.
3. **30-seed arena with paired CIs and CVaR** for the deck: D vs C vs B vs A, on calm and chaos days.
4. **Explanation quality:** review the surrogate-tree reasons and the template text that users will read.
5. **Forecast:** the P50 has a negative bias; check whether the full-run model fixed it.

## Phase 5: Sound (`plan.md §4`). M
`lobby/` has synthesised Web Audio. The chosen frontend needs:
- a cue list (about 60 cues, mapped from events);
- mix buses (music, SFX, UI, ambience) with ducking;
- an ambient kitchen bed and an adaptive music layer (load-reactive);
- a mute toggle and a "calm mode".

Use CC0 or licensed sources and keep a CREDITS file.

## Phase 6: Polish and UX. M–L
- **Motion system:** nothing pops, numbers roll, and a camera move between rooms (lobby, kitchen, pantry, office, arena).
- **Onboarding:** a 20-second coach overlay. Every 3D hot-spot gets a hover tooltip and a click affordance.
- **Performance:** stay at or under about 16 ms per frame on the M2 8 GB with the live WS stream. Check memory over a 30-minute run (no leaks from spawned customers or tickets).
- **Accessibility:** reduced motion, captions for sounds, colour-blind-safe signals, keyboard navigation, `aria-live` for key events.
- **States:** loading, error and reconnect states, and a backend-offline banner that falls back to replay.

## Phase 7: Demo packaging and hardening. M
- **Launch:** `uv run brew-demo` with one command does everything (API, world, frontend, browser). Also a `README` quickstart, screenshots, a recorded 3–5 min video, and the demo script rehearsed against a preset.
- **CI:** GitHub Actions running pytest, ruff and mypy, plus a headless-browser smoke test of the frontend (loads, connects, renders tickets).
- **Load and soak:** a WS soak test (1 h at 60×), and a test with 4 arena worlds at once.
- **Deploy (only if a URL is needed):** a static frontend host plus the backend on a small VM. Otherwise local only.
- **Tidy up:** archive the unused frontend directions, remove stale scripts, and refresh `docs/backend-quickstart.md` and the runbook.

## Suggested order
Phase 0 decisions → Phase 1.1–1.2 (wiring skeleton) → Phase 2.1 hero room live → Phase 3.4 demo preset → Phase 2.2, 2.5 and 2.3 (menu, chaos, office) → Phase 2.4 Arena (with 3.2) → Phase 3.1 copilot → Phase 5 sound → Phase 6 polish → Phase 7 packaging and rehearsal. Phase 4 ML work can run on the desktop in parallel at any point.
