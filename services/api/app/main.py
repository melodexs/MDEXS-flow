"""MDEXS Flow API application entry point."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_v1_router
from app.core import config
from app.core.errors import install_exception_handlers
from app.core.logging import configure_logging

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    """Application factory."""
    settings = config.get_settings()
    configure_logging()
    settings.validate_runtime_safety()

    app = FastAPI(
        title=settings.app_name,
        version=settings.api_version,
        # Docs stay available in development; disabled in production.
        docs_url="/docs" if not settings.is_production else None,
        redoc_url=None,
        openapi_url="/openapi.json",
    )

    # CORS: exact origins from settings. The wildcard is a development-only,
    # explicitly opt-in flag and refused in production by config validation.
    if settings.cors_allow_all and not settings.is_production:
        allowed: list[str] | str = ["*"]
    else:
        allowed = settings.cors_origins
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    install_exception_handlers(app)
    app.include_router(api_v1_router)

    @app.get("/health", tags=["health"], include_in_schema=False)
    async def root_health() -> dict[str, str]:
        """Unversioned liveness probe for platform health checks (Render).

        Deliberately minimal and dependency-free: it proves the process is
        alive and says nothing about the database. The full payload with an
        explicit database status lives at /api/v1/health.
        """
        return {"status": "ok"}

    return app


app = create_app()
