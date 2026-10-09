"""Named RNG streams (CRN) built from one SeedSequence."""

from __future__ import annotations

import numpy as np

STREAM_NAMES = (
    "arrivals",
    "customers",
    "choice",
    "modifiers",
    "notes",
    "durations",
    "errors",
    "failures",
    "riders",
    "reviews",
    "weather",
    "inventory",
    "ids",
    "adversary",
    "policy",
    "replate",
    "combos",
)


class RngStreams:
    """Fixed-order named generators spawned from ``SeedSequence(seed)``.

    CRN rule: draws that define *who the customers are* are pre-sampled per day from
    ``arrivals`` / ``customers`` / ``choice`` / ``modifiers`` / ``notes`` so they are
    identical for every policy; policy-dependent consumption uses the later streams.
    """

    def __init__(self, seed: int) -> None:
        self.seed = seed
        children = np.random.SeedSequence(seed).spawn(len(STREAM_NAMES))
        self.g: dict[str, np.random.Generator] = {
            name: np.random.Generator(np.random.PCG64(ss))
            for name, ss in zip(STREAM_NAMES, children, strict=True)
        }
        self.arrivals = self.g["arrivals"]
        self.customers = self.g["customers"]
        self.choice = self.g["choice"]
        self.modifiers = self.g["modifiers"]
        self.notes = self.g["notes"]
        self.durations = self.g["durations"]
        self.errors = self.g["errors"]
        self.failures = self.g["failures"]
        self.riders = self.g["riders"]
        self.reviews = self.g["reviews"]
        self.weather = self.g["weather"]
        self.inventory = self.g["inventory"]
        self.ids = self.g["ids"]
        self.adversary = self.g["adversary"]
        self.policy = self.g["policy"]
        self.replate = self.g["replate"]
        self.combos = self.g["combos"]

    def reseed(self, seed: int) -> None:
        """Re-create all streams from a new seed (used by ``fork(reseed=...)``)."""
        self.__init__(seed)  # type: ignore[misc]


class Buffered:
    """Cheap scalar draws from a generator by refilling a numpy block."""

    __slots__ = ("buf", "gen", "i", "kind", "n")

    def __init__(self, gen: np.random.Generator, kind: str = "normal", n: int = 2048) -> None:
        self.gen = gen
        self.kind = kind
        self.n = n
        self.i = 0
        self.buf: list[float] = []
        self._fill()

    def _fill(self) -> None:
        a = self.gen.standard_normal(self.n) if self.kind == "normal" else self.gen.random(self.n)
        self.buf = a.tolist()
        self.i = 0

    def next(self) -> float:
        if self.i >= self.n:
            self._fill()
        v = self.buf[self.i]
        self.i += 1
        return v


def lognormal_params(mean: float, sd: float) -> tuple[float, float]:
    """(mu, sigma) of a lognormal with the given mean and standard deviation."""
    if mean <= 0:
        return 0.0, 0.0
    if sd <= 0:
        return float(np.log(mean)), 0.0
    s2 = np.log(1 + (sd / mean) ** 2)
    return float(np.log(mean) - s2 / 2), float(np.sqrt(s2))
