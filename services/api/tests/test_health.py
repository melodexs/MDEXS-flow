"""Tests for the health endpoints and error envelope."""

from __future__ import annotations

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings

# Mirrors packages/contracts/src/health.ts — HealthResponse. If either side
# changes, update both. (A future phase may generate this from OpenAPI.)
EXPECTED_KEYS = {"service", "status", "environment", "version", "database"}


def test_app_starts_under_test_configuration(client: TestClient) -> None:
    """The application factory builds and serves requests with no secrets."""
    assert client.get("/health").status_code == 200


def test_root_health_is_minimal_liveness(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_versioned_health_reports_service_identity(client: TestClient) -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    body = response.json()
    assert body["service"] == "MDEXS Flow API"
    assert body["status"] == "ok"
    assert body["environment"] == "development"
    assert body["version"] == Settings().api_version


def test_health_database_status_is_skipped_without_database(client: TestClient) -> None:
    """Without DATABASE_URL the API must honestly report the DB as skipped."""
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["database"]["status"] == "skipped"
    assert response.json()["database"]["latency_ms"] is None


def test_health_contract_matches_contracts_package(client: TestClient) -> None:
    """The response shape must stay aligned with packages/contracts."""
    body = client.get("/api/v1/health").json()
    assert set(body.keys()) == EXPECTED_KEYS
    assert set(body["database"].keys()) == {"status", "latency_ms"}


def test_health_reports_unavailable_when_database_unreachable(
    make_client: Callable[[], TestClient], monkeypatch: pytest.MonkeyPatch
) -> None:
    """A configured but unreachable database is reported honestly as
    "unavailable" — never as connected, never crashing the endpoint."""
    monkeypatch.setenv("DATABASE_URL", "postgresql://mdexs:placeholder@localhost:9/no-such-db")
    client = make_client()
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["database"]["status"] == "unavailable"
    assert response.json()["database"]["latency_ms"] is None


def test_health_never_leaks_sensitive_configuration(
    make_client: Callable[[], TestClient], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Credentials or internal details must not appear in health responses."""
    secret_url = "postgresql://mdexs:supersecret@localhost:9/no-such-db"
    monkeypatch.setenv("DATABASE_URL", secret_url)
    client = make_client()
    body = client.get("/api/v1/health").text
    assert "supersecret" not in body
    assert "postgresql" not in body
    assert "DATABASE_URL" not in body


def test_unknown_route_returns_error_envelope(client: TestClient) -> None:
    response = client.get("/api/v1/does-not-exist")
    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "http_404"
    assert isinstance(error["message"], str)
    assert "details" in error


def test_internal_error_is_sanitized(monkeypatch: pytest.MonkeyPatch) -> None:
    """Unexpected exceptions return a generic message, not a stack trace."""
    from fastapi.testclient import TestClient as TC

    from app.main import create_app

    app = create_app()

    @app.get("/api/v1/_boom")
    async def _boom() -> object:
        raise RuntimeError("internal detail: host=10.0.0.1 token=abc123")

    with TC(app, raise_server_exceptions=False) as boom_client:
        response = boom_client.get("/api/v1/_boom")
    assert response.status_code == 500
    body = response.json()
    assert body["error"]["code"] == "internal_error"
    assert "internal detail" not in response.text
    assert "abc123" not in response.text
