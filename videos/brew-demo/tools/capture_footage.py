"""Record the real brew UI as video for the demo film (assets/footage/*.mp4).

    uv run python videos/brew-demo/tools/capture_footage.py [name ...]

Each shot opens design/brew.html (motion on) in the installed Chrome, drives the replay in real time at a fixed sim
rate, and records the #frame box with the DevTools screencast (JPEG frames + timestamps), which ffmpeg turns into a
constant 30 fps H.264 clip. Kapi's shot runs against a throwaway scripted backend (no keys, no database).
"""

from __future__ import annotations

import base64
import os
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parents[1] / "assets" / "footage"
VIEW = {"width": 1632, "height": 1040}


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a: Any) -> None:
        pass


class Server(ThreadingHTTPServer):
    request_queue_size = 128


def hms(s: str) -> float:
    p = [int(x) for x in s.split(":")]
    return p[0] * 3600 + p[1] * 60 + (p[2] if len(p) > 2 else 0)


class Recorder:
    def __init__(self, pg: Any) -> None:
        self.pg, self.frames = pg, []
        self.cdp = pg.context.new_cdp_session(pg)
        self.dir = Path(tempfile.mkdtemp(prefix="brewshot-"))
        self.cdp.on("Page.screencastFrame", self.on_frame)

    def on_frame(self, ev: dict) -> None:
        p = self.dir / f"{len(self.frames):05d}.jpg"
        p.write_bytes(base64.b64decode(ev["data"]))
        self.frames.append((p, ev["metadata"]["timestamp"]))
        self.cdp.send("Page.screencastFrameAck", {"sessionId": ev["sessionId"]})

    def start(self) -> None:
        self.cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 95, "everyNthFrame": 1})

    def stop(self, name: str) -> None:
        self.cdp.send("Page.stopScreencast")
        box = self.pg.evaluate("(() => { const r = document.getElementById('frame').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()")
        x, y, w, h = (round(v) for v in box)
        w, h = w - w % 2, h - h % 2
        lst = self.dir / "list.txt"
        with lst.open("w") as f:
            for (p, t), nxt in zip(self.frames, [*self.frames[1:], (None, self.frames[-1][1] + 1 / 30)]):
                f.write(f"file '{p}'\nduration {max(nxt[1] - t, 0.001):.5f}\n")
            f.write(f"file '{self.frames[-1][0]}'\n")
        out = OUT / f"{name}.mp4"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst),
                        "-vf", f"crop={w}:{h}:{x}:{y},fps=30", "-c:v", "libx264", "-preset", "slow", "-crf", "15",
                        "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-g", "30", str(out)], check=True)  # fmt: skip
        span = self.frames[-1][1] - self.frames[0][1]
        print(f"  {name}.mp4  {len(self.frames)} frames in {span:.1f}s ({len(self.frames) / max(span, 0.01):.0f} fps)  {out.stat().st_size / 1e6:.1f} MB")


def open_replay(b: Any, base: str, fixture: str, room: str, start: str) -> Any:
    pg = b.new_page(viewport=VIEW, device_scale_factor=1)
    pg.goto(f"{base}/design/brew.html?source=replay&fixture={fixture}&speed=0#{room}")
    pg.wait_for_function("window.BrewLive && BrewLive.state && BrewLive.source && BrewLive.source.stream", timeout=20000)
    pg.evaluate("document.fonts.ready")
    pg.evaluate(f"BrewLive.source.stepTo({hms(start)})")
    pg.wait_for_timeout(2500)  # let the room settle on that moment
    return pg


def run(pg: Any, start: str, rate: float) -> None:
    """the replay runs on from `start` at `rate` sim seconds per real second"""
    pg.evaluate(f"""(() => {{ const t0 = {hms(start)}, w0 = performance.now();
        window.__run = setInterval(() => BrewLive.source.stepTo(t0 + (performance.now() - w0) / 1000 * {rate}), 50); }})()""")


