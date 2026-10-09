"""M3 (learning): env, masks, reward, behaviour cloning, ONNX parity, Policy D, explanations, adversary, CLI."""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import pytest
from gymnasium.utils.env_checker import check_env

from brew.rl import torch_setup  # noqa: F401  (import order: LightGBM / OR-tools before torch)
from brew.rl.actions import (
    D_PRICE,
    NOOP,
    NVEC,
    OFFSETS,
    default_vector,
    sanitize,
)
from brew.rl.env import BrewManagerEnv, EnvConfig
from brew.rl.masks import assert_valid
from brew.rl.reward import RewardConfig, RewardTracker, stock_value
from brew.sim.observation import NAMES
from brew.sim.world import World


# ---------------------------------------------------------------------------------- spaces
def test_spaces_match_the_spec():
    env = BrewManagerEnv(EnvConfig())
    assert list(env.action_space.nvec) == [5, 5, 5, 5, 5, 5, 5, 5, 6, 4, 4, 4, 24, 2, 2, 2, 4, 4]
    assert env.observation_space.shape == (183,) and len(NAMES) == 183
    assert sum(NVEC) == 96 and OFFSETS[-1] + NVEC[-1] == 96


def test_env_passes_gymnasium_env_checker():
    check_env(BrewManagerEnv(EnvConfig(days=1)), skip_render_check=True)


# ------------------------------------------------------------------------------- env loop
def test_env_episode_length_reward_and_info():
    env = BrewManagerEnv(EnvConfig(days=1))
    obs, info = env.reset(seed=3)
    assert obs.shape == (183,) and obs.dtype == np.float32 and info["days"] == 1
    n, done, total = 0, False, 0.0
    while not done:
        obs, r, term, trunc, info = env.step(default_vector())
        n += 1
        total += r
        done = term or trunc
        assert np.isfinite(r) and np.isfinite(obs).all()
    assert 50 <= n <= 70  # 07:00 start-of-day tick + 56 quarter hours (08:00 .. 21:45)
    k = info["kpis"]
    assert k["days"] == 1 and k["mean_profit_per_day"] > 30_000 and abs(k["episode_reward"] - total) < 1e-6
    assert set(info["reward_parts"]) == {"d_profit", "late", "walkouts", "price", "waste", "staff", "terminal"}


def test_env_is_deterministic_and_multi_day():
    def run(seed: int) -> list[float]:
        env = BrewManagerEnv(EnvConfig(days=2))
        env.reset(seed=seed)
        out, done = [], False
        while not done:
            _o, r, term, trunc, _i = env.step(default_vector())
            out.append(round(r, 9))
            done = term or trunc
        return out

    a, b, c = run(5), run(5), run(6)
    assert a == b and a != c
    assert 105 <= len(a) <= 135  # two days of ticks


def test_env_step_time_budget():
    env = BrewManagerEnv(EnvConfig(days=1))
    env.reset(seed=9)
    t0 = time.perf_counter()
    n = 0
    for _ in range(45):
        _o, _r, term, _t, _i = env.step(default_vector())
        n += 1
        if term:
            break
    assert (time.perf_counter() - t0) / n < 0.040  # docs/implementation-spec.md 17: env step < 40 ms average


def test_domain_randomisation_and_chaos_modes_change_the_world():
    env = BrewManagerEnv(EnvConfig(scenarios=("weekday_normal", "heatwave"), domain_randomisation=True))
    mults = set()
    for s in (1, 2, 3):
        env.reset(seed=s)
        assert env.world is not None
        mults.add(round(env.world.scenario.demand.global_mult, 4))
    assert len(mults) == 3
    env2 = BrewManagerEnv(EnvConfig(chaos="random"))
    env2.reset(seed=4)
    assert env2.world is not None and env2.world.scenario.random_chaos["rate_per_day"] >= 1.0
    assert env2.mode == "random"


# ----------------------------------------------------------------------------------- masks
def test_masks_are_never_all_false_over_random_valid_play():
    rng = np.random.default_rng(0)
    for scenario, seed in (("weekday_normal", 1), ("chaos_random", 2), ("rainy_delivery_surge", 3)):
        env = BrewManagerEnv(EnvConfig(scenarios=(scenario,), days=1))
        env.reset(seed=seed)
        done = False
        while not done:
            m = env.action_masks()
            assert m.shape == (96,) and m.dtype == bool and assert_valid(m)
            a = np.array([int(rng.choice(np.flatnonzero(m[o : o + n]))) for o, n in zip(OFFSETS, NVEC, strict=True)])
            _o, _r, term, trunc, _i = env.step(a)
            done = term or trunc


