"""Performance guard: replay ``lunch_delivery`` at speed 60 (one sim-minute per second: a busy stream, animations on)
and measure frame times with a requestAnimationFrame probe while a room (or the open menu book) is on screen, after the
static backdrops are baked (``R.bake``). p50 / p95 / max are printed (``pytest -s``).

The limit is ``BREW_PERF_LIMIT_MS`` (default 50 ms): headless Chromium rasterises in software, so CI gets a tolerance;
run ``BREW_PERF_LIMIT_MS=16.7 uv run pytest tests/frontend/test_perf.py -s`` on the M-series laptop for the 60 fps budget.
"""

from __future__ import annotations

import os

import pytest

pytestmark = pytest.mark.frontend

P95_LIMIT_MS = float(os.environ.get("BREW_PERF_LIMIT_MS", "50"))
# the open book is 3D-transformed pages: cheap on a GPU, ~45-50 ms in headless software rasterisation
BOOK_LIMIT_MS = float(os.environ.get("BREW_PERF_LIMIT_MS", "80"))
MEASURE_MS = 8000

PROBE_JS = """(ms) => new Promise((resolve) => {
  const dts = []; let last = null; const t0 = performance.now();
  const tick = (t) => {
    if (last !== null) dts.push(t - last);
    last = t;
    if (t - t0 < ms) requestAnimationFrame(tick); else resolve(dts);
  };
  requestAnimationFrame(tick);
})"""


def pct(xs: list[float], q: float) -> float:
    s = sorted(xs)
    return s[min(len(s) - 1, int(q * len(s)))]


@pytest.mark.parametrize("room", ["lobby", "kitchen", "pantry", "lobby+book"])
def test_frame_times_while_replaying_the_lunch_rush(browser, static_url, room):
    room, book = room.split("+")[0], room.endswith("+book")
    ctx = browser.new_context(viewport={"width": 1632, "height": 1040})
    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.route("**/fonts.g*/**", lambda r: r.abort())
    try:
        page.goto(f"{static_url}/design/brew.html?source=replay&fixture=lunch_delivery&speed=60#{room}")
        page.wait_for_function("window.BrewLive && BrewLive.state && BrewLive.source && BrewLive.source.stream", timeout=15000)
        page.evaluate("window.BREW_BAKED")
        page.wait_for_timeout(1500)  # the first sim-minutes: customers walking in, tickets landing
        if book:
            page.evaluate("BREW_MENUBOOK.open()")
            page.wait_for_timeout(1200)
        seq0 = page.evaluate("BrewLive.state.seq")
        dts = page.evaluate(PROBE_JS, MEASURE_MS)
        seq1 = page.evaluate("BrewLive.state.seq")
        assert page.evaluate("document.body.dataset.room") == room
    finally:
        ctx.close()
    assert not errors, errors[:3]
    assert seq1 - seq0 > 100, f"the replay really ran ({seq1 - seq0} events in {MEASURE_MS / 1000:.0f} s)"
    assert len(dts) > 30, f"only {len(dts)} frames in {MEASURE_MS / 1000:.0f} s: the page is starving"
    p50, p95, worst = pct(dts, 0.5), pct(dts, 0.95), max(dts)
    print(f"\nperf {room}{' + book' if book else ''}: {len(dts)} frames, {seq1 - seq0} events, p50 {p50:.1f} ms  p95 {p95:.1f} ms  max {worst:.1f} ms")
    limit = BOOK_LIMIT_MS if book else P95_LIMIT_MS
    assert p95 <= limit, f"{room}: p95 frame time {p95:.1f} ms > {limit:.0f} ms"
