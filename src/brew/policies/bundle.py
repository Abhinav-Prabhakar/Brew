"""Champion model bundle used by policies C / E (all members optional - built-in fallbacks everywhere)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from brew.models.registry import ModelRegistry


@dataclass
class ModelBundle:
    """Loaded champions: forecaster, elasticity, replate sell-through, prep-time and rider-ETA models."""

    forecaster: Any = None
    elasticity: Any = None
    sellthrough: Any = None
    prep_time: Any = None
    rider_eta: Any = None
    root: str = ""

    def loaded(self) -> list[str]:
        return [k for k in ("forecaster", "elasticity", "sellthrough", "prep_time", "rider_eta") if getattr(self, k)]


_CACHE: dict[tuple[str, float], ModelBundle] = {}


def load_bundle(models_dir: str | Path | None = None, use_models: bool = True) -> ModelBundle:
    """Load the champion artifacts under ``models_dir`` (default ``<repo>/models``); cached per registry file."""
    reg = ModelRegistry(models_dir)
    idx = reg.root / "registry.json"
    if not use_models or not idx.exists():
        return ModelBundle(root=str(reg.root))
    key = (str(reg.root), idx.stat().st_mtime)
    hit = _CACHE.get(key)
    if hit is not None:
        return hit
    b = ModelBundle(root=str(reg.root))
    try:
        from brew.forecast.lgbm import Forecaster

        p = reg.champion("forecast")
        if p is not None:
            b.forecaster = Forecaster.load(p)
    except Exception:  # pragma: no cover - a broken artifact must not break the policy
        b.forecaster = None
    try:
        from brew.models.elasticity import ElasticityModel

        p = reg.champion("elasticity")
        if p is not None:
            b.elasticity = ElasticityModel.load(p)
    except Exception:  # pragma: no cover
        b.elasticity = None
    try:
        from brew.models.replate_model import SellThroughModel

        p = reg.champion("replate")
        if p is not None:
            b.sellthrough = SellThroughModel.load(p)
    except Exception:  # pragma: no cover
        b.sellthrough = None
    try:
        from brew.models.prep_time import PrepTimeModel

        p = reg.champion("prep_time")
        if p is not None:
            b.prep_time = PrepTimeModel.load(p)
    except Exception:  # pragma: no cover
        b.prep_time = None
    try:
        from brew.models.rider_eta import RiderEtaModel

        p = reg.champion("rider_eta")
        if p is not None:
            b.rider_eta = RiderEtaModel.load(p)
    except Exception:  # pragma: no cover
        b.rider_eta = None
    _CACHE[key] = b
    return b
