"""GET /policies/comparison (committed final arena)."""

from __future__ import annotations

import numpy as np
import pytest
from gaps_common import API

pytestmark = pytest.mark.integration


def test_policy_comparison_shape(gap_client):
    r = gap_client.get(f"{API}/policies/comparison")
    assert r.status_code == 200
    d = r.json()
    assert d["order"] == ["A", "B", "C", "D"]
    assert d["days"] == 7 and d["scenario"] == "weekday_normal" and len(d["seeds"]) == 10
    assert d["source"].endswith("full-20261005/metrics.json")
    for k, row in d["policies"].items():
        assert row["label"] == d["labels"][k]
        assert len(row["profit_by_seed"]) == len(d["seeds"])
        lo, hi = row["ci95"]
        assert lo <= row["mean_profit"] <= hi
        for f in ("mean_waste_kg", "mean_rating", "mean_walkouts", "cvar10_daily_profit"):
            assert isinstance(row[f], float)
        assert np.mean(row["profit_by_seed"]) == pytest.approx(row["mean_profit"], rel=1e-6)
    assert d["policies"]["A"]["vs_A"] is None and d["policies"]["D"]["vs_A"]["ci95"][0] > 0
    assert d["baseline"]["policy"] == "A" and d["baseline"]["mean_profit"] == d["policies"]["A"]["mean_profit"]
    assert d["policies"]["D"]["uplift_pct_vs_A"] > 50


def test_policy_comparison_is_deterministic_and_cached(gap_client):
    a = gap_client.get(f"{API}/policies/comparison").json()
    b = gap_client.get(f"{API}/policies/comparison").json()
    assert a == b
