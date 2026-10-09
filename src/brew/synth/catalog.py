"""Supplier-catalogue calibration from the LLM ``supplier_catalog`` dataset (backend.md 8, inventory seed).

``calibrate_suppliers`` returns a *new* frozen :class:`CafeConfig` whose supplier items take the pack size,
price and minimum order of the catalogue row for the same ingredient (when the unit of measure matches), and
whose supplier lead times are blended with the catalogue's local / distance information.  The default cafe
config is untouched - pass the result to ``World(cfg=...)`` to run on the calibrated seed.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from brew.config.schemas import CafeConfig, Supplier, SupplierItem

from .loaders import _rows, clean_dir


def load_supplier_rows(path: str | Path | None = None) -> list[dict[str, Any]]:
    """Rows of ``supplier_catalog.jsonl`` (empty when the dataset is absent)."""
    return _rows(clean_dir(path) / "supplier_catalog.jsonl")


def calibrate_suppliers(cfg: CafeConfig, rows: list[dict[str, Any]] | None = None, blend: float = 0.5) -> CafeConfig:
    """Apply catalogue packs / prices / MOQs and blend each supplier's lead time toward the catalogue mean.

    ``blend`` is the weight of the catalogue (0 = keep the seed, 1 = catalogue only).
    """
    rows = load_supplier_rows() if rows is None else rows
    by_ing = {r["ingredient"]: r for r in rows}
    if not by_ing:
        return cfg
    new_suppliers = []
    for s in cfg.suppliers:
        items = []
        leads: list[float] = []
        for it in s.items:
            r = by_ing.get(it.ingredient)
            if r is not None and r["pack_uom"] == it.pack_uom:
                items.append(
                    SupplierItem(
                        ingredient=it.ingredient, pack_size=float(r["pack_size"]), pack_uom=it.pack_uom,
                        price=float(r["price_inr"]), moq_packs=int(r["min_order_packs"]),
                    )
                )
                leads.append(float(r["lead_time_h_mean"]))
            else:
                items.append(it)
        lead = s.lead_time_h
        if leads and not s.standing_times:
            mean_cat = sum(leads) / len(leads)
            lead = ((1 - blend) * lead[0] + blend * mean_cat, lead[1])
        new_suppliers.append(Supplier(**{**s.model_dump(), "items": tuple(items), "lead_time_h": lead}))
    return cfg.model_copy(update={"suppliers": tuple(new_suppliers)})
