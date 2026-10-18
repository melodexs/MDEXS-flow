# ADR-005: Authentication and session design

- **Status:** Accepted (Phase 3)
- **Date:** 2026-10-18
- **Deciders:** Okoh Destiny, Superagent
- **Related:** ADR-004 (Neon and deferrals), docs/security.md

## Context

MDEXS Flow needs accounts before any user data can sync: registration, sign-in,
profile access, and a session that survives app restarts. The FastAPI backend is
the sole authority for identity and permissions; the mobile client only holds
credentials and renders state. Two sign-in methods are in scope: email/password
and Google (OIDC). Password-reset email delivery is explicitly out of scope
until a real email provider is chosen.

## Decision

1. **Access tokens are short-lived signed JWTs** (default 15 minutes,
   `ACCESS_TOKEN_EXPIRE_MINUTES`). HS256 via PyJWT — no custom crypto. Each
   token carries `sub` (user id), `type: "access"`, `iss`, `aud`, `iat`, `exp`;
   validation rejects wrong type, wrong issuer/audience, expiry, and bad
   signature. Refresh tokens are never accepted as access tokens.

2. **Refresh credentials are opaque, high-entropy tokens** (`secrets.token_urlsafe`)
   stored **only as SHA-256 hashes** in `refresh_sessions` (default 30 days).
   They rotate on every use: presenting a rotated or revoked token is treated
   as theft and revokes the user's entire session family, forcing a fresh
   sign-in. Logout revokes the session; outstanding access JWTs remain valid
   until their short expiry — we do not claim immediate access-token
   revocation.

3. **Passwords use bcrypt** (work factor 12) via the maintained `bcrypt`
   package. Login errors are generic ("Invalid email or password.") for both
   unknown email and wrong password; suspended accounts return the same
   message so status cannot be enumerated.

4. **Google sign-in uses native OIDC**: the native SDK
   (`@react-native-google-signin/google-signin`) returns an OIDC `id_token`;
   the backend verifies signature, issuer, audience (configured client IDs),
   expiry, and the `sub` claim via `google-auth`. No client secret exists in
   the app; no client-supplied email is trusted.

5. **Account linking policy:** a Google identity auto-links an existing
   email/password account ONLY when Google asserts the email as verified.
   An unverified provider email colliding with an existing account is refused
   (`email_conflict`) — no silent takeover, no duplicate accounts. New Google
   users get `email_verified` set from the provider claim only.

6. **Client token handling:** access token in memory only; refresh token in
   `expo-secure-store` (Keychain / Android Keystore). The API client refreshes
   single-flight on an authentication-expiry 401 and retries only idempotent
   (GET/HEAD) requests at most once.

## Alternatives considered

- **Long-lived JWTs without refresh sessions** — rejected: no revocation.
- **Access-token denylist for immediate revocation** — deferred: adds state
  to every request; short expiry + revocable sessions is the standard trade.
- **Firebase/Auth0/Base44-managed auth** — rejected by project architecture:
  the FastAPI backend must remain the identity authority.
- **Passlib for hashing** — rejected: passlib is unmaintained (breaks with
  bcrypt ≥ 4.1); the `bcrypt` package is called directly.

## Consequences

- Sessions are revocable server-side; stolen refresh tokens trigger family
  revocation on reuse.
- A per-instance in-process rate limiter guards register/login in development;
  production needs an edge/Redis limiter (documented as outstanding).
- Google end-to-end requires real OAuth client IDs and a native development
  build — configured via environment variables, untested in this phase.
