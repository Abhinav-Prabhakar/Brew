"""Small LightGBM helpers shared by the prep-time, rider-ETA and replate sell-through models."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import lightgbm as lgb
import numpy as np


class FeatureSpace:
    """Maps a row dict / frame to a float matrix: numeric columns as-is, categoricals via a fixed vocab."""

    def __init__(self, numeric: list[str], categorical: dict[str, list[str]]) -> None:
        self.numeric = numeric
        self.categorical = categorical
        self.names = [*categorical, *numeric]
        self.cat_idx = list(range(len(categorical)))

    def matrix(self, df: Any) -> np.ndarray:
        cols = []
        for c, vocab in self.categorical.items():
            m = {v: i for i, v in enumerate(vocab)}
            cols.append(np.array([m.get(v, -1) for v in df[c].to_list()], dtype=np.float32))
        for c in self.numeric:
            cols.append(df[c].to_numpy().astype(np.float32))
        return np.stack(cols, axis=1) if cols else np.zeros((len(df), 0), dtype=np.float32)

    def row(self, **kw: Any) -> np.ndarray:
        out = []
        for c, vocab in self.categorical.items():
            out.append(float(vocab.index(kw[c])) if kw[c] in vocab else -1.0)
        for c in self.numeric:
            out.append(float(kw[c]))
        return np.array([out], dtype=np.float32)

    def to_json(self) -> dict[str, Any]:
        return {"numeric": self.numeric, "categorical": self.categorical}

    @classmethod
    def from_json(cls, j: dict[str, Any]) -> FeatureSpace:
        return cls(j["numeric"], j["categorical"])


def train_booster(
    X: np.ndarray, y: np.ndarray, cat_idx: list[int], names: list[str], params: dict[str, Any], rounds: int,
    val_frac: float = 0.15, seed: int = 0,
) -> lgb.Booster:  # fmt: skip
    """Train one booster with a random validation split for early stopping."""
    n = len(y)
    rng = np.random.default_rng(seed)
    is_val = rng.random(n) < val_frac if n >= 400 else np.zeros(n, dtype=bool)
    tr = lgb.Dataset(X[~is_val], y[~is_val], categorical_feature=cat_idx, feature_name=names, free_raw_data=False)
    p = {"num_leaves": 31, "learning_rate": 0.06, "min_data_in_leaf": 20, "verbose": -1, "seed": seed,
         "num_threads": 4, **params}  # fmt: skip
    if is_val.any():
        va = lgb.Dataset(X[is_val], y[is_val], reference=tr)
        return lgb.train(p, tr, num_boost_round=rounds, valid_sets=[va], callbacks=[lgb.early_stopping(25, verbose=False)])
    return lgb.train(p, tr, num_boost_round=rounds)


class QuantileGBM:
    """Quantile boosters (default P10/P50/P90) over a :class:`FeatureSpace`."""

    def __init__(self, space: FeatureSpace, alphas: tuple[float, ...] = (0.1, 0.5, 0.9)) -> None:
        self.space = space
        self.alphas = alphas
        self.boosters: dict[float, lgb.Booster] = {}

    def fit(self, df: Any, target: str, rounds: int = 80, seed: int = 0) -> QuantileGBM:
        X = self.space.matrix(df)
        y = df[target].to_numpy().astype(float)
        for a in self.alphas:
            self.boosters[a] = train_booster(
                X, y, self.space.cat_idx, self.space.names, {"objective": "quantile", "alpha": a}, rounds, seed=seed
            )
        return self

    def predict_matrix(self, X: np.ndarray) -> np.ndarray:
        """Sorted (non-crossing) quantile predictions, shape ``(n, len(alphas))``."""
        out = np.stack([self.boosters[a].predict(X, num_threads=1) for a in self.alphas], axis=1)
        out = np.maximum(out, 0.0)
        out.sort(axis=1)
        return out

    def predict(self, df: Any) -> np.ndarray:
        return self.predict_matrix(self.space.matrix(df))

    def predict_row(self, **kw: Any) -> np.ndarray:
        return self.predict_matrix(self.space.row(**kw))[0]

    def save(self, path: str | Path) -> Path:
        d = Path(path)
        d.mkdir(parents=True, exist_ok=True)
        for a, b in self.boosters.items():
            b.save_model(str(d / f"q{int(round(a * 100)):02d}.txt"))
        (d / "space.json").write_text(json.dumps({"space": self.space.to_json(), "alphas": list(self.alphas)}))
        return d

    @classmethod
    def load(cls, path: str | Path) -> QuantileGBM:
        d = Path(path)
        j = json.loads((d / "space.json").read_text())
        m = cls(FeatureSpace.from_json(j["space"]), tuple(j["alphas"]))
        for a in m.alphas:
            m.boosters[a] = lgb.Booster(model_file=str(d / f"q{int(round(a * 100)):02d}.txt"))
        return m
