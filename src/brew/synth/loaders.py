"""Loaders for synthetic corpora with built-in fallbacks (sim works without any LLM data)."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from brew.config.loader import repo_root

FALLBACK_NAMES = [
    "Riya", "Arjun", "Meera", "Kabir", "Zoya", "Dev", "Ananya", "Ishaan", "Tara", "Neel", "Sana", "Rohan",
    "Priya", "Aditya", "Nisha", "Vikram", "Leah", "Omar", "Kavya", "Farhan", "Aisha", "Siddharth", "Maya",
    "Yash", "Ira", "Rahul", "Diya", "Kunal", "Noor", "Varun", "Esha", "Aman", "Pooja", "Imran", "Tanvi",
    "Joel", "Ritika", "Arnav", "Lina", "Sameer",
]  # fmt: skip

# (text, intents, modifiers, urgency)
FALLBACK_NOTES: list[tuple[str, list[str], list[str], float]] = [
    ("make it strong pls", ["modifier"], ["shot"], 0.2),
    ("for Riya - happy bday!", ["gift_message"], [], 0.1),
    ("allergic to nuts!!", ["allergy"], ["nonuts"], 0.9),
    ("extra napkins pls", ["packaging"], [], 0.1),
    ("no straw, thanks", ["packaging"], [], 0.1),
    ("less ice", ["modifier"], [], 0.2),
    ("warm it up pls", ["modifier"], ["hot"], 0.3),
    ("cut in half?", ["other"], [], 0.1),
    ("can you write 'you got this'", ["gift_message"], [], 0.1),
    ("quick, train in 10!", ["rush"], [], 0.9),
    ("pls draw a heart", ["gift_message"], [], 0.1),
    ("separate bags pls", ["packaging"], [], 0.2),
    ("no onion please", ["modifier"], ["noonion"], 0.4),
    ("oat milk if possible", ["modifier"], ["oat"], 0.2),
    ("less sugar pls", ["modifier"], ["lesssugar"], 0.2),
    ("extra spicy", ["spice_level"], ["jalapeno"], 0.2),
]

_FALLBACK_REVIEWS: dict[tuple[int, str], list[str]] = {}


def _fb() -> dict[tuple[int, str], list[str]]:
    if _FALLBACK_REVIEWS:
        return _FALLBACK_REVIEWS
    pos = {
        "quality": ["Great coffee, properly made.", "The flat white here is genuinely good."],
        "staff": ["Lovely staff, felt welcome.", "The team was so kind."],
        "ambience": ["Cosy corner, nice music.", "Beautiful vibe, will come back."],
        "wait": ["Quick service even in the rush!", "Food arrived super fast."],
        "price": ["Fair prices for the quality.", "Worth every rupee."],
        "value": ["Good value for money.", "Generous portions for the price."],
        "cold_food": ["Arrived hot and fresh.", "Still piping hot on delivery."],
        "accuracy": ["Order was exactly right.", "They got my custom order spot on."],
        "packaging": ["Neat packaging, nothing spilled.", "Packed really well."],
    }
    neg = {
        "wait": ["Waited far too long for a simple order.", "Service was painfully slow."],
        "cold_food": ["Food arrived cold.", "Fries were soggy and cold by the time they came."],
        "price": ["Overpriced for what you get.", "Prices felt too steep today."],
        "quality": ["Coffee tasted burnt.", "Not up to the usual standard."],
        "ambience": ["Crowded and noisy, nowhere to sit.", "Tables were dirty."],
        "staff": ["Staff seemed stressed and rude.", "Had to ask three times."],
        "accuracy": ["They got my order wrong.", "Ignored my special instructions."],
        "packaging": ["Packaging leaked everywhere.", "Poorly packed, spilled in the bag."],
        "value": ["Not worth the money.", "Small portion for the price."],
    }
    mid = {k: ["Decent, nothing special.", "It was fine, could be better."] for k in neg}
    for stars in (1, 2):
        for c, v in neg.items():
            _FALLBACK_REVIEWS[(stars, c)] = v
    for c, v in mid.items():
        _FALLBACK_REVIEWS[(3, c)] = v
    for stars in (4, 5):
        for c, v in pos.items():
            _FALLBACK_REVIEWS[(stars, c)] = v
    return _FALLBACK_REVIEWS


@dataclass
class ReviewCorpus:
    """Index of review texts by (stars, cause, channel group)."""

    by_full: dict[tuple[int, str, str], list[str]] = field(default_factory=dict)
    by_cause: dict[tuple[int, str], list[str]] = field(default_factory=dict)
    by_stars: dict[int, list[str]] = field(default_factory=dict)
    n: int = 0

    def add(self, stars: int, cause: str, group: str, text: str) -> None:
        self.by_full.setdefault((stars, cause, group), []).append(text)
        self.by_cause.setdefault((stars, cause), []).append(text)
        self.by_stars.setdefault(stars, []).append(text)
        self.n += 1

    def sample(self, stars: int, cause: str, group: str, u: float) -> str:
        """Nearest-match text for ``(stars, cause, group)``; ``u`` in [0,1) picks the row."""
        for pool in (
            self.by_full.get((stars, cause, group)),
            self.by_cause.get((stars, cause)),
            self.by_stars.get(stars),
            _fb().get((stars, cause)),
            _fb().get((stars, "quality")),
        ):
            if pool:
                return pool[min(len(pool) - 1, int(u * len(pool)))]
        return "Decent place."


@dataclass
class Corpora:
    names: list[str]
    short_names: list[str]
    notes: list[tuple[str, list[str], list[str], float]]
    reviews: ReviewCorpus
    calendar: list
    explanations: list[dict]
    source: dict[str, str]


def _rows(path: Path) -> list[dict]:
    out = []
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


_CACHE: dict[str, Corpora] = {}


def clean_dir(path: str | Path | None = None) -> Path:
    return Path(path) if path else repo_root() / "data" / "synthetic" / "clean"


def load_corpora(path: str | Path | None = None) -> Corpora:
    """Load clean synthetic datasets if present, else fall back to built-ins. Cached per dir."""
    d = clean_dir(path)
    key = str(d)
    stamp = (
        key + "|" + "|".join(f"{p.name}:{p.stat().st_mtime_ns}" for p in sorted(d.glob("*.jsonl")))
        if d.exists()
        else key
    )
    hit = _CACHE.get(stamp)
    if hit is not None:
        return hit
    src: dict[str, str] = {}
    names_rows = _rows(d / "customer_names.jsonl")
    names = [r["name"] for r in names_rows] or list(FALLBACK_NAMES)
    shorts = [r["short"] for r in names_rows] or [n.upper()[:5] for n in FALLBACK_NAMES]
    src["customer_names"] = "clean" if names_rows else "fallback"
    note_rows = _rows(d / "order_notes.jsonl")
    notes = [
        (r["text"], r["intents"], r.get("modifiers", []), r.get("urgency", 0.0)) for r in note_rows
    ] or list(FALLBACK_NOTES)
    src["order_notes"] = "clean" if note_rows else "fallback"
    rc = ReviewCorpus()
    rev_rows = _rows(d / "reviews.jsonl")
    for r in rev_rows:
        causes = r.get("causes", {})
        top = max(causes, key=lambda k: causes[k]) if causes else "quality"
        grp = r["channel"] if r["channel"] in ("zomato", "swiggy") else "offline"
        rc.add(int(r["stars"]), top, grp, r["text"])
    src["reviews"] = "clean" if rev_rows else "fallback"
    from brew.config.schemas import CalendarEvent

    cal_rows = _rows(d / "calendar_bengaluru.jsonl")
    cal = [CalendarEvent(**{k: v for k, v in r.items()}) for r in cal_rows]
    src["calendar_bengaluru"] = "clean" if cal_rows else "fallback"
    expl = _rows(d / "explanations.jsonl")
    src["explanations"] = "clean" if expl else "fallback"
    c = Corpora(names, shorts, notes, rc, cal, expl, src)
    _CACHE[stamp] = c
    return c
