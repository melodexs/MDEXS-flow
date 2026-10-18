"""Application configuration loaded from environment variables.

All settings are backend-only. The mobile application must never receive
any value from this module.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-driven application settings."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "MDEXS Flow API"
    api_version: str = "0.1.0"
    env: str = "development"
    port: int = 8000
    log_level: str = "INFO"

    # Backend-only database credentials. Empty means the API runs without a
    # database (local development) and health checks must report it as skipped.
    database_url: str = ""
    db_driver: str = "postgresql+psycopg"

    cors_origins: list[str] = ["http://localhost:8081"]
    cors_allow_all: bool = False

    # ── Authentication ──────────────────────────────────────────────
    # Signing key for access JWTs. Required in production; in development
    # an ephemeral per-process key is generated (see core/security.py) so
    # local runs need no secret.
    jwt_secret_key: str = ""
    jwt_issuer: str = "mdexs-flow-api"
    jwt_audience: str = "mdexs-flow-app"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30
    # Google OIDC audiences accepted by the backend (server-side config;
    # the mobile app only ever holds client IDs, never secrets).
    google_web_client_id: str = ""
    google_ios_client_id: str = ""
    # Dev-grade in-process rate limiting (per key). Production should use
    # an edge/Redis limiter; see docs/security.md.
    auth_rate_limit_per_minute: int = 10

    @field_validator("env")
    @classmethod
    def _validate_env(cls, value: str) -> str:
        allowed = {"development", "production"}
        if value not in allowed:
            raise ValueError(f"env must be one of {sorted(allowed)}, got {value!r}")
        return value

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    @property
    def sqlalchemy_url(self) -> str | None:
        """SQLAlchemy URL for the cloud database, or None when unset.

        The raw DATABASE_URL is treated as the provider's connection string
        and converted to a SQLAlchemy URL using the configured driver.
        """
        if not self.database_url:
            return None
        if self.database_url.startswith("postgresql+"):
            # Already a SQLAlchemy URL with an explicit driver.
            return self.database_url
        if self.database_url.startswith("sqlite"):
            # Local test/development database (never in production).
            return self.database_url
        # Plain provider connection string: apply the configured driver.
        rest = self.database_url.split("://", 1)[1]
        return f"{self.db_driver}://{rest}"

    def validate_runtime_safety(self) -> None:
        """Fail clearly when required production configuration is missing.

        Local development deliberately needs none of these, so ordinary
        unit tests never depend on production secrets.
        """
        problems: list[str] = []
        if self.is_production:
            if not self.database_url:
                problems.append("DATABASE_URL is required in production")
            if self.cors_allow_all:
                problems.append("CORS_ALLOW_ALL=true is not allowed in production")
            if "*" in self.cors_origins:
                problems.append("CORS_ORIGINS must list exact origins in production")
            if not self.jwt_secret_key:
                problems.append("JWT_SECRET_KEY is required in production")
            elif len(self.jwt_secret_key) < 32:
                problems.append("JWT_SECRET_KEY must be at least 32 characters")
        if problems:
            raise RuntimeError("Invalid production configuration: " + "; ".join(problems))


@lru_cache
def get_settings() -> Settings:
    """Return cached settings for the process."""
    return Settings()
