from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

import pytest
from typer.testing import CliRunner

from brew.cli import synth_app
from brew.config.loader import repo_root
from brew.synth import loaders
from brew.synth.schemas import MIN_ROWS, SCHEMAS
from brew.synth.validate import status, validate_all

FIX = Path(__file__).parent / "fixtures" / "synthetic"
PROMPTS = repo_root() / "data" / "prompts"
NAMES = list(SCHEMAS)


def make_raw(tmp_path: Path, name: str, lines: list[str], fname: str = "batch_01.jsonl") -> tuple[Path, Path]:
    raw, clean = tmp_path / "raw", tmp_path / "clean"
    (raw / name).mkdir(parents=True)
    (raw / name / fname).write_text("\n".join(lines) + "\n")
    return raw, clean


def fixture_lines(name: str) -> list[str]:
    return [ln for ln in (FIX / f"{name}.jsonl").read_text().splitlines() if ln.strip()]


def test_fixtures_all_validate_and_have_expected_sizes(tmp_path):
    raw, clean = tmp_path / "raw", tmp_path / "clean"
    for n in NAMES:
        (raw / n).mkdir(parents=True)
        shutil.copy(FIX / f"{n}.jsonl", raw / n / "batch_01.jsonl")
    reports = {r.name: r for r in validate_all(None, raw, clean)}
    for n, r in reports.items():
        assert r.errors == [], (n, r.errors[:3])
        assert r.valid == r.read > 0
        assert (clean / f"{n}.jsonl").exists()
    assert reports["reviews"].valid >= 60 and reports["order_notes"].valid >= 60
    assert reports["reviews"].warnings == []  # star distribution passes (>= 10% per level)


def test_validator_rejects_bad_rows_with_line_numbers(tmp_path):
    good = fixture_lines("reviews")[:3]
    bad_json = "{not json"
    bad_star = json.dumps({**json.loads(good[0]), "id": "REV-X-1", "stars": 9})
    bad_cause = json.dumps({**json.loads(good[0]), "id": "REV-X-2", "causes": {"vibes": 0.5}})
    bad_sku = json.dumps({**json.loads(good[0]), "id": "REV-X-3", "skus_mentioned": ["pizza"]})
    short = json.dumps({**json.loads(good[0]), "id": "REV-X-4", "text": "meh"})
    heavy = json.dumps({**json.loads(good[0]), "id": "REV-X-5", "causes": {"wait": 1.0, "price": 1.0}})
    raw, clean = make_raw(
        tmp_path, "reviews", [good[0], bad_json, bad_star, good[1], bad_cause, bad_sku, short, heavy, good[2]]
    )
    [rep] = validate_all("reviews", raw, clean)
    assert rep.valid == 3 and len(rep.errors) == 6
    assert rep.errors[0].startswith("batch_01.jsonl:2:")
    assert any(e.startswith("batch_01.jsonl:3:") and "stars" in e for e in rep.errors)
    assert any("batch_01.jsonl:5:" in e and "vibes" in e for e in rep.errors)
    assert any("batch_01.jsonl:6:" in e and "pizza" in e for e in rep.errors)
    assert any("batch_01.jsonl:8:" in e and "1.5" in e for e in rep.errors)


def test_validator_tolerates_fences_blank_lines_and_arrays(tmp_path):
    lines = fixture_lines("order_notes")[:5]
    raw, clean = make_raw(tmp_path, "order_notes", ["```jsonl", "", *lines, "", "```"])
    [rep] = validate_all("order_notes", raw, clean)
    assert rep.valid == 5 and rep.errors == []
    arr = "[" + ",".join(fixture_lines("order_notes")[5:9]) + "]"
    raw2, clean2 = make_raw(tmp_path / "b", "order_notes", [arr], "batch_02.json")
    [rep2] = validate_all("order_notes", raw2, clean2)
    assert rep2.valid == 4


def test_dedupe_by_id_and_normalised_text(tmp_path):
    base = json.loads(fixture_lines("order_notes")[0])
    same_id = {**base, "text": "completely different words here"}
    same_text = {**base, "id": "NOTE-ZZ-9", "text": base["text"].upper() + "!!"}
    ok = {**base, "id": "NOTE-ZZ-10", "text": "a fresh instruction altogether"}
    raw, clean = make_raw(tmp_path, "order_notes", [json.dumps(x) for x in (base, same_id, same_text, ok)])
    [rep] = validate_all("order_notes", raw, clean)
    assert rep.valid == 2 and rep.dupes == 2 and rep.written == 2
    rows = [json.loads(ln) for ln in (clean / "order_notes.jsonl").read_text().splitlines()]
    assert [r["id"] for r in rows] == sorted(r["id"] for r in rows)


def test_distribution_check_flags_skewed_stars(tmp_path):
    base = json.loads(fixture_lines("reviews")[0])
    rows = [
        json.dumps(
            {**base, "id": f"REV-S-{i}", "text": f"Pleasant visit number {i} with lovely coffee", "stars": 5}
        )
        for i in range(40)
    ]
    raw, clean = make_raw(tmp_path, "reviews", rows)
    [rep] = validate_all("reviews", raw, clean)
    assert any("star level 1" in w for w in rep.warnings)


