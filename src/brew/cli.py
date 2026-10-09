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
    for pol in ("A", "B"):
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
def train_main() -> None:
    """Stub until M2/M3."""
    console.print("brew-train: available in M2/M3 (forecasting, elasticity, RL).")


def eval_main() -> None:
    """Stub until M2/M3."""
    console.print("brew-eval: available in M2/M3 (policy arena).")


if __name__ == "__main__":
    sim_app()
