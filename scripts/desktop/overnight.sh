#!/usr/bin/env bash
# brew · overnight training on the desktop (WSL2 / Linux).
#
#   bash scripts/desktop/overnight.sh prepare            # once, while online: uv sync + GPU check + tests
#   bash scripts/desktop/overnight.sh start [config]     # detached run (survives SSH logout); default configs/train/full.yaml
#   bash scripts/desktop/overnight.sh status             # morning check: state, progress, last log lines
#   bash scripts/desktop/overnight.sh tail               # follow the live log
#   bash scripts/desktop/overnight.sh push               # (re)try uploading logs of the latest run
#   bash scripts/desktop/overnight.sh stop               # stop the run (resume later with: start --resume)
#
# Offline-first: training never touches the network. Logs/metrics are committed to a local
# `training-logs` branch (worktree in .overnight/logs) and pushed best-effort every 30 min;
# a failed push never stops training. Final upload retries with backoff. Checkpoints stay
# local (runs/…) unless --push-model is given (then only the small champion ONNX is pushed).
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="$REPO/.overnight"
LOGS_WT="$STATE_DIR/logs"            # worktree of branch training-logs
LATEST="$STATE_DIR/latest"           # symlink → current run's log dir
SYNC_EVERY_S="${SYNC_EVERY_S:-1800}"
FINAL_PUSH_TRIES="${FINAL_PUSH_TRIES:-8}"
mkdir -p "$STATE_DIR"
cd "$REPO" || exit 1

ts() { date '+%Y-%m-%d %H:%M:%S'; }
say() { echo "[$(ts)] $*"; }
json_status() { # state [exit_code]
  local d="$1/status.json"
  printf '{"state":"%s","exit_code":%s,"run":"%s","config":"%s","git_sha":"%s","host":"%s","started":"%s","updated":"%s","last_push":"%s"}\n' \
    "$2" "${3:-null}" "$(basename "$1")" "${CONFIG:-}" "$(git rev-parse --short HEAD 2>/dev/null)" "$(hostname)" \
    "$(cat "$1/.started" 2>/dev/null)" "$(ts)" "$(cat "$1/.last_push" 2>/dev/null)" > "$d"
}
online() { timeout 8 git ls-remote --exit-code origin HEAD >/dev/null 2>&1; }

# ---------------------------------------------------------------- logs branch worktree
ensure_logs_wt() {
  [ -d "$LOGS_WT/.git" ] || [ -f "$LOGS_WT/.git" ] && return 0
  if timeout 20 git fetch -q origin training-logs 2>/dev/null; then
    git worktree add -q "$LOGS_WT" -B training-logs origin/training-logs
  elif git show-ref -q --verify refs/heads/training-logs; then
    git worktree add -q "$LOGS_WT" training-logs
  else
    git worktree add -q --detach "$LOGS_WT" HEAD
    ( cd "$LOGS_WT" && git checkout -q --orphan training-logs && git rm -rqf . && \
      echo "# brew training logs (one folder per run)" > README.md && git add README.md && \
      git commit -qm "training-logs: init" )
  fi
}

