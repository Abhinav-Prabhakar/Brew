"""Regenerate the README media in docs/images/ from the recorded fixtures (no backend needed, deterministic).

    uv run python scripts/capture_readme_media.py            # stills + GIFs
    uv run python scripts/capture_readme_media.py --stills   # stills only

Stills: the real page (design/brew.html) replaying a golden stream paused at a fixed moment (`speed=0` + `stepTo`),
`?still` (no motion), 1600x1000, saved as 256-colour PNGs. GIFs: the same page with motion on; Python advances the
replay in fixed sim-time steps per frame (events are deterministic) while the CSS motion runs in real time between
frames, then Pillow assembles the frames (shared palette, 960 px wide, ~8 fps). No ffmpeg needed. Google Fonts must
be reachable (the hand-drawn type is the look).
"""

from __future__ import annotations

import argparse
import io
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "images"
VIEW = {"width": 1632, "height": 1040}


def hms(s: str) -> float:
    h, m = s.split(":")[:2]
    return int(h) * 3600 + int(m) * 60


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def open_page(browser: Any, base: str, fixture: str, still: bool, room: str = "lobby") -> Any:
    pg = browser.new_page(viewport=VIEW, device_scale_factor=1)
    pg.goto(f"{base}/design/brew.html?source=replay&fixture={fixture}&speed=0{'&still' if still else ''}#{room}")
    pg.wait_for_function("window.BrewLive && BrewLive.state && BrewLive.source && BrewLive.source.stream", timeout=20000)
    pg.evaluate("window.BREW_BAKED")
    pg.evaluate("document.fonts.ready")
    return pg


def shot(pg: Any) -> Image.Image:
    box = pg.evaluate("(() => { const r = document.getElementById('frame').getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; })()")
    return Image.open(io.BytesIO(pg.screenshot(clip=box))).convert("RGB")


def save_png(img: Image.Image, name: str) -> None:
    img.quantize(256, dither=Image.Dither.NONE).save(OUT / f"{name}.png", optimize=True)
    print(f"  {name}.png  {(OUT / f'{name}.png').stat().st_size / 1e6:.2f} MB")


def save_gif(frames: list[Image.Image], name: str, fps: float = 8, width: int = 960) -> None:
    small = [f.resize((width, round(f.height * width / f.width)), Image.Resampling.LANCZOS) for f in frames]
    ref = small[len(small) // 2].quantize(255, method=Image.Quantize.MEDIANCUT)       # one palette for every frame
    pal = [f.quantize(palette=ref, dither=Image.Dither.NONE) for f in small]
    path = OUT / f"{name}.gif"
    pal[0].save(path, save_all=True, append_images=pal[1:], duration=round(1000 / fps), loop=0, optimize=True, disposal=1)
    print(f"  {name}.gif  {len(frames)} frames  {path.stat().st_size / 1e6:.2f} MB")


def stills(browser: Any, base: str) -> None:
    print("stills")
    pg = open_page(browser, base, "morning_rush", True)
    pg.evaluate(f"BrewLive.source.stepTo({hms('09:15')})")
    pg.wait_for_timeout(800)
    save_png(shot(pg), "lobby")
    pg.evaluate("document.querySelector('#hud .money').click()")
    pg.wait_for_timeout(500)
    save_png(shot(pg), "comparison")
    pg.evaluate("document.querySelector('#hud .money').click()")
    pg.evaluate("BREW_MENUBOOK.open()")
    pg.wait_for_timeout(900)
    save_png(shot(pg), "menu_book")
    pg.close()

    pg = open_page(browser, base, "morning_rush", True, "kitchen")
    pg.evaluate(f"BrewLive.source.stepTo({hms('08:40')})")  # espresso machine down since 08:30
    pg.wait_for_timeout(800)
    save_png(shot(pg), "kitchen_chaos")
    pg.close()

    pg = open_page(browser, base, "lunch_delivery", True, "pantry")
    pg.evaluate(f"BrewLive.source.stepTo({hms('13:30')})")
    pg.wait_for_timeout(800)
    save_png(shot(pg), "pantry")
    pg.close()

    pg = open_page(browser, base, "morning_rush", False)  # mid page-turn needs motion on
    pg.evaluate(f"BrewLive.source.stepTo({hms('09:30')})")
    pg.evaluate("BREW_MENUBOOK.open()")
    pg.wait_for_timeout(1300)
    pg.evaluate("BREW_MENUBOOK.turn(1)")
    pg.wait_for_timeout(430)
    save_png(shot(pg), "menu_turn")
    pg.close()


def gif_replay(browser: Any, base: str, fixture: str, room: str, start: str, sim_per_frame: float, n: int, name: str, setup: str = "") -> None:
    pg = open_page(browser, base, fixture, False, room)
    pg.evaluate(f"BrewLive.source.stepTo({hms(start)})")
    if setup:
        pg.evaluate(setup)
    pg.wait_for_timeout(1200)
    t, frames = hms(start), []
    for _ in range(n):
        t += sim_per_frame
        pg.evaluate(f"BrewLive.source.stepTo({t})")
        pg.wait_for_timeout(110)
        frames.append(shot(pg))
    pg.close()
    save_gif(frames, name)


def gifs(browser: Any, base: str) -> None:
    print("gifs")
    gif_replay(browser, base, "morning_rush", "lobby", "08:46", 8, 88, "lobby_rush")  # tickets slide in, paperclips, customers
    gif_replay(browser, base, "morning_rush", "kitchen", "08:27", 8, 80, "kitchen_chaos")  # the espresso machine breaks at 08:30
    # the menu book open on the coffee spread as the owner's 09:00 price change lands, then a page turn
    pg = open_page(browser, base, "morning_rush", False)
    pg.evaluate(f"BrewLive.source.stepTo({hms('08:59')})")
    pg.evaluate("BREW_MENUBOOK.open()")
    pg.wait_for_timeout(1300)
    t, frames = hms("08:59"), []
    for i in range(84):
        t += 2.5
        pg.evaluate(f"BrewLive.source.stepTo({t})")
        if i == 52:
            pg.evaluate("BREW_MENUBOOK.turn(1)")
        pg.wait_for_timeout(110)
        frames.append(shot(pg))
    pg.close()
    save_gif(frames, "menu_book")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stills", action="store_true", help="stills only")
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    port = free_port()
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"], cwd=ROOT,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)  # fmt: skip
    time.sleep(0.6)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            base = f"http://127.0.0.1:{port}"
            stills(b, base)
            if not a.stills:
                gifs(b, base)
            b.close()
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
