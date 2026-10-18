"""Shared test fixtures for the API test suite.

Each test runs with an isolated environment. Ordinary unit tests never
require production credentials or a live database: auth tests run against
an in-memory SQLite database created from the ORM metadata (production
schema management uses Alembic migrations).

Tests do NOT verify Neon/PostgreSQL integration — that requires a real
database connection and is reported as untested.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.core.config as config_module
import app.database.session as session_module
import app.modules.auth.models  # noqa: F401 — registers models on Base.metadata
from app.database.base import Base
from app.database.session import get_session
from app.main import create_app


@pytest.fixture(autouse=True)
def isolated_configuration(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Isolate env vars, cached settings, and the database engine per test."""
    monkeypatch.setenv("ENV", "development")
    monkeypatch.setenv("AUTH_RATE_LIMIT_PER_MINUTE", "1000")  # don't interfere with tests
    for var in (
        "DATABASE_URL",
        "CORS_ALLOW_ALL",
        "CORS_ORIGINS",
        "JWT_SECRET_KEY",
        "GOOGLE_WEB_CLIENT_ID",
        "GOOGLE_IOS_CLIENT_ID",
    ):
        monkeypatch.delenv(var, raising=False)
    config_module.get_settings.cache_clear()
    session_module.reset_engine()
    yield
    config_module.get_settings.cache_clear()
    session_module.reset_engine()


@pytest.fixture
def db_factory() -> Iterator[sessionmaker[Session]]:
    """In-memory SQLite created from ORM metadata (isolated per test)."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    yield factory
    engine.dispose()


@pytest.fixture
def make_client(db_factory: sessionmaker[Session]) -> Callable[[], TestClient]:
    """Build an app client whose DB dependency targets the test database."""

    def factory() -> TestClient:
        config_module.get_settings.cache_clear()

        def override_get_session() -> Iterator[Session]:
            with db_factory() as session:
                yield session

        app = create_app()
        app.dependency_overrides[get_session] = override_get_session
        return TestClient(app)

    return factory


@pytest.fixture
def client(make_client: Callable[[], TestClient]) -> TestClient:
    """App client with the test database under the default configuration."""
    return make_client()
