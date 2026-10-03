"""Deterministic UUIDv7-style ids (time-ordered, random bits supplied by the caller)."""

from __future__ import annotations


def uuid7(ts_ms: int, r1: int, r2: int) -> str:
    """Build a UUIDv7 string from a ms timestamp and two random 64-bit ints."""
    ts_ms &= (1 << 48) - 1
    rand_a = r1 & 0xFFF
    rand_b = r2 & ((1 << 62) - 1)
    n = (ts_ms << 80) | (0x7 << 76) | (rand_a << 64) | (0b10 << 62) | rand_b
    h = f"{n:032x}"
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"
