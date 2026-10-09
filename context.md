# ROADMAP: from here to a polished demo (written 2026-10-06, updated the same day)

> **Integration phase checkpoint:** see `docs/handoff/integration-status.md` for what's done and the remaining items
> (verify `main`, finish visual/perf tests from `docs/handoff/wave2-wip.patch`, get CI green), then `polish.md`.

> Read `plan.md` first. It is the master plan and was rewritten on 2026-10-06. This file is the short, current
> status plus the ordered roadmap. Each phase has its own self-contained handoff doc, written for a fresh chat.

## Where we are
- **Backend: done, tested, live** (Python 3.12, uv, FastAPI + WebSocket).
  - 281 tests pass; ruff and mypy are clean.
  - The café **runs in real time** (`BREW_LIVE_RATE=1.0`, no playback speeds). A `clock:"wall"` world starts on
    today's date, synced to Asia/Kolkata time. Controls are play, pause and step.
  - Policies A naive, B heuristic, C optimiser, D learned RL (ONNX) and E oracle.
  - **Replate** (rescue shelf) and **meal combos** are implemented.
  - Contract: 42 REST routes and 71 typed events (backend.md §6).
- **RL: trained and committed.** Champion `models/rl_policy/D/full-5033b06`, trained on the desktop (RTX 3050, WSL2).
  - Final arena (10 seeds × 7 days), per day: A ₹62.1k, B ₹73.5k, C ₹96.9k, **D ₹104.9k** (D beats C by 8 % and A by
    69 %).
  - Full metrics are in `docs/training/full-20261005/`. The story is told in `technical.md` §9.
- **Frontend: `design/` is final** (hand-inked 2D, "Strawberry Milk" palette), with **three screens only: lobby,
  kitchen, pantry**.
  - It is **static or mocked**. The exception is the new **menu book** (`design/menu.js`): it flies off the lectern,
    turns 3D pages, shows live prices with an ink strike-through, and has meal-combo and rescue-shelf spreads, all
    driven by a mock with backend event shapes.
  - `lobby/` (3D pink café) and `kitchen/` (3D night kitchen) are retired prototypes, to be deleted during
    integration. `kitchen/` still has uncommitted work-in-progress from another chat; it is unused.
- **Docs:**
  - `plan.md`: master plan.
  - `technical.md`: judges' deep-dive.
  - `backend.md`: backend product and API spec.
  - `docs/implementation-spec.md`: the low-level spec the code was built from (formerly technical.md).
  - `frontend-backend-integration.md`, `polish.md`: phase handoffs.

## Scope decisions (2026-10-06)
- Three screens only: lobby, kitchen, pantry. The menu book is an overlay opened from the lobby lectern.
- **No** policy-arena page. The comparison lives in the **HUD profit component**: click it and it expands into
  range/bar charts of D vs A/B/C ("what you'd otherwise make").
- **No** back office, no onboarding, no LLM chat or voice, no customer QR page. These are future scope, as are
  POS-CSV calibration, live weather and multi-café.
- **Live** café, no 1×/10×/60× speeds. The HUD speed buttons must go.

## Roadmap (in order)
| # | Phase | Handoff doc | Owner pattern |
|---|---|---|---|
| 1 | **Test suite first**: golden event-stream fixtures recorded from the real backend, a contract map (`design/contract.json`), pure state reducers, rendering, no-mock, e2e, visual-regression and basic perf tests, CI | `frontend-backend-integration.md` §4 | Sonnet 5.5 sub-agents, reviewed by the lead |
| 2 | **Frontend–backend integration**: WS client + hydration + replay source; static SVG strings → state-driven renderers; procedural customers; every lobby, kitchen, pantry and HUD surface wired; backend gaps closed (station load, staff fatigue stream, chaos UI, proposed PO + approve, policy-comparison endpoint, baselines); delete `lobby/` and `kitchen/` | `frontend-backend-integration.md` §5 | lead does UI; sub-agents do everything else |
| 3 | **Polish**: sound (port `lobby/js/audio.js` before deleting it), animated transitions, 2D camera moves and focus zooms, 16 ms/frame on the M2 (watch the `#wob` filters), accessibility, reconnect/offline/replay states, a Dock-style README with GIFs and screenshots | `polish.md` | lead does feel and design; sub-agents do the rest |
| 4 | **Demo packaging**: one-command launch (FastAPI serving `design/`), a demo world preset, a recorded 3–5 min video and a rehearsed script | `plan.md` (demo script, roadmap) | lead |
| 5 | **Optional ML follow-ups**: a gentler LR and entropy in the long curriculum stages with `target_kl`, fine-tuned from the champion; RARL from the champion (chaos CVaR); a 30-seed CI table; a heavier waste weight to close D's waste gap vs C | `technical.md` §9.10, §15 | desktop via `scripts/desktop/overnight.sh` |

## Standing rules
- **Commit and push to `main` frequently.** `main` is the only branch, locally and on GitHub.
- **Use Sonnet 5.5 sub-agents for everything that isn't UI design.** The lead reviews their work before merging.
- Use **uv** for Python. Keep backend and frontend suites green.
- Keep the hand-inked style exactly consistent everywhere.
- Never change an event or endpoint without updating `backend.md` §6, the schema and the tests.
- The laptop is an M2 with 8 GB, and the owner dislikes fan noise: at most 2 heavy worker processes.

## Training machine (if ML work resumes)
- **Access:** desktop over Tailscale with `ssh -i ~/.ssh/brew_desktop_ed25519 -p 2222 abhinav@100.72.93.7` (WSL2
  Ubuntu 24.04; i5-11400; RTX 3050; WSL RAM 10 GiB). The repo is at `~/brew`.
- **Runner:** `bash scripts/desktop/overnight.sh prepare | start <config> [--resume] [--push-model] | status | stop`.
  - Training is offline. Logs are committed locally, and pushes are best-effort to a `training-logs` branch that the
    runner creates.
  - **Merge or copy the useful logs into `main` (like `docs/training/`) and delete that branch afterwards**, so that
    `main` stays the only branch.
- **Rule from the owner:** after starting a long training run, give the morning-check command and **end the chat**.
  Don't monitor; the owner reports when it's done.
