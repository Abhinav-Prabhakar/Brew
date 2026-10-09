"""Surrogate decision trees for explaining Policy D (docs/implementation-spec.md 14.4).

One depth-4 ``DecisionTreeClassifier`` per action dimension is fitted on ``(observation, chosen action)`` pairs
from policy rollouts.  A decision is explained by the path its observation takes through the trees of the
dimensions that are *active* (a price move, a throttle, a hidden dish, a non-default level ...): the features
tested along the path, with the observed value and the threshold, are the 'top factors'.  Fidelity (agreement
with the network) is reported per dimension.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import joblib
import numpy as np

from brew.analysis.drivers import SHORT_LABELS, short_drivers, short_label  # noqa: F401
from brew.sim.observation import NAMES

from .actions import (
    BATCH_WINDOWS,
    DIM_NAMES,
    KAPPA_LEVELS,
    PREMAKE_LEVELS,
    PRICE_STEPS,
    REPLATE_MODES,
    STRATEGIES,
    THROTTLES,
    default_vector,
)

PRETTY = {
    "tod": "time of day", "util": "utilisation of the {} station", "queue": "{} queue", "down": "{} equipment down",
    "cover": "days of cover of {}", "demand": "expected demand {}", "open": "open {} orders", "wx": "weather {}",
    "dis": "disruption {}", "prep": "{} prep stock", "price_index": "{} price level", "rep": "{} rating",
    "replate": "Replate {}", "kappa": "service level of {}", "throttle": "{} throttle", "strategy": "strategy {}",
    "slack": "order slack bucket {}", "cal": "calendar {}", "dow": "weekday {}",
}  # fmt: skip


def describe_feature(name: str, value: float) -> str:
    """Readable phrase for an observation feature, e.g. ``util_espresso`` -> 'espresso station utilisation 91%'."""
    head, _, rest = name.partition("_")
    tmpl = PRETTY.get(head)
    if tmpl is None:
        return f"{name.replace('_', ' ')} {value:.2f}"
    label = tmpl.format(rest.replace("_", " ")) if "{}" in tmpl else tmpl
    if head in ("util", "cover", "prep", "queue", "open"):
        return f"{label} {value * 100:.0f}%" if head == "util" else f"{label} {value:.2f}"
    return f"{label} {value:.2f}"


def describe_action(dim: int, idx: int) -> str:
    """Human description of one chosen index."""
    n = DIM_NAMES[dim]
    if n.startswith("price_"):
        return f"{n[6:]} prices {PRICE_STEPS[idx] * 100:+.0f}%"
    if n.startswith("kappa_"):
        return f"prep {n[6:]} at {'off' if KAPPA_LEVELS[idx] == 0 else f'P{KAPPA_LEVELS[idx] * 100:.0f}'}"
    if n == "strategy":
        return f"dispatch strategy {STRATEGIES[idx]}"
    if n.startswith("throttle_"):
        return f"{n[9:]} throttle {THROTTLES[idx]}"
    if n == "batch_window":
        return f"batch window {BATCH_WINDOWS[idx]:.0f}s"
    if n == "featured":
        return "feature a dish" if idx else "no featured dish"
    if n.startswith("hide_"):
        return f"{'hide' if idx else 'show'} {n[5:]}"
    if n == "replate_mode":
        return f"Replate {REPLATE_MODES[idx]}"
    return f"make-ahead level {PREMAKE_LEVELS[idx] * 100:.0f}%" if PREMAKE_LEVELS[idx] else "no make-ahead"


class Surrogate:
    """Per-dimension decision trees fitted to the policy's actions."""

    def __init__(self, trees: list[Any], fidelity: list[float], depth: int, n_samples: int) -> None:
        self.trees = trees
        self.fidelity = fidelity
        self.depth = depth
        self.n_samples = n_samples
        self.default = default_vector()

    @classmethod
    def fit(cls, obs: np.ndarray, actions: np.ndarray, depth: int = 4, seed: int = 0) -> Surrogate:
        from sklearn.model_selection import train_test_split
        from sklearn.tree import DecisionTreeClassifier

        n = len(obs)
        idx = np.arange(n)
        tr, te = (idx, idx) if n < 40 else train_test_split(idx, test_size=0.25, random_state=seed)
        trees: list[Any] = []
        fid: list[float] = []
        for d in range(actions.shape[1]):
            t = DecisionTreeClassifier(max_depth=depth, min_samples_leaf=3, random_state=seed)
            t.fit(obs[tr], actions[tr, d])
            trees.append(t)
            fid.append(float(np.mean(t.predict(obs[te]) == actions[te, d])))
        return cls(trees, fid, depth, n)

    # ------------------------------------------------------------------ explain
    def path_factors(self, dim: int, x: np.ndarray, top: int = 3) -> list[dict[str, Any]]:
        """Features tested on the path of ``x`` through the tree of ``dim`` (most informative first)."""
        t = self.trees[dim].tree_
        node_ids = self.trees[dim].decision_path(x[None]).indices
        out: list[tuple[float, dict[str, Any]]] = []
        for nid in node_ids:
            if t.children_left[nid] == t.children_right[nid]:  # leaf
                continue
            f = int(t.feature[nid])
            thr = float(t.threshold[nid])
            n = t.weighted_n_node_samples[nid]
            gain = n * t.impurity[nid] - sum(
                t.weighted_n_node_samples[c] * t.impurity[c] for c in (t.children_left[nid], t.children_right[nid])
            )
            v = float(x[f])
            out.append(
                (float(gain), {"name": NAMES[f], "value": round(v, 3), "threshold": round(thr, 3), "op": "<=" if v <= thr else ">", "dim": DIM_NAMES[dim]})
            )
        out.sort(key=lambda p: -p[0])
        return [f for _g, f in out[:top]]

    def active_dims(self, vec: np.ndarray) -> list[int]:
        return [d for d in range(len(vec)) if int(vec[d]) != int(self.default[d])]

    def explain(self, obs: np.ndarray, vec: np.ndarray) -> tuple[list[dict[str, Any]], str]:
        """``(top_factors, summary)`` for one decision (the factors come from the active dimensions' trees)."""
        dims = self.active_dims(vec)
        # keep the decisions people care about first: prices, throttles, hides, featured
        dims.sort(key=lambda d: (0 if DIM_NAMES[d].split("_")[0] in ("price", "throttle", "hide", "featured") else 1, d))
        dims = dims[:2]
        factors: list[dict[str, Any]] = []
        seen: set[str] = set()
        for d in dims:
            for f in self.path_factors(d, obs):
                if f["name"] not in seen:
                    seen.add(f["name"])
                    factors.append(f)
        if not factors:  # the active dimension's tree is a single leaf (never varied in the data): use the busiest tree
            for d in sorted(range(len(self.trees)), key=lambda i: -self.trees[i].tree_.node_count)[:2]:
                for f in self.path_factors(d, obs):
                    if f["name"] not in seen:
                        seen.add(f["name"])
                        factors.append(f)
                if factors:
                    break
        what = "; ".join(describe_action(d, int(vec[d])) for d in dims) or "kept the plan unchanged"
        why = ", ".join(describe_feature(f["name"], f["value"]) for f in factors[:3])
        summary = f"RL manager: {what}" + (f" (drivers: {why})" if why else "")
        return factors, summary

    # --------------------------------------------------------------------- io
    def save(self, path: str | Path) -> None:
        joblib.dump({"trees": self.trees, "fidelity": self.fidelity, "depth": self.depth, "n": self.n_samples}, path, compress=3)

    @classmethod
    def load(cls, path: str | Path) -> Surrogate:
        d = joblib.load(path)
        return cls(d["trees"], d["fidelity"], d["depth"], d["n"])
