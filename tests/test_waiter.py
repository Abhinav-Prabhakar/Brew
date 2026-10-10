"""The lobby waiter: scripted brain, the guest_order action, and the chat endpoint with and without an LLM."""

from __future__ import annotations

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from brew.api.app import create_app
from brew.llm import LLMPool
from brew.settings import Settings
from brew.waiter import brain
from brew.waiter.service import parse_reply

API = "/api/v1"
MENU = [
    {"sku": "latte", "name": "Latte", "cat": "coffee", "price": 230, "available": True, "featured": False, "desc": "Milky.", "veg": True, "vegan": False, "allergens": ["milk"], "sold_today": 9},
    {"sku": "icedlatte", "name": "Iced Latte", "cat": "coffee", "price": 260, "available": True, "featured": True, "desc": "Cold.", "veg": True, "vegan": False, "allergens": ["milk"], "sold_today": 3},
    {"sku": "coldbrew", "name": "Cold Brew", "cat": "coffee", "price": 250, "available": True, "featured": False, "desc": "Steeped.", "veg": True, "vegan": True, "allergens": [], "sold_today": 1},
    {"sku": "croissant", "name": "Butter Croissant", "cat": "bakes", "price": 180, "available": False, "featured": False, "desc": "Flaky.", "veg": True, "vegan": False, "allergens": ["gluten", "milk"], "sold_today": 0},
]  # fmt: skip
CTX = {"menu": MENU, "clock": {"hhmm": "10:00", "weekday": "tue", "is_open": True, "opens": "07:00", "closes": "22:00"},
       "queue": {"open_orders": 3, "wait_min": 4.2}}  # fmt: skip


def acts(text, ctx=CTX):
    return brain.reply(text, ctx)["actions"]


def test_brain_orders_with_quantities_and_ambiguous_names():
    assert brain.find_items("two iced lattes and a latte, plus 3 cold brews", MENU) == [
        {"sku": "icedlatte", "qty": 2}, {"sku": "latte", "qty": 1}, {"sku": "coldbrew", "qty": 3}]  # fmt: skip
    assert acts("I'll have two iced lattes please") == [
        {"type": "order", "items": [{"sku": "icedlatte", "qty": 2}], "note": None}
    ]
    assert acts("a cold brew") == [
        {"type": "order", "items": [{"sku": "coldbrew", "qty": 1}], "note": None}
    ]  # not a "cold" complaint
    r = brain.reply("one croissant and a latte", CTX)  # croissant is sold out: the rest still goes through
    assert r["actions"][0]["items"] == [{"sku": "latte", "qty": 1}] and "Butter Croissant" in r["say"]
    assert acts("a croissant please") == []
    assert acts("a latte please", {**CTX, "clock": {**CTX["clock"], "is_open": False}}) == []


def test_brain_questions_do_not_order():
    assert (
        acts("how much is the iced latte?") == []
        and "₹260" in brain.reply("how much is the iced latte?", CTX)["say"]
    )
    assert (
        acts("is the cold brew vegan?") == []
        and "vegan" in brain.reply("is the cold brew vegan?", CTX)["say"]
    )
    assert "Iced Latte" in brain.reply("what do you recommend?", CTX)["say"]
    assert "Iced Latte" in brain.reply("what's good today?", CTX)["say"]
    assert "07:00" in brain.reply("when do you close?", CTX)["say"]
    assert "4 min" in brain.reply("how long is the wait?", CTX)["say"]
    assert brain.reply("hello!", CTX)["actions"] == []


def test_brain_complaints_and_escalation():
    (n,) = acts("my coffee was cold and it took too long")
    assert (n["type"], n["kind"], n["severity"]) == ("note", "complaint", "low")
    (n,) = acts("there is a hair in my muffin")
    assert (n["kind"], n["severity"]) == ("complaint", "high")
    (n,) = acts("I want to speak to the manager")
    assert (n["kind"], n["severity"]) == ("escalation", "high")
    (n,) = acts("I have a nut allergy, is the latte ok?")
    assert (n["kind"], n["severity"]) == ("request", "high")


def test_parse_reply_is_lenient():
    assert parse_reply('```json\n{"say": "Hi!", "mood": "happy", "actions": [{"type": "note"}, 7]}\n```') == {
        "say": "Hi!", "thought": "", "mood": "happy", "actions": [{"type": "note"}]}  # fmt: skip
    assert parse_reply("Just words.") == {
        "say": "Just words.",
        "thought": "",
        "mood": "neutral",
        "actions": [],
    }
    assert parse_reply('{"say": "x", "thought": "ugh  fine", "mood": "furious", "actions": "none"}') == {
        "say": "x", "thought": "ugh fine", "mood": "neutral", "actions": []}  # fmt: skip
    assert brain.reply("there is a hair in my muffin", CTX)["thought"] in brain.THOUGHTS["serious"]


# ------------------------------------------------------------------------------------------------ API


