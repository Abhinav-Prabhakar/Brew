"""Request / response models for the HTTP API."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class WorldCreate(BaseModel):
    kind: Literal["live", "demo", "counterfactual", "arena", "train"] = "live"
    scenario: str = "weekday_normal"
    policy: str = "A"
    seed: int = 7
    clock: Literal["wall", "open"] = Field(
        "open", description="wall: today's date, synced to the real local time (live café); open: start at opening."
    )
    start_day: int = Field(0, ge=0, description="Offset in days from the scenario start date.")
    start_date: str | None = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    cash_start: float | None = None
    strategy: str = "balanced"
    replate: Literal["off", "gentle", "standard", "aggressive"] | None = Field(
        None, description="Force the Replate ladder (owner override); default follows the policy."
    )


class ControlRequest(BaseModel):
    action: Literal["play", "pause", "step", "speed"]
    step_s: float | None = Field(None, gt=0, le=86_400)
    rate: float | None = Field(None, description="speed: sim seconds per wall second, one of 1, 5, 20, 60")


class PolicyRequest(BaseModel):
    policy: str | None = None
    strategy: str | None = None


class ForkRequest(BaseModel):
    at: str = "now"
    kind: Literal["live", "demo", "counterfactual", "arena", "train"] = "counterfactual"
    reseed: int | None = None


class ChaosRequest(BaseModel):
    kind: str
    target: str | None = None
    severity: float = Field(1.0, gt=0, le=5)
    duration_min: float = Field(60.0, gt=0, le=720)


class ActionRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    kind: str

    def payload(self) -> dict[str, Any]:
        return {k: v for k, v in (self.model_extra or {}).items()}


class InvestRequest(BaseModel):
    catalog_key: str


class ArenaRequest(BaseModel):
    policies: list[str] = ["A", "B"]
    scenario: str = "weekday_normal"
    seeds: list[int] = [1, 2, 3]
    days: int = 1
