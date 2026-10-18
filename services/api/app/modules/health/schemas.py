"""API schema definitions for the health module."""

from __future__ import annotations

from pydantic import BaseModel


class DatabaseHealth(BaseModel):
    status: str
    latency_ms: float | None = None


class HealthResponse(BaseModel):
    """Contract for GET /health and GET /api/v1/health.

    Mirrors packages/contracts/src/health.ts — keep both in sync.
    """

    service: str
    status: str
    environment: str
    version: str
    database: DatabaseHealth
