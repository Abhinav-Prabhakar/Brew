"""FastAPI application factory (docs/implementation-spec.md 10.1)."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

import orjson
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from brew.config.loader import repo_root
from brew.llm import LLMPool, TTSPool
from brew.policies.charter import CharterViolation
from brew.settings import Settings, get_settings
from brew.sim.actions import ActionError
from brew.version import __version__

from .jobs import JobRegistry
from .world_manager import NotImplementedYet, UnknownWorld, WorldManager


class ORJSONResponse(Response):
    """JSON response serialised with orjson (numpy-safe)."""

    media_type = "application/json"

    def render(self, content: Any) -> bytes:
        return orjson.dumps(content, option=orjson.OPT_SERIALIZE_NUMPY | orjson.OPT_NON_STR_KEYS)


def error_body(code: str, message: str, details: Any = None) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "details": details}}


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the app. ``settings`` overrides the environment (used by tests)."""
    s = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):  # type: ignore[no-untyped-def]
        app.state.manager = WorldManager(s)
        app.state.jobs = JobRegistry()
        app.state.waiter_pads = {}
        if getattr(app.state, "llm", None) is None:  # (tests may set their own pool before startup)
            app.state.llm = LLMPool.from_env(dotenv=repo_root() / ".env") if s.llm_enabled else LLMPool()
        if getattr(app.state, "tts", None) is None:
            app.state.tts = TTSPool.from_env(dotenv=repo_root() / ".env") if s.llm_enabled else TTSPool()
        yield
        await app.state.llm.aclose()
        await app.state.tts.aclose()
        app.state.jobs.shutdown()
        await app.state.manager.shutdown()

    app = FastAPI(
        title="Brew API",
        version=__version__,
        description="Digital-twin cafe simulator: worlds, control, actions, read models and a WebSocket event stream.",
        default_response_class=ORJSONResponse,
        lifespan=lifespan,
    )
    app.state.settings = s
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(UnknownWorld)
    async def _unknown_world(_: Request, e: UnknownWorld) -> ORJSONResponse:
        return ORJSONResponse(error_body("world_not_found", f"world {e} not found"), status_code=404)

    @app.exception_handler(ActionError)
    async def _action_error(_: Request, e: ActionError) -> ORJSONResponse:
        code = {404: "not_found", 409: "invalid_action", 422: "bad_request"}.get(e.status, "error")
        return ORJSONResponse(error_body(code, str(e)), status_code=e.status)

    @app.exception_handler(CharterViolation)
    async def _charter(_: Request, e: CharterViolation) -> ORJSONResponse:
        return ORJSONResponse(error_body("charter_violation", str(e)), status_code=422)

    @app.exception_handler(NotImplementedYet)
    async def _not_impl(_: Request, e: NotImplementedYet) -> ORJSONResponse:
        return ORJSONResponse(
            error_body("not_implemented", str(e), {"milestone": e.milestone, "feature": e.what}),
            status_code=501,
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, e: RequestValidationError) -> ORJSONResponse:
        det = [{"loc": list(x["loc"]), "msg": x["msg"], "type": x["type"]} for x in e.errors()]
        return ORJSONResponse(
            error_body("validation_error", "request validation failed", det), status_code=422
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, e: StarletteHTTPException) -> ORJSONResponse:
        code = {404: "not_found", 405: "method_not_allowed"}.get(e.status_code, "http_error")
        return ORJSONResponse(error_body(code, str(e.detail)), status_code=e.status_code)

    from .routers import analysis, meta, read, waiter, worlds, ws

    prefix = "/api/v1"
    app.include_router(meta.router, prefix=prefix)
    app.include_router(worlds.router, prefix=prefix)
    app.include_router(read.router, prefix=prefix)
    app.include_router(analysis.router, prefix=prefix)
    app.include_router(ws.router, prefix=prefix)
    app.include_router(waiter.router, prefix=prefix)
    if s.serve_design:
        _mount_design(app)
    return app


def _mount_design(app: FastAPI) -> None:
    """Serve ``design/`` at ``/`` (index -> brew.html). Mounted last so ``/api/v1/*`` wins."""
    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles

    d = repo_root() / "design"
    if not (d / "brew.html").exists():
        return

    @app.get("/", include_in_schema=False)
    def _index() -> FileResponse:
        return FileResponse(d / "brew.html", media_type="text/html")

    app.mount("/", StaticFiles(directory=d), name="design")


def app_factory() -> FastAPI:
    return create_app()
