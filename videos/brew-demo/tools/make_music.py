"""The film's score, synthesised (assets/music/brew-day.wav): 90 bpm, 24 bars of 4/4 = 64 s, C major, ii-V-I-VI.

    uv run python videos/brew-demo/tools/make_music.py

Lo-fi café: an FM electric piano, a round bass, swung boom-bap drums, a kalimba lead and a pad for the last chorus,
all through a plate-ish reverb and a soft clipper. Seeded, so the same file every time. The arrangement follows the
film's scenes (bar numbers in ARR), and the cuts in index.html sit on these bar lines.
"""

from __future__ import annotations

import wave
from pathlib import Path

import numpy as np
from scipy import signal

SR = 44100
BPM = 90
BEAT = 60 / BPM
BAR = 4 * BEAT
BARS = 24
N = round(BARS * BAR * SR)
rng = np.random.default_rng(7)
OUT = Path(__file__).resolve().parents[1] / "assets" / "music" / "brew-day.wav"


def hz(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def tt(d: float) -> np.ndarray:
    return np.arange(int(d * SR)) / SR


def add(buf: np.ndarray, x: np.ndarray, at: float, gain: float = 1.0, pan: float = 0.0) -> None:
    i = round(at * SR)
    if i >= N or i < 0:
        return
    x = x[: N - i]
    left, right = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    buf[i : i + len(x), 0] += x * gain * left
    buf[i : i + len(x), 1] += x * gain * right


def filt(x: np.ndarray, kind: str, f, order: int = 2) -> np.ndarray:
    sos = signal.butter(order, f, kind, fs=SR, output="sos")
    return signal.sosfilt(sos, x, axis=0)


def fade(x: np.ndarray, a: float = 0.004, r: float = 0.03) -> np.ndarray:
    na, nr = min(int(a * SR), len(x) // 2), min(int(r * SR), len(x) // 2)
    x = x.copy()
    x[:na] *= np.linspace(0, 1, na)
    x[len(x) - nr :] *= np.linspace(1, 0, nr)
    return x


# ---------------------------------------------------------------- voices
def ep(m: float, d: float, vel: float = 1.0) -> np.ndarray:
    """FM electric piano: a tine (1:1, falling index) and a faint bell on top"""
    t = tt(d + 0.5)
    f = hz(m)
    idx = (1.6 * vel) * np.exp(-t * 5) + 0.25
    body = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * t))
    bell = 0.18 * vel * np.exp(-t * 16) * np.sin(2 * np.pi * f * 14 * t + 0.8 * np.sin(2 * np.pi * f * t))
    env = np.exp(-t * (1.1 + 60 / f)) * np.minimum(1, np.maximum(0, (d + 0.5 - t) / 0.35))
    return fade((body + bell) * env * vel, 0.003, 0.05)


def kalimba(m: float, d: float, vel: float = 1.0) -> np.ndarray:
    t = tt(max(d, 0.25) + 0.7)
    f = hz(m)
    vib = 1 + 0.003 * np.sin(2 * np.pi * 5.2 * t) * np.minimum(1, t * 3)
    ph = 2 * np.pi * np.cumsum(f * vib) / SR
    x = np.sin(ph) + 0.32 * np.sin(2 * ph) * np.exp(-t * 9) + 0.2 * np.sin(5.4 * ph) * np.exp(-t * 30)
    return fade(x * np.exp(-t * 4.2) * vel, 0.002, 0.08)


def bass(m: float, d: float, vel: float = 1.0) -> np.ndarray:
    t = tt(d)
    f = hz(m)
    x = np.sin(2 * np.pi * f * t + 0.5 * np.exp(-t * 14) * np.sin(4 * np.pi * f * t))
    x = np.tanh(1.7 * x) * np.exp(-t * 1.6)
    return fade(x * vel, 0.006, 0.05)


def pad(notes: list[int], d: float) -> np.ndarray:
    t = tt(d)
    x = np.zeros((len(t), 2))
    for k, m in enumerate(notes):
        for det, pn in ((-0.07, -0.7), (0.0, 0.0), (0.08, 0.7)):
            ph = 2 * np.pi * hz(m + det) * t + k
            saw = sum(np.sin(h * ph) / h for h in range(1, 9))
            x[:, 0] += saw * np.cos((pn + 1) * np.pi / 4)
            x[:, 1] += saw * np.sin((pn + 1) * np.pi / 4)
    env = np.minimum(1, t / 0.5) * np.minimum(1, (d - t) / 0.4)
    return filt(x, "low", 1800) * env[:, None] / (3 * len(notes))