@pytest.fixture
def client():
    app = create_app(Settings(db_enabled=False, llm_enabled=False))
    with TestClient(app) as c:
        c.app_ = app  # type: ignore[attr-defined]
        r = c.post(f"{API}/worlds", json={"policy": "A", "seed": 3, "scenario": "weekday_normal"})
        assert r.status_code == 201, r.text
        c.wid = r.json()["id"]  # type: ignore[attr-defined]
        c.post(f"{API}/worlds/{c.wid}/control", json={"action": "step", "step_s": 3 * 3600})  # 10:00, open
        yield c


def on_menu(c, n=2):
    """n (sku, name) pairs that can be ordered right now in the test world"""
    w = c.app_.state.manager.worlds[c.wid].world
    return [(m.sku, m.name) for m in w.cfg.menu if w.menu[m.sku].hidden is None][:n]


def say(c, *texts):
    msgs = []
    for t in texts:
        msgs.append({"role": "user", "content": t})
        r = c.post(f"{API}/worlds/{c.wid}/waiter/chat", json={"messages": msgs})
        assert r.status_code == 200, r.text
        msgs.append({"role": "assistant", "content": r.json()["say"]})
    return r.json()


@pytest.mark.integration
def test_guest_order_action_puts_a_paid_ticket_on_the_rail(client):
    c = client
    w = c.app_.state.manager.worlds[c.wid].world
    (a, _), (b, _) = on_menu(c)
    r = c.post(
        f"{API}/worlds/{c.wid}/actions",
        json={"kind": "guest_order", "items": [{"sku": a, "qty": 2}, {"sku": b}]},
    )
    assert r.status_code == 200, r.text
    res = r.json()["result"]
    o = w.orders.orders[res["order_no"]]
    assert o.channel == "takeaway" and o.paid and o.items_n == 3 and res["total"] == o.total > 0
    assert res["order_no"] in w.orders.open
    c.post(f"{API}/worlds/{c.wid}/control", json={"action": "step", "step_s": 1800})
    assert o.state == "served"  # made by the kitchen and handed over like any other ticket
    for bad, code in (
        ({"items": []}, 422),
        ({"items": [{"sku": "unicorn"}]}, 404),
        ({"items": [{"sku": a, "qty": 99}]}, 422),
        ({}, 422),
    ):
        assert (
            c.post(f"{API}/worlds/{c.wid}/actions", json={"kind": "guest_order", **bad}).status_code == code
        )


@pytest.mark.integration
def test_chat_scripted_orders_notes_and_status(client):
    c = client
    assert c.get(f"{API}/waiter/status").json() == {
        "configured": False,
        "strategy": "round_robin",
        "providers": [],
    }
    (sku, name), _ = on_menu(c)
    r = say(c, "hi!", f"two {name} please")
    assert r["source"] == "scripted" and r["order"]["items"] == [
        {"sku": sku, "qty": 2, "unit_price": r["order"]["items"][0]["unit_price"], "name": name}
    ]
    assert r["order"]["order_no"] in c.app_.state.manager.worlds[c.wid].world.orders.orders
    r = say(c, "there's a hair in my croissant!")
    assert r["order"] is None and r["notes"][0]["escalated"] and r["mood"] == "worried"
    say(c, "my chai was a bit cold")
    n = c.get(f"{API}/worlds/{c.wid}/waiter/notes").json()
    assert [x["severity"] for x in n["notes"]] == ["high", "low"] and n["escalated"] == 1
    assert (
        c.post(
            f"{API}/worlds/{c.wid}/waiter/chat", json={"messages": [{"role": "assistant", "content": "hi"}]}
        ).status_code
        == 422
    )
    assert (
        c.post(
            f"{API}/worlds/nope/waiter/chat", json={"messages": [{"role": "user", "content": "hi"}]}
        ).status_code
        == 404
    )


@pytest.mark.integration
def test_chat_with_an_llm_runs_its_actions_and_falls_back_when_it_is_down(client):
    c = client
    (sku, name), (sku2, name2) = on_menu(c)
    state = {"down": False, "reply": {"say": "Two chais, coming up!", "thought": "chai. again.", "mood": "happy", "actions": [
        {"type": "order", "items": [{"sku": name, "qty": 2}], "note": "less sugar"},
        {"type": "note", "kind": "request", "severity": "low", "summary": "wants the window seat"}]}}  # fmt: skip
    seen = []

    def h(req: httpx.Request) -> httpx.Response:
        seen.append(json.loads(req.content))
        if state["down"]:
            return httpx.Response(500)
        return httpx.Response(200, json={"content": [{"type": "text", "text": json.dumps(state["reply"])}]})

    c.app_.state.llm = LLMPool.from_env(
        {"ANTHROPIC_API_KEY": "ant-key-aaaa1111"}, client=httpx.AsyncClient(transport=httpx.MockTransport(h))
    )
    r = say(c, "two masala chai, less sugar, and can I sit by the window?")
    assert (
        r["source"] == "anthropic" and r["say"] == "Two chais, coming up!" and r["thought"] == "chai. again."
    )
    assert (
        r["order"]["items"][0]["sku"] == sku
        and r["order"]["items"][0]["qty"] == 2
        and r["notes"][0]["kind"] == "request"
    )
    w = c.app_.state.manager.worlds[c.wid].world
    assert w.orders.orders[r["order"]["order_no"]].note == "less sugar"
    assert (
        name in seen[0]["system"]
        and "OPEN" in seen[0]["system"]
        and seen[0]["messages"][-1]["role"] == "user"
    )
    # the model promises something the sim refuses: the waiter corrects himself instead of lying
    state["reply"] = {
        "say": "One unicorn latte!",
        "mood": "happy",
        "actions": [{"type": "order", "items": [{"sku": "unicorn", "qty": 1}]}],
    }
    r = say(c, "a unicorn latte")
    assert r["order"] is None and "couldn't" in r["say"] and r["mood"] == "worried"
    state["down"] = True
    r = say(c, f"one {name2} please")
    assert r["source"] == "scripted" and r["order"]["items"][0]["sku"] == sku2


