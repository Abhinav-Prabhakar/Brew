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

    def run_dir(self) -> Path:
        p = Path(self.runs_dir)
        return p if p.is_absolute() else repo_root() / p

    def models_path(self) -> Path:
        p = Path(self.models_dir)
        return p if p.is_absolute() else repo_root() / p


def load_train_config(path: str | Path) -> TrainConfig:
    p = Path(path)
    if not p.is_absolute() and not p.exists():
        p = repo_root() / p
    raw: dict[str, Any] = yaml.safe_load(p.read_text()) or {}
    return TrainConfig(**raw)