def test_status_reports_missing_below_minimum_ok(tmp_path):
    raw, clean = tmp_path / "raw", tmp_path / "clean"
    clean.mkdir(parents=True)
    (raw / "reviews").mkdir(parents=True)
    (raw / "reviews" / "batch_01.jsonl").write_text("x\n")
    (clean / "order_notes.jsonl").write_text("\n".join(fixture_lines("order_notes")) + "\n")
    st = {r["name"]: r for r in status(raw, clean)}
    assert st["reviews"]["state"].startswith("raw present")
    assert st["order_notes"]["state"].startswith("below minimum")
    assert st["customer_names"]["state"] == "missing"
    assert {r["min_rows"] for r in st.values()} >= {3000, 1500, 400, 600, 300}


def test_cli_validate_and_status(tmp_path):
    raw, clean = make_raw(tmp_path, "reviews", ["{broken"])
    runner = CliRunner()
    res = runner.invoke(synth_app, ["validate", "reviews", "--raw-dir", str(raw), "--clean-dir", str(clean)])
    assert res.exit_code == 1  # raw files exist but zero valid rows
    raw2, clean2 = make_raw(tmp_path / "ok", "reviews", fixture_lines("reviews"))
    res = runner.invoke(
        synth_app, ["validate", "reviews", "--raw-dir", str(raw2), "--clean-dir", str(clean2)]
    )
    assert res.exit_code == 0 and (clean2 / "reviews.jsonl").exists()
    res = runner.invoke(synth_app, ["status"])
    assert res.exit_code == 0 and "reviews" in res.output


def test_loaders_use_clean_data_when_present_else_fallback(tmp_path):
    fb = loaders.load_corpora(tmp_path / "empty")
    assert fb.source["reviews"] == "fallback" and "Riya" in fb.names and fb.notes
    clean = tmp_path / "clean"
    clean.mkdir()
    shutil.copy(FIX / "reviews.jsonl", clean / "reviews.jsonl")
    shutil.copy(FIX / "order_notes.jsonl", clean / "order_notes.jsonl")
    shutil.copy(FIX / "customer_names.jsonl", clean / "customer_names.jsonl")
    c = loaders.load_corpora(clean)
    assert c.source["reviews"] == "clean" and c.reviews.n >= 60
    assert "Thimmaiah" in c.names and any("nuts" in t[0] for t in c.notes)
    txt = c.reviews.sample(1, "wait", "offline", 0.3)
    assert txt and len(txt) > 8
    # fallback sampling still works for combos missing from the corpus
    assert fb.reviews.sample(5, "ambience", "zomato", 0.9)


def test_sim_uses_clean_corpus_when_wired(tmp_path):
    from brew.sim.world import World

    clean = tmp_path / "clean"
    clean.mkdir()
    shutil.copy(FIX / "customer_names.jsonl", clean / "customer_names.jsonl")
    shutil.copy(FIX / "reviews.jsonl", clean / "reviews.jsonl")
    corp = loaders.load_corpora(clean)
    w = World(policy="A", seed=2, corpora=corp)
    w.run()
    from brew.sim.readmodels import reviews

    names = {o.name for o in w.orders.archive}
    assert names & set(corp.names)
    texts = {r["text"] for r in reviews(w, 200)}
    fixture_texts = {json.loads(ln)["text"] for ln in fixture_lines("reviews")}
    assert texts and texts <= fixture_texts


# ------------------------------------------------------------------ prompts
REQUIRED_SECTIONS = ("## Save output to:", "## Rows per run:", "BATCH")


@pytest.mark.parametrize("name", NAMES)
def test_prompt_files_exist_and_are_self_contained(name):
    p = PROMPTS / f"{name}.md"
    assert p.exists(), p
    text = p.read_text()
    assert f"data/synthetic/raw/{name}/batch_" in text
    for s in REQUIRED_SECTIONS:
        assert s in text, (name, s)
    assert re.search(r"Target total:\s*[\d,]+", text)
    assert "JSON Lines" in text and "no code fences" in text.lower()
    assert re.search(r"(?i)schema", text) and "Example" in text
    assert len(text) > 3500


def test_prompts_inline_menu_personas_and_enums():
    from brew.config.loader import default_cafe

    cfg = default_cafe()
    rev = (PROMPTS / "reviews.md").read_text()
    for m in cfg.menu:
        assert m.sku in rev, m.sku
    for p in cfg.personas:
        assert p in rev
    for c in ("wait", "cold_food", "price", "quality", "ambience", "staff", "accuracy", "packaging", "value"):
        assert c in rev
    for ch in ("dine_in", "takeaway", "zomato", "swiggy"):
        assert ch in rev
    notes = (PROMPTS / "order_notes.md").read_text()
    for m in cfg.modifiers:
        assert m.id in notes, m.id
    for i in ("allergy", "modifier", "rush", "gift_message", "packaging", "cutlery", "spice_level", "other"):
        assert i in notes
    sup = (PROMPTS / "supplier_catalog.md").read_text()
    for ing in cfg.ingredients:
        assert ing.key in sup, ing.key
    ask = (PROMPTS / "ask_brew_eval.md").read_text()
    for route in (
        "/worlds/{id}/kpis",
        "/worlds/{id}/bottlenecks",
        "/worlds/{id}/advisor",
        "/worlds/{id}/inventory",
    ):
        assert route in ask
    assert (PROMPTS / "README.md").exists()


def test_min_rows_match_spec():
    assert MIN_ROWS["reviews"] == 3000 and MIN_ROWS["order_notes"] == 1500
    assert (
        MIN_ROWS["explanations"] == 400
        and MIN_ROWS["customer_names"] == 600
        and MIN_ROWS["ask_brew_eval"] == 300
    )


def test_raw_dirs_exist_with_gitkeep():
    for n in NAMES:
        assert (repo_root() / "data" / "synthetic" / "raw" / n / ".gitkeep").exists(), n
