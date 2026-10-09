"""M2 API endpoints: forecast, decisions/explain, bottlenecks, advisor, invest, arena, models, reviews."""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from brew.api.app import create_app
from brew.settings import Settings

pytestmark = pytest.mark.integration
API = "/api/v1"
H = 3600


@pytest.fixture
def c():
    app = create_app(Settings(db_enabled=False))
    with TestClient(app) as client:
        yield client


def mk(c, **kw) -> str:
    r = c.post(f"{API}/worlds", json={"policy": "B", "seed": 3, **kw})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def step(c, wid, s):
    r = c.post(f"{API}/worlds/{wid}/control", json={"action": "step", "step_s": s})
    assert r.status_code == 200, r.text


def test_forecast_endpoint_buckets_actuals_and_filters(c):
    wid = mk(c)
    step(c, wid, 5 * H)  # 12:00
    j = c.get(f"{API}/worlds/{wid}/forecast?horizon_min=60").json()
    assert j["target"] == "demand" and j["model"] in ("lightgbm", "moving_average") and "sim_s" in j
    assert len(j["buckets"]) == 4 * 2  # four slots x (offline, delivery)
    for b in j["buckets"]:
        assert b["p10"] <= b["p50"] + 1e-9 <= b["p90"] + 2e-9 and b["mean"] >= 0
    assert j["actual"] and all("offline" in a for a in j["actual"])
    one = c.get(f"{API}/worlds/{wid}/forecast?key=coffee&horizon_min=30").json()
    allr = c.get(f"{API}/worlds/{wid}/forecast?horizon_min=30").json()
    assert sum(b["mean"] for b in one["buckets"]) < sum(b["mean"] for b in allr["buckets"])
    assert c.get(f"{API}/worlds/{wid}/forecast?key=nope").status_code == 404
    assert c.get(f"{API}/worlds/{wid}/forecast?target=price").status_code == 422
    assert c.get(f"{API}/worlds/{wid}/forecast?horizon_min=5").status_code == 422


def test_bottlenecks_endpoint_ranks_resources(c):
    wid = mk(c)
    step(c, wid, 6 * H)
    j = c.get(f"{API}/worlds/{wid}/bottlenecks").json()
    assert j["primary"] and j["resources"]
    sc = [r["score"] for r in j["resources"]]
    assert sc == sorted(sc, reverse=True)
    assert {"rho", "wait_attribution", "active_share", "shadow_price"} <= set(j["resources"][0])


def test_advisor_job_and_invest_flow(c):
    wid = mk(c, cash_start=400_000)
    step(c, wid, 6 * H)
    r = c.get(f"{API}/worlds/{wid}/advisor?seeds=1&days=1&wait=true")
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["status"] == "done", j["job"]
    assert j["recommendations"]
    recs = j["recommendations"]
    assert [x["rank"] for x in recs] == list(range(1, len(recs) + 1))
    assert {"delta_profit_per_day", "ci90", "payback_days", "delta_p95_wait_s", "delta_waste_kg"} <= set(recs[0])
    # a second call the same day reuses the finished job
    assert c.get(f"{API}/worlds/{wid}/advisor").json()["job"]["id"] == j["job"]["id"]
    key = recs[0]["catalog_key"]
    r = c.post(f"{API}/worlds/{wid}/invest", json={"catalog_key": key})
    assert r.status_code == 201 and r.json()["catalog_key"] == key and "cash" in r.json() and "deliver_s" in r.json()
    assert c.post(f"{API}/worlds/{wid}/invest", json={"catalog_key": key}).status_code == 409  # already on order
    assert c.post(f"{API}/worlds/{wid}/invest", json={"catalog_key": "nope"}).status_code == 404


def test_invest_without_cash_is_409(c):
    wid = mk(c, cash_start=10)
    assert c.post(f"{API}/worlds/{wid}/invest", json={"catalog_key": "espresso_2nd"}).status_code == 409


def test_arena_job_lifecycle_and_validation(c):
    r = c.post(f"{API}/arena", json={"policies": ["A", "B"], "seeds": [1, 2], "days": 1})
    assert r.status_code == 202
    aid = r.json()["id"]
    j = {}
    for _ in range(300):
        j = c.get(f"{API}/arena/{aid}").json()
        if j["status"] in ("done", "error"):
            break
        time.sleep(0.2)
    assert j["status"] == "done", j
    s = j["summary"]["policies"]
    assert set(s) == {"A", "B"} and "vs_A" in s["B"] and len(s["B"]["profit_by_seed"]) == 2
    assert j["progress"]["done"] == j["progress"]["total"] == 4
    assert c.get(f"{API}/arena/arena-99999").status_code == 404
    assert c.post(f"{API}/arena", json={"policies": ["A", "Z"], "seeds": [1], "days": 1}).status_code == 422
    assert c.post(f"{API}/arena", json={"policies": ["A"], "seeds": [], "days": 1}).status_code == 422
    assert c.post(f"{API}/arena", json={"policies": ["A"], "scenario": "nope", "seeds": [1], "days": 1}).status_code == 422


def test_models_and_health(c):
    j = c.get(f"{API}/models").json()
    assert "items" in j and "champions" in j and j["models_loaded"] == len(j["champions"])
    kinds = {m["kind"] for m in j["champions"]}
    assert {"forecast", "elasticity", "text"} <= kinds
    m0 = next(m for m in j["champions"] if m["kind"] == "forecast")
    assert m0["metrics"] and m0["git_sha"] and m0["lineage"]
    assert c.get(f"{API}/health").json()["models_loaded"] == j["models_loaded"]


def test_decision_explain_and_policy_c_world(c):
    wid = mk(c, policy="C")
    step(c, wid, 4 * H)
    decs = c.get(f"{API}/worlds/{wid}/decisions").json()["items"]
    assert decs
    d = decs[0]
    r = c.get(f"{API}/decisions/{d['decision_id']}/explain?world_id={wid}")
    assert r.status_code == 200, r.text
    e = r.json()
    assert e["text"] and "{" not in e["text"] and e["decision_id"] == d["decision_id"] and e["world_id"] == wid
    assert "top_factors" in e and "template_id" in e
    assert c.get(f"{API}/decisions/dec-999999/explain?world_id={wid}").status_code == 404
    assert c.get(f"{API}/decisions/dec-000001/explain?world_id=nope").status_code == 404


def test_reviews_carry_tagger_output(c):
    wid = mk(c)
    step(c, wid, 10 * H)
    j = c.get(f"{API}/worlds/{wid}/reviews?limit=20").json()
    assert j["items"], "expected reviews after a service day"
    for r in j["items"]:
        assert {"stars", "text"} <= set(r) and isinstance(r.get("tagged_causes", {}), dict)
    assert any("tagged_causes" in r for r in j["items"])


def test_switch_policy_to_c_and_e_live(c):
    wid = mk(c)
    for code in ("C", "E"):
        assert c.post(f"{API}/worlds/{wid}/policy", json={"policy": code}).json()["policy"] == code
        step(c, wid, 1 * H)
    assert c.get(f"{API}/worlds/{wid}/state").status_code == 200
