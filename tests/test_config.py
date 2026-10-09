from __future__ import annotations

import shutil
from pathlib import Path

import pytest
import yaml

from brew.config.loader import (
    ConfigError,
    default_cafe,
    list_scenarios,
    load_cafe,
    load_policies,
    load_scenario,
    repo_root,
)


def test_loads_and_counts():
    cfg = default_cafe()
    assert len(cfg.menu) == 23
    assert len(cfg.modifiers) == 12
    assert {t.id for t in cfg.tables.tables} == {f"T{i}" for i in range(1, 7)}
    assert ("T1", "T2") in cfg.tables.combinable
    assert len(cfg.personas) == 9
    assert len(list_scenarios()) == 8
    assert len(cfg.channels) >= 4


def test_every_sku_has_recipe_and_prices_in_bounds():
    cfg = default_cafe()
    for m in cfg.menu:
        assert m.sku in cfg.recipes.recipes
        assert m.min_price <= m.base_price <= m.max_price
        assert m.base_price % 5 == 0
    assert [m.sku for m in cfg.menu][:15] == [
        "cappuccino",
        "flatwhite",
        "icedlatte",
        "coldbrew",
        "chai",
        "matcha",
        "hotchoc",
        "rosemilk",
        "croissant",
        "muffin",
        "cheesecake",
        "cinnamon",
        "avotoast",
        "sandwich",
        "cheesetoast",
    ]
    assert {m.sku for m in cfg.menu if m.staple} == {"chai", "filtercoffee"}


def test_scenarios_and_policies_load():
    for k in list_scenarios():
        assert load_scenario(k).key == k
    pol = load_policies()
    assert {"fcfs", "edf", "dine_first", "delivery_jit", "batch_max", "throughput"} <= set(
        pol.strategies.presets
    )
    assert set(pol.strategies.manual) == {"balanced", "delivery_first", "rush_menu", "happy_hour"}


def test_broken_reference_rejected(tmp_path: Path):
    dst = tmp_path / "cafe"
    shutil.copytree(repo_root() / "configs" / "cafe", dst)
    f = dst / "recipes.yaml"
    d = yaml.safe_load(f.read_text())
    d["recipes"]["cappuccino"]["components"][1]["ingredient"] = "unobtainium"
    f.write_text(yaml.safe_dump(d))
    with pytest.raises(ConfigError, match="unobtainium"):
        load_cafe(dst)


def test_missing_recipe_rejected(tmp_path: Path):
    dst = tmp_path / "cafe"
    shutil.copytree(repo_root() / "configs" / "cafe", dst)
    f = dst / "recipes.yaml"
    d = yaml.safe_load(f.read_text())
    del d["recipes"]["pasta"]
    f.write_text(yaml.safe_dump(d))
    with pytest.raises(ConfigError, match="pasta"):
        load_cafe(dst)
