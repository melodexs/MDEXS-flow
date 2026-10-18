"""FastAPI dependencies for authenticated routes."""

from __future__ import annotations

import jwt as pyjwt
from fastapi import Depends, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core import security
from app.core.errors import ApiError
from app.database.session import get_session
from app.modules.auth.models import AccountStatus, User
from app.modules.auth.repository import UserRepository

_bearer_scheme = HTTPBearer(auto_error=False)


def client_ip(request: Request) -> str:
    """Best-effort client key for rate limiting (dev grade)."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    session: Session = Depends(get_session),
) -> User:
    """Require a valid, unexpired *access* token and return its user.

    The dependency future protected endpoints will use. The mobile guard
    is UX only; authorization is always enforced here.
    """
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise ApiError(status.HTTP_401_UNAUTHORIZED, "auth_required", "Authentication required.")
    try:
        user_id = security.decode_access_token(credentials.credentials)
    except pyjwt.PyJWTError:
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED, "auth_invalid", "Access token is invalid or expired."
        ) from None
    user = UserRepository(session).get_by_id(user_id)
    if user is None or user.status != AccountStatus.ACTIVE:
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED, "auth_invalid", "Access token is invalid or expired."
        )
    return user
