"""The scripted waiter: no LLM, same contract. ``reply(text, ctx)`` -> ``{say, mood, actions}`` (see ``service``).

Deliberately small and predictable: it finds menu items and quantities in what was said, and recognises the handful
of things people ask a waiter (prices, what's good, hours, the wait, allergens, wifi) and complain about."""

from __future__ import annotations

import re
import zlib
from typing import Any

NUM = {"a": 1, "an": 1, "one": 1, "two": 2, "couple": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8}  # fmt: skip
ORDER_RE = re.compile(r"\b(i'?ll have|i'?d like|can i (get|have)|could i (get|have)|get me|give me|order|i want|we'?ll have|bring me|one more|another|please|to go)\b")  # fmt: skip
PRICE_RE = re.compile(r"\b(how much|price|cost|costs|rate)\b")
ASK_RE = re.compile(r"\?|\b(what|which|is|are|does|do you|tell me about|what'?s in|contain)\b")
SERIOUS_RE = re.compile(r"\b(hair|insect|bug|cockroach|glass|plastic|sick|ill|vomit|poison|allerg\w*|reaction|hospital|injur\w*|burn\w*|hurt|bleed\w*|rude|harass\w*|unsafe|stolen|theft|refund|overcharg\w*|charged twice|raw|mould|mold|spoiled|rotten|expired)\b")  # fmt: skip
COMPLAIN_RE = re.compile(r"\b(complain\w*|cold|stale|wrong|late|slow|waiting (for )?(so long|forever|ages)|too long|terrible|awful|bad|worst|dirty|sticky|burnt|bitter|watery|disappoint\w*|unhappy|not happy|missing|forgot|never (came|arrived))\b")  # fmt: skip
ESCALATE_RE = re.compile(r"\b(manager|owner|supervisor|in charge|speak to (someone|somebody)|escalate)\b")
LINES = {
    "hello": ["Hello hello! I'm Kapi. Pad's out, pencil's sharp — what can I get you?", "Welcome to brew! What are we having today?"],
    "thanks": ["Anytime! Shout if you need anything else.", "My pleasure — that's what the pencil is for."],
    "bye": ["See you soon! Mind the step, and the cat.", "Bye for now — come back hungry!"],
    "how": ["Run off my feet and loving it. You?", "Can't complain — the espresso machine does that for me."],
    "joke": ["Why did the espresso file a police report? It got mugged.", "I told the croissant a joke. It was too flaky to laugh."],
    "who": ["I'm Kapi — I take orders, answer questions, and pass complaints to the team so you don't have to shout."],
    "wifi": ["Wifi is 'brew-guest', password 'extrashot'. Laptop campers welcome — within reason!"],
    "pay": ["UPI, card or cash — whatever's easiest. I ring it up as I put the ticket on the rail."],
    "loo": ["Washroom's through the back, past the pantry door. Can't miss it."],
}  # fmt: skip


def _pick(key: str, seed: str) -> str:
    opts = LINES[key]
    return opts[zlib.crc32(seed.encode()) % len(opts)]


def _aliases(menu: list[dict[str, Any]]) -> list[tuple[str, str]]:
    """(alias, sku), longest first: full names, skus, and the noun (last word) of a name when only one item ends in
    it — "croissant", "chai", but not "latte" (several) and never an adjective ("cold" is not a Cold Brew)."""
    owners: dict[str, set[str]] = {}
    full: dict[str, str] = {}
    for m in menu:
        name = re.sub(r"[^a-z ]", " ", m["name"].lower()).strip()
        full[name] = m["sku"]
        full[m["sku"].lower()] = m["sku"]
        if len(name.split()[-1]) > 3:
            owners.setdefault(name.split()[-1], set()).add(m["sku"])
    for w, skus in owners.items():
        if w not in full and len(skus) == 1:
            full[w] = next(iter(skus))
    return sorted(full.items(), key=lambda kv: -len(kv[0]))


