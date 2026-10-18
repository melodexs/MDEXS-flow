"""Tests for typed configuration behavior."""

from __future__ import annotations

import pytest

from app.core.config import Settings


def test_defaults_match_documentation() -> None:
    settings = Settings()
    assert settings.app_name == "MDEXS Flow API"
    assert settings.api_version == "0.1.0"
    assert settings.env == "development"
    assert settings.port == 8000
    assert settings.log_level == "INFO"
    assert settings.database_url == ""
    assert settings.cors_origins == ["http://localhost:8081"]
    assert settings.cors_allow_all is False
    assert settings.sqlalchemy_url is None
    assert settings.is_production is False


def test_sqlalchemy_url_uses_configured_driver() -> None:
    settings = Settings(database_url="postgresql://user:pw@host/db", db_driver="postgresql+psycopg")
    assert settings.sqlalchemy_url == "postgresql+psycopg://user:pw@host/db"


def test_sqlalchemy_url_passthrough_for_explicit_driver() -> None:
    settings = Settings(database_url="postgresql+psycopg://user:pw@host/db")
    assert settings.sqlalchemy_url == "postgresql+psycopg://user:pw@host/db"


def test_invalid_env_rejected() -> None:
    with pytest.raises(Exception, match="env must be"):
        Settings(env="staging")


def test_production_requires_database_url() -> None:
    settings = Settings(env="production")
    with pytest.raises(RuntimeError, match="DATABASE_URL is required"):
        settings.validate_runtime_safety()


def test_production_rejects_wildcard_cors() -> None:
    settings = Settings(
        env="production",
        database_url="postgresql://u:p@h/db",
        cors_allow_all=True,
        jwt_secret_key="s" * 32,
    )
    with pytest.raises(RuntimeError, match="CORS_ALLOW_ALL"):
        settings.validate_runtime_safety()


def test_production_accepts_valid_configuration() -> None:
    settings = Settings(
        env="production", database_url="postgresql://u:p@h/db", jwt_secret_key="s" * 32
    )
    settings.validate_runtime_safety()  # must not raise
