"""Typer CLI: brew-sim, brew-api, brew-synth, brew-seed, brew-train, brew-eval."""

from __future__ import annotations

import time
from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

console = Console()

# ------------------------------------------------------------------ brew-sim
sim_app = typer.Typer(help="Run the cafe simulator headless.", no_args_is_help=True, add_completion=False)


@sim_app.command("run")
def sim_run(
    scenario: str = typer.Option("weekday_normal", help="Scenario key (configs/scenarios)."),
    policy: str = typer.Option("A", help="Policy code A or B (C/D/E arrive in M2/M3)."),
    days: int = typer.Option(1, min=1, help="Number of sim days."),
    seed: int = typer.Option(7, help="Master seed."),
    out: Path = typer.Option(None, help="Output dir for Parquet telemetry (events, orders, tasks, ...)."),
) -> None:
    """Run ``--days`` sim days and print the KPI summary."""
    from brew.events.bus import ParquetSink
    from brew.sim.telemetry import write_run
    from brew.sim.world import World

    sink = ParquetSink(out / "events.parquet") if out else None
    w = World(policy=policy, scenario=scenario, seed=seed, days=days, sink=sink, telemetry=out is not None)
    t0 = time.perf_counter()
    w.run(days)
    dt = time.perf_counter() - t0
    if sink is not None:
        sink.close()
        counts = write_run(w, out)
        console.print(f"telemetry written to {out}: {counts}, events={sink.count}")
    tbl = Table(title=f"{scenario} policy={policy} seed={seed}  ({dt:.2f}s wall, {w.seq} events)")
    for c in (
        "day",
        "orders",
        "revenue",
        "net_profit",
        "rating",
        "reneges",
        "balks",
        "sla_breach_rate",
        "waste_inr",
    ):
        tbl.add_column(c)
    for k in w.daily_kpis:
        tbl.add_row(
            *(
                str(k[c])
                for c in (
                    "day",
                    "orders",
                    "revenue",
                    "net_profit",
                    "rating",
                    "reneges",
                    "balks",
                    "sla_breach_rate",
                    "waste_inr",
                )
            )
        )
    console.print(tbl)


