# ADR-006: Local SQLite data layer

- **Status:** Accepted (Phase 4)
- **Date:** 2026-10-18
- **Deciders:** Okoh Destiny, Superagent
- **Related:** ADR-004 (Neon and deferrals), ADR-005 (Authentication), docs/offline-sync.md

## Context

MDEXS Flow is offline-first: library metadata, playback/reading progress,
bookmarks, playlists, and activity history must be readable and writable with
no network connection and no signed-in session. The cloud (FastAPI + Neon
PostgreSQL) is the sync and account layer only. Phase 4 needed a typed,
persistent, versioned local store on Android and iOS without building the
sync engine (Phase 9) or media import/playback (Phase 5+).

## Decision

1. **expo-sqlite (v15, SDK 53-compatible) is the local engine.** One
   database file (`mdexs_flow.db`) opened through a thin adapter
   (`openLocalDatabase()`) that enables foreign keys (`PRAGMA foreign_keys =
   ON`) and applies migrations. Initialization is idempotent: concurrent
   callers share one connection, applied migrations are skipped, and a failed
   initialization is not cached.

2. **Repositories depend on a minimal `SqlDriver` interface** (the
   expo-sqlite async subset: `runAsync`, `getFirstAsync`, `getAllAsync`,
   `withTransactionAsync`), not on expo-sqlite directly. On device the
   adapter wraps `SQLiteDatabase` (transactions are driven with explicit
   `BEGIN/COMMIT/ROLLBACK` because the library's own helper is void-typed).
   In Node tests the same interface is implemented over sql.js (WASM SQLite),
   so the production migration runner and repository code execute against a
   real SQLite engine in CI.

3. **Schema versioning uses `PRAGMA user_version`** with an ordered,
   append-only migration list (`src/localdb/migrations.ts`). Each migration
   runs inside one transaction and bumps the version atomically. A failing
   migration rolls back and surfaces a `migration_failed` error — startup
   never drops tables or deletes user data to "fix" a migration.

4. **Schema (version 1):** `library_items` (media metadata, `audio`|`pdf`,
   `device`|`catalog` origin, unavailable archival flag), `progress`
   (UNIQUE per item+type; upserted), `bookmarks` (typed audio/page),
   `playlists` + `playlist_items` (UNIQUE per playlist+item, gapless
   positions), `activity_history` (session records), and `sync_queue`
   (pending-operation log for Phase 9). FKs reference `library_items(id)`.
   IDs are RFC 4122 v4 UUID strings (expo-crypto `randomUUID`); timestamps
   are ISO-8601 UTC strings.

5. **Deletion is deliberate, not cascading.** A library item referenced by
   progress, bookmarks, playlist entries, or history is never deleted — the
   repository refuses and callers archive instead (`unavailable = 1`), so
   user history survives. Deleting a playlist removes its entries only.
   No `ON DELETE CASCADE` anywhere in the local schema.

6. **Validation lives at the application boundary** (`domain.ts`):
   media/progress/bookmark types, non-negative positions, page ≥ 1,
   type-vs-value consistency (audio needs `position_ms`, pdf needs `page`).
   All SQL is parameterized; values are validated before insert/update.
   Errors are stable-coded `LocalDbError`s whose messages never include
   SQL parameters, connection strings, or serialized payloads.

7. **The sync queue records, it does not sync.** Enqueueing is explicit —
   repositories never auto-queue. The queue table has explicit
   operation-type and status values, an index for pending-order drain, and
   attempt counters. Phase 9 consumes it idempotently (documented in the
   repository module). Nothing contacts the network.

## Consequences

- Local reads work with zero network and no auth token; auth secrets stay
  exclusively in expo-secure-store (ADR-005). SQLite never stores tokens.
- Binary media stays out of SQLite: rows reference app-managed file paths
  (nullable until the import phase) that only the import phase will create
  and verify.
- Adding an entity later means one migration entry and a repository module;
  screens consume typed domain objects, never raw rows.
- sql.js covers SQL semantics in tests, but native-device behavior
  (expo-sqlite native module, file persistence across restarts) must be
  verified on a real development build — the Node suite is not proof of
  on-device compatibility.
