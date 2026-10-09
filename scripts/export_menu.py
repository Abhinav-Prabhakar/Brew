"""Write design/data/menu.js (window.BREW_MENU) from configs/cafe — run: uv run python scripts/export_menu.py"""

import json
from pathlib import Path

from brew.config.loader import load_cafe, repo_root

c = load_cafe()
menu = [
    {
        "sku": m.sku, "name": m.name, "cat": m.cat, "price": m.base_price, "min": m.min_price, "max": m.max_price,
        "staple": m.staple, "desc": m.desc, "veg": m.veg, "vegan": m.vegan, "allergens": list(m.allergens),
        "co2e_g": m.co2e_g, "temp": m.temp, "deliverable": m.deliverable,
        "replate_eligible": bool(m.replate and m.replate.eligible),
    }
    for m in c.menu
]
combos = [
    {"id": x.id, "name": x.name, "skus": list(x.skus), "discount_pct": x.discount_pct, "tagline": x.tagline}
    for x in c.combos.combos
]
modifiers = {
    x.id: {"label": x.label, "long": x.long, "allergy": bool(getattr(x, "allergy", False))} for x in c.modifiers
}
data = {
    "_note": "static catalogue from configs/cafe; live prices/state come from GET /api/v1/worlds/{id}/state",
    "menu": menu, "combos": combos, "combo_round_to": c.combos.round_to, "modifiers": modifiers,
}
out = Path(repo_root()) / "design" / "data" / "menu.js"
out.write_text(
    "/* generated from configs/cafe (menu.yaml, combos.yaml, modifiers.yaml) by scripts/export_menu.py — do not edit by hand */\n"
    "window.BREW_MENU = " + json.dumps(data, indent=1, ensure_ascii=False) + ";\n"
)
print(f"wrote {out} ({len(menu)} items, {len(combos)} combos)")
