"""Basic performance guard: replay ``lunch_delivery`` at speed 60 (one sim-minute per second: a busy stream, animations on)
and measure frame times with a requestAnimationFrame probe while a room is on screen. Fails when p95 > 50 ms (generous:
the 16 ms target is enforced in the polish phase). p50 / p95 / max are printed (``pytest -s``).
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.frontend

P95_LIMIT_MS = 50.0
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


LOBBY_KNOWN = pytest.mark.xfail(
    strict=False,
    reason="KNOWN (polish phase): the 18 animated `filter=url(#wob)` groups in the lobby scene cost "
    "~150 ms per frame in headless Chromium's software rasteriser; with the filters removed the lobby runs at 16.7 ms. "
    "Not an event-handling cost (JS is 93 % idle in a profile). Drop this marker when the lobby passes.",
)


@pytest.mark.parametrize("room", [pytest.param("lobby", marks=LOBBY_KNOWN), "kitchen"])
def test_frame_times_while_replaying_the_lunch_rush(browser, static_url, room):
    ctx = browser.new_context(viewport={"width": 1632, "height": 1040})
    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.route("**/fonts.g*/**", lambda r: r.abort())
    try:
        page.goto(f"{static_url}/design/brew.html?source=replay&fixture=lunch_delivery&speed=60#{room}")
        page.wait_for_function("window.BrewLive && BrewLive.state && BrewLive.source && BrewLive.source.stream", timeout=15000)
        page.wait_for_timeout(1500)  # the first sim-minutes: customers walking in, tickets landing
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
    print(f"\nperf {room}: {len(dts)} frames, {seq1 - seq0} events, p50 {p50:.1f} ms  p95 {p95:.1f} ms  max {worst:.1f} ms")
    assert p95 <= P95_LIMIT_MS, f"{room}: p95 frame time {p95:.1f} ms > {P95_LIMIT_MS:.0f} ms"
