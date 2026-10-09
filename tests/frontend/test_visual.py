"""Visual regression: one screenshot per room (lobby, kitchen, pantry), the menu book open and the profit comparison open,
at fixed fixture moments, ``?still`` (no CSS animation, no rolling numbers) and a fixed 1632x1040 viewport, diffed against
``tests/visual/<platform>-<scene>.png`` with a tolerance so the hand-drawn look cannot drift unnoticed.

    uv run pytest -m visual                          # compare
    uv run pytest -m visual --update-visual          # rewrite the baselines (or BREW_UPDATE_VISUAL=1)

Tolerance: a pixel differs when any channel moves by more than ``PIXEL_TOL`` (of 255); the test fails when more than
``MAX_DIFF_RATIO`` (1.5 %) of the pixels differ. The diff image is written to ``tests/visual/_diff/`` (git-ignored).

Robustness: the page loads its fonts from Google Fonts. If they cannot be loaded (offline CI) the tests SKIP with that
reason instead of flaking; a platform without baselines (text rasterisation differs between macOS and Linux, so the
baselines are per platform) renders each scene twice and asserts the two renders are identical (a determinism guard),
then skips with the instruction to create baselines.
"""

from __future__ import annotations

import io
import os
import sys
from typing import Any

import numpy as np
import pytest
from PIL import Image

from .conftest import ROOT

pytestmark = [pytest.mark.frontend, pytest.mark.visual]

VISUAL = ROOT / "tests" / "visual"
PLATFORM = "darwin" if sys.platform == "darwin" else "linux" if sys.platform.startswith("linux") else sys.platform
PIXEL_TOL = 24
MAX_DIFF_RATIO = 0.015

SCENES: dict[str, dict[str, str]] = {
    "lobby": {"fixture": "morning_rush", "when": "08:45", "room": "lobby"},
    "kitchen": {"fixture": "morning_rush", "when": "08:45", "room": "kitchen"},  # espresso machine down
    "pantry": {"fixture": "lunch_delivery", "when": "13:30", "room": "pantry"},
    "menu_book": {"fixture": "morning_rush", "when": "09:30", "room": "lobby", "open": "book"},
    "comparison": {"fixture": "morning_rush", "when": "09:30", "room": "lobby", "open": "comparison"},
}


def update_mode(config: pytest.Config) -> bool:
    return bool(config.getoption("--update-visual")) or os.environ.get("BREW_UPDATE_VISUAL") == "1"


def fonts_loaded(page: Any) -> bool:
    return bool(
        page.evaluate(
            """async () => { await document.fonts.ready;
              const ok = new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')));
              return ['Gochi Hand', 'Patrick Hand'].every((f) => ok.has(f)); }"""
        )
    )


def shoot(open_app: Any, scene: dict[str, str]) -> bytes:
    app = open_app(scene["fixture"], fonts=True)
    app.page.wait_for_load_state("load")
    if not fonts_loaded(app.page):
        pytest.skip("Google Fonts could not be loaded (offline?): the hand-drawn text would not match the baselines")
    app.step_to(scene["when"], 500)
    app.room(scene["room"], 500)
    if scene.get("open") == "book":
        app.ev("() => BREW_MENUBOOK.open()")
        app.page.wait_for_timeout(500)
    elif scene.get("open") == "comparison":
        app.ev("() => document.querySelector('#hud .money').click()")
        app.page.wait_for_timeout(500)
    app.page.mouse.move(2, 2)
    app.page.wait_for_timeout(200)
    app.page.evaluate("document.fonts.ready")
    png: bytes = app.page.screenshot(full_page=False)
    app.check()
    return png


def compare(a: bytes, b: bytes) -> tuple[float, Image.Image | None]:
    """(share of pixels that differ by more than PIXEL_TOL in any channel, a red-on-grey diff image)."""
    ia, ib = Image.open(io.BytesIO(a)).convert("RGB"), Image.open(io.BytesIO(b)).convert("RGB")
    if ia.size != ib.size:
        return 1.0, None
    xa, xb = np.asarray(ia, dtype=np.int16), np.asarray(ib, dtype=np.int16)
    mask = np.abs(xa - xb).max(axis=2) > PIXEL_TOL
    ratio = float(mask.mean())
    out = np.asarray(ib.convert("L").convert("RGB"), dtype=np.uint8).copy() // 2 + 100
    out[mask] = (255, 0, 0)
    return ratio, Image.fromarray(out)


@pytest.mark.parametrize("name", list(SCENES))
def test_scene_matches_its_baseline(open_app, request, name):
    png = shoot(open_app, SCENES[name])
    path = VISUAL / f"{PLATFORM}-{name}.png"
    if update_mode(request.config):
        VISUAL.mkdir(parents=True, exist_ok=True)
        # 256-colour palette: ~0.8 MB instead of ~1.8 MB per baseline; costs < 0.2 % of the 1.5 % pixel budget
        Image.open(io.BytesIO(png)).convert("RGB").quantize(256, dither=Image.Dither.NONE).save(path, optimize=True)
        return
    if not path.exists():
        again = shoot(open_app, SCENES[name])
        ratio, _ = compare(png, again)
        assert ratio <= MAX_DIFF_RATIO / 10, f"{name} does not render deterministically ({ratio:.2%} of the pixels differ between two loads)"
        pytest.skip(f"no baseline for {PLATFORM}: run `uv run pytest -m visual --update-visual` (the scene renders deterministically)")
    ratio, diff = compare(png, path.read_bytes())
    if ratio > MAX_DIFF_RATIO:
        out = VISUAL / "_diff"
        out.mkdir(parents=True, exist_ok=True)
        (out / f"{PLATFORM}-{name}.actual.png").write_bytes(png)
        if diff is not None:
            diff.save(out / f"{PLATFORM}-{name}.diff.png")
    assert ratio <= MAX_DIFF_RATIO, (
        f"{name}: {ratio:.2%} of the pixels differ (limit {MAX_DIFF_RATIO:.1%}); see tests/visual/_diff/. "
        "If the change is intended: uv run pytest -m visual --update-visual"
    )


def test_baselines_are_not_orphaned() -> None:
    names = {p.name for p in VISUAL.glob("*.png")} if VISUAL.exists() else set()
    known = {f"{plat}-{n}.png" for n in SCENES for plat in ("darwin", "linux")}
    assert names <= known, f"baselines without a scene: {sorted(names - known)}"
