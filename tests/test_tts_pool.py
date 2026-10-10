"""brew.llm.tts: provider order, key rotation, failover, wire formats, and the /waiter/speak endpoint (no network)."""

from __future__ import annotations

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from brew.api.app import create_app
from brew.llm import TTSPool, TTSUnavailable
from brew.settings import Settings

MP3 = b"ID3fake-audio"
ENV = {
    "BREW_TTS_ORDER": "elevenlabs, openai, browser",
    "ELEVENLABS_API_KEYS": "el-key-aaaa1111,el-key-bbbb2222",
    "OPENAI_API_KEY": "sk-key-cccc3333",
    "BREW_TTS_OPENAI_VOICE": "fable",
    "BREW_TTS_OPENAI_INSTRUCTIONS": "a tired, sarcastic waiter",
    "BREW_TTS_BROWSER_PITCH": "0.6",
}


def make(handler, env=ENV):
    t = [0.0]
    return TTSPool.from_env(
        env, client=httpx.AsyncClient(transport=httpx.MockTransport(handler)), clock=lambda: t[0]
    ), t


async def test_order_rotation_formats_and_failover():
    seen, down = [], set()

    def h(req: httpx.Request) -> httpx.Response:
        key = (req.headers.get("xi-api-key") or req.headers.get("authorization", ""))[-4:]
        seen.append((req.url.host, req.url.path, key, json.loads(req.content)))
        return (
            httpx.Response(429)
            if key in down
            else httpx.Response(200, content=MP3, headers={"content-type": "audio/mpeg"})
        )

    pool, _ = make(h)
    got = [(await pool.speak("Two  chais,\ncoming up!"))[2] for _ in range(3)]
    assert got == ["elevenlabs"] * 3 and [s[2] for s in seen] == [
        "1111",
        "2222",
        "1111",
    ]  # first provider, its keys in turn
    host, path, _, body = seen[0]
    assert (
        host == "api.elevenlabs.io"
        and path.startswith("/v1/text-to-speech/")
        and body["text"] == "Two chais, coming up!"
    )
    down.update({"1111", "2222"})
    audio, ctype, name = await pool.speak("hello")
    assert (audio, ctype, name) == (MP3, "audio/mpeg", "openai")
    assert seen[-1][0] == "api.openai.com" and seen[-1][3] == {
        "model": "gpt-4o-mini-tts", "voice": "fable", "input": "hello", "response_format": "mp3", "instructions": "a tired, sarcastic waiter"}  # fmt: skip
    st = pool.status()
    assert (
        [p["name"] for p in st["providers"]] == ["elevenlabs", "openai"]
        and st["browser"]
        == {
            "voice": "",
            "pitch": 0.6,
            "rate": 1.05,
        }
        and st["speed"] == 1.0
    )
    assert "el-key" not in str(st) and all(k["cooling_s"] > 0 for k in st["providers"][0]["keys"])


async def test_get_kind_json_is_not_audio_and_nothing_configured():
    def h(req: httpx.Request) -> httpx.Response:
        if req.url.host == "tts.test":
            assert (
                req.url.params["text"] == "hi there"
                and req.url.params["voice"] == "Brian"
                and req.url.params["k"] == "free-key-dddd4444"
            )
            return httpx.Response(200, content=MP3, headers={"content-type": "audio/mp3"})
        return httpx.Response(200, json={"error": "nope"})  # a 200 that is not audio must not be played

    env = {"BREW_TTS_ORDER": "openai,funny", "OPENAI_API_KEY": "sk-key-cccc3333", "BREW_TTS_FUNNY_KIND": "get", "BREW_TTS_FUNNY_VOICE": "Brian",
           "BREW_TTS_FUNNY_URL": "https://tts.test/speech?voice={voice}&text={text}&k={key}", "FUNNY_API_KEY": "free-key-dddd4444"}  # fmt: skip
    pool, _ = make(h, env)
    assert (await pool.speak("hi there"))[1:] == ("audio/mp3", "funny") and pool.browser is None
    empty = TTSPool.from_env({})
    assert not empty.configured and empty.browser is not None  # default: the browser voice is the fallback
    with pytest.raises(TTSUnavailable):
        await empty.speak("hi")


@pytest.mark.integration
def test_speak_endpoint():
    app = create_app(Settings(db_enabled=False, llm_enabled=False))
    with TestClient(app) as c:
        assert c.get("/api/v1/waiter/voice").json() == {"providers": [], "browser": None, "speed": 1.0}
        assert c.post("/api/v1/waiter/speak", json={"text": "hi"}).status_code == 503
        app.state.tts = make(
            lambda req: httpx.Response(200, content=MP3, headers={"content-type": "audio/mpeg"})
        )[0]
        r = c.post("/api/v1/waiter/speak", json={"text": "hi"})
        assert (
            r.status_code == 200
            and r.content == MP3
            and r.headers["x-brew-tts"] == "elevenlabs"
            and r.headers["content-type"] == "audio/mpeg"
        )
        assert c.post("/api/v1/waiter/speak", json={"text": ""}).status_code == 422


async def test_style_prefix_settings_and_speed():
    seen = []

    def h(req: httpx.Request) -> httpx.Response:
        seen.append(json.loads(req.content))
        return httpx.Response(200, content=MP3, headers={"content-type": "audio/mpeg"})

    env = {"BREW_TTS_ORDER": "elevenlabs", "ELEVENLABS_API_KEY": "el-key-aaaa1111", "BREW_TTS_ELEVENLABS_MODEL": "eleven_v3",
           "BREW_TTS_ELEVENLABS_PREFIX": "[sarcastic] [deadpan]", "BREW_TTS_ELEVENLABS_SETTINGS": '{"stability": 0.0}', "BREW_TTS_SPEED": "1.5"}  # fmt: skip
    pool, _ = make(h, env)
    await pool.speak("One latte.", "happy")
    await pool.speak("I'm so sorry about that.", "worried")  # no sarcasm at a real complaint
    assert seen[0] == {
        "text": "[sarcastic] [deadpan] One latte.",
        "model_id": "eleven_v3",
        "voice_settings": {"stability": 0.0},
    }
    assert seen[1]["text"] == "I'm so sorry about that." and pool.status()["speed"] == 1.5
