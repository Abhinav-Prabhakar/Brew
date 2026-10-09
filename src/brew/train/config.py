"""Training / evaluation pipeline configuration (``configs/train/*.yaml``)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field

from brew.config.loader import repo_root


class _C(BaseModel):
    model_config = ConfigDict(extra="allow")


class RunSpec(_C):
    policy: str = "B"
    seed: int = 101
    days: int = 14
    scenario: str | None = None


class PriceExpCfg(_C):
    """CRN price experiment: ``groups`` seeds x ``variants`` random price vectors, one day each."""

    groups: int = 16
    variants: int = 4
    seed: int = 500
    policy: str = "B"


class HistoryCfg(_C):
    scenario: str = "weekday_normal"
    runs: list[RunSpec] = Field(default_factory=lambda: [RunSpec()])
    price_explore_prob: float = 0.8  # share of SKUs given a random price level each day
    premake_explore: bool = True
    ladder_explore: bool = True
    price_experiment: PriceExpCfg = PriceExpCfg()


class ForecastCfg(_C):
    n_estimators: int = 120
    folds: int = 3
    test_days: int = 2
    min_history: int = 7


class ElasticityCfg(_C):
    alpha: float = 1e-3
    shrink_k: float = 200.0


class QuantileModelCfg(_C):
    n_estimators: int = 80
    min_rows: int = 200


class TextCfg(_C):
    source: str = "clean"  # clean | fixtures
    test_size: float = 0.25
    seed: int = 0


class EvalCfg(_C):
    policies: list[str] = Field(default_factory=lambda: ["A", "B", "C"])
    seeds: list[int] = Field(default_factory=lambda: [1, 2, 3])
    days: int = 1
    scenario: str = "weekday_normal"
    replate_ab: bool = True
    workers: int = 0  # 0 = sequential


class BCCfg(_C):
    """Behaviour cloning of Policy C (docs/implementation-spec.md 13.5)."""

    days: int = 5  # days of Policy C rolled out (smoke 5, full 200)
    episode_days: int = 5
    epochs: int = 60
    batch_size: int = 256
    lr: float = 1e-3
    gamma: float = 0.99
    seed: int = 900
    workers: int | str = 1  # teacher rollouts in parallel (<= 2 on the laptop; 'auto' = min(16, cpu - 2))
    scenarios: list[str] = Field(default_factory=lambda: ["weekday_normal"])
    domain_randomisation: bool = False


class CurriculumStage(_C):
    days: int = 1  # episode length in sim days
    frac: float = 1.0  # share of total_timesteps
    shaping: float = 1.0  # shaping_scale (reward penalties) during the stage


class RLEvalCfg(_C):
    every: int = 5000  # env steps between evaluations (also one before training starts)
    seeds: int = 3  # held-out seeds base_seed .. base_seed + seeds - 1
    days: int = 1
    scenario: str = "weekday_normal"
    base_seed: int = 1000
    workers: int | str = 1  # parallel eval envs (SubprocVecEnv when > 1)


class PPOCfg(_C):
    """MaskablePPO (sb3-contrib), MlpPolicy, curriculum over episode length."""

    total_timesteps: int = 20000
    n_envs: int | str = 4  # int or "auto" = min(16, cpu - 2)
    vec: str = "dummy"  # dummy | subproc
    n_steps: int = 128
    batch_size: int = 256
    n_epochs: int = 10
    gamma: float = 0.99
    gae_lambda: float = 0.95
    lr_start: float = 3e-4
    lr_end: float = 3e-4
    ent_coef: float = 0.01
    clip_range: float = 0.2
    vf_coef: float = 0.5
    max_grad_norm: float = 0.5
    target_kl: float | None = None  # stop a PPO update early once the approximate KL exceeds 1.5 x this
    critic_warmup_updates: int = 0  # after BC: train only the value head for this many updates (calibrates V)
    net_arch: list[int] = Field(default_factory=lambda: [256, 256])
    curriculum: list[CurriculumStage] = Field(default_factory=lambda: [CurriculumStage()])
    eval: RLEvalCfg = RLEvalCfg()
    checkpoint_every: int = 10000
    scenarios: list[str] = Field(default_factory=lambda: ["weekday_normal"])
    domain_randomisation: bool = False
    chaos: str = "none"  # none | random | mix
    seed: int = 0


class AdvCfg(_C):
    """RARL: alternate k adversary / protagonist iterations (docs/implementation-spec.md 13.5)."""

    total_timesteps: int = 5000  # adversary env steps over all iterations
    iterations: int = 2  # k
    protagonist_steps: int = 1024  # protagonist PPO steps per iteration (vs the frozen adversary mix)
    n_envs: int | str = 2
    n_steps: int = 128
    batch_size: int = 128
    lr: float = 3e-4
    ent_coef: float = 0.02
    chaos_mix: list[float] = Field(default_factory=lambda: [0.5, 0.3, 0.2])  # random / adversary / calm
    scenario: str = "weekday_normal"
    days: int = 1
    vec: str = "dummy"
    seed: int = 7


class ExportCfg(_C):
    parity_obs: int = 256
    parity_tol: float = 1e-4
    surrogate_depth: int = 4
    surrogate_days: int = 2  # days of policy rollout used to fit the surrogate tree
    surrogate_seeds: int = 2
    version: str = ""  # default: <config name>-<git sha>


class FinalEvalCfg(_C):
    policies: list[str] = Field(default_factory=lambda: ["A", "B", "C", "D"])
    seeds: list[int] = Field(default_factory=lambda: [1, 2, 3])
    days: int | list[int] = 3  # one arena per entry
    scenario: str = "weekday_normal"
    workers: int = 1


class TrainConfig(_C):
    name: str = "smoke"
    runs_dir: str = "data/runs"
    models_dir: str = "models"
    history: HistoryCfg = HistoryCfg()
    forecast: ForecastCfg = ForecastCfg()
    elasticity: ElasticityCfg = ElasticityCfg()
    prep_time: QuantileModelCfg = QuantileModelCfg()
    rider_eta: QuantileModelCfg = QuantileModelCfg()
    replate_model: QuantileModelCfg = QuantileModelCfg()
    text: TextCfg = TextCfg()
    eval: EvalCfg = EvalCfg()
    bc: BCCfg = BCCfg()
    ppo: PPOCfg = PPOCfg()
    adversarial: AdvCfg = AdvCfg()
    export: ExportCfg = ExportCfg()
    final_eval: FinalEvalCfg = FinalEvalCfg()
    device: str = "auto"

    def run_dir(self) -> Path:
        p = Path(self.runs_dir)
        return p if p.is_absolute() else repo_root() / p

    def models_path(self) -> Path:
        p = Path(self.models_dir)
        return p if p.is_absolute() else repo_root() / p


def resolve_n_envs(n: int | str) -> int:
    """``auto`` = min(16, cpu - 2), never below 1."""
    import os

    if isinstance(n, str):
        if n != "auto":
            return max(1, int(n))
        return max(1, min(16, (os.cpu_count() or 4) - 2))
    return max(1, int(n))


def load_train_config(path: str | Path) -> TrainConfig:
    p = Path(path)
    if not p.is_absolute() and not p.exists():
        p = repo_root() / p
    raw: dict[str, Any] = yaml.safe_load(p.read_text()) or {}
    return TrainConfig(**raw)
