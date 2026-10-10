"""Text-to-speech for the waiter's voice chat: several providers, several keys each, rotated with failover.

Same idea as :mod:`brew.llm.pool` (every (provider, key) is a slot; a failing slot rests and the call moves on), for
audio. The browser's own speech synthesis is the keyless last resort, done client-side (``browser`` in the order).

Environment (a ``.env`` in the repository root is read too):

``BREW_TTS_ORDER``             providers to try, in order, e.g. ``elevenlabs,openai,browser`` (default: every known
                               provider that has a key, then ``browser``). Leave ``browser`` out to stay silent
                               rather than fall back to the browser voice.
``<NAME>_API_KEYS``            the provider's keys (shared with the chat pool: ``OPENAI_API_KEYS``, ``GROQ_API_KEYS``,
                               ``ELEVENLABS_API_KEYS``, …), comma separated; ``BREW_TTS_<NAME>_KEYS`` for TTS-only keys
``BREW_TTS_<NAME>_VOICE``      voice name / id · ``BREW_TTS_<NAME>_MODEL`` · ``BREW_TTS_<NAME>_URL``
``BREW_TTS_<NAME>_INSTRUCTIONS``  how to say it (OpenAI-style ``instructions``, e.g. "a tired, sarcastic waiter")
``BREW_TTS_<NAME>_PREFIX``     put in front of every line, e.g. ElevenLabs v3 audio tags ``[sarcastic] [deadpan]``
                               (left off when the waiter's mood is "worried": no sarcasm at a real complaint)
``BREW_TTS_<NAME>_SETTINGS``   JSON merged into the request (ElevenLabs: its ``voice_settings``, e.g.
                               ``{"stability": 0.0, "style": 0.8}``; OpenAI-style: extra body fields)
``BREW_TTS_SPEED``             playback speed of the audio in the page, 0.5–2 (default 1; pitch is kept)
``BREW_TTS_<NAME>_KIND``       wire format of a provider this file does not know:
                               ``openai`` (POST {model, voice, input} -> audio; OpenAI, Groq and compatibles),
                               ``elevenlabs`` (POST …/text-to-speech/{voice}), or
                               ``get`` (GET a URL template with ``{text}``, ``{voice}``, ``{key}`` placeholders)
``BREW_TTS_BROWSER_VOICE`` / ``_PITCH`` / ``_RATE``   the browser fallback: voice name contains…, pitch 0–2, rate 0.5–2
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx

from .pool import COOL_AUTH_S, COOL_ERROR_S, COOL_MAX_S, COOL_RATE_S, LLMUnavailable, _keys, read_dotenv

# name -> (wire format, endpoint, default model, default voice)
KNOWN: dict[str, tuple[str, str, str, str]] = {
    "openai": ("openai", "https://api.openai.com/v1/audio/speech", "gpt-4o-mini-tts", "ballad"),
    "groq": ("openai", "https://api.groq.com/openai/v1/audio/speech", "playai-tts", "Fritz-PlayAI"),
    "elevenlabs": ("elevenlabs", "https://api.elevenlabs.io/v1/text-to-speech/{voice}", "eleven_flash_v2_5", "JBFqnCBsd6RMkjVDRZzb"),
}  # fmt: skip
MAX_CHARS = 600


class TTSUnavailable(LLMUnavailable):
    """No TTS slot could produce audio (none configured, or all failing)."""


@dataclass(frozen=True)
class Voice:
    name: str
    kind: str
    url: str
    model: str
    voice: str
    instructions: str = ""
    prefix: str = ""
    settings: tuple[tuple[str, Any], ...] = ()


@dataclass
class VoiceSlot:
    provider: Voice
    key: str
    ok: int = 0
    failed: int = 0
    streak: int = 0
    cool_until: float = 0.0
    last_error: str = ""

    def masked(self) -> str:
        return "…" + self.key[-4:] if len(self.key) > 8 else "…"


class TTSPool:
    def __init__(
        self,
        slots: list[VoiceSlot] | None = None,
        browser: dict[str, Any] | None = None,
        speed: float = 1.0,
        client: httpx.AsyncClient | None = None,
        timeout_s: float = 15.0,
        clock: Any = time.monotonic,
    ) -> None:
        self.slots = slots or []
        self.browser = browser  # None = no browser fallback; else {voice, pitch, rate}
        self.speed = speed
        self._client = client
        self._timeout = timeout_s
        self._cursor = 0
        self._lock = asyncio.Lock()
        self._now = clock

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None, dotenv: Path | None = None, **kw: Any) -> TTSPool:
        e = {**(read_dotenv(dotenv) if dotenv else {}), **(dict(os.environ) if env is None else env)}
        order = [n.strip().lower() for n in re.split(r"[,\s]+", e.get("BREW_TTS_ORDER", "")) if n.strip()]
        if not order:
            order = [*KNOWN, "browser"]
        slots: list[VoiceSlot] = []
        for name in order:
            if name == "browser":
                continue
            up = name.upper()
            kind, url, model, voice = KNOWN.get(name, ("openai", "", "", ""))
            v = Voice(
                name,
                e.get(f"BREW_TTS_{up}_KIND", kind),
                e.get(f"BREW_TTS_{up}_URL", url),
                e.get(f"BREW_TTS_{up}_MODEL", model),
                e.get(f"BREW_TTS_{up}_VOICE", voice),
                e.get(f"BREW_TTS_{up}_INSTRUCTIONS", ""),
                e.get(f"BREW_TTS_{up}_PREFIX", "").strip(),
                tuple(_json_obj(e.get(f"BREW_TTS_{up}_SETTINGS", "")).items()),
            )
            keys = [k for k in re.split(r"[,\s]+", e.get(f"BREW_TTS_{up}_KEYS", "")) if k] or _keys(e, name)
            if v.kind == "get" and not keys and "{key}" not in v.url:
                keys = [""]  # a keyless GET endpoint is one slot
            if v.url:
                slots += [VoiceSlot(v, k) for k in keys]
        browser = None

        def num(key: str, default: float, lo: float, hi: float) -> float:
            try:
                return max(lo, min(hi, float(e.get(key, default))))
            except ValueError:
                return default

        if "browser" in order:
            browser = {
                "voice": e.get("BREW_TTS_BROWSER_VOICE", ""),
                "pitch": num("BREW_TTS_BROWSER_PITCH", 0.8, 0.0, 2.0),
                "rate": num("BREW_TTS_BROWSER_RATE", 1.05, 0.5, 2.0),
            }
        return cls(slots, browser, num("BREW_TTS_SPEED", 1.0, 0.5, 2.0), **kw)

    @property
    def configured(self) -> bool:
        return bool(self.slots)

    def status(self) -> dict[str, Any]:
        now = self._now()
        provs: dict[str, dict[str, Any]] = {}
        for s in self.slots:
            p = s.provider
            d = provs.setdefault(p.name, {"name": p.name, "model": p.model, "voice": p.voice, "keys": []})
            d["keys"].append(
                {
                    "key": s.masked(), "ok": s.ok, "failed": s.failed, "last_error": s.last_error,
                    "cooling_s": round(max(0.0, s.cool_until - now), 1),
                }
            )  # fmt: skip
        return {"providers": list(provs.values()), "browser": self.browser, "speed": self.speed}

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def speak(self, text: str, mood: str = "") -> tuple[bytes, str, str]:
        """``text`` -> (audio bytes, content type, provider name). Raises :class:`TTSUnavailable`.
        ``mood`` is the waiter's: a provider's style prefix is dropped when he is "worried"."""
        text = " ".join(text.split())[:MAX_CHARS]
        if not self.slots or not text:
            raise TTSUnavailable("no TTS provider configured" if text else "nothing to say")
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self._timeout)
        async with self._lock:
            n = len(self.slots)
            start = self._cursor % n
            rot = self.slots[start:] + self.slots[:start]
            now = self._now()
            healthy = [s for s in rot if s.cool_until <= now]
            if healthy:
                # stay with the first provider in the order while it has a healthy key; rotate over its keys
                first = next(s.provider.name for s in self.slots if s.cool_until <= now)
                healthy.sort(key=lambda s: s.provider.name != first)
                self._cursor = self.slots.index(healthy[0]) + 1
            order = healthy + sorted((s for s in rot if s.cool_until > now), key=lambda s: s.cool_until)
        tried: list[str] = []
        for s in order:
            try:
                p = s.provider
                line = f"{p.prefix} {text}" if p.prefix and mood != "worried" else text
                audio, ctype = await self._call(s, line)
            except _Fail as f:
                s.failed += 1
                s.streak += 1
                s.last_error = f.reason
                s.cool_until = self._now() + min(max(COOL_MAX_S, f.cool_s), f.cool_s * 2 ** (s.streak - 1))
                tried.append(f"{s.provider.name}{s.masked()}: {f.reason}")
                continue
            s.ok += 1
            s.streak = 0
            s.last_error = ""
            s.cool_until = 0.0
            return audio, ctype, s.provider.name
        raise TTSUnavailable("; ".join(tried))

    async def _call(self, s: VoiceSlot, text: str) -> tuple[bytes, str]:
        p = s.provider
        assert self._client is not None
        try:
            if p.kind == "elevenlabs":
                r = await self._client.post(
                    p.url.replace("{voice}", quote(p.voice)),
                    headers={"xi-api-key": s.key, "accept": "audio/mpeg"},
                    json={
                        "text": text,
                        "model_id": p.model,
                        **({"voice_settings": dict(p.settings)} if p.settings else {}),
                    },
                )
            elif p.kind == "get":
                url = p.url.replace("{text}", quote(text)).replace("{voice}", quote(p.voice))
                r = await self._client.get(url.replace("{key}", quote(s.key)))
            else:
                body = {"model": p.model, "voice": p.voice, "input": text, "response_format": "mp3"}
                if p.instructions:
                    body["instructions"] = p.instructions
                body.update(dict(p.settings))
                r = await self._client.post(p.url, headers={"authorization": f"Bearer {s.key}"}, json=body)
        except httpx.TimeoutException as e:
            raise _Fail("timeout", COOL_ERROR_S) from e
        except httpx.HTTPError as e:
            raise _Fail(f"network: {type(e).__name__}", COOL_ERROR_S) from e
        if r.status_code in (401, 403):
            raise _Fail(f"http {r.status_code} (key rejected)", COOL_AUTH_S)
        if r.status_code == 429:
            raise _Fail("http 429 (rate limited / quota)", COOL_RATE_S)
        ctype = r.headers.get("content-type", "").split(";")[0].strip()
        if r.status_code >= 400 or not r.content or ctype.startswith(("application/json", "text/")):
            raise _Fail(
                f"http {r.status_code}" if r.status_code >= 400 else "no audio in the response", COOL_ERROR_S
            )
        return r.content, ctype or "audio/mpeg"


def _json_obj(raw: str) -> dict[str, Any]:
    try:
        v = json.loads(raw) if raw.strip() else {}
    except ValueError:
        return {}
    return v if isinstance(v, dict) else {}


class _Fail(Exception):
    def __init__(self, reason: str, cool_s: float) -> None:
        super().__init__(reason)
        self.reason = reason
        self.cool_s = cool_s
