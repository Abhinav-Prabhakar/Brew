"""A pool of chat-completion providers with several API keys each, rotated round-robin with failover.

Every (provider, key) pair is a *slot*. A call takes the next healthy slot; a slot that fails (rate limit, bad key,
server error, timeout) cools down with exponential backoff and the call moves on to the next one, so one exhausted
key or one provider outage never takes the waiter down. Keys only ever leave this module masked.

Configuration is environment only (a ``.env`` in the repository root is read too, real environment wins):

``BREW_LLM_ORDER``             providers to use, in order (default: every known provider that has a key)
``BREW_LLM_STRATEGY``          ``round_robin`` (default: rotate over every slot) | ``priority`` (first provider's keys
                               first, the next provider only when all of those are cooling down)
``<NAME>_API_KEYS``            comma / space separated keys (``<NAME>_API_KEY`` for a single one), e.g.
                               ``ANTHROPIC_API_KEYS``, ``OPENAI_API_KEYS``, ``GEMINI_API_KEYS``, ``GROQ_API_KEYS``,
                               ``OPENROUTER_API_KEYS``
``BREW_LLM_<NAME>_MODEL``      model override; ``BREW_LLM_<NAME>_URL`` endpoint override;
``BREW_LLM_<NAME>_KIND``       wire format of a provider this file does not know: ``openai`` (default) | ``anthropic``
"""

from __future__ import annotations

import asyncio
import os
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

# name -> (wire format, endpoint, default model). Models and endpoints are overridable per provider (see above).
KNOWN: dict[str, tuple[str, str, str]] = {
    "anthropic": ("anthropic", "https://api.anthropic.com/v1/messages", "claude-haiku-5-5"),
    "openai": ("openai", "https://api.openai.com/v1/chat/completions", "gpt-4o-mini"),
    "gemini": ("openai", "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", "gemini-2.0-flash"),
    "groq": ("openai", "https://api.groq.com/openai/v1/chat/completions", "llama-3.3-70b-versatile"),
    "openrouter": ("openai", "https://openrouter.ai/api/v1/chat/completions", "meta-llama/llama-3.3-70b-instruct"),
}  # fmt: skip
ANTHROPIC_VERSION = "2023-06-01"
COOL_RATE_S, COOL_ERROR_S, COOL_AUTH_S, COOL_MAX_S = 20.0, 10.0, 600.0, 300.0


class LLMUnavailable(Exception):
    """No slot could answer (none configured, or every one failed / is cooling down)."""


@dataclass(frozen=True)
class Provider:
    name: str
    kind: str  # "anthropic" | "openai" (OpenAI-compatible chat completions)
    url: str
    model: str


@dataclass
class Slot:
    provider: Provider
    key: str
    ok: int = 0
    failed: int = 0
    streak: int = 0  # consecutive failures (drives the backoff)
    cool_until: float = 0.0
    last_error: str = ""

    def masked(self) -> str:
        return "…" + self.key[-4:] if len(self.key) > 8 else "…"


@dataclass
class Reply:
    text: str
    provider: str
    model: str
    attempts: int = 1
    tried: list[str] = field(default_factory=list)


def read_dotenv(path: Path) -> dict[str, str]:
    """``KEY=value`` lines of a .env file (quotes stripped, ``#`` comments and ``export`` ignored)."""
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.removeprefix("export ").split("=", 1)
        out[k.strip()] = v.strip().strip("'\"")
    return out


def _keys(env: dict[str, str], name: str) -> list[str]:
    up = name.upper()
    raw = " ".join(env.get(k, "") for k in (f"{up}_API_KEYS", f"{up}_API_KEY", f"BREW_LLM_{up}_KEYS"))
    if name == "gemini":
        raw += " " + env.get("GOOGLE_API_KEY", "")
    seen: list[str] = []
    for k in re.split(r"[,\s]+", raw):
        if k and k not in seen:
            seen.append(k)
    return seen


