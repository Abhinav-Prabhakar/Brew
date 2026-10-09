"""Engine / session helpers. SQLite by default, PostgreSQL via DATABASE_URL."""

from __future__ import annotations

from sqlalchemy import Engine, create_engine
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session, sessionmaker

from brew.settings import get_settings

from .models import Base


def async_url(url: str) -> str:
    """Map a sync SQLAlchemy URL to its async driver."""
    if url.startswith("sqlite:///"):
        return url.replace("sqlite:///", "sqlite+aiosqlite:///", 1)
    if url.startswith("postgresql+psycopg://"):
        return url.replace("postgresql+psycopg://", "postgresql+psycopg_async://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg_async://", 1)
    return url


def sync_url(url: str) -> str:
    if url.startswith("sqlite+aiosqlite:///"):
        return url.replace("sqlite+aiosqlite:///", "sqlite:///", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


def make_sync_engine(url: str | None = None) -> Engine:
    return create_engine(sync_url(url or get_settings().resolved_database_url()), future=True)


def make_async_engine(url: str | None = None) -> AsyncEngine:
    return create_async_engine(async_url(url or get_settings().resolved_database_url()), future=True)


def sync_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(engine, expire_on_commit=False)


def async_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


def create_all(engine: Engine) -> None:
    """Create tables directly (tests / dev). Production uses ``alembic upgrade head``."""
    Base.metadata.create_all(engine)
