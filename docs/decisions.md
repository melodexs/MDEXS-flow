# MDEXS Flow — Decisions

## Decided (provisional — change via a new ADR)

| # | Decision | Where |
|---|---|---|
| D1 | pnpm workspaces for the monorepo | ADR-001 |
| D2 | Expo Router for mobile navigation | ADR-001 |
| D3 | pyproject.toml + venv + pip for the API (uv upgrade possible later) | ADR-001 |
| D4 | FastAPI + SQLAlchemy 2 + Alembic; lazy engine, runs without a DB | ADR-001 |
| D5 | Alembic for migrations; versions live in `services/api/alembic/versions` | ADR-001 |
| D6 | Render as the initial deploy target (no deploy without authorization) | ADR-001 |
| D7 | Object storage stays provider-neutral behind an interface | ADR-002 |
| D8 | Provisional sync policy: versioned updates, LWW per progress item | offline-sync.md (provisional) |
| D9 | `apps/admin/` location reserved; React web app when built | ADR-001 |
| D10 | Neon as the planned cloud PostgreSQL provider (backend-only credentials) | ADR-004 |
| D11 | Local-first sync with durable outbox; scoped LWW policy | ADR-003 |
| D12 | Authentication deferred to Phase 3 (all endpoints public until then) | ADR-004 |
| D15 | Access = short-lived JWT (15 min); refresh = opaque hashed rotating tokens (30 days) | ADR-005 |
| D16 | Passwords: bcrypt (work factor 12); generic non-enumerating login errors | ADR-005 |
| D17 | Refresh reuse (rotated/revoked token replayed) revokes the user's whole session family | ADR-005 |
| D18 | Google: backend verifies OIDC id_token (signature/issuer/audience/exp); auto-link by email only when provider asserts verified | ADR-005 |
| D19 | Mobile: access token memory-only; refresh token in expo-secure-store; single-flight refresh in API client | ADR-005 |
| D13 | Offline TTS + OCR deferred pending feasibility decisions | ADR-002/004 |
| D14 | ESLint 9 flat config (typescript-eslint / eslint-config-expo) | ADR-001 |

## Open (must be decided before the relevant phase)

1. **Object storage provider** (S3 / R2 / B2) — affects egress cost, Nigeria
   download performance, signed-URL design. Needed by Phase 8.
2. **Offline TTS strategy** — system voices vs bundled packs (e.g. Piper).
   Largest technical risk; needed by Phase 12.
3. **OCR scope** — supporting scanned PDFs adds native ML Kit. Defer?
4. **Final conflict policy** — LWW vs "furthest reading position". Phase 9.
5. **Admin dashboard** — in-repo React vs separate Base44 web app. Phase 11.
6. **Content licensing plan** — what rights the catalog must verify. Phase 11.
7. **TTS voice-pack + auth details** — provider and scope decisions. Phases 3/12.
8. **ESLint scope** — Expo config lints app code only today; a shared root
   flat config can be extracted if the admin dashboard lands.
