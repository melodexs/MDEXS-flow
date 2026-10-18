"""Database access layer.

The engine is created lazily. When DATABASE_URL is unset (local development
without a cloud database), no engine is created and requesters receive None
instead of a failing connection pool.
"""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core import config

_engine: Engine | None = None
_session_factory: sessionmaker[Session] | None = None


def get_engine() -> Engine | None:
    """Return the SQLAlchemy engine, or None when no database is configured."""
    global _engine, _session_factory
    if _engine is None:
        url = config.get_settings().sqlalchemy_url
        if url is None:
            return None
        _engine = create_engine(url, pool_pre_ping=True, future=True)
        _session_factory = sessionmaker(bind=_engine, expire_on_commit=False, future=True)
    return _engine


def has_database() -> bool:
    """True when a cloud database URL is configured."""
    return config.get_settings().sqlalchemy_url is not None


def reset_engine() -> None:
    """Dispose and clear the cached engine (used by tests and config reloads)."""
    global _engine, _session_factory
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _session_factory = None


def get_session() -> Iterator[Session]:
    """FastAPI dependency yielding a database session.

    Raises RuntimeError when called without a configured database so that
    miswired startup fails loudly instead of silently at request time.
    """
    if get_engine() is None or _session_factory is None:
        raise RuntimeError("Database access requested but DATABASE_URL is not configured.")
    with _session_factory() as session:
        yield session
