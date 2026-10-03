"""Ticket-note parser: high-precision rules + TF-IDF logistic regression (technical.md 12.7).

Maps a free-text special instruction to intents (``allergy, modifier, rush, gift_message, packaging,
cutlery, spice_level, other``), modifier ids, an allergen, an urgency score and a gift name.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from scipy.sparse import hstack
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import f1_score
from sklearn.multiclass import OneVsRestClassifier

from brew.config.loader import repo_root

INTENTS = ("allergy", "modifier", "rush", "gift_message", "packaging", "cutlery", "spice_level", "other")
MODIFIERS = (
    "oat", "almond", "shot", "decaf", "lesssugar", "iced", "hot", "large", "noonion", "nonuts", "cheese", "jalapeno",
)  # fmt: skip

# high-precision rules (checked before the classifier; a hit forces the label on)
MOD_RULES: dict[str, re.Pattern[str]] = {
    "oat": re.compile(r"\boat\b"),
    "almond": re.compile(r"\balmond\b"),
    "decaf": re.compile(r"\bdecaf\b"),
    "lesssugar": re.compile(r"(less|low|kam|thoda)\s+(sugar|meetha|sweet)|sugar\s*(kam|less)|no sugar"),
    "noonion": re.compile(r"no onion|without onion|onion nahi|bina pyaaz|hold the onion"),
    "nonuts": re.compile(r"nut allerg|no nuts|nuts? free|allergic to (peanut|nut)|peanut allerg"),
    "jalapeno": re.compile(r"jalape"),
}
ALLERGEN_RULES: dict[str, re.Pattern[str]] = {
    "nuts": re.compile(r"\bnuts?\b|almond|cashew|walnut"),
    "peanuts": re.compile(r"peanut"),
    "lactose": re.compile(r"lactose|dairy|milk allerg|allergic to milk"),
    "gluten": re.compile(r"gluten|celiac|coeliac"),
    "egg": re.compile(r"\begg"),
    "onion": re.compile(r"onion allerg|allergic to onion"),
    "sesame": re.compile(r"sesame"),
    "soy": re.compile(r"\bsoy"),
}
ALLERGY_WORD = re.compile(r"allerg|anaphyl|epipen|intoleran")
GIFT_NAME = re.compile(
    r"(?:for|ke liye|ki|ka)\s+([A-Z][a-z]{2,})|(?:^|\s)([A-Z][a-z]{2,})\s+(?:ke liye|ki farewell|ka)", re.UNICODE
)


@dataclass
class ParsedNote:
    """Structured reading of a ticket note."""

    text: str
    intents: list[str] = field(default_factory=list)
    modifiers: list[str] = field(default_factory=list)
    allergy: str | None = None
    urgency: float = 0.0
    gift_name: str | None = None


def load_note_rows(source: str = "clean") -> list[dict[str, Any]]:
    root = repo_root()
    path = (
        root / "data" / "synthetic" / "clean" / "order_notes.jsonl"
        if source == "clean"
        else root / "tests" / "fixtures" / "synthetic" / "order_notes.jsonl"
    )
    if source == "clean" and not path.exists():
        path = root / "tests" / "fixtures" / "synthetic" / "order_notes.jsonl"
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _multi_hot(rows: list[dict[str, Any]], key: str, vocab: tuple[str, ...]) -> np.ndarray:
    y = np.zeros((len(rows), len(vocab)), dtype=int)
    for i, r in enumerate(rows):
        for v in r.get(key, []):
            if v in vocab:
                y[i, vocab.index(v)] = 1
    return y


class NoteParser:
    """Rules + TF-IDF/LR multi-label classifiers for intents and modifiers, ridge for urgency."""

    def __init__(self) -> None:
        self.word = TfidfVectorizer(ngram_range=(1, 2), min_df=1, sublinear_tf=True, lowercase=True)
        self.char = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 5), min_df=2, sublinear_tf=True)
        self.intent_clf: OneVsRestClassifier | None = None
        self.mod_clf: OneVsRestClassifier | None = None
        self.urg: Ridge | None = None
        self.intents_ok: list[int] = []
        self.mods_ok: list[int] = []
        self.threshold = 0.4

    def _x(self, texts: list[str], fit: bool = False) -> Any:
        if fit:
            return hstack([self.word.fit_transform(texts), self.char.fit_transform(texts)]).tocsr()
        return hstack([self.word.transform(texts), self.char.transform(texts)]).tocsr()

    def fit(self, rows: list[dict[str, Any]]) -> NoteParser:
        texts = [r["text"] for r in rows]
        X = self._x(texts, fit=True)
        yi = _multi_hot(rows, "intents", INTENTS)
        ym = _multi_hot(rows, "modifiers", MODIFIERS)
        n = len(rows)
        self.intents_ok = [j for j in range(len(INTENTS)) if 2 <= yi[:, j].sum() <= n - 2]
        self.mods_ok = [j for j in range(len(MODIFIERS)) if 2 <= ym[:, j].sum() <= n - 2]
        mk = lambda: OneVsRestClassifier(LogisticRegression(C=8, max_iter=3000, class_weight="balanced"))  # noqa: E731
        self.intent_clf = mk().fit(X, yi[:, self.intents_ok])
        self.mod_clf = mk().fit(X, ym[:, self.mods_ok])
        urg = np.array([float(r.get("urgency", 0.0)) for r in rows])
        self.urg = Ridge(alpha=1.0).fit(X, urg)
        return self

    # ------------------------------------------------------------- inference
    def _probs(self, texts: list[str]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        assert self.intent_clf is not None and self.mod_clf is not None and self.urg is not None
        X = self._x(texts)
        pi = np.zeros((len(texts), len(INTENTS)))
        pi[:, self.intents_ok] = self.intent_clf.predict_proba(X)
        pm = np.zeros((len(texts), len(MODIFIERS)))
        pm[:, self.mods_ok] = self.mod_clf.predict_proba(X)
        return pi, pm, np.clip(self.urg.predict(X), 0.0, 1.0)

    def parse_many(self, texts: list[str]) -> list[ParsedNote]:
        pi, pm, urg = self._probs(texts)
        out = []
        for i, t in enumerate(texts):
            low = t.lower()
            intents = {INTENTS[j] for j in range(len(INTENTS)) if pi[i, j] >= self.threshold}
            mods = {MODIFIERS[j] for j in range(len(MODIFIERS)) if pm[i, j] >= self.threshold}
            for m, rx in MOD_RULES.items():
                if rx.search(low):
                    mods.add(m)
            allergy = None
            if ALLERGY_WORD.search(low):
                intents.add("allergy")
                for name, rx in ALLERGEN_RULES.items():
                    if rx.search(low):
                        allergy = name
                        break
            if "nonuts" in mods and allergy is None:
                allergy = "nuts"
            gift = None
            gm = GIFT_NAME.search(t)
            if gm and "gift_message" in intents:
                gift = gm.group(1) or gm.group(2)
            if not intents:
                j = int(np.argmax(pi[i]))
                intents = {INTENTS[j]}
            out.append(
                ParsedNote(t, sorted(intents), sorted(mods), allergy, round(float(urg[i]), 3), gift)
            )
        return out

    def parse(self, text: str) -> ParsedNote:
        return self.parse_many([text])[0]

    def evaluate(self, rows: list[dict[str, Any]]) -> dict[str, Any]:
        parsed = self.parse_many([r["text"] for r in rows])
        yi = _multi_hot(rows, "intents", INTENTS)
        ym = _multi_hot(rows, "modifiers", MODIFIERS)
        pi = np.array([[int(v in p.intents) for v in INTENTS] for p in parsed])
        pm = np.array([[int(v in p.modifiers) for v in MODIFIERS] for p in parsed])
        fi = {INTENTS[j]: float(f1_score(yi[:, j], pi[:, j], zero_division=0)) for j in range(len(INTENTS)) if yi[:, j].sum() > 0}
        fm = {MODIFIERS[j]: float(f1_score(ym[:, j], pm[:, j], zero_division=0)) for j in range(len(MODIFIERS)) if ym[:, j].sum() > 0}
        allergy_ok = np.mean([(p.allergy is not None) == (r.get("allergy") is not None) for p, r in zip(parsed, rows, strict=True)])
        macro_i = float(np.mean(list(fi.values()))) if fi else 0.0
        macro_m = float(np.mean(list(fm.values()))) if fm else 0.0
        return {
            "macro_f1": float((macro_i + macro_m) / 2.0), "macro_f1_intents": macro_i, "macro_f1_modifiers": macro_m,
            "per_intent_f1": fi, "per_modifier_f1": fm, "allergy_flag_accuracy": float(allergy_ok), "n": len(rows),
        }  # fmt: skip

    # ------------------------------------------------------------------ io
    def save(self, path: str | Path) -> Path:
        d = Path(path)
        d.mkdir(parents=True, exist_ok=True)
        joblib.dump(self, d / "parser.joblib", compress=3)
        (d / "labels.json").write_text(json.dumps({"intents": INTENTS, "modifiers": MODIFIERS}))
        return d

    @classmethod
    def load(cls, path: str | Path) -> NoteParser:
        p = joblib.load(Path(path) / "parser.joblib")
        assert isinstance(p, cls)
        return p
