"""Async SQLAlchemy database engine, session factory, and FastAPI dependency."""

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from .config import get_settings


class Base(DeclarativeBase):
    """Shared declarative base for all ORM models."""


def get_engine():
    """Create and return a new async SQLAlchemy engine using the configured database URL."""
    settings = get_settings()
    return create_async_engine(settings.database_url, echo=False)


def get_session_factory(engine):
    """Return an async session factory bound to *engine*."""
    return async_sessionmaker(engine, expire_on_commit=False)


async def get_db():
    """FastAPI dependency that yields a single-request ``AsyncSession``.

    A new engine and session are created per request so that the dependency
    works correctly without a global connection pool in development.
    """
    settings = get_settings()
    engine = create_async_engine(settings.database_url)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
