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
