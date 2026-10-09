"""Dispatch strategies: priority weights + manual (HUD) strategy overlays."""

from __future__ import annotations

from typing import TYPE_CHECKING

from brew.config.schemas import ManualStrategy, Preset, StrategiesConfig

if TYPE_CHECKING:
    from brew.sim.state import Task


def priority(
    t: Task,
    now: float,
    p: Preset,
    channel_boost: dict[str, float] | None = None,
    peers: int = 0,
) -> float:
    """Higher = dispatch first.

    ``priority = w_late*(-slack) + w_age*age + w_channel + w_persona + w_batch*peers + w_bump*bumped
    + w_short/est`` with seconds as the unit of ``slack`` and ``age``.
    """
    age = now - t.placed_s if t.placed_s else now - t.ready_s
    slack = t.due_s - now - t.est_s if t.due_s else 1e4
    v = p.w_late * (-slack) + p.w_age * age
    if p.w_channel:
        v += p.w_channel.get(t.channel, 0.0)
    if channel_boost:
        v += channel_boost.get(t.channel, 0.0)
    if p.w_persona:
        v += p.w_persona.get(t.persona, 0.0)
    if p.w_batch and t.batchable:
        v += p.w_batch * peers
    if t.bumped:
        v += p.w_bump
    if p.w_short:
        v += p.w_short / (t.duration_mean + 1.0)
    return v


def resolve_manual(cfg: StrategiesConfig, name: str) -> ManualStrategy:
    """Look up a manual strategy; raises KeyError for unknown names."""
    return cfg.manual[name]
