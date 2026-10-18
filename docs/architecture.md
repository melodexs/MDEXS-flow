# MDEXS Flow — Architecture

## Components

| Component | Tech | Responsibility |
|---|---|---|
| `apps/mobile` | React Native + Expo Router + TS | Product app; UI, local SQLite, file import, playback, downloads, offline sync queue |
| `apps/admin` | (deferred, planned React web) | Catalog moderation and administration; location reserved |
| `services/api` | FastAPI + SQLAlchemy 2 | Auth, catalog, sync, moderation; sole holder of DB and storage credentials |
| Cloud DB | Neon PostgreSQL | Accounts, catalog metadata, submissions, moderation records, progress/playlist/activity, sync metadata |
| Object storage | provider-neutral (undecided) | Media files: music, PDFs, audiobooks, artwork, voice packs |
| Local DB | SQLite on device | Library, file locations, progress, bookmarks, playlists, sessions, pending sync ops |
| `packages/contracts` | TS types + guards | Shared API shapes consumed by the mobile app |

## Boundaries (security-critical)

- The mobile app talks **only** to the API over HTTPS and to object storage
  via short-lived signed URLs issued by the API.
- The mobile app never receives: the Neon connection string, storage
  credentials, or any admin capability. Privileged operations are role-gated
  API endpoints, never app-side logic.
- The API is the only component with database access.
- Downloaded media files live in app-sandbox file storage, separate from
  SQLite records (records reference file paths, never store the files).

## Data separation

Cloud PostgreSQL: accounts/profiles, catalog metadata + media references,
submissions and moderation records, playlists/bookmarks/progress/activity,
sync metadata and permissions.

On-device SQLite: local library + imported file references, download records
and local file locations, reading positions/bookmarks/playback
state/playlists, reading/listening sessions, pending sync operations.

## Phase roadmap

1. **Phase 1 — Foundation report** (done): compatibility, structure, open decisions.
2. **Phase 2 — Monorepo scaffold** (this): API health service, mobile shell, contracts, CI.
3. Phase 3 — Auth: email/password + Google sign-in, JWT issue/refresh.
4. Phase 4 — Mobile local SQLite schema; sync-queue groundwork.
5. Phase 5 — Music import + playback (react-native-track-player, dev build).
6. Phase 6 — PDF import + rendering + positions/bookmarks.
7. Phase 7 — Audiobooks (reuse audio engine).
8. Phase 8 — Catalog API + resumable downloads + signed storage URLs.
9. Phase 9 — Sync engine (queue, conflict resolution, online transition).
10. Phase 10 — Activity tracking (day/week/month).
11. Phase 11 — Submissions + moderation; admin endpoints (+ admin UI).
12. Phase 12 — PDF-to-speech + offline voice pack strategy (pending ADR-002).
13. Phase 13 — Test hardening, security review, store readiness.

## Authentication architecture (Phase 3)

FastAPI is the sole identity authority (ADR-005). Registration and login
issue a short-lived access JWT plus an opaque, hashed, rotating refresh
session. Google sign-in delivers an OIDC id_token to the backend, which
verifies it (signature, issuer, audience, expiry) and applies the verified
email auto-link policy. The mobile app stores only the refresh token
(expo-secure-store) and keeps the access token in memory; its API client
refreshes single-flight on expiry. Password reset is a documented
non-feature until an email provider is chosen. See docs/security.md for
lifetimes, revocation policy, and known limitations.
