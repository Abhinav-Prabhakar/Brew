from __future__ import annotations

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from brew.config.loader import default_cafe
from brew.sim.state import T_DONE
from brew.sim.world import World

MAX_ATTENTION = 1.5  # 1.0 active attention + 0.5 passive monitoring (see kitchen._fits)


def check_invariants(w: World) -> None:
    k = w.kitchen
    for s in k.staff_list:
        assert -1e-9 <= s.attention_used <= MAX_ATTENTION + 1e-9, (s.key, s.attention_used)
        tot = 0.0
        seen_batches = set()
        for t in s.active:
            key = t.batch_id or id(t)
            if key in seen_batches:
                continue
            seen_batches.add(key)
            tot += t.attention
        assert abs(tot - s.attention_used) < 1e-6
    for e in w.equip:
        assert 0 <= e.slots_used <= max(e.slots, 0), (e.key, e.slots_used, e.slots)
    for st_ in k.stations.values():
        assert len(st_.staff_active) <= st_.max_staff, st_.key


@pytest.fixture(scope="module")
def cfg():
    return default_cafe()


def _variant(cfg, slots: int, speed: float, error: float, drop_barista: bool):
    equip = tuple(
        e.model_copy(update={"slots": max(1, min(e.slots, slots))} if e.slots else {}) for e in cfg.equipment
    )
    staff = tuple(
        s.model_copy(update={"speed": speed, "error_rate": error})
        for s in cfg.staff
        if not (drop_barista and s.key == "barista_b")
    )
    return cfg.model_copy(update={"equipment": equip, "staff": staff})


@pytest.mark.property
@settings(max_examples=8, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(
    seed=st.integers(0, 10_000),
    slots=st.integers(1, 3),
    speed=st.floats(0.6, 1.6),
    error=st.floats(0.0, 0.4),
    drop=st.booleans(),
)
def test_capacity_never_exceeded_random_configs(cfg, seed, slots, speed, error, drop):
    w = World(cfg=_variant(cfg, slots, speed, error, drop), policy="B", seed=seed)
    eng = w.engine
    n = 0
    while eng.step(w._dispatch):
        n += 1
        if n % 7 == 0:
            check_invariants(w)
    check_invariants(w)
    assert n > 1000


def test_dependencies_respected(small_world):
    w = small_world(seed=3, policy="A")
    orig = w.kitchen.try_start

    def spy(tasks):
        for t in tasks:
            if t.unit is not None:
                assert t.deps_left == 0
                for other in t.unit.tasks:
                    if t in other.children:
                        assert other.state == T_DONE
        return orig(tasks)

    w.kitchen.try_start = spy
    w.run()


def test_batch_time_formula(small_world):
    w = small_world(seed=3, policy="A")
    w.run_until(7 * 3600 + 31 * 60)
    k = w.kitchen
    for s in k.staff_list:
        s.speed = 1.0
        s.fatigue = 0.0
        s.exp_days = 1e9  # learning factor -> 1
    ts = [
        k.add_service_task("step", "steam", "espresso", 30.0, 0.0, 0.5, ref=None)
        for _ in range(3)
    ]  # fmt: skip
    for t in ts:
        t.batchable, t.max_batch, t.batch_factor = True, 3, 0.35
    assert k.try_start(ts)
    dur = ts[0].end_s - ts[0].start_s
    assert dur == pytest.approx(30.0 * (1 + 0.35 * 2), rel=1e-3)
    ev = [e for e in w.test_sink.events if e.type == "batch.started"]
    assert ev and ev[-1].data["size"] == 3


def test_errors_cause_remakes_and_extra_consumption(cfg):
    base = World(cfg=_variant(cfg, 2, 1.0, 0.0, False), policy="A", seed=5)
    bad = World(cfg=_variant(cfg, 2, 1.0, 0.9, False), policy="A", seed=5)
    base.run()
    bad.run()
    assert sum(o.remakes for o in bad.orders.archive) > 5
    assert sum(o.remakes for o in base.orders.archive) == 0
    # consumption per order is higher when remaking
    per_base = base.inv.mov["coffee_beans"]["consume"] / max(1, base.daily_kpis[0]["orders"])
    per_bad = bad.inv.mov["coffee_beans"]["consume"] / max(1, bad.daily_kpis[0]["orders"])
    assert per_bad > per_base


def test_dish_pit_can_block(cfg):
    tiny = cfg.model_copy(
        update={"cafe": cfg.cafe.model_copy(update={"dish_pool": {"cup_ceramic_m": 3, "plate": 2}})}
    )
    w = World(cfg=tiny, policy="A", seed=5)
    w.run()
    assert w.kitchen.wait_by_reason.get("dishpit", 0) > 0


def test_batching_b_batches_more_than_a(day_a, day_b):
    assert day_b.daily_kpis[0]["batch_rate"] > day_a.daily_kpis[0]["batch_rate"] == 0
    assert any(e.type == "batch.started" for e in day_b.test_sink.events)


def test_kitchen_load_in_range(day_b):
    ticks = [e.data["load_pct"] for e in day_b.test_sink.of_type("kpi.tick")]
    assert max(ticks) > 5 and all(0 <= x <= 100 for x in ticks)
