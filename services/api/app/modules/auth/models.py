"""Persistent authentication models (Phase 3).

Design notes:
- Users are keyed by a stable UUID, not the email (emails can change).
- Password credentials are optional because Google-only accounts exist;
  when present, only a bcrypt hash is stored.
- External identities (Google) live in a separate table keyed by
  (provider, provider_subject) so an account can gain/lose identities
  without touching the user row. A provider subject is only linked after
  the backend verified the provider token itself.
- Refresh sessions store only a SHA-256 hash of the opaque refresh token;
  the raw token exists only in the client's possession.
"""

from __future__ import annotations

import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base


def _utcnow() -> datetime:
    return datetime.now(UTC)


class AccountStatus(enum.StrEnum):
    ACTIVE = "active"
    SUSPENDED = "suspended"


class User(Base):
    """An application account (internal identity)."""

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[AccountStatus] = mapped_column(
        Enum(AccountStatus, name="account_status"), default=AccountStatus.ACTIVE, nullable=False
    )
    # Null for Google-only accounts. bcrypt hash, never plaintext.
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Email verification is performed by a real provider (e.g. Google
    # verified-claim) or a future verification flow — never assumed.
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    identities: Mapped[list[UserIdentity]] = relationship(back_populates="user", lazy="selectin")
    refresh_sessions: Mapped[list[RefreshSession]] = relationship(back_populates="user")


class UserIdentity(Base):
    """A verified external identity linked to a user (e.g. Google OIDC sub)."""

    __tablename__ = "user_identities"
    __table_args__ = (
        UniqueConstraint("provider", "provider_subject", name="uq_provider_subject"),
        Index("ix_user_identities_user", "user_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    # Stable subject claim ("sub") from the provider, not an email.
    provider_subject: Mapped[str] = mapped_column(String(255), nullable=False)
    # Whether the provider asserted the email as verified at link time.
    provider_email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    user: Mapped[User] = relationship(back_populates="identities")


class RefreshSession(Base):
    """A revocable refresh session; only the token hash is persisted."""

    __tablename__ = "refresh_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # The previous session id this token was rotated from (reuse detection).
    rotated_from_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    user: Mapped[User] = relationship(back_populates="refresh_sessions")
