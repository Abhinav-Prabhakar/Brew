"""Resilience against a flaky or restarting backend (the real page served by brew-api, BREW_LIVE_RATE=60, no database).

1. Kill brew-api mid-rush: the HUD shows reconnecting (dashed spinner), after a few seconds the paper "we'll be right
   back" card, and every action is paused with an explanation (no request leaves). Restart brew-api on the same port:
   the old world is gone (WS close 4404), so the page finds or creates the live world, re-hydrates and streams on its
   own; no ticket is drawn twice and the stream after the re-hydrate is gap-free.
2. Boot with no backend: the page plays the recorded morning, clearly labelled replay, never live. Start brew-api:
   the page switches itself to live.
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
import urllib.error
from collections.abc import Iterator
from typing import Any

import pytest

from .conftest import ROOT
from .test_e2e import call, free_port

pytestmark = [pytest.mark.frontend, pytest.mark.integration]

RECORD_JS = """window.__seen = []; window.__status = [];
  (function wait() { if (!window.BREW_LIVE) return setTimeout(wait, 0);
    BREW_LIVE.on('*', (type, data, ev) => { if (ev && ev.seq != null) window.__seen.push(ev.seq); if (type === 'hydrate') window.__seen.push('H'); });
    BREW_LIVE.on('status', (s) => window.__status.push(s.status)); })();"""


class Server:
    def __init__(self, port: int) -> None:
        self.port, self.proc = port, None
        self.base = f"http://127.0.0.1:{port}"

    def start(self) -> None:
        env = {**os.environ, "BREW_DB_ENABLED": "0", "BREW_LIVE_RATE": "60", "PYTHONUNBUFFERED": "1"}
        self.proc = subprocess.Popen(  # type: ignore[assignment]
            [sys.executable, "-m", "uvicorn", "brew.api.app:create_app", "--factory", "--host", "127.0.0.1", "--port", str(self.port), "--log-level", "warning"],
            cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )  # fmt: skip
        for _ in range(160):
            try:
                if call(self.base, "GET", "/health")["status"] == "ok":
                    return
            except (urllib.error.URLError, ConnectionError, OSError):
                time.sleep(0.25)
        raise RuntimeError("brew-api did not start")

    def kill(self) -> None:
        if self.proc is not None:
            self.proc.kill()
            self.proc.wait(timeout=10)
            self.proc = None


@pytest.fixture
def server() -> Iterator[Server]:
    s = Server(free_port())
    yield s
    s.kill()


def open_page(browser: Any, url: str) -> tuple[Any, Any, list[str]]:
    ctx = browser.new_context(viewport={"width": 1632, "height": 1040})
    pg = ctx.new_page()
    errors: list[str] = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/fonts.g*/**", lambda r: r.abort())
    pg.add_init_script(RECORD_JS)
    pg.goto(url)
    return ctx, pg, errors


def wait(pg: Any, expr: str, timeout: int = 30000) -> None:
    pg.wait_for_function(expr, timeout=timeout)


def test_backend_killed_mid_rush_degrades_then_recovers_without_duplicates(browser, server):
    server.start()
    ctx, pg, errors = open_page(browser, f"{server.base}/?clock=open")
    try:
        wait(pg, "BrewLive.status === 'live' && window.__seen.filter((x) => x !== 'H').length > 20")  # 07:00, events flowing
        assert pg.evaluate("document.body.dataset.actions") == "on"
        server.kill()
        wait(pg, "BrewLive.status === 'reconnecting'", 15000)
        assert pg.evaluate("document.querySelector('.live').dataset.status") == "reconnecting"
        wait(pg, "!document.getElementById('brb').hidden", 15000)
        assert "right back" in pg.inner_text("#brb")
        assert pg.evaluate("document.body.dataset.actions") == "off"
        sent: list[str] = []
        pg.on("request", lambda r: sent.append(r.url) if "/chaos" in r.url else None)
        pg.evaluate("document.querySelector('.tab[data-go=kitchen]').click()")
        pg.wait_for_timeout(400)
        pg.click("[data-chaos]")
        pg.wait_for_timeout(300)
        assert not sent, "an action left the page while the café was unreachable"
        assert pg.evaluate("[...document.querySelectorAll('.toast')].some((t) => /paused/.test(t.textContent))")

        server.start()  # a fresh server: the old world id is gone (WS 4404) → rejoin
        wait(pg, "BrewLive.status === 'live' && document.getElementById('brb').hidden", 45000)
        wait(pg, "window.__seen.lastIndexOf('H') < window.__seen.length - 5", 20000)
        after = pg.evaluate("window.__seen.slice(window.__seen.lastIndexOf('H') + 1)")
        assert all(b == a + 1 for a, b in zip(after, after[1:], strict=False)), f"stream after the re-hydrate has gaps or repeats: {after[:20]}"
        pg.evaluate("document.querySelector('.tab[data-go=lobby]').click()")
        pg.wait_for_timeout(500)
        keys = pg.evaluate("[...document.querySelectorAll('#l-rail [data-ticket]')].map((e) => e.dataset.ticket)")
        assert len(keys) == len(set(keys)), f"a ticket is drawn twice: {keys}"
        assert pg.evaluate("document.body.dataset.actions") == "on"
        assert not errors, errors[:3]
    finally:
        ctx.close()


def test_no_backend_at_boot_plays_a_labelled_replay_then_goes_live(browser, server):
    # the page itself must come from somewhere: a static server for design/, the API at a port nobody listens on yet
    static = subprocess.Popen([sys.executable, "-m", "http.server", str(sport := free_port()), "--bind", "127.0.0.1"], cwd=ROOT,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)  # fmt: skip
    time.sleep(0.6)
    ctx, pg, errors = open_page(browser, f"http://127.0.0.1:{sport}/design/brew.html?api={server.base}&clock=open")
    try:
        wait(pg, "BrewLive.status === 'offline-demo'", 30000)
        assert "replay" in pg.inner_text(".live").lower() or "demo" in pg.inner_text(".live").lower()
        wait(pg, "!document.getElementById('brb').hidden", 5000)
        assert "replay" in pg.inner_text("#brb").lower()
        assert pg.evaluate("document.body.dataset.actions") == "off"
        server.start()
        wait(pg, "BrewLive.status === 'live' && BrewLive.mode === 'ws'", 40000)
        wait(pg, "document.getElementById('brb').hidden", 5000)
        assert pg.evaluate("document.body.dataset.actions") == "on"
        assert not errors, errors[:3]
    finally:
        ctx.close()
        static.terminate()
