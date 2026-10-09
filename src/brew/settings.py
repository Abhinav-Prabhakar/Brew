"""Runtime settings (BREW_* environment variables)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

from brew.config.loader import repo_root


class Settings(BaseSettings):
    """Application settings; override with ``BREW_<NAME>`` env vars."""

    model_config = SettingsConfigDict(env_prefix="BREW_", extra="ignore")

    database_url: str = ""
    config_dir: str = ""
    models_dir: str = ""
    runs_dir: str = ""
    live_rate: float = 1.0  # sim seconds per wall second; 1.0 = real time (the café runs live, no playback speeds)
    live_tz: str = "Asia/Kolkata"  # wall-clock time zone for clock="wall" worlds (the café is in Bengaluru)
    db_enabled: bool = True
    db_store_events: bool = True  # write sim_event rows for live worlds
    ws_frame_interval_s: float = 0.075
    ws_heartbeat_s: float = 15.0
    ws_ring_size: int = 10_000
    pacer_tick_s: float = 0.05
    pacer_cpu_budget_s: float = 0.03
    max_worlds: int = 32
    git_sha: str = "unknown"
    serve_design: bool = True  # serve design/ (the hand-drawn frontend) at / from the same origin

    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        p = repo_root() / "data" / "brew.db"
        p.parent.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{p}"

    def resolved_runs_dir(self) -> Path:
        return Path(self.runs_dir) if self.runs_dir else repo_root() / "data" / "runs"

    def resolved_models_dir(self) -> Path:
        return Path(self.models_dir) if self.models_dir else repo_root() / "models"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
