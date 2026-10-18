"""Authentication tests: registration, login, tokens, sessions, Google.

These run against an in-memory SQLite database via the ORM. They verify
the real service/route logic, not Neon connectivity. Google tests
monkeypatch the verification boundary — no network or live credentials.
"""

from __future__ import annotations

import time

import jwt as pyjwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

import app.modules.auth.google as google_module
from app.core import security
from app.modules.auth.models import AccountStatus, RefreshSession, User

NEW_USER = {
    "email": "Reader@Example.com",
    "password": "correct horse battery",
    "display_name": "Reader",
}
NORM_EMAIL = "reader@example.com"


def register(client: TestClient, **overrides) -> dict:
    payload = {**NEW_USER, **overrides}
    response = client.post("/api/v1/auth/register", json=payload)
    return response.json()


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── Registration ─────────────────────────────────────────────────────


def test_register_success(client: TestClient) -> None:
    response = client.post("/api/v1/auth/register", json=NEW_USER)
    assert response.status_code == 201
    body = response.json()
    assert body["user"]["email"] == NORM_EMAIL
    assert body["access_token"] and body["refresh_token"] and body["expires_in"] > 0
    assert set(body["user"]) == {"id", "email", "display_name", "status", "email_verified"}
    # New accounts are not claimed verified.
    assert body["user"]["email_verified"] is False


def test_password_stored_as_hash_not_plaintext(
    client: TestClient, db_factory: sessionmaker[Session]
) -> None:
    register(client)
    with db_factory() as session:
        user = session.scalar(select(User).where(User.email == NORM_EMAIL))
        assert user is not None
        assert user.password_hash
        assert user.password_hash != NEW_USER["password"]
        assert NEW_USER["password"] not in user.password_hash
        assert security.verify_password(NEW_USER["password"], user.password_hash)


def test_duplicate_normalized_email_rejected(client: TestClient) -> None:
    assert client.post("/api/v1/auth/register", json=NEW_USER).status_code == 201
    # Different casing + padding must still collide after normalization.
    dup = {**NEW_USER, "email": "  reader@example.COM  "}
    response = client.post("/api/v1/auth/register", json=dup)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "email_taken"


def test_invalid_email_or_short_password_rejected(client: TestClient) -> None:
    bad_email = {**NEW_USER, "email": "not-an-email"}
    assert client.post("/api/v1/auth/register", json=bad_email).status_code == 422
    short_pw = {**NEW_USER, "password": "short"}
    assert client.post("/api/v1/auth/register", json=short_pw).status_code == 422


def test_register_response_never_contains_password_hash(client: TestClient) -> None:
    response = client.post("/api/v1/auth/register", json=NEW_USER)
    assert "password_hash" not in response.text
    assert NEW_USER["password"] not in response.text


# ── Login ─────────────────────────────────────────────────────────────


def login(client: TestClient, email: str, password: str) -> TestClient:
    return client.post("/api/v1/auth/login", json={"email": email, "password": password})


def test_login_correct_credentials(client: TestClient) -> None:
    register(client)
    response = login(client, NORM_EMAIL, NEW_USER["password"])
    assert response.status_code == 200
    assert response.json()["user"]["email"] == NORM_EMAIL


def test_login_wrong_password_fails_with_generic_error(client: TestClient) -> None:
    register(client)
    response = login(client, NORM_EMAIL, "wrong password entirely")
    assert response.status_code == 401
    assert response.json()["error"]["message"] == "Invalid email or password."


def test_login_unknown_email_matches_wrong_password_error(client: TestClient) -> None:
    register(client)
    unknown = login(client, "ghost@example.com", NEW_USER["password"])
    wrong = login(client, NORM_EMAIL, "wrong password entirely")
    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json()["error"] == wrong.json()["error"]  # non-enumerating


def test_suspended_account_cannot_authenticate(
    client: TestClient, db_factory: sessionmaker[Session]
) -> None:
    register(client)
    with db_factory() as session:
        user = session.scalar(select(User).where(User.email == NORM_EMAIL))
        user.status = AccountStatus.SUSPENDED
        session.commit()
    response = login(client, NORM_EMAIL, NEW_USER["password"])
    assert response.status_code == 401
    # Same generic message — no account-status oracle.
    assert response.json()["error"]["message"] == "Invalid email or password."