class LLMPool:
    """Round-robin over (provider, key) slots with cooldowns. Safe to share between requests."""

    def __init__(
        self,
        slots: list[Slot] | None = None,
        strategy: str = "round_robin",
        client: httpx.AsyncClient | None = None,
        timeout_s: float = 25.0,
        clock: Any = time.monotonic,
    ) -> None:
        self.slots = slots or []
        self.strategy = strategy if strategy in ("round_robin", "priority") else "round_robin"
        self._client = client
        self._timeout = timeout_s
        self._cursor = 0
        self._lock = asyncio.Lock()
        self._now = clock

    # ------------------------------------------------------------------ setup
    @classmethod
    def from_env(cls, env: dict[str, str] | None = None, dotenv: Path | None = None, **kw: Any) -> LLMPool:
        e = {**(read_dotenv(dotenv) if dotenv else {}), **(dict(os.environ) if env is None else env)}
        order = [
            n.strip().lower() for n in re.split(r"[,\s]+", e.get("BREW_LLM_ORDER", "")) if n.strip()
        ] or list(KNOWN)
        per: list[list[Slot]] = []
        for name in order:
            keys = _keys(e, name)
            if not keys:
                continue
            kind, url, model = KNOWN.get(name, ("openai", "", ""))
            up = name.upper()
            p = Provider(
                name,
                e.get(f"BREW_LLM_{up}_KIND", kind),
                e.get(f"BREW_LLM_{up}_URL", url),
                e.get(f"BREW_LLM_{up}_MODEL", model),
            )
            if p.url and p.model:
                per.append([Slot(p, k) for k in keys])
        strategy = e.get("BREW_LLM_STRATEGY", "round_robin").strip().lower()
        if strategy == "priority":
            slots = [s for group in per for s in group]
        else:  # interleave providers so consecutive calls spread over APIs as well as keys
            slots = [g[i] for i in range(max((len(g) for g in per), default=0)) for g in per if i < len(g)]
        return cls(slots, strategy, **kw)

    @property
    def configured(self) -> bool:
        return bool(self.slots)

    def status(self) -> dict[str, Any]:
        """What is configured and how it is doing — never the keys themselves."""
        now = self._now()
        provs: dict[str, dict[str, Any]] = {}
        for s in self.slots:
            d = provs.setdefault(
                s.provider.name, {"name": s.provider.name, "model": s.provider.model, "keys": []}
            )
            d["keys"].append(
                {
                    "key": s.masked(), "ok": s.ok, "failed": s.failed, "last_error": s.last_error,
                    "cooling_s": round(max(0.0, s.cool_until - now), 1),
                }
            )  # fmt: skip
        return {"configured": self.configured, "strategy": self.strategy, "providers": list(provs.values())}

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    # ------------------------------------------------------------------- call
    async def _order(self) -> list[Slot]:
        """Slots to try for one call: healthy ones first (rotated), then the cooling ones, soonest back first."""
        async with self._lock:
            n = len(self.slots)
            start = self._cursor % n if self.strategy == "round_robin" else 0
            rot = self.slots[start:] + self.slots[:start]
            now = self._now()
            healthy = [s for s in rot if s.cool_until <= now]
            if healthy and self.strategy == "round_robin":
                self._cursor = self.slots.index(healthy[0]) + 1
            return healthy + sorted((s for s in rot if s.cool_until > now), key=lambda s: s.cool_until)

    async def chat(
        self, system: str, messages: list[dict[str, str]], max_tokens: int = 500, temperature: float = 0.7
    ) -> Reply:
        """One assistant turn for ``messages`` ([{role: user|assistant, content}]). Raises :class:`LLMUnavailable`."""
        if not self.slots:
            raise LLMUnavailable("no LLM keys configured")
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self._timeout)
        tried: list[str] = []
        for s in await self._order():
            label = f"{s.provider.name}{s.masked()}"
            try:
                text = await self._call(s, system, messages, max_tokens, temperature)
            except _SlotError as e:
                s.failed += 1
                s.streak += 1
                s.last_error = e.reason
                cool = min(max(COOL_MAX_S, e.cool_s), e.cool_s * 2 ** (s.streak - 1))
                s.cool_until = self._now() + cool if e.cool_s else 0.0
                tried.append(f"{label}: {e.reason}")
                continue
            s.ok += 1
            s.streak = 0
            s.last_error = ""
            s.cool_until = 0.0
            return Reply(text, s.provider.name, s.provider.model, len(tried) + 1, tried)
        raise LLMUnavailable("; ".join(tried) or "no slot available")

    async def _call(
        self, s: Slot, system: str, messages: list[dict[str, str]], max_tokens: int, temp: float
    ) -> str:
        p = s.provider
        if p.kind == "anthropic":
            headers = {"x-api-key": s.key, "anthropic-version": ANTHROPIC_VERSION}
            body: dict[str, Any] = {
                "model": p.model,
                "max_tokens": max_tokens,
                "system": system,
                "messages": messages,
            }
        else:
            headers = {"authorization": f"Bearer {s.key}"}
            body = {
                "model": p.model, "max_tokens": max_tokens, "temperature": temp,
                "messages": [{"role": "system", "content": system}, *messages],
            }  # fmt: skip
        assert self._client is not None
        try:
            r = await self._client.post(p.url, headers=headers, json=body)
        except httpx.TimeoutException as e:
            raise _SlotError("timeout", COOL_ERROR_S) from e
        except httpx.HTTPError as e:
            raise _SlotError(f"network: {type(e).__name__}", COOL_ERROR_S) from e
        if r.status_code in (401, 403):
            raise _SlotError(f"http {r.status_code} (key rejected)", COOL_AUTH_S)
        if r.status_code == 429:
            try:
                wait = float(r.headers.get("retry-after", ""))
            except ValueError:
                wait = COOL_RATE_S
            raise _SlotError("http 429 (rate limited)", max(1.0, min(COOL_MAX_S, wait)))
        if r.status_code >= 400:
            # 4xx other than auth/rate is a bad request for this provider (e.g. an unknown model): rest it a while
            raise _SlotError(f"http {r.status_code}", COOL_ERROR_S if r.status_code >= 500 else 60.0)
        try:
            data = r.json()
            if p.kind == "anthropic":
                text = "".join(b.get("text", "") for b in data["content"] if b.get("type") == "text")
            else:
                text = data["choices"][0]["message"]["content"] or ""
        except (ValueError, KeyError, IndexError, TypeError, AttributeError) as e:
            raise _SlotError("unreadable response", COOL_ERROR_S) from e
        if not text.strip():
            raise _SlotError("empty response", 0.0)
        return text


class _SlotError(Exception):
    def __init__(self, reason: str, cool_s: float) -> None:
        super().__init__(reason)
        self.reason = reason
        self.cool_s = cool_s
