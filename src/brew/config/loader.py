"""YAML -> pydantic loading with cross-reference validation."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from .schemas import (
    CATS,
    CafeConfig,
    CafeProfile,
    CalendarEvent,
    CatalogItem,
    Channel,
    CharterConfig,
    EquipmentType,
    Ingredient,
    MenuItem,
    Modifier,
    Persona,
    PoliciesConfig,
    PrepItem,
    RecipeBook,
    ScenarioConfig,
    StaffMember,
    Station,
    StrategiesConfig,
    Supplier,
    TablesConfig,
)


class ConfigError(ValueError):
    """Raised when seed data is internally inconsistent."""


def repo_root() -> Path:
    """Repository root (directory containing ``configs/``)."""
    here = Path(__file__).resolve()
    for p in [*here.parents, Path.cwd()]:
        if (p / "configs" / "cafe").is_dir():
            return p
    return Path.cwd()


def _y(path: Path) -> Any:
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _resolve(path: str | Path | None, default: str) -> Path:
    p = Path(path) if path else repo_root() / default
    if not p.is_absolute() and not p.exists():
        p = repo_root() / p
    return p


def load_cafe(path: str | Path | None = None) -> CafeConfig:
    """Load and validate ``configs/cafe`` into a frozen :class:`CafeConfig`."""
    d = _resolve(path, "configs/cafe")
    personas_raw = _y(d / "personas.yaml")
    personas = {k: Persona(key=k, **v) for k, v in personas_raw.items()}
    mods = _y(d / "modifiers.yaml")
    cfg = CafeConfig(
        cafe=CafeProfile(**_y(d / "cafe.yaml")),
        menu=tuple(MenuItem(**m) for m in _y(d / "menu.yaml")),
        modifiers=tuple(Modifier(**m) for m in mods["modifiers"]),
        incompatible=tuple(tuple(p) for p in mods.get("incompatible", [])),
        recipes=RecipeBook(**_y(d / "recipes.yaml")),
        ingredients=tuple(Ingredient(**i) for i in _y(d / "ingredients.yaml")),
        prep_items=tuple(PrepItem(**i) for i in _y(d / "prep_items.yaml")),
        suppliers=tuple(Supplier(**s) for s in _y(d / "suppliers.yaml")),
        staff=tuple(StaffMember(**s) for s in _y(d / "staff.yaml")),
        equipment=tuple(EquipmentType(**e) for e in _y(d / "equipment.yaml")),
        stations=tuple(Station(**s) for s in _y(d / "stations.yaml")),
        tables=TablesConfig(**_y(d / "tables.yaml")),
        channels=tuple(Channel(**c) for c in _y(d / "channels.yaml")),
        personas=personas,
        catalog=tuple(CatalogItem(**c) for c in _y(d / "catalog.yaml")),
        calendar_fallback=tuple(CalendarEvent(**c) for c in _y(d / "calendar_fallback.yaml")),
    )
    validate_cafe(cfg)
    return cfg


def validate_cafe(cfg: CafeConfig) -> None:
    """Cross-reference checks; raises :class:`ConfigError` listing every problem."""
    errs: list[str] = []
    skus = {m.sku for m in cfg.menu}
    if len(skus) != len(cfg.menu):
        errs.append("duplicate SKU in menu")
    ings = {i.key for i in cfg.ingredients}
    preps = {p.key for p in cfg.prep_items}
    stations = {s.key for s in cfg.stations}
    equip = {e.key for e in cfg.equipment}
    pools = set(cfg.cafe.dish_pool)
    stock_keys = ings | preps
    mods = {m.id for m in cfg.modifiers}
    channels = {c.key for c in cfg.channels}

    for m in cfg.menu:
        if m.sku not in cfg.recipes.recipes:
            errs.append(f"menu item {m.sku} has no recipe")
        if m.station not in stations:
            errs.append(f"menu item {m.sku}: unknown station {m.station}")
    for sku in cfg.recipes.recipes:
        if sku not in skus:
            errs.append(f"recipe {sku} has no menu item")

    def comp_ok(ctx: str, ingredient: str, returnable: bool = False) -> None:
        if returnable:
            if ingredient not in pools:
                errs.append(f"{ctx}: returnable {ingredient} not in dish_pool")
        elif ingredient not in stock_keys:
            errs.append(f"{ctx}: unknown ingredient/prep item {ingredient}")

    for grp, comps in cfg.recipes.packaging.items():
        for c in comps:
            comp_ok(f"packaging.{grp}", c.ingredient, c.returnable)
    for sku, r in cfg.recipes.recipes.items():
        if r.pack and r.pack not in cfg.recipes.packaging:
            errs.append(f"recipe {sku}: unknown pack group {r.pack}")
        for c in r.components:
            comp_ok(f"recipe {sku}", c.ingredient, c.returnable)
        names = [s.name for s in r.steps]
        if len(set(names)) != len(names):
            errs.append(f"recipe {sku}: duplicate step names")
        for s in r.steps:
            if s.station not in stations:
                errs.append(f"recipe {sku}.{s.name}: unknown station {s.station}")
            for dep in s.depends_on or ():
                if dep not in names:
                    errs.append(f"recipe {sku}.{s.name}: unknown dependency {dep}")
            if s.batchable and s.max_batch < 2:
                errs.append(f"recipe {sku}.{s.name}: batchable needs max_batch>=2")
    for p in cfg.prep_items:
        for c in p.components:
            comp_ok(f"prep {p.key}", c.ingredient)
        for pst in p.steps:
            if pst.station not in stations:
                errs.append(f"prep {p.key}: unknown station {pst.station}")
    if ings & preps:
        errs.append(f"keys both ingredient and prep item: {sorted(ings & preps)}")
    for stn in cfg.stations:
        for eq in stn.equipment:
            if eq not in equip:
                errs.append(f"station {stn.key}: unknown equipment {eq}")
    for et in cfg.equipment:
        if et.station not in stations:
            errs.append(f"equipment {et.key}: unknown station {et.station}")
    for md in cfg.modifiers:
        for sk_ in md.applies_to:
            if sk_ not in skus:
                errs.append(f"modifier {md.id}: unknown sku {sk_}")
        for d in md.recipe_delta:
            for k in (d.replace or {}).values():
                if k not in stock_keys:
                    errs.append(f"modifier {md.id}: unknown ingredient {k}")
            if d.add and d.add.get("ingredient") not in stock_keys:
                errs.append(f"modifier {md.id}: unknown ingredient {d.add.get('ingredient')}")
    for a, b in cfg.incompatible:
        if a not in mods or b not in mods:
            errs.append(f"incompatible pair {a},{b} references unknown modifier")
    for sup in cfg.suppliers:
        for it in sup.items:
            if it.ingredient not in ings:
                errs.append(f"supplier {sup.key}: unknown ingredient {it.ingredient}")
    supplied = {it.ingredient for s in cfg.suppliers for it in s.items}
    for i in cfg.ingredients:
        if i.key not in supplied:
            errs.append(f"ingredient {i.key} has no supplier")
    for st in cfg.staff:
        for sk in st.skills:
            if sk not in stations:
                errs.append(f"staff {st.key}: unknown station skill {sk}")
    for k, per in cfg.personas.items():
        for key in per.affinity:
            if key not in skus and key not in CATS:
                errs.append(f"persona {k}: affinity {key} is not a sku/category")
        for ch in per.channels:
            if ch not in channels:
                errs.append(f"persona {k}: unknown channel {ch}")
        for dt in ("weekday", "weekend"):
            if dt not in per.arrivals:
                errs.append(f"persona {k}: missing {dt} arrivals")
        if abs(sum(per.party_size.values()) - 1) > 1e-6:
            errs.append(f"persona {k}: party_size must sum to 1")
        if abs(sum(per.channels.values()) - 1) > 1e-6:
            errs.append(f"persona {k}: channels must sum to 1")
    for md in cfg.modifiers:
        for k in md.pick_prob:
            if k != "default" and k not in cfg.personas:
                errs.append(f"modifier {md.id}: pick_prob persona {k} unknown")
    tids = {t.id for t in cfg.tables.tables}
    for a, b in cfg.tables.combinable:
        if a not in tids or b not in tids:
            errs.append(f"combinable tables {a},{b} unknown")
    if errs:
        raise ConfigError("invalid cafe config:\n  - " + "\n  - ".join(errs))


@lru_cache(maxsize=8)
def _cached(path: str) -> CafeConfig:
    return load_cafe(path)


def default_cafe() -> CafeConfig:
    """Process-wide cached default cafe config (frozen, safe to share)."""
    return _cached(str(_resolve(None, "configs/cafe")))


def weather_profiles(path: str | Path | None = None) -> dict[str, dict[str, dict[str, float]]]:
    d = _resolve(path, "configs/scenarios")
    return _y(d / "weather_profiles.yaml")


def load_scenario(key: str, path: str | Path | None = None) -> ScenarioConfig:
    d = _resolve(path, "configs/scenarios")
    f = d / f"{key}.yaml"
    if not f.exists():
        raise ConfigError(f"unknown scenario {key!r}")
    return ScenarioConfig(**_y(f))


def list_scenarios(path: str | Path | None = None) -> list[str]:
    d = _resolve(path, "configs/scenarios")
    return sorted(p.stem for p in d.glob("*.yaml") if p.stem != "weather_profiles")


def load_policies(path: str | Path | None = None) -> PoliciesConfig:
    d = _resolve(path, "configs/policies")
    params = {}
    for code in "ABCDE":
        f = d / f"{code}.yaml"
        if f.exists():
            params[code] = _y(f)
    return PoliciesConfig(
        strategies=StrategiesConfig(**_y(d / "strategies.yaml")),
        charter=CharterConfig(**_y(d / "charter.yaml")),
        params=params,
    )


@lru_cache(maxsize=4)
def default_policies() -> PoliciesConfig:
    return load_policies()