def kick(vel: float = 1.0) -> np.ndarray:
    t = tt(0.42)
    f = 46 + 95 * np.exp(-t * 34)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 8.5)
    click = filt(rng.standard_normal(len(t)), "low", 3000) * np.exp(-t * 220) * 0.35
    return fade(np.tanh(1.6 * (x + click)) * vel, 0.001, 0.03)


def snare(vel: float = 1.0) -> np.ndarray:
    t = tt(0.3)
    n = filt(rng.standard_normal(len(t)), "band", (900, 6500)) * np.exp(-t * 19)
    body = np.sin(2 * np.pi * (185 + 60 * np.exp(-t * 40)) * t) * np.exp(-t * 26) * 0.7
    return fade((n + body) * vel, 0.001, 0.02)


def rim(vel: float = 1.0) -> np.ndarray:
    t = tt(0.09)
    x = (np.sin(2 * np.pi * 820 * t) + 0.6 * np.sin(2 * np.pi * 1740 * t)) * np.exp(-t * 75)
    return fade(x * vel, 0.0005, 0.01)


def hat(vel: float = 1.0, open_: bool = False) -> np.ndarray:
    t = tt(0.3 if open_ else 0.07)
    x = filt(rng.standard_normal(len(t)), "high", 7200, 4) * np.exp(-t * (11 if open_ else 70))
    return fade(x * vel, 0.0005, 0.01)


def shaker(vel: float = 1.0) -> np.ndarray:
    t = tt(0.09)
    x = filt(rng.standard_normal(len(t)), "band", (4200, 9000)) * np.sin(np.pi * t / 0.09) ** 2
    return x * vel


def riser(d: float) -> np.ndarray:
    t = tt(d)
    n = rng.standard_normal(len(t))
    out = np.zeros(len(t))
    for k in range(8):  # a band that climbs, in slices
        a, b = k * len(t) // 8, (k + 1) * len(t) // 8
        f = 500 * (12000 / 500) ** ((k + 0.5) / 8)
        out[a:b] = filt(n, "band", (f * 0.7, min(f * 1.4, 20000)))[a:b]
    tone = 0.25 * np.sin(2 * np.pi * np.cumsum(220 * 2 ** (t / d * 2)) / SR)
    return fade((out + tone) * (t / d) ** 2.2, 0.01, 0.01)


def impact() -> np.ndarray:
    t = tt(2.2)
    boom = np.sin(2 * np.pi * np.cumsum(38 + 60 * np.exp(-t * 9)) / SR) * np.exp(-t * 2.4)
    crash = filt(rng.standard_normal(len(t)), "high", 3500) * np.exp(-t * 2.8) * 0.4
    return fade(np.tanh(1.5 * boom) + crash, 0.001, 0.2)


def bell(m: float = 88) -> np.ndarray:
    """the shop door"""
    t = tt(2.4)
    f = hz(m)
    x = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t * dk) for r, a, dk in ((1, 1, 2.2), (2.76, 0.5, 3.5), (5.4, 0.3, 6), (8.9, 0.15, 9)))
    return fade(x, 0.001, 0.2)


