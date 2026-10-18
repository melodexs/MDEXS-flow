"""Google ID-token verification boundary.

Uses Google's supported validation via google-auth (`verify_oauth2_token`),
which checks signature (JWKS), issuer, and expiry. Audience is checked
against the configured client IDs. Never trust client-supplied claims.

Tests monkeypatch `verify_google_id_token`, so no network or live Google
credentials are needed.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from google.auth.exceptions import GoogleAuthError
from google.oauth2.id_token import verify_oauth2_token

from app.core import config

logger = logging.getLogger(__name__)

GOOGLE_ISSUERS = ("https://accounts.google.com", "accounts.google.com")


class GoogleAuthRejected(Exception):
    """Raised when a Google token fails verification."""

    code = "google_invalid"


@dataclass(frozen=True)
class VerifiedGoogleIdentity:
    """Claims verified by the backend, not by the client."""

    subject: str  # "sub": stable per-user id — the only identity key
    email: str | None
    email_verified: bool
    display_name: str | None


def allowed_audiences() -> list[str]:
    settings = config.get_settings()
    return [a for a in (settings.google_web_client_id, settings.google_ios_client_id) if a]


def verify_google_id_token(token: str) -> VerifiedGoogleIdentity:
    """Verify a Google OIDC ID token against the configured audiences."""
    audiences = allowed_audiences()
    if not audiences:
        not_configured = GoogleAuthRejected("Google sign-in is not configured on this server")
    not_configured.code = "google_not_configured"
    raise not_configured

    # verify_oauth2_token: signature, issuer, expiry; audience per candidate.
    last_error: Exception | None = None
    for audience in audiences:
        try:
            payload = verify_oauth2_token(token, audience=audience)
        except (GoogleAuthError, ValueError) as exc:  # noqa: PERF203
            last_error = exc
            continue
        if payload.get("iss") not in GOOGLE_ISSUERS:
            last_error = GoogleAuthError("unexpected issuer")
            continue
        subject = payload.get("sub")
        if not isinstance(subject, str) or not subject:
            last_error = GoogleAuthError("missing subject")
            continue
        email = payload.get("email")
        email_verified = bool(payload.get("email_verified"))
        name = payload.get("name")
        return VerifiedGoogleIdentity(
            subject=subject,
            email=email if isinstance(email, str) else None,
            email_verified=email_verified,
            display_name=name if isinstance(name, str) else None,
        )
    logger.info("Google token verification failed: %s", type(last_error).__name__)
    raise GoogleAuthRejected("Google token verification failed")