# Copy small, human/agent-readable artefacts of a run into the logs worktree and commit locally.
snapshot() { # run_dir log_dir
  local run="$1" log="$2" dst="$LOGS_WT/runs/$(basename "$log")"
  mkdir -p "$dst"
  cp -f "$log"/*.json "$log"/*.txt "$dst"/ 2>/dev/null
  # full log can be large: keep head + tail, gzip the whole thing if < 20 MB
  if [ -f "$log/train.log" ]; then
    { head -n 300 "$log/train.log"; echo "…"; tail -n 3000 "$log/train.log"; } > "$dst/train.log.excerpt"
    [ "$(stat -c %s "$log/train.log")" -lt 20000000 ] && gzip -c "$log/train.log" > "$dst/train.log.gz"
  fi
  if [ -d "$run" ]; then
    find "$run" -maxdepth 3 \( -name 'metrics*.json' -o -name 'progress.json' -o -name 'config.yaml' -o -name 'eval*.json' -o -name '*.csv' \) \
      -size -5M -exec cp -f --parents {} "$dst/" \; 2>/dev/null
    if [ "${PUSH_MODEL:-0}" = 1 ]; then
      find "$run" -path '*champion*' -name '*.onnx' -size -5M -exec cp -f --parents {} "$dst/" \; 2>/dev/null
      find "$run" -path '*champion*' -name 'obs_norm.json' -exec cp -f --parents {} "$dst/" \; 2>/dev/null
    fi
  fi
  ( cd "$LOGS_WT" && git add -A runs >/dev/null 2>&1 && \
    git commit -qm "logs: $(basename "$log") @ $(ts)" >/dev/null 2>&1 ) || true
}

push_once() { # best effort, bounded time
  ( cd "$LOGS_WT" && timeout 90 git push -q origin training-logs 2>/dev/null ) && return 0
  # remote moved (e.g. another run): rebase our per-run folder on top and retry once
  ( cd "$LOGS_WT" && timeout 60 git pull -q --rebase origin training-logs 2>/dev/null && \
    timeout 90 git push -q origin training-logs 2>/dev/null )
}

push_with_retry() { # tries
  local n="${1:-$FINAL_PUSH_TRIES}" wait=30 i
  for ((i = 1; i <= n; i++)); do
    if push_once; then say "logs pushed (try $i)"; return 0; fi
    say "push failed (try $i/$n) — network down? retrying in ${wait}s"
    sleep "$wait"; wait=$((wait * 2 > 900 ? 900 : wait * 2))
  done
  say "giving up on upload for now; logs are committed locally on branch training-logs."
  say "push later with: bash scripts/desktop/overnight.sh push"
  return 1
}

# Keep Windows awake while training (WSL only; no admin needed). Best effort.
keep_awake() {
  command -v powershell.exe >/dev/null 2>&1 || return 0
  powershell.exe -NoProfile -Command '
    $s = Add-Type -MemberDefinition "[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint f);" -Name P -Namespace W -PassThru;
    while ($true) { [void]$s::SetThreadExecutionState(0x80000001); Start-Sleep 50 }' >/dev/null 2>&1 &
  echo $! > "$STATE_DIR/awake.pid"
}

# ---------------------------------------------------------------- commands
cmd_prepare() {
  say "repo: $REPO"
  command -v uv >/dev/null || { say "installing uv"; curl -LsSf https://astral.sh/uv/install.sh | sh; export PATH="$HOME/.local/bin:$PATH"; }
  if online; then git pull -q --ff-only || say "git pull skipped (local changes?)"; else say "offline: skipping git pull"; fi
  uv sync --frozen 2>/dev/null || uv sync || { say "uv sync failed (offline and no cache?)"; return 1; }
  uv run python - <<'PY'
import os, platform
print("python", platform.python_version(), "| cpus", os.cpu_count())
try:
    import torch
    print("torch", torch.__version__, "| cuda", torch.cuda.is_available(),
          torch.cuda.get_device_name(0) if torch.cuda.is_available() else "")
except Exception as e:  # torch arrives with M3
    print("torch not available:", e)
PY
  command -v nvidia-smi >/dev/null && nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
  uv run pytest -q -x -m "not slow" 2>&1 | tail -3
  ensure_logs_wt && say "logs worktree ready at $LOGS_WT"
  say "prepared. Training itself needs no network."
}

cmd_start() {
  local resume=""
  CONFIG="configs/train/full.yaml"
  for a in "$@"; do case "$a" in --resume) resume="--resume" ;; --push-model) export PUSH_MODEL=1 ;; *) CONFIG="$a" ;; esac; done
  [ -f "$CONFIG" ] || { say "config not found: $CONFIG"; exit 1; }
  if [ -f "$STATE_DIR/run.pid" ] && kill -0 "$(cat "$STATE_DIR/run.pid")" 2>/dev/null; then say "a run is already active (pid $(cat "$STATE_DIR/run.pid"))"; exit 1; fi
  ensure_logs_wt
  local stamp; stamp="$(date '+%Y%m%d_%H%M%S')_$(git rev-parse --short HEAD)"
  local log="$STATE_DIR/runs/$stamp"; mkdir -p "$log"
  ln -sfn "$log" "$LATEST"
  export CONFIG
  setsid nohup bash "$0" _run "$log" "$CONFIG" "$resume" > "$log/supervisor.log" 2>&1 < /dev/null &
  echo $! > "$STATE_DIR/run.pid"
  say "started run $stamp (pid $!) with $CONFIG $resume"
  say "check in the morning:  bash scripts/desktop/overnight.sh status"
}

cmd__run() { # internal: log_dir config resume
  local log="$1"; CONFIG="$2"; local resume="${3:-}"
  local run="$REPO/runs/overnight/$(basename "$log")"
  export UV_OFFLINE=1 PYTHONUNBUFFERED=1 TQDM_MININTERVAL=30
  ts > "$log/.started"
  json_status "$log" preparing
  {
    echo "== system"; uname -a; lscpu 2>/dev/null | grep -E 'Model name|^CPU\(s\)'; free -h 2>/dev/null | head -2
    command -v nvidia-smi >/dev/null && nvidia-smi; uv --version; git log -1 --oneline
  } > "$log/system.txt" 2>&1
  keep_awake
  # periodic best-effort sync (never blocks training)
  ( while sleep "$SYNC_EVERY_S"; do
      json_status "$log" training; snapshot "$run" "$log"
      push_once && ts > "$log/.last_push" || true
    done ) &
  local syncer=$!

  json_status "$log" training
  say "training: brew-train all --config $CONFIG --run-dir $run $resume" | tee -a "$log/train.log"
  local t0=$SECONDS
  uv run --offline brew-train all --config "$CONFIG" --run-dir "$run" $resume >> "$log/train.log" 2>&1
  local rc=$?
  local dur=$(( SECONDS - t0 ))
  kill "$syncer" 2>/dev/null
  [ -f "$STATE_DIR/awake.pid" ] && kill "$(cat "$STATE_DIR/awake.pid")" 2>/dev/null
  say "finished rc=$rc after $((dur / 3600))h$(((dur % 3600) / 60))m" | tee -a "$log/train.log"
  json_status "$log" "$([ $rc = 0 ] && echo done || echo failed)" "$rc"
  snapshot "$run" "$log"
  push_with_retry "$FINAL_PUSH_TRIES" && ts > "$log/.last_push" && json_status "$log" "$([ $rc = 0 ] && echo done || echo failed)" "$rc" \
    && snapshot "$run" "$log" && push_once
  rm -f "$STATE_DIR/run.pid"
}

cmd_status() {
  [ -e "$LATEST" ] || { echo "no runs yet"; return; }
  local log; log="$(readlink -f "$LATEST")"
  local pid; pid="$(cat "$STATE_DIR/run.pid" 2>/dev/null)"
  echo "run:     $(basename "$log")"
  echo "process: $([ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && echo "running (pid $pid)" || echo "not running")"
  echo "status:  $(cat "$log/status.json" 2>/dev/null)"
  local prog; prog="$(find "$REPO/runs/overnight/$(basename "$log")" -name progress.json 2>/dev/null | head -1)"
  [ -n "$prog" ] && echo "progress: $(cat "$prog")"
  echo "--- last 25 log lines"; tail -n 25 "$log/train.log" 2>/dev/null
  echo "--- logs branch: $(cd "$LOGS_WT" 2>/dev/null && git log -1 --format='%h %s (%cr)') | unpushed commits: $(cd "$LOGS_WT" 2>/dev/null && git rev-list --count origin/training-logs..HEAD 2>/dev/null || echo '?')"
}

cmd_push() {
  ensure_logs_wt
  [ -e "$LATEST" ] && snapshot "$REPO/runs/overnight/$(basename "$(readlink -f "$LATEST")")" "$(readlink -f "$LATEST")"
  push_with_retry "${1:-$FINAL_PUSH_TRIES}"
}

cmd_stop() {
  local pid; pid="$(cat "$STATE_DIR/run.pid" 2>/dev/null)" || true
  [ -n "$pid" ] && kill -- -"$pid" 2>/dev/null && say "stopped run (pid group $pid)"
  [ -f "$STATE_DIR/awake.pid" ] && kill "$(cat "$STATE_DIR/awake.pid")" 2>/dev/null
  rm -f "$STATE_DIR/run.pid"
  [ -e "$LATEST" ] && json_status "$(readlink -f "$LATEST")" stopped
}

case "${1:-}" in
  prepare) shift; cmd_prepare "$@" ;;
  start)   shift; cmd_start "$@" ;;
  _run)    shift; cmd__run "$@" ;;
  status)  cmd_status ;;
  tail)    tail -f "$(readlink -f "$LATEST")/train.log" ;;
  push)    shift; cmd_push "$@" ;;
  stop)    cmd_stop ;;
  *) sed -n 2,15p "$0" ;;
esac
