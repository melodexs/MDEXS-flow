"""Request/response schemas for authentication. Safe fields only."""

from __future__ import annotations

import re

from pydantic import BaseModel, EmailStr, Field, field_validator

_EMAIL_STRIP_RE = re.compile(r"\s+")


def normalize_email(value: str) -> str:
    """Canonical normalization: trim whitespace, strip + Gmail dots? No —
    only trim and lowercase. Dot-stripping would merge accounts that the
    provider treats as distinct outside Gmail.
    """
    return _EMAIL_STRIP_RE.sub("", value).lower()


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)
    display_name: str = Field(min_length=1, max_length=80)

    @field_validator("email")
    @classmethod
    def _normalize(cls, value: str) -> str:
        return normalize_email(value)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def _normalize(cls, value: str) -> str:
        return normalize_email(value)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=20, max_length=256)


class LogoutRequest(BaseModel):
    refresh_token: str = Field(min_length=20, max_length=256)


class GoogleAuthRequest(BaseModel):
    """A Google OIDC ID token obtained by the mobile client.

    The backend verifies the token itself; no client-supplied email or
    user id is trusted as proof of authentication.
    """

    id_token: str = Field(min_length=20, max_length=4096)


class UserResponse(BaseModel):
    """Safe account representation. Never includes password_hash."""

    id: str
    email: str
    display_name: str
    status: str
    email_verified: bool

    @classmethod
    def from_user(cls, user) -> UserResponse:  # noqa: ANN001 (avoid model import cycle)
        return cls(
            id=user.id,
            email=user.email,
            display_name=user.display_name,
            status=user.status.value,
            email_verified=user.email_verified,
        )


class AuthResponse(BaseModel):
    """Session issued by register/login/refresh/google."""

    access_token: str
    expires_in: int  # seconds
    refresh_token: str
    user: UserResponse


class LogoutResponse(BaseModel):
    ok: bool
    note: str = (
        "Refresh session revoked. Outstanding access tokens remain valid until "
        "their short expiry; protected endpoints enforce fresh validation on "
        "each request."
    )
