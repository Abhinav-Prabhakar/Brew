"""Shared constants."""

from __future__ import annotations

WEATHER_STATES = ("sunny", "partly", "cloudy", "drizzle", "rain")
CHANNELS = ("dine_in", "takeaway", "zomato", "swiggy")
AGGREGATORS = ("zomato", "swiggy")
CHANNEL_GROUPS = ("offline", "zomato", "swiggy")
CATEGORIES = ("coffee", "notcoffee", "bakes", "plates")
DISRUPTION_KINDS = (
    "staff_absent",
    "staff_late",
    "equipment_down",
    "supplier_delay",
    "supplier_short",
    "rider_shortage",
    "power_cut",
    "demand_spike",
    "price_shock",
    "platform_outage",
)
CAUSES = ("wait", "cold_food", "price", "quality", "ambience", "staff", "accuracy", "packaging", "value")
THROTTLE_LEVELS = ("open", "plus5", "plus10", "pause")
STRATEGY_PRESETS = ("fcfs", "edf", "dine_first", "delivery_jit", "batch_max", "throughput")
MANUAL_STRATEGIES = ("balanced", "delivery_first", "rush_menu", "happy_hour")


def channel_group(channel: str) -> str:
    """Reputation group for a channel: offline / zomato / swiggy."""
    return channel if channel in AGGREGATORS else "offline"
