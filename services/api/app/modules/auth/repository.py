"""Repository layer: all persistence queries for auth, no HTTP concerns."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import security
from app.modules.auth.models import AccountStatus, RefreshSession, User, UserIdentity


def _as_utc(value: datetime) -> datetime:
    """Coerce naive datetimes (e.g. from SQLite) to aware UTC ones."""
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


class UserRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get_by_email(self, email: str) -> User | None:
        return self._session.scalar(select(User).where(User.email == email))

    def get_by_id(self, user_id: str) -> User | None:
        return self._session.get(User, user_id)

    def email_exists(self, email: str) -> bool:
        return self.get_by_email(email) is not None

    def create_with_password(self, email: str, password: str, display_name: str) -> User:
        user = User(
            email=email,
            display_name=display_name,
            password_hash=security.hash_password(password),
        )
        self._session.add(user)
        self._session.commit()
        return user


class IdentityRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get_by_provider(self, provider: str, subject: str) -> UserIdentity | None:
        return self._session.scalar(
            select(UserIdentity).where(
                UserIdentity.provider == provider,
                UserIdentity.provider_subject == subject,
            )
        )

    def create(
        self, user_id: str, provider: str, subject: str, email_verified: bool
    ) -> UserIdentity:
        identity = UserIdentity(
            user_id=user_id,
            provider=provider,
            provider_subject=subject,
            provider_email_verified=email_verified,
        )
        self._session.add(identity)
        self._session.commit()
        return identity


class RefreshSessionRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def create(
        self, user_id: str, token: str, rotated_from_id: str | None = None
    ) -> RefreshSession:
        session_record = RefreshSession(
            user_id=user_id,
            token_hash=security.hash_refresh_token(token),
            expires_at=security.refresh_expiry(),
            rotated_from_id=rotated_from_id,
        )
        self._session.add(session_record)
        self._session.commit()
        return session_record

    def find_valid(self, token: str) -> RefreshSession | None:
        """Return the matching non-revoked, non-expired session, if any."""
        token_hash = security.hash_refresh_token(token)
        record = self._session.scalar(
            select(RefreshSession).where(RefreshSession.token_hash == token_hash)
        )
        if record is None:
            return None
        now = datetime.now(UTC)
        if _as_utc(record.expires_at) <= now:
            return None
        if record.revoked_at is not None:
            return None
        return record

    def find_any(self, token: str) -> RefreshSession | None:
        """Return the matching session regardless of state (reuse detection)."""
        return self._session.scalar(
            select(RefreshSession).where(
                RefreshSession.token_hash == security.hash_refresh_token(token)
            )
        )

    def revoke(self, record: RefreshSession) -> None:
        record.revoked_at = datetime.now(UTC)
        self._session.commit()

    def revoke_all_for_user(self, user_id: str) -> None:
        records = self._session.scalars(
            select(RefreshSession).where(
                RefreshSession.user_id == user_id,
                RefreshSession.revoked_at.is_(None),
            )
        ).all()
        now = datetime.now(UTC)
        for record in records:
            record.revoked_at = now
        self._session.commit()


def is_active(user: User) -> bool:
    return user.status == AccountStatus.ACTIVE
