"""The lobby waiter: chat turns, his notepad, and which LLM providers are wired up."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from brew.sim.actions import BadPayload
from brew.waiter.service import Notepad, respond

from ..deps import MW

router = APIRouter(tags=["waiter"])


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=60)


def _pad(request: Request, wid: str) -> Notepad:
    pads: dict[str, Notepad] = request.app.state.waiter_pads
    return pads.setdefault(wid, Notepad())


@router.post("/worlds/{wid}/waiter/chat")
async def chat(wid: str, body: ChatRequest, mw: MW, request: Request) -> dict[str, Any]:
    """One turn. Send the conversation so far (the client keeps it); the last message must be the user's."""
    try:
        res = await respond(
            mw, request.app.state.llm, _pad(request, wid), [m.model_dump() for m in body.messages]
        )
    except ValueError as e:
        raise BadPayload(str(e)) from e
    return {**res, "sim_s": mw.world.now}


@router.get("/worlds/{wid}/waiter/notes")
def notes(wid: str, mw: MW, request: Request) -> dict[str, Any]:
    """Everything on the waiter's pad (complaints, requests, escalations), oldest first."""
    items = list(_pad(request, wid).items)
    return {"notes": items, "escalated": sum(1 for n in items if n["escalated"]), "sim_s": mw.world.now}


@router.get("/waiter/status")
def status(request: Request) -> dict[str, Any]:
    """Which LLM providers / keys the waiter can use and how they are doing (keys masked)."""
    return request.app.state.llm.status()  # type: ignore[no-any-return]
