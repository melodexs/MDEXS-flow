"""Health module: service status reporting.

The database status is reported honestly:
- "skipped": no DATABASE_URL configured (development without a cloud DB).
- "connected": a lightweight SELECT 1 succeeded.
- "unavailable": configured, but the check failed.

Basic process health (/health and the service block of /api/v1/health) never
probes the database; the database check is separate and explicit.
"""

from __future__ import annotations

import logging
import time

from sqlalchemy import text

from app.core import config
from app.database.session import get_engine, has_database

logger = logging.getLogger(__name__)

DATABASE_SKIPPED = "skipped"
DATABASE_CONNECTED = "connected"
DATABASE_UNAVAILABLE = "unavailable"


def service_status() -> dict[str, str]:
    """Return service identity and configuration status (no database probe)."""
    settings = config.get_settings()
    return {
        "service": settings.app_name,
        "status": "ok",
        "environment": settings.env,
        "version": settings.api_version,
    }


def database_status() -> dict[str, object]:
    """Probe the cloud database when one is configured."""
    if not has_database():
        return {"status": DATABASE_SKIPPED, "latency_ms": None}

    engine = get_engine()
    started = time.perf_counter()
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        latency_ms = round((time.perf_counter() - started) * 1000, 1)
        return {"status": DATABASE_CONNECTED, "latency_ms": latency_ms}
    except Exception:
        # Log the failure type server-side; never log credentials.
        logger.exception("Database health check failed")
        return {"status": DATABASE_UNAVAILABLE, "latency_ms": None}