def test_charter_cooldown_masks_repeated_price_moves_and_shield_blocks_invalid_actions():
    env = BrewManagerEnv(EnvConfig(days=1))
    env.reset(seed=11)
    assert env.world is not None
    m0 = env.action_masks()
    up = default_vector()
    up[D_PRICE] = 3  # coffee +5 %
    assert m0[OFFSETS[D_PRICE] + 3]
    before = {s: env.world.menu[s].price for s in ("cappuccino", "latte")}
    env.step(up)
    after = {s: env.world.menu[s].price for s in ("cappuccino", "latte")}
    assert all(after[s] > before[s] for s in before)
    m1 = env.action_masks()
    assert not m1[OFFSETS[D_PRICE] + 3] and not m1[OFFSETS[D_PRICE] + 4]  # 2 h cooldown + staples cannot rise
    assert m1[OFFSETS[D_PRICE] + 2] and assert_valid(m1)
    # an invalid (masked) action is replaced by 'no change': the shield never lets it through
    s = sanitize(up, m1)
    assert s[D_PRICE] == NOOP[D_PRICE]
    _o, _r, _t, _tr, info = env.step(up)
    assert after == {s_: env.world.menu[s_].price for s_ in after}
    assert isinstance(info["clipped"], list)


# ---------------------------------------------------------------------------------- reward
def test_reward_components_follow_the_formula():
    w = World(policy="A", seed=1, days=1)
    w.run_until(7 * 3600 + 1)
    cfg = RewardConfig()
    tr = RewardTracker(w, cfg)
    tr.rebase()
    tr.cum_profit = lambda: tr.prev["profit"] + 1000.0  # type: ignore[method-assign]
    k = w.kpi
    k.cum_late_min["commuter"] += 2.0  # weight 1.5
    k.cum_late_min["student"] += 1.0
    k.cum_walkouts["regular"] += 1  # LTV 1500
    k.cum_walkouts["tourist"] += 2  # default LTV 400
    k.cum_price_changes += 3
    k.cum_waste_inr += 100.0
    k.cum_waste_kg += 5.0
    k.cum_overload_s += 120.0
    r, p = tr.step()
    assert p["d_profit"] == pytest.approx(1.0)
    assert p["late"] == pytest.approx(-6.0 * (1.5 * 2.0 + 1.0) / 1000)
    assert p["walkouts"] == pytest.approx(-(1500 + 800) / 1000)
    assert p["price"] == pytest.approx(-20.0 * 3 / 1000)
    assert p["waste"] == pytest.approx(-(100.0 + 8.0 * 2.0 * 5.0) / 1000)
    assert p["staff"] == pytest.approx(-10.0 * 2.0 / 1000)
    assert r == pytest.approx(sum(p.values()))
    # curriculum shaping anneals lateness / price churn / overload but never walkouts or waste
    tr.cfg.shaping_scale = 0.3
    k.cum_late_min["commuter"] += 2.0
    k.cum_walkouts["regular"] += 1
    k.cum_price_changes += 1
    k.cum_overload_s += 60.0
    _r2, p2 = tr.step()
    assert p2["late"] == pytest.approx(-0.3 * 6.0 * 3.0 / 1000)
    assert p2["walkouts"] == pytest.approx(-1.5)
    assert p2["price"] == pytest.approx(-0.3 * 20.0 / 1000)
    assert p2["staff"] == pytest.approx(-0.3 * 10.0 / 1000)
    # terminal: salvage of prepared stock minus open obligations
    tr.stock0 = 0.0
    _r3, p3 = tr.step(terminal=True)
    assert p3["terminal"] == pytest.approx((0.5 * stock_value(w) - 250.0 * len(w.orders.open)) / 1000)


# ---------------------------------------------------------------- behaviour cloning + ONNX
@pytest.fixture(scope="module")
def teacher():
    from brew.rl.bc import collect_teacher

    return collect_teacher(1, 1, 5, 0.99, workers=1)