# ---------------------------------------------------------------- the song
CH = [  # (bass root, electric-piano voicing): Dm9, G13, Cmaj9, A7b13
    (38, [53, 57, 60, 64]),
    (31, [53, 57, 59, 64]),
    (36, [52, 55, 59, 62]),
    (33, [55, 57, 61, 65]),
]
MEL_A = [
    [(0, 69, 0.5), (0.5, 72, 0.5), (1, 76, 1.0), (2.5, 74, 0.5), (3, 72, 1)],
    [(0, 71, 1.5), (1.5, 69, 0.5), (2, 67, 1), (3, 76, 0.5), (3.5, 74, 0.5)],
    [(0, 76, 1), (1, 79, 0.5), (1.5, 76, 0.5), (2, 74, 1.5), (3.5, 72, 0.5)],
    [(0, 73, 1), (1, 76, 0.5), (1.5, 79, 0.5), (2, 77, 1), (3, 76, 1)],
]
MEL_B = [
    [(0, 77, 0.5), (0.5, 76, 0.5), (1, 74, 0.5), (1.5, 81, 1.5), (3, 79, 0.5), (3.5, 77, 0.5)],
    [(0, 76, 1), (1, 74, 0.5), (1.5, 71, 0.5), (2, 74, 1), (3, 79, 1)],
    [(0, 79, 0.5), (0.5, 76, 0.5), (1, 84, 1.5), (2.5, 83, 0.5), (3, 79, 1)],
    [(0, 81, 1), (1, 79, 0.5), (1.5, 76, 0.5), (2, 73, 1), (3, 76, 0.5), (3.5, 81, 0.5)],
]
# bar -> what plays.  d drums (0 none, 1 light: rim + shaker, 2 groove, 3 groove + sixteenths), b bass, c chords,
# m melody (None, 'A', 'B', 'A8' an octave up with B answering), p pad
ARR = {
    0: dict(d=0, b=0, c=1, m=None), 1: dict(d=0, b=0, c=1, m="A"),                      # 07:00, the door opens
    2: dict(d=2, b=1, c=1, m=None), 3: dict(d=2, b=1, c=1, m="A"), 4: dict(d=2, b=1, c=1, m="A"),   # the rush
    5: dict(d=1, b=1, c=1, m=None), 6: dict(d=1, b=1, c=1, m=None, roll=True),          # ...an ML system (a build)
    7: dict(d=3, b=1, c=1, m="B"), 8: dict(d=3, b=1, c=1, m="B"), 9: dict(d=3, b=1, c=1, m="B"),    # the kitchen
    10: dict(d=1, b=0, c=1, m="A"), 11: dict(d=1, b=1, c=1, m="A"),                     # the menu book (a breath)
    12: dict(d=2, b=1, c=1, m=None), 13: dict(d=2, b=1, c=1, m="A"),                    # the pantry
    14: dict(d=2, b=1, c=1, m="B"), 15: dict(d=2, b=1, c=1, m="B"), 16: dict(d=2, b=1, c=1, m="B", roll=True),  # kapi
    17: dict(d=3, b=1, c=1, m="A8", p=1), 18: dict(d=3, b=1, c=1, m="A8", p=1),         # the arena (the chorus)
    19: dict(d=3, b=1, c=1, m="A8", p=1), 20: dict(d=3, b=1, c=1, m="A8", p=1),
    21: dict(d=1, b=1, c=1, m="A", p=1), 22: dict(d=0, b=0, c=2, m=None), 23: dict(d=0, b=0, c=0, m=None),  # closing
}  # fmt: skip
SW = 0.07  # swing: the off sixteenths arrive late, in beats


def sw(b: float) -> float:
    return b + (SW if round(b * 4) % 2 else 0)


