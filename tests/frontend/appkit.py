"""The real page (``design/brew.html``) replaying a recorded fixture, driven step by step (render / visual / perf tests).

``open_app(fixture)`` loads ``brew.html?source=replay&fixture=<name>&speed=0&still``: a ReplaySource with ``speed=0`` is
paused and ``BrewLive.source.stepTo(sim_s)`` delivers every event up to that sim time, so a test can look at the screens at
a fixed moment of a fixture. ``?still`` disables CSS animation and rolling numbers (render.js ``R.reduced``).
Google Fonts are blocked by default (hermetic, fast); the visual tests let them through and wait for ``document.fonts``.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Any

import pytest

VIEWPORT = {"width": 1632, "height": 1040}
FONTS_GLOB = "**/fonts.g*/**"  # fonts.googleapis.com (CSS) + fonts.gstatic.com (files)

GARBAGE_JS = """() => {
  const bad = [];
  const re = /NaN|undefined|Infinity|\\[object /;
  for (const el of document.querySelectorAll('#viewport, #viewport *')) {
    for (const a of el.attributes) if (re.test(a.value)) bad.push(el.tagName + '[' + a.name + ']=' + a.value.slice(0, 80));
    if (el.childElementCount === 0 && /NaN|undefined|\\[object /.test(el.textContent)) bad.push(el.tagName + ' text=' + el.textContent.slice(0, 80));
  }
  return bad.slice(0, 12);
}"""


def sim_at(hhmm: str) -> float:
    """``"08:45"`` or ``"+1 02:00"`` (next day) -> sim seconds since day-0 midnight (the fixtures' clock)."""
    day = 0
    if hhmm.startswith("+"):
        d, hhmm = hhmm.split(" ", 1)
        day = int(d[1:])
    h, m = hhmm.split(":")
    return day * 86400.0 + int(h) * 3600 + int(m) * 60


class App:
    """A page plus its collected errors. ``check()`` fails on page errors, console errors and NaN/undefined in the DOM."""

    def __init__(self, page: Any, errors: list[str]) -> None:
        self.page = page
        self.errors = errors

    def step_to(self, when: str | float, settle_ms: int = 450) -> None:
        t = sim_at(when) if isinstance(when, str) else when
        self.page.evaluate("(t) => BrewLive.source.stepTo(t)", t)
        self.page.wait_for_timeout(settle_ms)

    def ev(self, js: str, arg: object = None) -> Any:
        return self.page.evaluate(js, arg)

    def state(self, expr: str) -> Any:
        """Evaluate a JS expression with ``s`` = the store state (JSON result)."""
        return self.page.evaluate(f"() => {{ const s = BrewLive.state; return ({expr}); }}")

    def room(self, name: str, settle_ms: int = 350) -> None:
        self.page.evaluate("(r) => document.querySelector(`.tab[data-go=${r}]`).click()", name)
        self.page.wait_for_timeout(settle_ms)

    def garbage(self) -> list[str]:
        return self.page.evaluate(GARBAGE_JS)  # type: ignore[no-any-return]

    def check(self) -> None:
        assert not self.errors, f"page / console errors: {self.errors[:5]}"
        g = self.garbage()
        assert not g, f"NaN / undefined in the DOM: {g}"


@pytest.fixture
def open_app(browser: Any, static_url: str) -> Iterator[Callable[..., App]]:
    """``open_app(fixture, fonts=False, extra='')`` -> App on ``brew.html?source=replay&fixture=..&speed=0&still``."""
    ctxs: list[Any] = []
    apps: list[App] = []

    def make(fixture: str, fonts: bool = False, extra: str = "") -> App:
        ctx = browser.new_context(viewport=VIEWPORT, device_scale_factor=1)
        ctxs.append(ctx)
        page = ctx.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        def on_console(m: Any) -> None:
            loc = m.location or {}
            if m.type == "error" and "fonts.g" not in loc.get("url", ""):
                errors.append(f"{m.text} @ {loc.get('url', '')}:{loc.get('lineNumber')}")

        page.on("console", on_console)
        if not fonts:
            page.route(FONTS_GLOB, lambda r: r.abort())
        page.goto(f"{static_url}/design/brew.html?source=replay&fixture={fixture}&speed=0&still{extra}")
        page.wait_for_function("window.BrewLive && BrewLive.state && BrewLive.source && BrewLive.source.stream", timeout=15000)
        app = App(page, errors)
        apps.append(app)
        return app

    yield make
    for a in apps:
        a.check()
    for c in ctxs:
        c.close()
