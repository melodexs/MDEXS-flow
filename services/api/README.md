# MDEXS Flow API

FastAPI backend for MDEXS Flow. PostgreSQL (Neon) via SQLAlchemy 2.x and
Alembic. Deploy target: Render (not deployed yet).

## Setup

```bash
cd services/api
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
```

Copy `.env.example` from the repo root to `services/api/.env` for local runs.
The API starts **without** a database: leave `DATABASE_URL` empty and the
health endpoint honestly reports `database.status = "skipped"`.

## Run

```bash
.venv/bin/uvicorn app.main:app --reload --port 8000
# docs: http://localhost:8000/docs
```

## Tests / lint

```bash
.venv/bin/pytest
.venv/bin/ruff check app tests
.venv/bin/ruff format --check app tests
```

## Migrations (Alembic)

```bash
.venv/bin/alembic revision -m "describe_change"   # needs DATABASE_URL in .env
.venv/bin/alembic upgrade head
```

Generated version files live in `alembic/versions/`. Alembic refuses to run
without `DATABASE_URL` — it never guesses or commits a real connection string.

## Structure

- `app/main.py` — application factory, CORS, error envelope
- `app/api/v1/` — versioned routing
- `app/modules/<name>/` — routers, schemas, and services per feature
- `app/core/` — settings, logging, error handling
- `app/database/` — engine/session setup (lazy; None-safe without a URL)
- `tests/` — pytest suite (health, config, error envelope covered)

## Health responses

- `GET /health` — minimal liveness `{"status":"ok"}` (no database probe)
- `GET /api/v1/health` — `{"service","status","environment","version","database"}`;
  `database.status` is `skipped` (no DATABASE_URL), `connected` (SELECT 1
  succeeded), or `unavailable` (probe failed). It never claims connectivity
  that was not actually checked.

Production (`ENV=production`) fails at startup unless `DATABASE_URL` is set
and CORS is restricted to exact origins. Development needs no secrets.

## Authentication API (Phase 3)

All errors use the standard envelope. Base path `/api/v1/auth`.

| Method | Path            | Auth            | Success | Errors |
|--------|-----------------|-----------------|---------|--------|
| POST   | `/register`      | public          | 201 `AuthResponse` | 409 `email_taken`, 422 validation, 429 `rate_limited` |
| POST   | `/login`        | public          | 200 `AuthResponse` | 401 `auth_failed` (generic), 429 |
| POST   | `/refresh`      | refresh token   | 200 `AuthResponse` | 401 `refresh_invalid` |
| POST   | `/logout`       | refresh token   | 200 `{ok, note}`   | idempotent |
| POST   | `/google`       | Google id_token | 200/201           | 401 `google_invalid`, 409 `email_conflict`, 503 `google_not_configured` |
| GET    | `/me`           | Bearer access JWT | 200 `UserResponse` | 401 `auth_required`/`auth_invalid` |

`AuthResponse` = `{access_token, expires_in, refresh_token, user}` with
`user` containing only safe fields (never a password hash).

### Migrations

```bash
# With DATABASE_URL set (Neon in production, sqlite locally for dev):
alembic upgrade head          # apply
alembic upgrade head --sql    # review SQL without executing
```

The auth schema lives in revision `0001_auth` (users, user_identities,
refresh_sessions). Models are dialect-neutral; tests run against in-memory
SQLite created from the same metadata — **Neon/PostgreSQL connectivity is
not covered by the test suite** and must be verified with a live database
before deployment.

### Tests

```bash
pytest        # full suite (SQLite-backed; no credentials needed)
ruff check .  # lint
```

Google verification is boundary-tested with fixtures — no network or live
Google credentials are required.
