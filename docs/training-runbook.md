# Training runbook: desktop (WSL2 + RTX 3050)

This runbook covers full training on the desktop. Everything below runs inside WSL (Ubuntu 24.04) in `~/brew`.

## One-time setup (already done on 2026-10-04)

These steps are recorded here in case the machine is ever rebuilt.

1. **SSH:** install `openssh-server`, listening on port 2222 with key-only login. Authorise the Mac's `~/.ssh/brew_desktop_ed25519.pub`.
2. **Tailscale:** install it in WSL, then run `sudo tailscale set --accept-dns=false` and `sudo tailscale set --operator=$USER`. The desktop is `100.72.93.7`.
3. **`.wslconfig`:** `memory=11GB`, `swap=8GB`, `processors=12`, `networkingMode=mirrored`.
4. **GitHub:** run `gh auth login` and `gh auth setup-git`, and set the repo-local `git config user.name/email`.
5. **Clone:** `git clone https://github.com/Abhinav-Prabhakar/Brew.git ~/brew`.
6. **GPU:**
   - The Windows NVIDIA driver is 572.70, which supports CUDA 12.8. `nvidia-smi` lives at `/usr/lib/wsl/lib/nvidia-smi`.
   - On Linux, torch is installed from the **CUDA 12.6** index (pinned in `pyproject.toml`), because the default PyPI wheel needs a newer driver.
   - If you update the Windows driver, nothing needs changing.

## Run training (overnight)

```bash
cd ~/brew && git checkout main && git pull --ff-only
```

```bash
bash scripts/desktop/overnight.sh prepare
```

```bash
bash scripts/desktop/overnight.sh start configs/train/full.yaml
```

- **`prepare`** needs the network. It runs `uv sync` (with retries), checks the GPU, runs the fast tests and initialises the `training-logs` worktree.
- **`start`** runs fully offline (`UV_OFFLINE=1`).
  - The run is detached (`setsid nohup`), so it survives SSH logout and closing the terminal.
  - It keeps Windows awake while it runs.
  - Logs and metrics go to `.overnight/runs/<stamp>/`. Run artefacts (checkpoints, TensorBoard, champion) go to `runs/overnight/<stamp>/`.
  - Every 30 minutes a snapshot of the small files is committed to the local `training-logs` branch and pushed if the network is up. A failed push never affects training.
  - When the run ends, the final push is retried 8 times with backoff (30 s, doubling, up to 15 min; about 1.5 h in total). If it still can't reach GitHub, `overnight.sh push` retries later.
  - Checkpoints are never uploaded. `--push-model` adds the champion ONNX (under 5 MB).
- **Resume after a crash or reboot:** `bash scripts/desktop/overnight.sh start configs/train/full.yaml --resume`. Completed stages are skipped and PPO continues from its last checkpoint.

## Morning check

```bash
bash scripts/desktop/overnight.sh status
```

This shows the state (`training`, `done`, `failed` or `stopped`), the `progress.json` contents (stage, step, steps/s, ETA, last evaluation), the last 25 log lines and whether any log commits are still unpushed.

From the Mac, without SSH:

```bash
git fetch origin training-logs && git log --oneline -3 origin/training-logs
```

The files are under `runs/<stamp>/` on that branch: `status.json`, `progress.json`, `metrics.json`, `train.log.excerpt` and `train.log.gz`.

Other commands: `overnight.sh tail` (follow the log live), `overnight.sh stop`, `overnight.sh push`.

## What `full.yaml` does

| Stage | Work | Notes |
|---|---|---|
| M2 | 180-day histories × 4 scenarios, forecaster, elasticity, prep/ETA/replate/text models, M2 arena | CPU only |
| BC | 200 days of Policy C, 80 epochs | warm-starts PPO |
| PPO | 5 M steps, curriculum 1 → 7 → 28-day episodes, `n_envs = min(16, cpu−2)` = 10 | the bulk of the time; sim-bound |
| RARL | 1 M adversary steps, 2 iterations | |
| Export | ONNX plus parity check, surrogate tree | champion copied to `models/rl_policy/D/<version>/` |
| Final arena | A/B/C/D × 10 seeds × 7 days | |

To validate the plan in seconds without training, run `uv run brew-train all --config configs/train/full.yaml --dry-run`.

## After training

1. **Fetch the champion:** pull `training-logs` on the Mac and check `metrics.json` (D vs A/B/C, ONNX parity). Then either `scp` the champion folder or rerun with `--push-model`.
2. **Commit it:** add the champion under `models/rl_policy/D/<version>/` together with its `registry.json` entry, and commit.
