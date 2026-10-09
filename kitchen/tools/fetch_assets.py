"""Fetch + optimise the CC0 assets for the Night Kitchen frontend.

    uv run kitchen/tools/fetch_assets.py            # everything
    uv run kitchen/tools/fetch_assets.py models     # one group (hdri | tex | models | city)

Raw downloads land in kitchen/assets/_src (git-ignored); optimised outputs
(WebP textures, meshopt-compressed GLBs) land in kitchen/assets/{hdri,tex,models}.
Needs: curl-free stdlib, `cwebp`, `ffmpeg`, and `npx` (for @gltf-transform/cli).
"""
from __future__ import annotations

import json
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "assets"
SRC = ROOT / "_src"
API = "https://api.polyhaven.com/files/"
UA = {"User-Agent": "brew-kitchen-asset-fetch/1.0"}

# id -> (resolution, map keys)
TEXTURES = {
    "herringbone_parquet": "1k",   # dining floor
    "dark_wooden_planks": "1k",    # wall panelling / shelves
    "black_walnut_veneer_01": "1k",  # tables, trims
    "brown_leather": "1k",         # banquettes, chairs
    "concrete_floor_worn_001": "1k",  # kitchen floor
    "grey_plaster": "1k",          # dark plaster walls / ceiling
    "long_white_tiles": "1k",      # kitchen backsplash (tinted near-black)
}
MAPS = {"Diffuse": "diff", "nor_gl": "nor", "arm": "arm"}

# id -> (glTF texture res, max texture px, simplify ratio or 0 for none)
MODELS = {
    "croissant": ("1k", 512, 0),
    "wooden_cutting_board": ("2k", 1024, 0),
    "carrot_cake": ("1k", 512, 0.5),
    "strawberry_chocolate_cake": ("1k", 512, 0.2),
    "potted_plant_02": ("1k", 1024, 0.08),
    "potted_plant_04": ("1k", 512, 0.3),
    "calathea_orbifolia_01": ("1k", 1024, 0.6),
    "anthurium_botany_01": ("1k", 1024, 0.2),
    "fern_02": ("1k", 1024, 0),
    "pachira_aquatica_01": ("1k", 1024, 0.15),
    "dining_chair_02": ("1k", 512, 0.08),
    "round_wooden_table_02": ("1k", 512, 0.3),
    "hanging_industrial_lamp": ("1k", 512, 0.5),
    "modern_ceiling_lamp_01": ("1k", 512, 0),
    "wine_bottles_01": ("1k", 512, 0.4),
    "lemon": ("1k", 256, 0.5),
    "food_lime_01": ("1k", 256, 0.3),
    "yellow_onion": ("1k", 256, 0.4),
    "food_avocado_01": ("1k", 256, 0.4),
    "metal_jug": ("1k", 512, 0),
    "ceramic_vase_01": ("1k", 512, 0.3),
}

HDRIS = {"warm_restaurant_night": "1k"}


def get(url: str, dest: Path) -> Path:
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    print("  ↓", url.rsplit("/", 1)[-1])
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA)) as r, open(dest, "wb") as f:
        while chunk := r.read(1 << 16):
            f.write(chunk)
    return dest


def files(asset: str) -> dict:
    with urllib.request.urlopen(urllib.request.Request(API + asset, headers=UA)) as r:
        return json.load(r)


def run(*cmd: str) -> None:
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)


def fetch_hdri() -> None:
    out = ROOT / "hdri"
    out.mkdir(parents=True, exist_ok=True)
    for asset, res in HDRIS.items():
        print("hdri", asset)
        get(files(asset)["hdri"][res]["hdr"]["url"], out / f"{asset}_{res}.hdr")


def fetch_city() -> None:
    """A wide, blurred night-city strip for the windows (from a tonemapped HDRI)."""
    print("city backdrop")
    src = get(files("shanghai_bund")["tonemapped"]["url"], SRC / "shanghai_bund_tonemapped.jpg")
    out = ROOT / "tex" / "city_night.webp"
    out.parent.mkdir(parents=True, exist_ok=True)
    # the equirect's horizon band, scaled to 2048 wide
    run("ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-vf",
        "crop=iw:ih*0.32:0:ih*0.30,scale=2048:-2", "-q:v", "2", str(SRC / "city_band.jpg"))
    run("cwebp", "-quiet", "-q", "82", str(SRC / "city_band.jpg"), "-o", str(out))


def fetch_tex() -> None:
    out = ROOT / "tex"
    out.mkdir(parents=True, exist_ok=True)
    for asset, res in TEXTURES.items():
        print("tex", asset)
        f = files(asset)
        for key, short in MAPS.items():
            if key not in f:
                continue
            raw = get(f[key][res]["jpg"]["url"], SRC / "tex" / f"{asset}_{short}.jpg")
            q = "90" if short == "nor" else "84"
            run("cwebp", "-quiet", "-q", q, "-resize", "1024", "0", str(raw), "-o", str(out / f"{asset}_{short}.webp"))


def fetch_models() -> None:
    out = ROOT / "models"
    out.mkdir(parents=True, exist_ok=True)
    for asset, (res, px, ratio) in MODELS.items():
        dst = out / f"{asset}.glb"
        if dst.exists():
            continue
        print("model", asset)
        g = files(asset)["gltf"][res]["gltf"]
        d = SRC / "models" / asset
        gltf = get(g["url"], d / g["url"].rsplit("/", 1)[-1])
        for rel, meta in g["include"].items():
            get(meta["url"], d / rel)
        cmd = ["npx", "-y", "@gltf-transform/cli@4", "optimize", str(gltf), str(dst),
               "--compress", "meshopt", "--texture-compress", "webp", "--texture-size", str(px),
               "--palette", "false"]
        cmd += ["--simplify", "true", "--simplify-ratio", str(ratio), "--simplify-error", "0.01"] if ratio else ["--simplify", "false"]
        subprocess.run(cmd, check=True)



GROUPS = {"hdri": fetch_hdri, "city": fetch_city, "tex": fetch_tex, "models": fetch_models}

if __name__ == "__main__":
    for name in sys.argv[1:] or list(GROUPS):
        GROUPS[name]()
    print("done")
