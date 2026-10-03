"""Review-cause tagger: TF-IDF (1-2 grams) + one-vs-rest logistic regression (technical.md 12.7)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score
from sklearn.multiclass import OneVsRestClassifier
from sklearn.pipeline import Pipeline

from brew.config.loader import repo_root
from brew.domain.enums import CAUSES

POSITIVE_WEIGHT = 0.3
THRESHOLD = 0.35


def load_review_rows(source: str = "clean") -> list[dict[str, Any]]:
    """Rows of ``reviews.jsonl`` from ``data/synthetic/clean`` (or the test fixtures)."""
    root = repo_root()
    path = (
        root / "data" / "synthetic" / "clean" / "reviews.jsonl"
        if source == "clean"
        else root / "tests" / "fixtures" / "synthetic" / "reviews.jsonl"
    )
    if source == "clean" and not path.exists():
        path = root / "tests" / "fixtures" / "synthetic" / "reviews.jsonl"
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def label_matrix(rows: list[dict[str, Any]]) -> np.ndarray:
    """Multi-hot labels: causes whose weight is at least ``POSITIVE_WEIGHT``."""
    y = np.zeros((len(rows), len(CAUSES)), dtype=int)
    for i, r in enumerate(rows):
        for c, w in r.get("causes", {}).items():
            if w >= POSITIVE_WEIGHT and c in CAUSES:
                y[i, CAUSES.index(c)] = 1
    return y


class ReviewCauseTagger:
    """Multi-label cause tagger over review text."""

    def __init__(self, threshold: float = THRESHOLD) -> None:
        self.threshold = threshold
        self.pipeline: Pipeline | None = None
        self.trained: list[str] = []

    def fit(self, rows: list[dict[str, Any]]) -> ReviewCauseTagger:
        texts = [r["text"] for r in rows]
        y = label_matrix(rows)
        keep = [j for j in range(len(CAUSES)) if 2 <= y[:, j].sum() <= len(rows) - 2]
        self.trained = [CAUSES[j] for j in keep]
        self.pipeline = Pipeline(
            [
                ("tfidf", TfidfVectorizer(ngram_range=(1, 2), min_df=2 if len(rows) > 200 else 1, sublinear_tf=True)),
                ("clf", OneVsRestClassifier(LogisticRegression(C=4, max_iter=2000))),
            ]
        )
        self.pipeline.fit(texts, y[:, keep])
        return self

    def predict_proba(self, texts: list[str]) -> dict[str, np.ndarray]:
        """Per-cause probabilities for each text (untrained causes get 0)."""
        assert self.pipeline is not None, "fit() first"
        p = self.pipeline.predict_proba(texts)
        out = {c: np.zeros(len(texts)) for c in CAUSES}
        for k, c in enumerate(self.trained):
            out[c] = p[:, k]
        return out

    def tag(self, text: str) -> dict[str, float]:
        """Causes above the threshold for one review, with their probabilities."""
        pr = self.predict_proba([text])
        return {c: round(float(v[0]), 3) for c, v in pr.items() if v[0] >= self.threshold}

    def evaluate(self, rows: list[dict[str, Any]]) -> dict[str, Any]:
        texts = [r["text"] for r in rows]
        y = label_matrix(rows)
        pr = self.predict_proba(texts)
        f1s: dict[str, float] = {}
        for j, c in enumerate(CAUSES):
            if y[:, j].sum() == 0:
                continue
            pred = (pr[c] >= self.threshold).astype(int)
            f1s[c] = float(f1_score(y[:, j], pred, zero_division=0))
        return {"macro_f1": float(np.mean(list(f1s.values()))) if f1s else 0.0, "per_label_f1": f1s, "n": len(rows)}

    # ------------------------------------------------------------------ io
    def save(self, path: str | Path) -> Path:
        d = Path(path)
        d.mkdir(parents=True, exist_ok=True)
        joblib.dump(self.pipeline, d / "pipeline.joblib", compress=3)
        (d / "labels.json").write_text(json.dumps({"trained": self.trained, "threshold": self.threshold}))
        return d

    @classmethod
    def load(cls, path: str | Path) -> ReviewCauseTagger:
        d = Path(path)
        meta = json.loads((d / "labels.json").read_text())
        t = cls(meta["threshold"])
        t.trained = meta["trained"]
        t.pipeline = joblib.load(d / "pipeline.joblib")
        return t


def train_test_split_rows(rows: list[dict[str, Any]], test_size: float, seed: int) -> tuple[list, list]:
    """Deterministic shuffle split."""
    idx = np.random.default_rng(seed).permutation(len(rows))
    n_test = max(1, int(round(len(rows) * test_size)))
    test = [rows[i] for i in idx[:n_test]]
    train = [rows[i] for i in idx[n_test:]]
    return train, test