def replay_shot(b: Any, base: str, name: str, fixture: str, room: str, start: str, rate: float, secs: float, script: Any = None) -> None:
    pg = open_replay(b, base, fixture, room, start)
    rec = Recorder(pg)
    rec.start()
    run(pg, start, rate)
    if script:
        script(pg)
    else:
        pg.wait_for_timeout(secs * 1000)
    rec.stop(name)
    pg.close()


def menu_script(pg: Any) -> None:
    pg.wait_for_timeout(600)
    pg.evaluate("BREW_MENUBOOK.open()")
    pg.wait_for_timeout(6200)
    pg.evaluate("BREW_MENUBOOK.turn(1)")
    pg.wait_for_timeout(2600)


def walk_script(pg: Any) -> None:
    pg.wait_for_timeout(1200)
    for room, ms in (("kitchen", 2800), ("pantry", 2800), ("lobby", 2400)):
        pg.evaluate(f"document.querySelector('.tab[data-go=\"{room}\"]').click()")
        pg.wait_for_timeout(ms)


def compare_script(pg: Any) -> None:
    pg.wait_for_timeout(1000)
    pg.evaluate("document.querySelector('#hud .money').click()")
    pg.wait_for_timeout(4500)


def kapi_shot(b: Any) -> None:
    with ThreadingHTTPServer(("127.0.0.1", 0), Quiet) as probe:
        port = probe.server_address[1]
    env = {**os.environ, "BREW_LLM_ENABLED": "0", "BREW_DB_ENABLED": "0", "BREW_HOURS": "00:00-24:00", "BREW_LIVE_RATE": "20"}
    api = subprocess.Popen(["uv", "run", "brew-api", "--port", str(port)], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)  # fmt: skip
    base = f"http://127.0.0.1:{port}"
    try:
        for _ in range(120):
            try:
                urllib.request.urlopen(f"{base}/api/v1/waiter/status", timeout=1)
                break
            except OSError:
                time.sleep(0.5)
        pg = b.new_page(viewport=VIEW, device_scale_factor=1)
        pg.goto(f"{base}/#lobby")
        pg.wait_for_function("window.BrewLive && BrewLive.state && window.BrewWaiter", timeout=30000)
        pg.evaluate("document.fonts.ready")
        pg.wait_for_timeout(6000)  # a little life in the lobby first
        rec = Recorder(pg)
        rec.start()
        pg.wait_for_timeout(700)
        pg.evaluate("BrewWaiter.open()")
        pg.wait_for_timeout(3600)
        for line in ("show me the bakes", "a butter croissant and an oat latte please"):
            pg.evaluate("(m) => { BrewWaiter.send(m); }", line)
            pg.wait_for_function("!BrewWaiter.busy", timeout=60000)
            pg.wait_for_timeout(1500)
        rec.stop("kapi")
        pg.close()
    finally:
        api.terminate()


def main() -> None:
    want = set(sys.argv[1:])
    OUT.mkdir(parents=True, exist_ok=True)
    srv = Server(("127.0.0.1", 0), partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    shots = {
        "lobby_rush": lambda b: replay_shot(b, base, "lobby_rush", "morning_rush", "lobby", "08:08", 40, 12),
        "kitchen_chaos": lambda b: replay_shot(b, base, "kitchen_chaos", "morning_rush", "kitchen", "08:29:15", 12, 11),
        "menu_book": lambda b: replay_shot(b, base, "menu_book", "morning_rush", "lobby", "08:59:20", 8, 0, menu_script),
        "pantry": lambda b: replay_shot(b, base, "pantry", "lunch_delivery", "pantry", "13:20", 30, 8),
        "walk": lambda b: replay_shot(b, base, "walk", "morning_rush", "lobby", "08:50", 20, 0, walk_script),
        "comparison": lambda b: replay_shot(b, base, "comparison", "morning_rush", "lobby", "09:14", 20, 0, compare_script),
        "kapi": kapi_shot,
    }
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(channel="chrome")
            for name, fn in shots.items():
                if not want or name in want:
                    fn(b)
            b.close()
    finally:
        srv.shutdown()


if __name__ == "__main__":
    main()