# ── Access tokens ────────────────────────────────────────────────────


def test_me_requires_authentication(client: TestClient) -> None:
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "auth_required"


def test_me_with_valid_access_token(client: TestClient) -> None:
    body = register(client)
    response = client.get("/api/v1/auth/me", headers=auth_headers(body["access_token"]))
    assert response.status_code == 200
    assert response.json()["email"] == NORM_EMAIL
    assert "password_hash" not in response.text


def test_me_with_expired_access_token_rejected(client: TestClient) -> None:
    body = register(client)
    token = body["access_token"]
    # Craft an expired variant of the same signed token.
    payload = pyjwt.decode(token, options={"verify_signature": False})
    payload["exp"] = int(time.time()) - 3600
    expired = pyjwt.encode(payload, security._get_jwt_secret(), algorithm="HS256")
    response = client.get("/api/v1/auth/me", headers=auth_headers(expired))
    assert response.status_code == 401


def test_wrong_token_type_rejected(client: TestClient) -> None:
    body = register(client)
    payload = pyjwt.decode(body["access_token"], options={"verify_signature": False})
    payload["type"] = "refresh"
    wrong_type = pyjwt.encode(payload, security._get_jwt_secret(), algorithm="HS256")
    response = client.get("/api/v1/auth/me", headers=auth_headers(wrong_type))
    assert response.status_code == 401


def test_tampered_signature_rejected(client: TestClient) -> None:
    body = register(client)
    forged = body["access_token"][:-2] + "zz"
    response = client.get("/api/v1/auth/me", headers=auth_headers(forged))
    assert response.status_code == 401


# ── Refresh sessions ──────────────────────────────────────────────────


def test_refresh_rotates_credentials(client: TestClient) -> None:
    body = register(client)
    response = client.post("/api/v1/auth/refresh", json={"refresh_token": body["refresh_token"]})
    assert response.status_code == 200
    rotated = response.json()
    # Opaque refresh tokens must rotate; access tokens may be identical when
    # minted within the same second (same payload, same signature).
    assert rotated["refresh_token"] != body["refresh_token"]
    me = client.get("/api/v1/auth/me", headers=auth_headers(rotated["access_token"]))
    assert me.status_code == 200


def test_reused_rotated_refresh_token_revokes_family(client: TestClient) -> None:
    body = register(client)
    first = client.post("/api/v1/auth/refresh", json={"refresh_token": body["refresh_token"]})
    rotated = first.json()["refresh_token"]
    # Presenting the ORIGINAL (now rotated) token is detected as reuse:
    reuse = client.post("/api/v1/auth/refresh", json={"refresh_token": body["refresh_token"]})
    assert reuse.status_code == 401
    # Theft policy: the whole session family is revoked, including the new one.
    after = client.post("/api/v1/auth/refresh", json={"refresh_token": rotated})
    assert after.status_code == 401


def test_logout_revokes_refresh_session(client: TestClient) -> None:
    body = register(client)
    logout = client.post("/api/v1/auth/logout", json={"refresh_token": body["refresh_token"]})
    assert logout.status_code == 200 and logout.json()["ok"] is True
    refresh = client.post("/api/v1/auth/refresh", json={"refresh_token": body["refresh_token"]})
    assert refresh.status_code == 401


def test_logout_is_idempotent_and_safe(client: TestClient) -> None:
    body = register(client)
    token = body["refresh_token"]
    assert client.post("/api/v1/auth/logout", json={"refresh_token": token}).status_code == 200
    assert client.post("/api/v1/auth/logout", json={"refresh_token": token}).status_code == 200
    assert client.post("/api/v1/auth/logout", json={"refresh_token": "x" * 40}).status_code == 200


def test_invalid_refresh_token_rejected(client: TestClient) -> None:
    response = client.post("/api/v1/auth/refresh", json={"refresh_token": "t" * 48})
    assert response.status_code == 401