def test_teacher_labels_respect_masks(teacher):
    n = len(teacher.obs)
    assert 50 <= n <= 70 and teacher.obs.shape[1] == 183 and teacher.mask.shape == (n, 96)
    for d, (o, k) in enumerate(zip(OFFSETS, NVEC, strict=True)):
        assert teacher.mask[np.arange(n), o + teacher.act[:, d]].all(), d
        assert teacher.act[:, d].max() < k


def test_bc_reduces_loss(teacher):
    from brew.rl.bc import new_model, train_bc

    model = new_model(device="cpu", seed=0)
    met = train_bc(model, teacher, epochs=30, batch_size=32, seed=0)
    assert met["loss_last"] < 0.5 * met["loss_first"]
    assert met["value_loss_last"] < met["value_loss_first"]
    assert met["accuracy"] > 0.8


def _fake_vecnorm(path: Path, seed: int = 0) -> None:
    from stable_baselines3.common.vec_env import DummyVecEnv, VecNormalize

    from brew.rl.bc import SpecEnv

    vn = VecNormalize(DummyVecEnv([SpecEnv]))
    rng = np.random.default_rng(seed)
    vn.obs_rms.mean = rng.normal(0, 0.3, 183)
    vn.obs_rms.var = rng.uniform(0.05, 1.5, 183)
    vn.save(str(path))


@pytest.fixture(scope="module")
def champion(tmp_path_factory, teacher):
    from brew.rl.bc import new_model, train_bc
    from brew.rl.export_onnx import parity_observations, write_champion
    from brew.rl.surrogate import Surrogate

    d = tmp_path_factory.mktemp("champ")
    model = new_model(device="cpu", seed=1)
    train_bc(model, teacher, epochs=20, batch_size=32, seed=1)
    _fake_vecnorm(d / "vn.pkl")
    par = write_champion(model, d / "vn.pkl", d / "D", {"version": "test"}, parity_observations(256, 0, teacher.obs))
    sur = Surrogate.fit(teacher.obs, teacher.act, depth=4)
    sur.save(d / "D" / "surrogate.joblib")
    return model, d / "D", par


def test_onnx_parity_on_256_random_observations(champion):
    from brew.rl.export_onnx import parity_check, parity_observations

    model, d, par = champion
    assert par["ok"] and par["max_abs_diff"] < 1e-4
    rng_obs = parity_observations(256, 7)  # purely random observations
    p2 = parity_check(model, d, rng_obs)
    assert p2["n_obs"] == 256 and p2["max_abs_diff"] < 1e-4 and p2["argmax_agreement"] == 1.0
    assert (d / "policy.onnx").stat().st_size < 5_000_000
    meta = json.loads((d / "meta.json").read_text())
    assert meta["nvec"] == NVEC and meta["obs_dim"] == 183 and len(json.loads((d / "obs_norm.json").read_text())["mean"]) == 183


def test_onnx_runtime_applies_masks(champion):
    from brew.rl.onnx_runtime import OnnxManagerModel

    _model, d, _ = champion
    rt = OnnxManagerModel.load(d)
    env = BrewManagerEnv(EnvConfig(days=1))
    obs, _ = env.reset(seed=2)
    mask = env.action_masks()
    a = rt.act(obs, mask)
    assert a.shape == (18,) and all(mask[o + a[i]] for i, o in enumerate(OFFSETS))
    # forbidding the argmax moves the choice
    lg = rt.logits(obs)[0]
    m2 = np.ones(96, bool)
    m2[int(np.argmax(lg[:5]))] = False
    assert rt.act(obs, m2)[0] != int(np.argmax(lg[:5]))


def test_policy_d_runs_a_day_in_the_arena_world(champion):
    from brew.policies.D_rl import PolicyD

    _model, d, _ = champion
    pol = PolicyD(champion=d)
    w = World(policy=pol, seed=3, days=1)
    w.run(1)
    k = w.daily_kpis[0]
    assert k["net_profit"] > 30_000 and k["orders"] > 100
    assert pol.last_vec is not None and len(pol.last_vec) == 18
    assert any(r["policy"] == "D" for r in w.decisions) or pol.last_vec is not None
    # forks (live API what-ifs) keep working: the ONNX session is rebuilt, not pickled
    w2 = World(policy=PolicyD(champion=d), seed=3, days=1)
    w2.run_until(12 * 3600)
    child = w2.fork()
    child.run(1)
    assert child.daily_kpis


