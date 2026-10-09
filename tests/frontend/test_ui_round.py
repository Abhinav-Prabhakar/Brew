"""Client behaviour added in the UI round: room hotkeys, the menu book's price doodles + hover card, the eggs, the Z-report."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

pytestmark = pytest.mark.frontend

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "streams"


def room(app) -> str:
    return app.ev("() => document.body.dataset.room")


def test_number_keys_switch_rooms_but_not_while_sliding_a_control(open_app):
    app = open_app("morning_rush")
    app.step_to("09:00", 300)
    page = app.page
    assert room(app) == "lobby"
    for key, want in (("2", "kitchen"), ("3", "pantry"), ("1", "lobby")):
        page.keyboard.press(key)
        page.wait_for_timeout(150)
        assert room(app) == want, key
    # focus inside the sound panel's range input: the digits belong to the control
    page.click("#hud .snd .bgm")
    page.wait_for_timeout(200)
    page.focus("#soundpanel input[type=range]")
    page.keyboard.press("3")
    page.wait_for_timeout(200)
    assert room(app) == "lobby", "a digit typed into the volume slider must not change the room"
    page.keyboard.press("Escape")


def test_menu_book_shows_doodles_after_a_price_change_and_a_hover_card(open_app):
    app = open_app("morning_rush")
    app.step_to("09:30")  # the owner's set_price landed at 09:00
    sku = next(
        a
        for a in json.loads((FIXTURES / "morning_rush.jsonl").open().readline())["actions"]
        if a["kind"] == "set_price"
    )["payload"]["sku"]
    app.ev("() => BREW_MENUBOOK.open()")
    page = app.page
    page.wait_for_timeout(1200)
    moved = app.ev(
        "() => [...document.querySelectorAll('#mb .row.up, #mb .row.down')].map((r) => r.dataset.sku)"
    )
    assert sku in moved, f"{sku} should be marked up/down after set_price, got {moved}"
    row = page.locator(f'#mb .row[data-sku="{sku}"]').first
    assert row.locator(".mk").count() >= 1
    assert row.locator(".mk").first.inner_html().strip(), "a moved price draws its doodle(s)"
    assert page.locator("#mb .why").count() == 0 and page.locator("#mb .mb-live").count() == 0
    assert not app.ev("() => document.getElementById('mb-tip').classList.contains('on')")
    row.hover()
    page.wait_for_timeout(300)
    assert app.ev("() => document.getElementById('mb-tip').classList.contains('on')")
    name = app.state(f"s.menu['{sku}'].name").lower()
    assert name in page.inner_text("#mb-tip").lower()
    app.check()


def test_eggs_load_clean_and_are_not_focusable(open_app):
    app = open_app("morning_rush")
    app.step_to("09:00", 300)
    assert app.ev("() => window.BrewEggs.total") == 15
    assert app.ev("() => document.querySelectorAll('[data-action^=\"egg-\"]').length") > 0
    assert (
        app.ev(
            '() => document.querySelectorAll(\'[data-action^="egg-"][tabindex], [id^="egg-"] [tabindex]\').length'
        )
        == 0
    )
    app.check()


def test_zreport_prints_the_net_profit(open_app):
    summary = next(
        json.loads(ln)["data"]["summary"]
        for ln in (FIXTURES / "closing.jsonl").open()
        if '"type": "day.ended"' in ln or '"type":"day.ended"' in ln
    )
    app = open_app("morning_rush")
    app.step_to("09:00", 300)
    app.ev("(s) => BrewHUD.zreport(s)", summary)
    app.page.wait_for_timeout(300)
    assert app.ev("() => !document.getElementById('zrep').hidden")
    text = app.page.inner_text("#zrep")
    assert f"₹{round(summary['net_profit']):,}" in text and "NET PROFIT" in text
    app.page.click("#zrep")
    assert app.ev("() => document.getElementById('zrep').hidden")
    app.check()