def test_brain_shows_dishes_takes_reviews_and_pencils_in_tables():
    (a,) = acts("show me the menu")
    assert a["type"] == "show" and set(a["skus"]) == {
        "latte",
        "icedlatte",
        "coldbrew",
    }  # what can be ordered right now
    (a,) = acts("can I see the bakes?", {**CTX, "menu": [{**m, "available": True} for m in MENU]})
    assert (a["type"], a["skus"]) == ("show", ["croissant"])
    assert acts("I'd like to leave a review") == []  # asks for the stars first
    (a,) = acts("review: 4 stars, lovely cold brew")
    assert (a["type"], a["rating"]) == ("review", 4)
    assert acts("can I book a table?") == []  # asks for how many and when
    (a,) = brain.reply("Book a table for four at 7:30 pm under Meera", CTX)["actions"]
    assert (a["type"], a["party"], a["time"], a["name"]) == ("reserve", 4, "7:30 pm", "Meera")


@pytest.mark.integration
def test_the_model_looks_the_menu_up_with_a_tool_call_then_shows_cards(client):
    c = client
    (sku, name), (sku2, _) = on_menu(c)
    w = c.app_.state.manager.worlds[c.wid].world
    script = [
        {"tool": "menu", "args": {"query": name.split()[-1], "available_only": True}},
        {"thought": "The book knows.", "say": "Have a look!", "mood": "happy", "actions": [
            {"type": "show", "title": "try these", "skus": [sku, "unicorn", sku2]},
            {"type": "review", "rating": 9, "text": "  great   place "},
            {"type": "reserve", "name": "Meera", "party": "4", "time": "7:30 pm"}]},
    ]  # fmt: skip
    seen = []

    def h(req: httpx.Request) -> httpx.Response:
        seen.append(json.loads(req.content))
        return httpx.Response(
            200, json={"content": [{"type": "text", "text": json.dumps(script[len(seen) - 1])}]}
        )

    c.app_.state.llm = LLMPool.from_env(
        {"ANTHROPIC_API_KEY": "ant-key-aaaa1111"}, client=httpx.AsyncClient(transport=httpx.MockTransport(h))
    )
    rating_before = w.reviews.rep.rating("offline") if hasattr(w.reviews, "rep") else None
    tables_before = (
        [t.state for t in w.tables.tables.values()]
        if hasattr(w, "tables") and hasattr(w.tables, "tables")
        else None
    )
    r = say(c, f"how much is the {name}? and book me a table")
    assert len(seen) == 2 and r["tools"] == [
        {"name": "menu", "args": script[0]["args"], "found": r["tools"][0]["found"]}
    ]
    assert r["tools"][0]["found"] >= 1
    # the first prompt carries the index, not the prices; the lookup result is handed back for the second call
    assert (
        f"{sku} = {name}" in seen[0]["system"]
        and "₹" not in seen[0]["system"].split("On the menu")[1].split("TOOL")[0]
    )
    back = seen[1]["messages"][-1]["content"]
    assert back.startswith("MENU BOOK RESULT") and f'"sku": "{sku}"' in back and '"price"' in back
    assert seen[1]["messages"][-2] == {"role": "assistant", "content": json.dumps(script[0])}
    assert [i["sku"] for i in r["show"]["items"]] == [sku, sku2] and r["show"]["title"] == "try these"
    assert {"name", "price", "available", "diet", "allergens", "desc"} <= set(r["show"]["items"][0])
    assert r["review"] == {"rating": 5, "text": "great place", "pretend": True}
    assert r["reservation"] == {"name": "Meera", "party": 4, "time": "7:30 pm", "note": None, "pretend": True}
    # pretend means pretend: no rating moved, no table held
    if rating_before is not None:
        assert w.reviews.rep.rating("offline") == rating_before
    if tables_before is not None:
        assert [t.state for t in w.tables.tables.values()] == tables_before
