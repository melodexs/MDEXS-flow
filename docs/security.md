# MDEXS Flow — Security

## Secrets and configuration

- `.env` files, keys, and credentials are git-ignored; `.env.example`
  documents placeholders only.
- Neon connection strings, storage credentials, and any admin keys are
  **backend-only**. The mobile app bundle may only contain `EXPO_PUBLIC_*`
  non-secret values (API base URL, environment name).
- CI runs without production credentials: API tests run with no database,
  health honestly reports `database.status = "skipped"`.
- Never commit: real API keys, `.env`, venvs, databases, build output.

## Authentication (planned — not implemented)

- Email/password with server-side hashing (argon2/bcrypt) and Google sign-in
  (OAuth via the API), both issuing short-lived JWTs + refresh tokens.
- Password reset flows; rate limiting on auth endpoints.
- No tokens in SQLite beyond a secure-store refresh token (Keychain/Keystore).

## Permissions and administration (planned — documented, NOT implemented)

- User permissions are enforced **by the backend**: the mobile app requests
  operations and the API decides whether the authenticated user may perform
  them. The app never holds privilege state it can elevate.
- Admin access requires explicit server-side authorization (role claim
  verified per request). There are no admin-only secrets in the app.

## Media access (planned)

- Upload authorization: short-lived, scoped signed URLs; submissions are
  quarantined (pending) until an admin approves them.
- Download authorization: signed URLs for approved catalog items only.
- Signed URLs must have **limited scope and lifetime** (single object,
  read-only, short expiry) and must never grant listing or write access.
- Private media (pending submissions, unapproved content) is **not publicly
  accessible by default**; direct bucket access is denied without a signed
  URL issued by the API.
- Copyright: publication requires recorded rights attribution; moderation
  approval records the licensing decision. (Requirement, not yet implemented.)

## Security checklist (pre-merge)

- [ ] No secrets, tokens, or credentials in the diff
- [ ] `.env` untouched; only `.env.example` changed if new config added
- [ ] CORS: no new wildcards; production uses exact origins
- [ ] New endpoints validate input via Pydantic schemas
- [ ] Errors use the shared envelope; no internals leaked to clients
- [ ] Database access only through `app/database/session.py`
- [ ] Tests added and passing (`pytest`, `ruff`, `tsc`)
- [ ] Mobile: no privileged keys; only `EXPO_PUBLIC_*` non-secrets added

## Known limitations (Phase 2)

- Docs are disabled in production mode; enable deliberately if needed.
- `CORS_ALLOW_ALL=true` works only outside production and is a dev flag.
- No authentication exists yet; every endpoint is currently public by design
  until Phase 3.

## Authentication (Phase 3) — token lifecycle

- **Access tokens:** signed JWTs, HS256, 15-minute default lifetime. The
  backend validates signature, expiry, issuer, audience, subject, and token
  type on every protected request. Refresh tokens are structurally rejected
  for protected endpoints (wrong `type` claim).
- **Refresh sessions:** opaque 384-bit tokens; only SHA-256 hashes are stored
  in PostgreSQL. Every use rotates the credential; presenting an already
  rotated or revoked token is treated as theft and revokes **all** of the
  user's refresh sessions (family revocation). Logout revokes the session.
- **Passwords:** bcrypt, work factor 12, via the maintained `bcrypt` package
  (Passlib was rejected as unmaintained). Login failures are generic and
  identical for unknown email / wrong password / suspended account.
- **Google:** the backend verifies the OIDC id_token itself (signature via
  JWKS, issuer, audience, expiry) using `google-auth`. The mobile app holds
  only public client IDs, never a client secret. Account auto-linking by
  email happens only when Google asserts the email as verified.
- **Secrets:** `JWT_SECRET_KEY` is required in production (validated at
  startup, min 32 chars). In development an ephemeral per-process key is
  generated, so no secret is committed and local restarts invalidate tokens.
- **Dev rate limiting:** an in-process fixed-window limiter caps
  register/login per client IP. **Outstanding for production:** a shared /
  edge limiter (Redis or CDN-level) is required before public deployment.
- **HTTPS:** mandatory in production (Render terminates TLS); tokens must
  never travel over plain HTTP outside localhost development.

### Known limitations (do not treat as implemented)

- **Access-token revocation is not immediate**: a logout leaves existing
  access JWTs valid until their short expiry. This is an accepted trade-off
  documented in ADR-005; an explicit denylist was deferred.
- **Password reset is NOT implemented** — it requires a real, configurable
  email provider. The mobile screen is a clearly-marked placeholder.
- **Google sign-in end-to-end is untested** — no real OAuth client IDs exist
  yet; the backend verification path and mobile integration boundary are
  implemented and unit-tested, configuration pending.
- **Email verification for password accounts is not implemented**; new
  registrations are marked unverified (`email_verified: false`).
- **No account lockout / CAPTCHA** yet; rate limiting is dev-grade.
