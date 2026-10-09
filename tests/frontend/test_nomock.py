"""No-mock test: once a stream is connected, none of the hard-coded values of the original design mock render anywhere
in ``#viewport`` (all three rooms, the HUD, the menu book and the policy comparison are part of it).

Legitimate live values are NOT flagged: ``08:42`` can be a real sim time, and meera / kabir / dev / zoya / raju are the
real crew. The old HUD string ``tue · 08:42 am`` only counts as mock at a moment when the sim clock is not 08:42.
"""

from __future__ import annotations

import re

import pytest

pytestmark = pytest.mark.frontend

MOCKS = [
    r"#0(?:41|43|44|45|46|38)\b",
    r"\basha\b",
    r"\bravi\b",
    r"₹18,420",
    r"day 12 of 30",
    r"38 orders/hr",
    r"tech called · 08:31",
    r"₹6,840",
    r"greenleaf",
    r"tomorrow 07:30",
    r"\bseed 7\b",
]
MOCK_RE = re.compile("|".join(MOCKS), re.I)
OLD_HUD = "tue · 08:42 am"

MOMENTS = [
    ("morning_rush", None),  # hydrated, no event delivered yet
    ("morning_rush", "08:20"),
    ("morning_rush", "08:42"),
    ("morning_rush", "10:20"),
    ("lunch_delivery", "12:45"),
    ("lunch_delivery", "13:55"),
    ("closing", "21:30"),
    ("closing", "+1 02:00"),
]


def viewport_text(app) -> str:  # type: ignore[no-untyped-def]
    return app.ev("() => document.querySelector('#viewport').textContent")  # type: ignore[no-any-return]


@pytest.mark.parametrize(("fixture", "when"), MOMENTS)
def test_no_mock_string_renders(open_app, fixture, when):
    app = open_app(fixture)
    if when:
        app.step_to(when)
    app.page.wait_for_timeout(300)
    for room in ("lobby", "kitchen", "pantry"):
        app.room(room, 150)
    sim = app.state("s.clock.hhmm")
    text = viewport_text(app)
    assert len(text) > 1500, "something rendered (the check is not vacuous)"
    hits = sorted({m.group(0) for m in MOCK_RE.finditer(text)})
    assert not hits, f"mock values rendered at {fixture} {when}: {hits}"
    if sim != "08:42":
        assert OLD_HUD not in text, f"the old HUD mock string renders at sim time {sim}"
    # the live crew is real: the mock crew (asha, ravi) is gone but the sim's staff show up in the kitchen
    kitchen = app.ev("() => document.querySelector('#kitchen .crew').textContent.toLowerCase()")
    if when:
        assert any(n in kitchen for n in ("meera", "kabir", "dev", "zoya", "raju"))


@pytest.mark.parametrize("fixture", ["morning_rush", "lunch_delivery"])
def test_no_mock_in_the_menu_book_or_the_comparison(open_app, fixture):
    app = open_app(fixture)
    app.step_to("08:30" if fixture == "morning_rush" else "13:00")
    app.ev("() => BREW_MENUBOOK.open()")
    app.page.wait_for_timeout(250)
    for _ in range(3):
        assert not MOCK_RE.findall(viewport_text(app))
        app.ev("() => BREW_MENUBOOK.turn(1)")
        app.page.wait_for_timeout(150)
    app.ev("() => BREW_MENUBOOK.close()")
    app.page.wait_for_timeout(250)
    app.ev("() => document.querySelector('#hud .money').click()")
    app.page.wait_for_timeout(250)
    text = viewport_text(app)
    assert "what you’d otherwise make" in text
    assert not MOCK_RE.findall(text)


def test_the_detector_would_catch_a_mock():
    """Guard against a vacuous test: inject each old mock string into the DOM and see the regex fire."""
    for s in ["#041", "asha", "ravi", "₹18,420", "day 12 of 30", "38 orders/hr", "tech called · 08:31", "₹6,840", "GreenLeaf", "tomorrow 07:30", "seed 7"]:
        assert MOCK_RE.search(f"x {s} y"), s
    for ok in ["meera", "kabir", "08:42", "#157", "ravindra", "₹18,421", "seed 70"]:
        assert not MOCK_RE.search(f"x {ok} y"), ok