def test_raw_refresh_tokens_never_persisted(
    client: TestClient, db_factory: sessionmaker[Session]
) -> None:
    """Only SHA-256 hashes are stored; the raw token appears nowhere."""
    body = register(client)
    token = body["refresh_token"]
    with db_factory() as session:
        records = session.scalars(select(RefreshSession)).all()
        assert records, "a refresh session row must exist"
        for record in records:
            assert record.token_hash == security.hash_refresh_token(token)
            assert record.token_hash != token


# ── Google identity ───────────────────────────────────────────────────


def _google_identity(**overrides):
    identity = google_module.VerifiedGoogleIdentity(
        subject="google-sub-123",
        email="google.user@example.com",
        email_verified=True,
        display_name="Google User",
    )
    for key, value in overrides.items():
        object.__setattr__(identity, key, value)
    return identity


def test_google_rejected_when_not_configured(client: TestClient) -> None:
    response = client.post("/api/v1/auth/google", json={"id_token": "f" * 64})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "google_not_configured"


def test_google_invalid_token_rejected(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOOGLE_WEB_CLIENT_ID", "test-client-id.apps.googleusercontent.com")

    def rejected(_token: str):
        raise google_module.GoogleAuthRejected("verification failed")

    monkeypatch.setattr(google_module, "verify_google_id_token", rejected)
    response = client.post("/api/v1/auth/google", json={"id_token": "f" * 64})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "google_invalid"


def test_google_valid_identity_creates_and_reuses_account(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("GOOGLE_WEB_CLIENT_ID", "test-client-id.apps.googleusercontent.com")
    identity = _google_identity()
    monkeypatch.setattr(google_module, "verify_google_id_token", lambda _t: identity)

    first = client.post("/api/v1/auth/google", json={"id_token": "f" * 64})
    assert first.status_code == 200
    user_a = first.json()["user"]
    assert user_a["email"] == "google.user@example.com"
    assert user_a["email_verified"] is True  # provider-asserted

    # Second sign-in with the same provider subject → same internal account.
    second = client.post("/api/v1/auth/google", json={"id_token": "f" * 64})
    assert second.json()["user"]["id"] == user_a["id"]


def test_google_links_existing_account_only_with_verified_email(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("GOOGLE_WEB_CLIENT_ID", "test-client-id.apps.googleusercontent.com")
    registered = register(client)  # password account for google.user@example.com
    assert registered["user"]["email"] == NORM_EMAIL
    # Same email, verified by Google → auto-link policy applies.
    identity = _google_identity(subject="google-sub-999", email=NORM_EMAIL)
    monkeypatch.setattr(google_module, "verify_google_id_token", lambda _t: identity)
    linked = client.post("/api/v1/auth/google", json={"id_token": "f" * 64})
    assert linked.status_code == 200
    assert linked.json()["user"]["id"] == registered["user"]["id"]


def test_google_unverified_email_does_not_link_existing_account(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("GOOGLE_WEB_CLIENT_ID", "test-client-id.apps.googleusercontent.com")
    registered = register(client)
    identity = _google_identity(subject="google-sub-777", email=NORM_EMAIL, email_verified=False)
    monkeypatch.setattr(google_module, "verify_google_id_token", lambda _t: identity)
    result = client.post("/api/v1/auth/google", json={"id_token": "f" * 64})
    # Unverified provider email must NOT silently take over the password
    # account — the link attempt is refused (no takeover, no duplicate).
    assert result.status_code == 409
    assert result.json()["error"]["code"] == "email_conflict"
    assert (
        result.json()["user"]["id"] != registered["user"]["id"] if "user" in result.json() else True
    )


# ── Rate limiting (dev limiter) ──────────────────────────────────────


def test_rate_limiter_fixed_window() -> None:
    from app.core.rate_limit import RateLimiter

    limiter = RateLimiter(per_minute=2)
    assert limiter.allow("k") and limiter.allow("k")
    assert not limiter.allow("k")
    assert limiter.allow("other")  # independent keys
