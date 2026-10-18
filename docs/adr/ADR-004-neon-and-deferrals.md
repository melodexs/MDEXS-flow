# ADR-004: Neon as cloud PostgreSQL provider; deferred auth, TTS, OCR

Status: accepted (provisional) — 2026-10-18

## Context

Phase 2B requires the platform choices and deferrals to be recorded
explicitly rather than implied by earlier documents.

## Decisions

- **Neon is the planned cloud PostgreSQL provider.** The backend connects
  with a server-side connection string only (env `DATABASE_URL`, converted
  to SQLAlchemy with the `postgresql+psycopg` driver for the psycopg binary
  driver). Neon credentials never reach the mobile app or Git. Neon remains
  replaceable: the code uses standard SQLAlchemy/PostgreSQL, nothing
  Neon-specific.
- **Authentication is deferred** (Phase 3). The architectural boundary is
  in place — all privileged operations will be backend endpoints — but no
  user accounts, JWT issuance, or sign-in flows exist yet. Until Phase 3,
  every endpoint is public by design and the service must not be exposed.
- **Offline TTS and OCR are deferred** (Phase 12): system voices vs a
  bundled engine (and scanned-PDF support) remain unresolved product
  decisions; feasibility spikes must precede estimates.
- **Local-first synchronization** stands as the architecture: SQLite is the
  on-device working truth with a durable outbox; the cloud mirrors and
  arbitrates. Conflict policy per ADR-003 (scoped, provisional).

## Consequences

- Production startup now fails fast when required configuration (database
  URL, restricted CORS) is missing, while development and tests stay
  credential-free.
- The sync-phase schema must carry version/snapshot fields from the start
  (ADR-003).
