"""Versioned API v1 router. Feature modules are mounted here."""

from __future__ import annotations

from fastapi import APIRouter

from app.modules.auth import router as auth_router
from app.modules.health import router as health_router

api_v1_router = APIRouter(prefix="/api/v1")
api_v1_router.include_router(health_router.router)
api_v1_router.include_router(auth_router.router)
