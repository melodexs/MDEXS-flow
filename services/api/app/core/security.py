"""Cryptographic primitives for authentication.

Password hashing: bcrypt (maintained library, tunable work factor).
Access tokens: signed JWTs via PyJWT (no custom crypto).
Refresh tokens: opaque high-entropy values from `secrets`; only a SHA-256
hash is stored server-side.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt

from app.core import config

logger = logging.getLogger(__name__)

ACCESS_TOKEN_TYPE = "access"
_BCRYPT_ROUNDS = 12
_ephemeral_secret: bytes | None = None


def _get_jwt_secret() -> str:
    """Return the configured signing key, or an ephemeral dev key.

    Production requires JWT_SECRET_KEY (enforced by config validation).
    In development an ephemeral per-process key is generated so no secret
    is needed locally; tokens simply do not survive restarts.
    """
    settings = config.get_settings()
    if settings.jwt_secret_key:
        return settings.jwt_secret_key
    if settings.is_production:
        # Defensive: config validation should already have failed startup.
        raise RuntimeError("JWT_SECRET_KEY is required in production")
    global _ephemeral_secret
    if _ephemeral_secret is None:
        _ephemeral_secret = secrets.token_bytes(64)
        logger.warning(
            "JWT_SECRET_KEY not set; using an ephemeral development key "
            "(restarts invalidate all access tokens)."
        )
    return _ephemeral_secret.hex()


# ── Passwords ────────────────────────────────────────────────────────


def hash_password(password: str) -> str:
    """Hash a password with bcrypt (work factor 12)."""
    digest = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=_BCRYPT_ROUNDS))
    return digest.decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    """Constant-time password verification; False on any mismatch."""
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        # Malformed stored hash: treat as failed verification.
        return False


# ── Access tokens (JWT) ──────────────────────────────────────────────


def create_access_token(user_id: str) -> tuple[str, int]:
    """Create a signed access JWT. Returns (token, expires_in_seconds)."""
    settings = config.get_settings()
    lifetime = timedelta(minutes=settings.access_token_expire_minutes)
    now = datetime.now(UTC)
    payload = {
        "sub": user_id,
        "type": ACCESS_TOKEN_TYPE,
        "iat": now,
        "exp": now + lifetime,
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
    }
    token = jwt.encode(payload, _get_jwt_secret(), algorithm="HS256")
    return token, int(lifetime.total_seconds())


def decode_access_token(token: str) -> str:
    """Validate an access JWT and return the user id.

    Verifies signature, expiration, issuer, audience, and that the token
    is an *access* token (refresh/malformed types are rejected). Raises
    jwt.PyJWTError on any failure.
    """
    settings = config.get_settings()
    payload = jwt.decode(
        token,
        _get_jwt_secret(),
        algorithms=["HS256"],
        audience=settings.jwt_audience,
        issuer=settings.jwt_issuer,
        options={"require": ["exp", "sub", "type", "iss", "aud"]},
    )
    if payload.get("type") != ACCESS_TOKEN_TYPE:
        raise jwt.InvalidTokenError("wrong token type")
    user_id = payload.get("sub")
    if not isinstance(user_id, str) or not user_id:
        raise jwt.InvalidTokenError("missing subject")
    return user_id


# ── Refresh tokens (opaque) ───────────────────────────────────────────


def generate_refresh_token() -> str:
    """Generate a cryptographically secure opaque refresh token."""
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    """SHA-256 hash of a refresh token (what gets persisted)."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def refresh_expiry() -> datetime:
    settings = config.get_settings()
    return datetime.now(UTC) + timedelta(days=settings.refresh_token_expire_days)
