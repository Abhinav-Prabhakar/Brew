"""FastAPI dependencies."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request

from .world_manager import ManagedWorld, WorldManager


def get_manager(request: Request) -> WorldManager:
    return request.app.state.manager  # type: ignore[no-any-return]


Manager = Annotated[WorldManager, Depends(get_manager)]


def get_world(wid: str, request: Request) -> ManagedWorld:
    return request.app.state.manager.get(wid)  # type: ignore[no-any-return]


MW = Annotated[ManagedWorld, Depends(get_world)]