def build() -> np.ndarray:
    drums, keys, low, lead, pads, fx = (np.zeros((N, 2)) for _ in range(6))
    duck = np.ones(N)
    for bar in range(BARS):
        a, t0, ch = ARR[bar], bar * BAR, CH[bar % 4]
        root, voic = ch
        at = lambda b, t0=t0: t0 + sw(b) * BEAT  # noqa: E731
        # --- electric piano: the chord on one, an answer on the and-of-two
        if a["c"]:
            hold = 8 if a["c"] == 2 else 2.4
            for k, m in enumerate(voic):
                add(keys, ep(m, hold * BEAT, 0.8), t0 + k * 0.012, 0.34, (k - 1.5) * 0.3)
                if a["c"] == 1:
                    add(keys, ep(m, 1.2 * BEAT, 0.55), at(2.5) + k * 0.008, 0.27, (1.5 - k) * 0.3)
            if a["c"] == 2:
                add(keys, ep(48, 8 * BEAT, 0.9), t0, 0.3)  # the last chord lands on C
        # --- bass
        if a["b"]:
            for b, m, d, v in ((0, root, 1.4, 1), (1.75, root, 0.5, 0.7), (2.5, root + 12, 0.45, 0.6), (3, root + 7, 0.9, 0.8)):
                add(low, bass(m + (12 if m < 34 else 0) - 0, d * BEAT, v), at(b), 0.3)
        # --- drums
        d = a["d"]
        if d >= 2:
            ks = [0, 1.75, 2.5] + ([3.75] if bar % 4 == 3 else [])
            for b in ks:
                add(drums, kick(1 if b in (0, 2.5) else 0.75), at(b), 0.62)
                i = int(at(b) * SR)
                n = int(0.26 * SR)
                env = 1 - 0.55 * np.exp(-np.arange(n) / (0.07 * SR))
                duck[i : i + n] = np.minimum(duck[i : i + n], env[: max(0, min(n, N - i))])
            for b in (1, 3):
                add(drums, snare(0.9), at(b), 0.5, 0.05)
                add(drums, rim(0.6), at(b), 0.2, -0.2)
            step = 0.25 if d == 3 else 0.5
            for k in range(int(4 / step)):
                b = k * step
                v = (0.9 if b % 1 == 0 else 0.55 if b % 0.5 == 0 else 0.3) * (0.85 + 0.3 * rng.random())
                add(drums, hat(v, open_=(b == 3.5 and bar % 2 == 1)), at(b), 0.2, 0.35)
        elif d == 1:
            for b in (1, 3):
                add(drums, rim(0.8), at(b), 0.3, -0.2)
            for k in range(8):
                add(drums, shaker(0.5 + 0.4 * (k % 2 == 0)), at(k * 0.5), 0.16, 0.4)
            add(drums, kick(0.8), at(0), 0.6)
        if a.get("roll"):
            for k in range(8):  # a snare climb over the last two beats
                add(drums, snare(0.35 + 0.08 * k), t0 + (2 + k * 0.25) * BEAT, 0.3, 0)
        # --- lead
        m = a["m"]
        if m:
            phrase = (MEL_B if m == "B" else MEL_A)[bar % 4]
            for b, note, dur in phrase:
                up = 12 if m == "A8" else 0
                add(lead, kalimba(note + up, dur * BEAT, 0.9), at(b), 0.5, 0.25 * np.sin(bar + b))
                if m == "A8":
                    add(lead, kalimba(note, dur * BEAT, 0.6), at(b), 0.32, -0.3)
        if a.get("p"):
            pd = pad([v + 12 for v in voic], BAR)
            i = int(t0 * SR)
            pads[i : i + len(pd)] += pd[: N - i] * 0.5
    # --- one-shots: the door bell, risers into the groove / the kitchen / the arena, hits on the downbeats after
    add(fx, bell(88), 0.02, 0.1, 0.3)
    add(fx, bell(93), 0.02 + BEAT * 0.5, 0.06, -0.3)
    for bar, g in ((2, 0.1), (7, 0.16), (17, 0.2)):
        r = riser(BAR)
        add(fx, r, bar * BAR - BAR, g * 1.2)
        add(fx, impact(), bar * BAR, g * 3.2)
    add(fx, bell(84), 22 * BAR, 0.1, 0.2)   # and the door again, on the last chord
    add(fx, bell(91), 22 * BAR + BEAT, 0.05, -0.2)

    dk = duck[:, None]
    keys = filt(keys, "low", 5200)
    wet = keys * 0.5 + lead * 0.7 + pads * 0.6 + fx * 0.5 + drums * 0.08
    # a plate-ish reverb: decaying noise, pre-delayed, and a dotted-eighth echo on the lead
    echo = np.zeros_like(lead)
    dl = int(0.75 * BEAT * SR)
    echo[dl:] += lead[:-dl] * 0.34
    echo[2 * dl :] += lead[: -2 * dl] * 0.14
    n_ir = int(2.2 * SR)
    ir = rng.standard_normal((n_ir, 2)) * np.exp(-np.arange(n_ir) / (0.45 * SR))[:, None]
    ir = filt(filt(ir, "low", 5200), "high", 260)
    rev = np.stack([signal.fftconvolve(wet[:, c], ir[:, c])[:N] for c in (0, 1)], axis=1)
    rev /= np.abs(rev).max() + 1e-9
    mix = drums + low * dk + (keys + pads * 0.9) * (0.35 + 0.65 * dk) + lead + echo[:, ::-1] + fx + rev * 0.2
    mix = filt(mix, "high", 28)
    mix = np.tanh(mix * 1.5) / np.tanh(1.5)
    mix /= np.abs(mix).max() / 0.92
    tail = int(2.0 * SR)
    mix[-tail:] *= (np.linspace(1, 0, tail) ** 1.5)[:, None]
    return mix


def main() -> None:
    mix = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(OUT), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((mix * 32767).astype("<i2").tobytes())
    rms = float(np.sqrt((mix**2).mean()))
    print(f"{OUT.name}  {len(mix) / SR:.2f}s  peak {np.abs(mix).max():.2f}  rms {20 * np.log10(rms):.1f} dBFS")


if __name__ == "__main__":
    main()