def find_items(text: str, menu: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Menu items mentioned in ``text`` with quantities: ``[{sku, qty}]`` in the order they were said."""
    return _scan(text, menu)[0]


def _scan(text: str, menu: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str]:
    """(items, the rest of the sentence with the item names blanked — so "cold brew" is not a "cold" complaint)."""
    t = " " + re.sub(r"[^a-z0-9 ]", " ", text.lower()) + " "
    found: list[tuple[int, str, int]] = []
    for alias, sku in _aliases(menu):
        pat = re.compile(
            rf"(?:\b(\d+|{'|'.join(NUM)})\s+(?:x\s+|of\s+|more\s+)?(?:\w+\s+)?)?\b{re.escape(alias)}(?:e?s)?\b"
        )
        while (m := pat.search(t)) is not None:
            q = m.group(1)
            qty = (int(q) if q.isdigit() else NUM[q]) if q else 1
            found.append((m.start(), sku, max(1, min(8, qty))))
            t = t[: m.start()] + " " * (m.end() - m.start()) + t[m.end() :]
    out: dict[str, dict[str, Any]] = {}
    for _, sku, qty in sorted(found):
        out.setdefault(sku, {"sku": sku, "qty": 0})["qty"] += qty
    return list(out.values()), t


def _rs(x: float) -> str:
    return f"₹{x:,.0f}"


def reply(text: str, ctx: dict[str, Any]) -> dict[str, Any]:
    menu = [m for m in ctx["menu"]]
    by = {m["sku"]: m for m in menu}
    t = text.lower().strip()
    items, rest = _scan(t, menu)
    act: list[dict[str, Any]] = []

    def out(say: str, mood: str = "happy") -> dict[str, Any]:
        return {"say": say, "mood": mood, "actions": act}

    if SERIOUS_RE.search(rest):
        asking_allergy = re.search(r"allerg", t) and not re.search(r"reaction|sick|ill|hospital", t)
        if asking_allergy and items:
            m = by[items[0]["sku"]]
            al = ", ".join(m["allergens"]) or "none of the common allergens"
            act.append({"type": "note", "kind": "request", "severity": "high", "summary": f"Guest asked about allergens ({m['name']}): {text[:140]}"})  # fmt: skip
            return out(f"Good that you asked. Our {m['name']} contains: {al}. I've flagged it to the kitchen so they take extra care — tell me exactly what to avoid.", "worried")  # fmt: skip
        act.append({"type": "note", "kind": "complaint", "severity": "high", "summary": text[:200]})
        return out("Oh no — I'm really sorry. I've written that down word for word and I'm taking it straight to the team right now. Someone will come to you.", "worried")  # fmt: skip
    if ESCALATE_RE.search(t):
        act.append({"type": "note", "kind": "escalation", "severity": "high", "summary": f"Guest asked for the manager: {text[:160]}"})  # fmt: skip
        return out("Of course. I've passed it up to the team — they'll be with you shortly. Anything I can do meanwhile?", "neutral")  # fmt: skip
    if COMPLAIN_RE.search(rest) and not (items and ORDER_RE.search(t)):
        act.append({"type": "note", "kind": "complaint", "severity": "low", "summary": text[:200]})
        return out("I'm sorry about that — it's on my pad and I'll make sure the team sees it. Can I fix it for you right now?", "worried")  # fmt: skip

    if items and PRICE_RE.search(t):
        bits = [f"{by[i['sku']]['name']} is {_rs(by[i['sku']]['price'])}" for i in items]
        return out(" · ".join(bits) + ". Shall I put one down for you?")
    if items and ASK_RE.search(t) and not ORDER_RE.search(t):
        m = by[items[0]["sku"]]
        diet = "vegan" if m["vegan"] else "vegetarian" if m["veg"] else "not vegetarian"
        al = f" Contains {', '.join(m['allergens'])}." if m["allergens"] else ""
        avail = "" if m["available"] else " It's off the menu right now, sadly."
        return out(f"{m['name']} — {m['desc']} {_rs(m['price'])}, {diet}.{al}{avail}")
    if items:
        if not ctx["clock"]["is_open"]:
            return out(f"I'd love to, but we're closed — doors open at {ctx['clock']['opens']}.", "neutral")
        gone = [by[i["sku"]]["name"] for i in items if not by[i["sku"]]["available"]]
        ok = [i for i in items if by[i["sku"]]["available"]]
        if not ok:
            return out(
                f"Ah, {' and '.join(gone)} just ran out, I'm sorry. Can I tempt you with something else?",
                "worried",
            )
        act.append({"type": "order", "items": ok, "note": None})
        said = ", ".join(f"{i['qty']} × {by[i['sku']]['name']}" for i in ok)
        extra = f" (no {' or '.join(gone)} left, sorry!)" if gone else ""
        return out(f"{said} — got it, scribbling it down{extra}. Ticket's going on the rail now.")

    if PRICE_RE.search(t) or re.search(r"\b(menu|what do you (have|serve)|recommend|suggest|special|popular|what'?s good|good (here|today)|best|hungry|thirsty|what should i)\b", t):  # fmt: skip
        on_now = [x for x in menu if x["available"]]
        pick = sorted(on_now, key=lambda x: (not x["featured"], -x["sold_today"]))[:4]
        if not pick:
            return out(
                "Honestly? We're cleaned out for the moment. Give the kitchen a few minutes.", "worried"
            )
        return out("Today I'd go for " + ", ".join(f"{x['name']} ({_rs(x['price'])})" for x in pick) + ". The full menu's on the book by the window.")  # fmt: skip
    if re.search(r"\b(open|close|closing|hours|timings?)\b", t):
        c = ctx["clock"]
        return out(f"We're open {c['opens']} to {c['closes']}. Right now it's {c['hhmm']} and we're {'open' if c['is_open'] else 'closed'}.")  # fmt: skip
    if re.search(r"\b(how long|wait|busy|queue|rush)\b", t):
        n, w = ctx["queue"]["open_orders"], ctx["queue"]["wait_min"]
        return out(f"{n} tickets on the rail — about {max(1, round(w))} min for a fresh order." if n else "No queue at all. Best time to order!")  # fmt: skip
    if re.search(r"\b(vegan|dairy[- ]free)\b", t):
        v = [x["name"] for x in menu if x["vegan"] and x["available"]][:5]
        return out("Vegan today: " + ", ".join(v) + ". Most milk drinks can go oat, too." if v else "Nothing fully vegan left right now, sorry — oat milk is an option in most drinks.")  # fmt: skip
    for key, pat in (("wifi", r"wi-?fi|internet|password"), ("pay", r"\b(pay|upi|card|cash|bill)\b"), ("loo", r"washroom|toilet|restroom|loo\b"),
                     ("joke", r"\bjoke|funny\b"), ("who", r"who are you|your name|what can you do|help"), ("how", r"how are you|how'?s it going|what'?s up"),
                     ("thanks", r"\b(thanks|thank you|cheers|perfect|great)\b"), ("bye", r"\b(bye|goodbye|see you|later)\b"),
                     ("hello", r"\b(hi|hello|hey|namaste|good (morning|afternoon|evening))\b")):  # fmt: skip
        if re.search(pat, t):
            return out(_pick(key, t))
    return out("Hmm, let me think… I can take your order, tell you what's good or what's in it, or pass a word to the team. What'll it be?", "neutral")  # fmt: skip
