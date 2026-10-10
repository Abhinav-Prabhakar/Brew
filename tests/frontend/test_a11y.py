"""Accessibility: axe-core (WCAG 2.1 A/AA + best practice) on every screen state, and the keyboard path.

States: the three rooms, the profit card expanded into the policy comparison, the sound panel, the open menu book.
The keyboard test walks the page with Tab/Enter only: room tabs, the profit card, the sound control, a zoom hot-spot,
Esc back, and the menu book's focus trap.
"""

from __future__ import annotations

from typing import Any

import pytest
from axe_playwright_python.sync_playwright import Axe

pytestmark = pytest.mark.frontend

TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]


def violations(page: Any, axe: Axe) -> list[str]:
    res = axe.run(page, options={"runOnly": {"type": "tag", "values": TAGS}})
    return [
        f"{v['id']} ({v['impact']}): {v['help']} @ {[n['target'] for n in v['nodes'][:3]]}"
        for v in res.response["violations"]
    ]


def test_axe_clean_on_every_screen(open_app):
    app = open_app("morning_rush")
    app.step_to("09:00", 600)
    page, axe, found = app.page, Axe(), {}
    for room in ("lobby", "kitchen", "pantry"):
        app.room(room, 400)
        found[room] = violations(page, axe)
    app.room("lobby", 300)
    app.ev("() => document.querySelector('#hud .money').click()")
    page.wait_for_timeout(300)
    found["comparison"] = violations(page, axe)
    app.ev("() => document.querySelector('#hud .money').click()")
    page.click("#hud .snd .bgm")
    page.wait_for_timeout(200)
    found["sound panel"] = violations(page, axe)
    page.keyboard.press("Escape")
    app.ev("() => BREW_MENUBOOK.open()")
    page.wait_for_timeout(1200)
    found["menu book"] = violations(page, axe)
    page.hover("#mb .row[data-sku]")  # the hover card visible
    page.wait_for_timeout(300)
    assert page.evaluate("document.getElementById('mb-tip').classList.contains('on')")
    found["menu book + hover card"] = violations(page, axe)
    app.ev("() => BREW_MENUBOOK.close()")
    page.wait_for_timeout(600)
    page.keyboard.press("Shift+?")
    page.wait_for_timeout(200)
    assert page.evaluate("!document.getElementById('keys').hidden")
    found["keys card"] = violations(page, axe)
    page.keyboard.press("Escape")
    summary = {
        "day": 0,
        "date": "2026-10-06",
        "revenue": 174862.54,
        "net_profit": 89037.33,
        "orders": 303,
        "items_sold": 826,
        "orders_by_channel": {"takeaway": 74, "dine_in": 163},
        "food_cost_pct": 30.45,
        "sla_breach_rate": 0.0578,
        "walkouts": 58,
        "rating": 4.44,
        "waste_kg": 6.6,
        "price_changes": 37,
        "ledger": {"labour": 7557.5, "rent": 6000.0},
    }
    app.ev("(s) => BrewHUD.zreport(s)", summary)
    page.wait_for_timeout(300)
    found["z-report"] = violations(page, axe)
    app.check()
    assert not any(found.values()), {k: v for k, v in found.items() if v}


def test_keyboard_path(open_app):
    app = open_app("morning_rush")
    app.step_to("09:00", 500)
    page = app.page

    def focus_until(pred: str, limit: int = 200) -> bool:
        for _ in range(limit):
            page.keyboard.press("Tab")
            if page.evaluate(pred):
                return True
        return False

    # the one zoom hot-spot is the waiter: Enter frames him and opens his chat with the input focused, Esc returns
    assert focus_until("document.activeElement?.classList?.contains('zoomhit')"), "the waiter is not reachable with Tab"
    assert "Kapi" in page.evaluate("document.activeElement.getAttribute('aria-label')")
    page.keyboard.press("Enter")
    page.wait_for_timeout(150)
    assert page.evaluate("BrewCamera.zoomed?.zone") == "waiter" and page.evaluate("BrewWaiter.isOpen")
    assert page.evaluate("document.activeElement?.classList?.contains('wt-in')")
    page.keyboard.type("m1?")  # typing to the waiter is not a hotkey
    assert page.evaluate("document.body.dataset.room") == "lobby" and not page.evaluate("!!window.BREW_MENUBOOK?.isOpen")
    page.keyboard.press("Escape")
    assert page.evaluate("BrewCamera.zoomed === null") and not page.evaluate("BrewWaiter.isOpen")
    # room tabs are reachable and Enter switches rooms
    assert focus_until("document.activeElement?.dataset?.go === 'kitchen'"), (
        "the kitchen tab is not reachable with Tab"
    )
    page.keyboard.press("Enter")
    page.wait_for_timeout(300)
    assert page.evaluate("document.body.dataset.room") == "kitchen"
    # the stations no longer zoom on a click / Enter: no hot-spots in the kitchen
    assert page.evaluate("document.querySelectorAll('#kitchen-scene .zoomhit').length") == 0
    # the profit card expands with Enter and says so
    assert focus_until("document.activeElement?.classList?.contains('money')"), (
        "the profit card is not reachable"
    )
    page.keyboard.press("Enter")
    page.wait_for_timeout(200)
    assert page.evaluate(
        "!document.getElementById('cmp').hidden && document.querySelector('#hud .money').getAttribute('aria-expanded') === 'true'"
    )
    assert "running now" in page.evaluate("document.querySelector('#cmp svg').getAttribute('aria-label')")
    page.keyboard.press("Enter")
    # the sound control opens its panel and Esc closes it
    assert focus_until("document.activeElement?.classList?.contains('bgm')"), (
        "the sound control is not reachable"
    )
    page.keyboard.press("Enter")
    assert page.evaluate("!document.getElementById('soundpanel').hidden")
    page.keyboard.press("Escape")
    assert page.evaluate("document.getElementById('soundpanel').hidden")
    # the open menu book keeps focus inside
    page.evaluate("document.querySelector('.tab[data-go=lobby]').click()")
    app.ev("() => BREW_MENUBOOK.open()")
    page.wait_for_timeout(1200)
    for _ in range(25):
        page.keyboard.press("Tab")
        assert page.evaluate("document.getElementById('mb').contains(document.activeElement)"), (
            "focus escaped the open menu book"
        )
    app.check()
