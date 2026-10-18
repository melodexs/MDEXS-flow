"""Health endpoints (versioned under /api/v1/health)."""

from __future__ import annotations

from fastapi import APIRouter

from app.modules.health.schemas import DatabaseHealth, HealthResponse
from app.modules.health.service import database_status, service_status

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def get_health() -> HealthResponse:
    return HealthResponse(
        **service_status(),
        database=DatabaseHealth.model_validate(database_status()),
    )
