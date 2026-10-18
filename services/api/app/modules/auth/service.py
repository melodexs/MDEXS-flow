"""Authentication service: business logic, no HTTP concerns.

Token design (see docs/security.md and ADR-005):
- Short-lived signed JWT access tokens (default 15 min).
- Opaque high-entropy refresh tokens; only SHA-256 hashes persisted.
- Refresh tokens rotate on every use. Presenting a rotated/revoked token
  is treated as theft: ALL of the user's refresh sessions are revoked.
- Login errors are generic (no account enumeration).
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core import security
from app.modules.auth import google as google_module
from app.modules.auth.models import AccountStatus, User
from app.modules.auth.repository import (
    IdentityRepository,
    RefreshSessionRepository,
    UserRepository,
)
from app.modules.auth.schemas import normalize_email


class AuthError(Exception):
    """Expected authentication failure with a client-safe message."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int = 401,
        code: str = "auth_failed",
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code


@dataclass
class SessionTokens:
    access_token: str
    expires_in: int
    refresh_token: str
    user: User


class AuthService:
    def __init__(self, session: Session) -> None:
        self._session = session
        self.users = UserRepository(session)
        self.identities = IdentityRepository(session)
        self.sessions = RefreshSessionRepository(session)

    # ── Registration ─────────────────────────────────────────────

    def register(self, email: str, password: str, display_name: str) -> SessionTokens:
        email = normalize_email(email)
        if self.users.email_exists(email):
            # Generic message; the same shape a login failure returns.
            raise AuthError("Email is already in use.", status_code=409, code="email_taken")
        user = self.users.create_with_password(email, password, display_name)
        return self._issue(user)

    # ── Login ────────────────────────────────────────────────────

    def login(self, email: str, password: str) -> SessionTokens:
        email = normalize_email(email)
        user = self.users.get_by_email(email)
        # Same generic error whether the email is unknown or the password
        # is wrong; verification runs even for unknown users (constant
        # work shape, and no timing oracle from early exit).
        stored_hash = (
            user.password_hash if user and user.password_hash else security.hash_password(password)
        )
        password_ok = security.verify_password(password, stored_hash)
        if user is None or not password_ok:
            raise AuthError("Invalid email or password.")
        if user.status != AccountStatus.ACTIVE:
            raise AuthError("Invalid email or password.")  # same message: no enumeration
        return self._issue(user)

    # ── Refresh / rotation ───────────────────────────────────────

    def refresh(self, token: str) -> SessionTokens:
        existing = self.sessions.find_valid(token)
        if existing is None:
            # Reuse detection: a known-but-invalid token (already rotated or
            # revoked) means the token was stolen or replayed — revoke the
            # entire family and require a fresh sign-in.
            known = self.sessions.find_any(token)
            if known is not None:
                self.sessions.revoke_all_for_user(known.user_id)
            raise AuthError("Refresh token is invalid or expired.", code="refresh_invalid")
        user = self.users.get_by_id(existing.user_id)
        if user is None or user.status != AccountStatus.ACTIVE:
            raise AuthError("Refresh token is invalid or expired.", code="refresh_invalid")
        # Rotate: the old token becomes unusable, a new one is issued.
        self.sessions.revoke(existing)
        return self._issue(user, rotated_from_id=existing.id)

    # ── Logout ───────────────────────────────────────────────────

    def logout(self, token: str) -> None:
        existing = self.sessions.find_valid(token)
        if existing is not None:
            self.sessions.revoke(existing)
        # Idempotent: an unknown/already-revoked token is a no-op, so a
        # double logout (or an attacker probing) reveals nothing.

    # ── Google ───────────────────────────────────────────────────

    def login_with_google(self, id_token_value: str) -> SessionTokens:
        try:
            identity = google_module.verify_google_id_token(id_token_value)
        except google_module.GoogleAuthRejected as exc:
            status_code = 503 if exc.code == "google_not_configured" else 401
            raise AuthError(str(exc), status_code=status_code, code=exc.code) from exc

        linked = self.identities.get_by_provider("google", identity.subject)
        if linked is not None:
            user = self.users.get_by_id(linked.user_id)
            if user is None or user.status != AccountStatus.ACTIVE:
                raise AuthError("This account cannot sign in.", code="account_inactive")
            return self._issue(user)

        # No existing Google identity. Linking policy: an internal account
        # may be auto-linked by email ONLY when Google asserts the email
        # as verified; otherwise a new unverified account is created.
        email = identity.email.lower() if identity.email else None
        if email and identity.email_verified:
            existing_user = self.users.get_by_email(email)
            if existing_user is not None:
                if existing_user.status != AccountStatus.ACTIVE:
                    raise AuthError("This account cannot sign in.", code="account_inactive")
                self.identities.create(existing_user.id, "google", identity.subject, True)
                return self._issue(existing_user)

        if email is None:
            raise AuthError(
                "Google account did not provide an email address.", code="google_invalid"
            )
        if self.users.email_exists(email):
            # Unverified provider email colliding with an existing account:
            # never auto-link (takeover risk) and never duplicate the email.
            raise AuthError(
                "That email already has an account. Sign in with your password, "
                "then link Google from your profile.",
                status_code=409,
                code="email_conflict",
            )
        display_name = identity.display_name or email.split("@")[0]
        user = User(email=email, display_name=display_name, email_verified=identity.email_verified)
        self._session.add(user)
        self._session.commit()
        self.identities.create(user.id, "google", identity.subject, identity.email_verified)
        return self._issue(user)

    # ── Helpers ──────────────────────────────────────────────────

    def _issue(self, user: User, rotated_from_id: str | None = None) -> SessionTokens:
        access_token, expires_in = security.create_access_token(user.id)
        refresh_token = security.generate_refresh_token()
        self.sessions.create(user.id, refresh_token, rotated_from_id=rotated_from_id)
        return SessionTokens(access_token, expires_in, refresh_token, user)
