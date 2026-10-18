"""Consistent error-handling foundation.

All API errors use the envelope:

    {"error": {"code": <str>, "message": <str>, "details": <object|null>}}
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)


def error_response(status_code: int, code: str, message: str, details: Any = None) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=jsonable_encoder({"error": {"code": code, "message": message, "details": details}}),
    )


class ApiError(Exception):
    """Expected API failure rendered with the standard error envelope."""

    def __init__(self, status_code: int, code: str, message: str, details: Any = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details


def install_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(request: Request, exc: ApiError) -> JSONResponse:
        return error_response(exc.status_code, exc.code, exc.message, exc.details)

    """Register consistent JSON error handlers on the application."""

    @app.exception_handler(StarletteHTTPException)
    async def _http_exception(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return error_response(
            status_code=exc.status_code,
            code=f"http_{exc.status_code}",
            message=str(exc.detail),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_exception(request: Request, exc: RequestValidationError) -> JSONResponse:
        return error_response(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="validation_error",
            message="Request validation failed.",
            details=exc.errors(),
        )

    @app.exception_handler(Exception)
    async def _unhandled_exception(request: Request, exc: Exception) -> JSONResponse:
        # Never leak internals; log the real exception server-side.
        logger.exception("Unhandled server error", extra={"path": request.url.path})
        return error_response(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="internal_error",
            message="An internal server error occurred.",
        )