def test_make_policy_d_needs_a_champion(tmp_path):
    from brew.policies.registry import make_policy

    with pytest.raises(FileNotFoundError):
        make_policy("D", models_dir=tmp_path)


# ------------------------------------------------------------------------------ explanations
def test_surrogate_explains_decisions_and_hooks_into_the_explainer(champion, teacher):
    from brew.analysis.explain import Explainer
    from brew.rl.surrogate import Surrogate

    _model, d, _ = champion
    sur = Surrogate.load(d / "surrogate.joblib")
    assert len(sur.trees) == 18 and np.mean(sur.fidelity) > 0.7
    vec = default_vector()
    vec[0] = 3  # coffee +5 %
    factors, summary = sur.explain(teacher.obs[20], vec)
    assert summary.startswith("RL manager:") and "coffee prices +5%" in summary
    assert factors and all(f["name"] in NAMES for f in factors)
    w = World(policy="A", seed=1, days=1)
    did = w.make_decision(
        "price_change", summary, "D", factors,
        changes=[{"kind": "price", "item": "latte", "old": 230, "new": 240}],
    )
    rec = next(r for r in w.decisions if r["decision_id"] == did)
    out = Explainer().explain(rec)
    assert out["policy"] == "D" and "Key drivers" in out["text"] and out["drivers"]


# ------------------------------------------------------------------------------- adversary
def test_adversary_scheduler_budget_masks_and_env():
    from brew.rl.adversary import ADV_LOGITS, ADV_NVEC, AdversaryEnv, DisruptionScheduler

    w = World(policy="A", seed=1, days=1)
    w.run_until(9 * 3600)
    sch = DisruptionScheduler()
    m = sch.mask(w)
    assert m.shape == (ADV_LOGITS,) and m[0] and m[11:15].all()
    assert sch.apply(w, np.array([3, 0, 30])) and sch.apply(w, np.array([6, 1, 40])) and sch.apply(w, np.array([9, 0, 20]))
    assert not sch.apply(w, np.array([2, 0, 20]))  # budget of 3 per day
    m = sch.mask(w)
    assert m[0] and not m[1:11].any()
    assert len(w.dis.items) >= 3
    env = AdversaryEnv(EnvConfig(days=1))
    obs, _ = env.reset(seed=1)
    assert obs.shape == (186,) and list(env.action_space.nvec) == ADV_NVEC
    for _ in range(6):
        mk = env.action_masks()
        a = np.array([1, 0, 30]) if mk[1] else np.array([0, 0, 0])
        obs, r, term, _tr, info = env.step(a)
        assert np.isfinite(r) and "budget_left" in info
    assert env.sched.used == 3  # the hits were placed


# ------------------------------------------------------------------------------------ vec
def test_vec_env_factories_and_masks():
    from brew.rl.train_ppo import build_venv

    v = build_venv(EnvConfig(days=1), 2, "dummy", 0.99)
    obs = v.reset()
    assert obs.shape == (2, 183)
    masks = np.stack(v.env_method("action_masks"))
    assert masks.shape == (2, 96)
    obs, r, d, _i = v.step(np.stack([default_vector(), default_vector()]))
    assert obs.shape == (2, 183) and r.shape == (2,)
    v.close()


# ---------------------------------------------------------------------------- CLI contract
def test_full_config_dry_run_validates():
    from typer.testing import CliRunner

    from brew.cli import train_app

    r = CliRunner().invoke(train_app, ["all", "--config", "configs/train/full.yaml", "--dry-run"])
    assert r.exit_code == 0, r.output
    out = r.output.replace("\n", " ")
    assert "13 stages" in out and "2000000" in out and "plan is valid" in out
    assert "28" in out  # the 28-day curriculum stage


def test_unknown_stage_fails_and_smoke_dry_run_lists_every_stage():
    from typer.testing import CliRunner

    from brew.cli import train_app

    assert CliRunner().invoke(train_app, ["nope", "--config", "configs/train/smoke.yaml"]).exit_code != 0
    r = CliRunner().invoke(train_app, ["all", "--config", "configs/train/smoke.yaml", "--dry-run"])
    assert r.exit_code == 0
    for s in ("history", "bc", "ppo", "adversarial", "export", "arena"):
        assert s in r.output
