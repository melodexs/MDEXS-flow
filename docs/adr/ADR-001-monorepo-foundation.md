# ADR-001: Monorepo foundation choices

Status: accepted (provisional) — 2026-10-18

## Context

MDEXS Flow needs a maintainable monorepo shared between a React Native
mobile app, a FastAPI backend, and future shared tooling, with CI.

## Decisions

- **Package manager: pnpm workspaces.** Handles the JS side (apps/mobile,
  packages/contracts, future apps/admin) with workspace protocol deps
  (`"workspace:*"`), fast installs, and strict dependency hygiene.
- **Mobile routing: Expo Router.** File-based routing matches the
  `app/` directory convention, is first-party maintained, and keeps deep
  linking simple.
- **Python workflow: pyproject.toml + venv + pip.** Single-source project
  metadata with optional-dependency dev extras. A move to `uv` is allowed
  later without changing the pyproject contract.
- **API stack: FastAPI + SQLAlchemy 2 + Alembic.** Clean module separation
  (routers / schemas / services / database). The engine is created lazily
  so the API runs in development without a database, and health reporting
  states this honestly rather than implying connectivity.
- **Migrations: Alembic**, version files in `services/api/alembic/versions`.
  URL comes from `DATABASE_URL` only; Alembic refuses to run without it.
- **Initial deploy target: Render.** Dockerfile provided; **no deployment
  happens without owner authorization.**
- **Admin dashboard: deferred.** `apps/admin/` location reserved in the
  architecture; intended as a React web app consuming the same contracts.

## Consequences

- Mobile/JS tooling is pnpm-only (an `.npmrc` and workspace file pin this).
- The API test suite runs credential-free in CI.
- TTS/OCR/object-storage specifics are deliberately out of scope here (ADR-002).