@sim_app.command("bench")
def sim_bench(seed: int = typer.Option(7), days: int = typer.Option(3, min=1)) -> None:
    """Time one sim day per policy (telemetry on) plus fork latency."""
    from brew.events.bus import ListSink
    from brew.sim.world import World

    tbl = Table(title="brew-sim bench")
    for c in ("policy", "sec/day", "events/day", "fork ms (mid-day)"):
        tbl.add_column(c)
    for pol in ("A", "B", "C"):
        w = World(policy=pol, seed=seed, days=days, sink=ListSink(), telemetry=True)
        t0 = time.perf_counter()
        w.run(days)
        per = (time.perf_counter() - t0) / days
        w2 = World(policy=pol, seed=seed, sink=None, telemetry=True)
        w2.run_until(14 * 3600)
        t1 = time.perf_counter()
        w2.fork()
        fk = (time.perf_counter() - t1) * 1000
        tbl.add_row(pol, f"{per:.3f}", str(w.seq // days), f"{fk:.1f}")
    console.print(tbl)


def sim_main() -> None:
    sim_app()


# ------------------------------------------------------------------ brew-api
def _api(
    host: str = typer.Option("127.0.0.1"),
    port: int = typer.Option(8000),
    reload: bool = typer.Option(False, help="Auto-reload on code changes."),
) -> None:
    """Serve the FastAPI app (default :8000)."""
    import uvicorn

    uvicorn.run("brew.api.app:create_app", host=host, port=port, reload=reload, factory=True)


def api_main() -> None:
    typer.run(_api)


# ----------------------------------------------------------------- brew-synth
synth_app = typer.Typer(
    help="Validate and ingest LLM-generated synthetic data.", no_args_is_help=True, add_completion=False
)


@synth_app.command("status")
def synth_status() -> None:
    """Show which synthetic datasets exist and whether minimum counts are met."""
    from brew.synth.validate import status

    rows = status()
    tbl = Table(title="synthetic datasets")
    for c in ("dataset", "raw files", "clean rows", "minimum", "state"):
        tbl.add_column(c)
    for r in rows:
        tbl.add_row(r["name"], str(r["raw_files"]), str(r["clean_rows"]), str(r["min_rows"]), r["state"])
    console.print(tbl)


@synth_app.command("validate")
def synth_validate(
    name: str = typer.Argument(None, help="Dataset name (default: all)."),
    raw_dir: Path = typer.Option(None, help="Override data/synthetic/raw."),
    clean_dir: Path = typer.Option(None, help="Override data/synthetic/clean."),
) -> None:
    """Validate raw LLM outputs, dedupe, write clean/{name}.jsonl; non-zero exit if a dataset is empty."""
    from brew.synth.validate import validate_all

    reports = validate_all(name, raw_dir, clean_dir)
    bad = False
    tbl = Table(title="validation")
    for c in ("dataset", "files", "rows read", "valid", "errors", "dupes", "clean written"):
        tbl.add_column(c)
    for r in reports:
        tbl.add_row(
            r.name, str(r.files), str(r.read), str(r.valid), str(len(r.errors)), str(r.dupes), str(r.written)
        )
        for e in r.errors[:20]:
            console.print(f"[red]{e}[/red]")
        for w in r.warnings:
            console.print(f"[yellow]{r.name}: {w}[/yellow]")
        if r.files and r.valid == 0:
            bad = True
    console.print(tbl)
    if bad:
        raise typer.Exit(1)


def synth_main() -> None:
    synth_app()


# ------------------------------------------------------------------ brew-seed
def _seed(
    database_url: str = typer.Option(
        None, help="SQLAlchemy URL (default: BREW_DATABASE_URL or data/brew.db)."
    ),
) -> None:
    """Create tables and seed cafe, menu, channels, policies and scenarios in the operational DB."""
    from brew.db.repo import seed_reference_data

    n = seed_reference_data(database_url)
    console.print(f"seeded reference data: {n}")


def seed_main() -> None:
    typer.run(_seed)


# ------------------------------------------------------- brew-train / brew-eval
train_app = typer.Typer(
    help="Training pipeline stages (history, forecast, elasticity, ...).", no_args_is_help=True, add_completion=False
)
M3_STAGES = ("bc", "ppo", "adversarial", "export")


def _train_cfg(config: Path) -> object:
    from brew.train.config import load_train_config

    return load_train_config(config)


def _report(stage: str, res: dict) -> None:
    import json

    keep = {k: v for k, v in res.items() if not isinstance(v, dict | list) or k in ("backtest",)}
    console.print(f"[bold]{stage}[/bold]: " + json.dumps(keep, default=str)[:900])


@train_app.command("stage")
def train_stage(
    stage: str = typer.Argument(..., help="history|forecast|elasticity|prep_time|rider_eta|text|replate|eval|all"),
    config: Path = typer.Option(Path("configs/train/smoke.yaml"), "--config", help="Train config YAML."),
    device: str = typer.Option("auto", help="Reserved for M3 (RL) stages."),
) -> None:
    """Run one pipeline stage (or ``all`` M2 stages) from a train config."""
    from brew.train.pipeline import M2_STAGES, run_all, run_stage

    cfg = _train_cfg(config)
    if stage in M3_STAGES:
        console.print(f"stage '{stage}' belongs to milestone M3 (learning) - not available yet.")
        raise typer.Exit(0)
    if stage == "all":
        t0 = time.perf_counter()
        res = run_all(cfg, M2_STAGES, log=lambda m: console.print(m))  # type: ignore[arg-type]
        console.print(f"[green]all M2 stages done in {time.perf_counter() - t0:.1f}s[/green]")
        for k, v in res.items():
            _report(k, v)
        return
    res1 = run_stage(stage, cfg)  # type: ignore[arg-type]
    _report(stage, res1)


def train_main() -> None:
    """Entry point: ``brew-train <stage> --config configs/train/smoke.yaml``."""
    train_app()


eval_app = typer.Typer(help="Policy arena: policies x seeds x days with paired statistics.", add_completion=False)


@eval_app.callback(invoke_without_command=True)
def eval_cmd(
    policies: str = typer.Option("A,B,C", help="Comma separated policy codes."),
    seeds: int = typer.Option(3, min=1, help="Number of seeds (1..N)."),
    days: int = typer.Option(1, min=1, help="Sim days per run."),
    scenario: str = typer.Option("weekday_normal"),
    replate_ab: bool = typer.Option(False, "--replate-ab", help="Also run C with Replate on vs off."),
    workers: int = typer.Option(0, help="Process-pool workers (0 = sequential)."),
    out: Path = typer.Option(None, help="Write the JSON result here."),
) -> None:
    """Run the arena and print mean profit, paired CIs vs A and Wilcoxon p-values."""
    import json

    from brew.analysis.arena import run_arena, run_replate_ab

    pols = [p.strip().upper() for p in policies.split(",") if p.strip()]
    seed_list = list(range(1, seeds + 1))
    t0 = time.perf_counter()
    res = run_arena(pols, seed_list, days, scenario, workers=workers)
    summ = res.summary()
    tbl = Table(title=f"arena {scenario} seeds={seeds} days={days} ({time.perf_counter() - t0:.1f}s)")
    for c in ("policy", "mean profit/day", "d vs A", "95% CI", "wilcoxon p", "waste kg", "sla breach", "rating"):
        tbl.add_column(c)
    for pc, row in summ["policies"].items():
        d = row.get("vs_A") or {}
        ci = d.get("ci95")
        tbl.add_row(
            pc, f"{row['mean_profit']:.0f}", f"{d.get('mean_diff', 0.0):+.0f}" if d else "-",
            f"[{ci[0]:+.0f}, {ci[1]:+.0f}]" if ci else "-", f"{d.get('wilcoxon_p', float('nan')):.3f}" if d else "-",
            f"{row['mean_waste_kg']:.1f}", f"{row['mean_sla_breach']:.3f}", f"{row['mean_rating']:.2f}",
        )  # fmt: skip
    console.print(tbl)
    result: dict = {"arena": summ}
    if replate_ab:
        ab = run_replate_ab("C", seed_list, days, scenario)
        result["replate_ab"] = ab
        console.print(
            f"replate on vs off (C): waste kg {ab['off']['waste_kg']:.1f} -> {ab['on']['waste_kg']:.1f} "
            f"({ab['waste_reduction_pct']:.0f}% less), profit {ab['off']['profit']:.0f} -> {ab['on']['profit']:.0f}"
        )
    if out:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result, indent=2, default=str))


def eval_main() -> None:
    eval_app()


if __name__ == "__main__":
    sim_app()
