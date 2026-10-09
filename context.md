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
  - The agent may still be running. If it isn't, check `git log main..HEAD` and the status of that worktree, then finish M3 from where it stopped.
  - **Required CLI contract** (the desktop script depends on it): `uv run brew-train all --config <yaml> --run-dir <dir> [--resume] [--dry-run]`. It must write:
    - `progress.json` (stage, step, total, steps_per_s, eta, last_eval)
    - `metrics.json`, `config.yaml`, `eval/`, `tb/`, `checkpoints/`
    - `champion/{policy.onnx, obs_norm.json, meta.json}`
  - Training must make no network calls.
  - Tracked artifacts under `models/` must not be overwritten by smoke runs.
  - **Acceptance:** env passes `env_checker`; masks never all-false; smoke PPO improves; D ≥ A on 3 seeds; ONNX parity < 1e-4; `full.yaml --dry-run` OK; smoke end to end OK; env step < 40 ms.

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
- **DNS:** Tailscale overrides DNS (MagicDNS 100.100.100.100), and that caused one `uv sync` failure. The user should run `sudo tailscale set --accept-dns=false` and `sudo tailscale set --operator=$USER` (not done yet).
- **Last state:** `uv sync` succeeded. `overnight.sh prepare` was running detached, with output in `~/prepare.log` on the desktop. Torch isn't installed yet because it arrives with the M3 merge; re-run `prepare` after merging.

## `scripts/desktop/overnight.sh` (offline-first runner)
- **Commands:** `prepare | start [config] [--resume] [--push-model] | status | tail | push | stop`.
- **How a run works:** detached with `setsid nohup`, run under `UV_OFFLINE=1`, and keeps Windows awake through `SetThreadExecutionState`.
- **Logs:** written to `.overnight/runs/<stamp>/` and committed to a local `training-logs` worktree (`.overnight/logs`). Pushes are best-effort every 30 minutes; the final push makes 8 attempts with exponential backoff. Checkpoints are never pushed (only a champion ONNX under 5 MB, with `--push-model`).
- **Testing:** only syntax-checked plus the `prepare` path. Still to verify: the `start`/`status` flow, the offline path and `cp --parents` on GNU.

## Estimates (to give the user)
- **Full training on the M2 Mac:** about 12–30 h, CPU-bound.
- **On the desktop:** expect it to be faster mainly from more parallel envs (about 10), not from the GPU. Measure steps/s in the smoke run and give the user a real estimate.
