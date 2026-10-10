"""brew.llm.pool: rotation over providers and keys, failover, cooldowns, wire formats (no network: MockTransport)."""

from __future__ import annotations

import httpx
import pytest

from brew.llm import LLMPool, LLMUnavailable
from brew.llm.pool import read_dotenv

ENV = {
    "ANTHROPIC_API_KEYS": "ant-key-aaaa1111, ant-key-bbbb2222",
    "GROQ_API_KEY": "groq-key-cccc3333",
    "BREW_LLM_ORDER": "anthropic,groq",
}


def make(handler, env=ENV, **kw):
    t = [0.0]
    pool = LLMPool.from_env(
        env, client=httpx.AsyncClient(transport=httpx.MockTransport(handler)), clock=lambda: t[0], **kw
    )
    return pool, t


def ok(req: httpx.Request) -> httpx.Response:
    if "anthropic" in req.url.host:
        return httpx.Response(
            200, json={"content": [{"type": "text", "text": "hi from " + req.headers["x-api-key"][-4:]}]}
        )
    return httpx.Response(
        200, json={"choices": [{"message": {"content": "hi from " + req.headers["authorization"][-4:]}}]}
    )


async def test_round_robin_spreads_calls_over_every_provider_and_key():
    pool, _ = make(ok)
    got = [(await pool.chat("sys", [{"role": "user", "content": "hi"}])).text[-4:] for _ in range(6)]
    assert got == ["1111", "3333", "2222", "1111", "3333", "2222"]  # providers interleaved, keys rotated
    assert pool.status()["configured"] and [len(p["keys"]) for p in pool.status()["providers"]] == [2, 1]


async def test_wire_formats():
    seen = []

    def h(req: httpx.Request) -> httpx.Response:
        import json

        seen.append((req.url.host, dict(req.headers), json.loads(req.content)))
        return ok(req)

    pool, _ = make(h)
    for _ in range(2):
        await pool.chat("be kapi", [{"role": "user", "content": "hi"}], max_tokens=77)
    (h1, hd1, b1), (h2, hd2, b2) = seen
    assert (
        h1 == "api.anthropic.com"
        and hd1["anthropic-version"]
        and b1["system"] == "be kapi"
        and b1["max_tokens"] == 77
    )
    assert b1["messages"] == [{"role": "user", "content": "hi"}] and b1["model"] == "claude-haiku-5-5"
    assert h2 == "api.groq.com" and hd2["authorization"].startswith("Bearer groq-")
    assert (
        b2["messages"][0] == {"role": "system", "content": "be kapi"} and b2["messages"][1]["role"] == "user"
    )


async def test_failover_and_cooldown_then_recovery():
    down = {"1111", "3333"}

    def h(req: httpx.Request) -> httpx.Response:
        key = (req.headers.get("x-api-key") or req.headers["authorization"])[-4:]
        return httpx.Response(429, headers={"retry-after": "30"}) if key in down else ok(req)

    pool, t = make(h)
    r = await pool.chat("s", [{"role": "user", "content": "hi"}])
    assert r.text.endswith("2222") and r.attempts == 3 and len(r.tried) == 2
    # the two rate-limited keys are resting: the next calls go straight to the healthy one
    r = await pool.chat("s", [{"role": "user", "content": "hi"}])
    assert r.attempts == 1 and r.text.endswith("2222")
    cool = {k["key"]: k["cooling_s"] for p in pool.status()["providers"] for k in p["keys"]}
    assert cool == {"…1111": 30.0, "…2222": 0.0, "…3333": 30.0}
    down.clear()
    t[0] = 31.0
    got = {(await pool.chat("s", [{"role": "user", "content": "hi"}])).text[-4:] for _ in range(3)}
    assert got == {"1111", "2222", "3333"}


async def test_everything_down_raises_and_bad_keys_rest_longer():
    def h(req: httpx.Request) -> httpx.Response:
        return httpx.Response(401) if "anthropic" in req.url.host else httpx.Response(503)

    pool, _ = make(h)
    with pytest.raises(LLMUnavailable) as e:
        await pool.chat("s", [{"role": "user", "content": "hi"}])
    assert "key rejected" in str(e.value) and "503" in str(e.value)
    assert "ant-key" not in str(e.value) and "ant-key" not in str(pool.status())  # keys never leak
    cool = [k["cooling_s"] for p in pool.status()["providers"] for k in p["keys"]]
    assert cool[0] == cool[1] == 600.0 and cool[2] == 10.0
    with pytest.raises(LLMUnavailable):  # cooling slots are still tried when nothing else is left
        await pool.chat("s", [{"role": "user", "content": "hi"}])


async def test_priority_strategy_and_custom_provider_and_empty():
    env = {**ENV, "BREW_LLM_STRATEGY": "priority", "BREW_LLM_ORDER": "local,anthropic", "LOCAL_API_KEY": "local-key-dddd4444",
           "BREW_LLM_LOCAL_URL": "http://llm.test/v1/chat/completions", "BREW_LLM_LOCAL_MODEL": "tiny"}  # fmt: skip
    pool, _ = make(ok, env)
    got = [(await pool.chat("s", [{"role": "user", "content": "hi"}])).text[-4:] for _ in range(3)]
    assert got == ["4444"] * 3 and pool.status()["providers"][0]["model"] == "tiny"
    empty = LLMPool.from_env({})
    assert not empty.configured
    with pytest.raises(LLMUnavailable):
        await empty.chat("s", [{"role": "user", "content": "hi"}])


def test_dotenv(tmp_path):
    f = tmp_path / ".env"
    f.write_text(
        "# keys\nexport OPENAI_API_KEYS='sk-one-11112222,sk-two-33334444'\nBREW_LLM_OPENAI_MODEL=gpt-x\n\nnonsense\n"
    )
    assert read_dotenv(f) == {
        "OPENAI_API_KEYS": "sk-one-11112222,sk-two-33334444",
        "BREW_LLM_OPENAI_MODEL": "gpt-x",
    }
    pool = LLMPool.from_env({}, dotenv=f)
    assert [(p["name"], p["model"], len(p["keys"])) for p in pool.status()["providers"]] == [
        ("openai", "gpt-x", 2)
    ]
