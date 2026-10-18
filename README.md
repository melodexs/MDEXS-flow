# MDEXS Flow

Offline-first music player and PDF reading/audiobook app for Android and iOS.

**Status: Phase 3 — authentication.** The monorepo foundation (Phase 2) is
hardened and the authentication layer is implemented: email/password
registration and login, JWT access tokens with rotating hashed refresh
sessions, logout with revocation, Google OIDC verification boundary, and a
mobile auth flow with secure token storage. Product features (import,
playback, reading, downloads, sync) are **planned, not implemented** — see
`docs/PRD.md`, `docs/architecture.md`, and `docs/adr/ADR-005-authentication.md`.

## Repository layout

```
apps/mobile/         Expo + React Native app (TypeScript, Expo Router)
apps/admin/          (planned; deferred — see docs/decisions.md)
services/api/        FastAPI backend (SQLAlchemy 2 + Alembic)
packages/contracts/  Shared API contract types (consumed by the mobile app)
database/            Migration + seed documentation (Alembic versions live in services/api)
infrastructure/      Render + object-storage configuration notes
docs/                PRD, architecture, offline-sync, security, decisions, ADRs
scripts/             Developer helper scripts
.github/workflows/   CI (Python lint/tests, TypeScript typecheck/tests)
```

## Prerequisites

- Node 20+ and pnpm 9 (`corepack enable`)
- Python 3.11+
- Git

## Common commands (repo root)

```bash
pnpm install                  # JS dependencies (workspace, from pnpm-lock.yaml)
pnpm dev:api:install          # API venv + dev dependencies (Python 3.11)
pnpm dev:api                  # API at http://localhost:8000 (no DB required)
pnpm dev:mobile               # Expo dev server (Metro)
pnpm lint                     # ESLint (JS) + ruff (Python)
pnpm typecheck                # TypeScript typecheck (all workspaces)
pnpm test                     # JS tests + API pytest
pnpm check                    # lint + typecheck + test (everything CI runs)
```

The Python scripts use the Unix venv layout (`.venv/bin`). On Windows, run
the equivalents from `services/api` directly: `.venv\Scripts\pip install
-e ".[dev]"` and `.venv\Scripts\uvicorn app.main:app --reload`.

## Environment

Copy `.env.example` → `.env` (API) and `apps/mobile/.env` (non-secret
`EXPO_PUBLIC_*` values). Never commit real credentials.

## CI

GitHub Actions runs on every push/PR: API ruff lint + format + pytest
(credential-free), JS lint (ESLint), contracts typecheck + tests, mobile
typecheck. No Neon account, Expo account, or secrets are required.

## Deployment

Initial target: Render (API) + Neon PostgreSQL. **Nothing is deployed
without the owner's authorization**; see `infrastructure/render/README.md`.
