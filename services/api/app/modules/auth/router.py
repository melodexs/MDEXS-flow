"""Authentication routes. Thin: validation via schemas, logic in service."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.rate_limit import login_limiter
from app.database.session import get_session
from app.modules.auth import dependencies, schemas, service
from app.modules.auth.models import User

router = APIRouter(prefix="/auth", tags=["auth"])


def _auth_response(tokens: service.SessionTokens) -> schemas.AuthResponse:
    return schemas.AuthResponse(
        access_token=tokens.access_token,
        expires_in=tokens.expires_in,
        refresh_token=tokens.refresh_token,
        user=schemas.UserResponse.from_user(tokens.user),
    )


def _rate_limited(request: Request, action: str) -> None:
    if not login_limiter().allow(f"{action}:{dependencies.client_ip(request)}"):
        raise ApiError(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "rate_limited",
            "Too many attempts. Try again in a minute.",
        )


@router.post(
    "/register",
    response_model=schemas.AuthResponse,
    status_code=status.HTTP_201_CREATED,
)
def register(
    payload: schemas.RegisterRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> schemas.AuthResponse:
    _rate_limited(request, "register")
    svc = service.AuthService(session)
    try:
        tokens = svc.register(payload.email, payload.password, payload.display_name)
    except service.AuthError as exc:
        raise _to_api_error(exc) from None
    return _auth_response(tokens)


@router.post("/login", response_model=schemas.AuthResponse)
def login(
    payload: schemas.LoginRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> schemas.AuthResponse:
    _rate_limited(request, "login")
    svc = service.AuthService(session)
    try:
        tokens = svc.login(payload.email, payload.password)
    except service.AuthError as exc:
        raise _to_api_error(exc) from None
    return _auth_response(tokens)


@router.post("/refresh", response_model=schemas.AuthResponse)
def refresh(
    payload: schemas.RefreshRequest,
    session: Session = Depends(get_session),
) -> schemas.AuthResponse:
    svc = service.AuthService(session)
    try:
        tokens = svc.refresh(payload.refresh_token)
    except service.AuthError as exc:
        raise _to_api_error(exc) from None
    return _auth_response(tokens)


@router.post("/google", response_model=schemas.AuthResponse)
def google_login(
    payload: schemas.GoogleAuthRequest,
    session: Session = Depends(get_session),
) -> schemas.AuthResponse:
    svc = service.AuthService(session)
    try:
        tokens = svc.login_with_google(payload.id_token)
    except service.AuthError as exc:
        raise _to_api_error(exc) from None
    return _auth_response(tokens)


@router.post("/logout", response_model=schemas.LogoutResponse)
def logout(
    payload: schemas.LogoutRequest,
    session: Session = Depends(get_session),
) -> schemas.LogoutResponse:
    service.AuthService(session).logout(payload.refresh_token)
    return schemas.LogoutResponse(ok=True)


@router.get("/me", response_model=schemas.UserResponse)
def me(current_user: User = Depends(dependencies.get_current_user)) -> schemas.UserResponse:
    return schemas.UserResponse.from_user(current_user)


def _to_api_error(exc: service.AuthError) -> ApiError:
    return ApiError(exc.status_code, exc.code, exc.message)
