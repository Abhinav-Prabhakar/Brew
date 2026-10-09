"""Frontend test fixtures: a static file server for the repo and a headless-Chromium harness page.

One headless Chromium for the whole frontend package; every test file shares the harness page unless it needs its own
init scripts (fake WebSocket, fake clock).

The browser is our own package-scoped fixture (shadowing pytest-playwright's session-scoped ``browser``) on purpose:
Playwright's sync API keeps an asyncio loop running in the main thread until it is stopped, which would break the
asyncio-based backend tests that run after this package ("Runner.run() cannot be called from a running event loop").
"""

from __future__ import annotations

import functools
import http.server
import threading
from collections.abc import Iterator
from pathlib import Path

import pytest

from brew.config.loader import repo_root

ROOT = Path(repo_root())
HELPERS = Path(__file__).with_name("helpers.js")
FIXTURES = ROOT / "tests" / "fixtures" / "streams"
FIXTURE_NAMES = ["morning_rush", "lunch_delivery", "closing"]


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a: object) -> None:  # keep pytest output clean
        pass

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class _Server(http.server.ThreadingHTTPServer):
    request_queue_size = 128  # Chromium opens a burst of connections for the ~20 scripts of brew.html: the default backlog (5) resets some


def serve(directory: Path) -> tuple[_Server, str]:
    handler = functools.partial(_Quiet, directory=str(directory))
    srv = _Server(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}"


@pytest.fixture(scope="package")
def browser() -> Iterator[object]:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


@pytest.fixture(scope="package")
def static_url() -> Iterator[str]:
    """The repository root served statically (design/ and tests/fixtures/ both reachable)."""
    srv, url = serve(ROOT)
    yield url
    srv.shutdown()


@pytest.fixture(scope="package")
def harness_url(static_url: str) -> str:
    return static_url + "/design/live/harness.html"


@pytest.fixture(scope="package")
def harness(browser, harness_url: str) -> Iterator[object]:  # type: ignore[no-untyped-def]
    """A page with the live scripts + test helpers (window.T) loaded; console errors collected in .errors."""
    ctx = browser.new_context()
    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.add_init_script(path=str(HELPERS))
    page.goto(harness_url)
    page.errors = errors  # type: ignore[attr-defined]
    yield page
    ctx.close()


@pytest.fixture
def fresh_page(browser, harness_url: str) -> Iterator[object]:  # type: ignore[no-untyped-def]
    """A throwaway page (own context) for tests that inject scripts before load. Call .open(init_script=...)."""
    ctx = browser.new_context()
    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.errors = errors  # type: ignore[attr-defined]
    page.add_init_script(path=str(HELPERS))

    def open_(url_suffix: str = "", init_script: str | None = None) -> object:
        if init_script:
            page.add_init_script(init_script)
        page.goto(harness_url + url_suffix)
        return page

    page.open = open_  # type: ignore[attr-defined]
    yield page
    ctx.close()


from .appkit import open_app  # noqa: E402, F401  (fixture: the real page replaying a fixture)
