from __future__ import annotations

import numpy as np

from brew.sim.arrivals import expected_daily_parties, slot_rates
from brew.sim.world import World


def _start(policy: str, seed: int = 21, scenario: str = "weekday_normal") -> World:
    w = World(policy=policy, seed=seed, scenario=scenario)
    w.run_until(7 * 3600 + 5)  # day plan built
    return w


def test_crn_identical_plan_across_policies():
    a, b = _start("A"), _start("B")
    assert a.plan is not None and b.plan is not None
    assert a.plan.fingerprint() == b.plan.fingerprint()
    for f in (
        "t",
        "pidx",
        "u_thin",
        "chan",
        "size",
        "patience_z",
        "dwell_z",
        "seeds",
        "gumbel",
        "mod_u",
        "note_u",
    ):
        assert np.array_equal(getattr(a.plan, f), getattr(b.plan, f)), f


def test_crn_holds_after_full_day_and_second_day():
    a = World(policy="A", seed=21, days=2)
    b = World(policy="B", seed=21, days=2)
    a.run()
    b.run()
    # day-2 plan was sampled from streams untouched by policy-dependent draws
    assert a.plan.fingerprint() == b.plan.fingerprint()
    assert a.plan.day == 1


def test_different_seed_different_plan():
    assert _start("A", 1).plan.fingerprint() != _start("A", 2).plan.fingerprint()


def test_slot_profile_peaks_at_commuter_hours(cafe_cfg):
    r = slot_rates(cafe_cfg.personas["commuter"], "weekday")
    peak = int(np.argmax(r))
    assert 8 * 4 <= peak <= 9 * 4 + 3  # 08:00-09:45
    assert r[0] == 0 and r[60] == 0  # nothing at midnight / 15:00
    assert r[17 * 4 + 2] > 0  # evening commute bump


def test_expected_daily_orders_in_range_over_five_seeds():
    counts = []
    for seed in range(5):
        w = World(policy="B", seed=seed, scenario="weekday_normal")
        w.run()
        counts.append(w.daily_kpis[0]["orders"])
    mean = sum(counts) / 5
    assert 290 <= mean <= 400, counts


def test_weekend_busier_than_weekday():
    wk = World(policy="B", seed=3, scenario="weekday_normal")
    we = World(policy="B", seed=3, scenario="weekend_brunch")
    wk.run()
    we.run()
    assert we.daily_kpis[0]["orders"] > 0.95 * wk.daily_kpis[0]["orders"]
    e = expected_daily_parties(wk.cfg, "weekend")
    assert e["leisurely"] > expected_daily_parties(wk.cfg, "weekday")["leisurely"]


def test_rain_lowers_dine_in_and_raises_delivery_demand():
    dry = World(policy="A", seed=4, scenario="weekday_normal")
    rainy = World(policy="A", seed=4, scenario="rainy_delivery_surge")
    for w in (dry, rainy):
        w.run_until(7 * 3600 + 5)
    # force the same rainy weather plan on the dry world for an apples-to-apples static multiplier
    dry.weather_plan = dict.fromkeys(range(7, 23), "rain")
    m_rain = dry._static_mult(0)
    dry.weather_plan = dict.fromkeys(range(7, 23), "sunny")
    m_sun = dry._static_mult(0)
    s = 4 * 12  # noon
    assert m_rain["delivery_home"][s] > 1.4 * m_sun["delivery_home"][s]
    assert m_rain["leisurely"][s] < 0.85 * m_sun["leisurely"][s]
    assert rainy.scenario.demand.persona_mult["delivery_home"] == 1.5


def test_rainy_scenario_produces_more_delivery_orders():
    a = World(policy="B", seed=9, scenario="weekday_normal")
    b = World(policy="B", seed=9, scenario="rainy_delivery_surge")
    a.run()
    b.run()

    def agg(w):
        o = w.daily_kpis[0]["orders_by_channel"]
        return o.get("zomato", 0) + o.get("swiggy", 0)

    assert agg(b) > 1.3 * agg(a)


# ----------------------------------------------------------------- choice
def test_choice_probs_sum_to_one_and_hidden_never_chosen():
    w = World(policy="A", seed=2)
    w.run_until(9 * 3600)
    w.set_hidden("cappuccino", True, "owner", "test", "x")
    w.ensure_choice_ctx()
    for p in w.cfg.personas:
        po, pr = w.choice.probs(p, "drink")
        assert abs(po + pr.sum() - 1) < 1e-9
        assert pr[w.choice.skus.index("cappuccino")] == 0
        po, pr = w.choice.probs(p, "food", with_outside=False)
        assert abs(pr.sum() - 1) < 1e-9
    rng = np.random.default_rng(0)
    picks = {w.choice.choose("commuter", "drink", rng.gumbel(size=24), True) for _ in range(500)}
    assert w.choice.skus.index("cappuccino") not in picks


def _share(w, persona, sku, mult):
    j = w.choice.skus.index(sku)
    lnr = np.zeros(len(w.choice.skus))
    lnr[j] = np.log(mult)
    w.choice.set_context(
        lnr, np.zeros_like(lnr), np.ones(len(lnr), dtype=bool), np.zeros_like(lnr), np.zeros_like(lnr)
    )
    return w.choice.probs(persona, "drink")[1][j]


def test_raising_price_lowers_share_monotone_and_loss_aversion():
    w = World(policy="A", seed=2)
    shares = [_share(w, "student", "latte", m) for m in (0.8, 0.9, 1.0, 1.1, 1.2)]
    assert all(a > b for a, b in zip(shares, shares[1:], strict=False))
    base = shares[2]
    # +10% hurts more than -10% helps (loss aversion)
    assert (base - shares[3]) > (shares[1] - base)


def test_outside_option_is_about_five_percent(cafe_cfg):
    w = World(policy="A", seed=2)
    w.ensure_choice_ctx()
    w.choice.set_context(*(np.zeros(23),) * 2, np.ones(23, dtype=bool), np.zeros(23), np.zeros(23))
    for p in cafe_cfg.personas:
        po, _ = w.choice.probs(p, "drink")
        assert 0.04 < po < 0.06
