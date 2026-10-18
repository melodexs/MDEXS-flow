# MDEXS Flow — Offline-First Sync Design (provisional)

Status: **design intent**. The local SQLite foundation described here landed in
Phase 4 (see ADR-006); the sync engine itself remains unimplemented (Phase 9).

## Principles

1. **Local first.** SQLite on device is the working truth. Every feature is
   usable with zero connectivity.
2. **The cloud is a mirror + authority for sharing.** Neon stores account
   progress so other devices can catch up; the API is the only writer.
3. **Media never syncs through the DB.** Files live in object storage and on
   the device; databases store references only.

## Local store (SQLite) contents

- Local library and imported file references (path, type, title, duration…)
- Download records (item id, local path, bytes, checksum)
- Reading positions, bookmarks, playback state, playlists
- Reading/listening sessions (day/week/month rollups derive from these)
- Pending sync operations (an append-only outbox queue)

## Outbox queue

**Phase 4 status:** the `sync_queue` table exists (schema, statuses, attempt
counters, pending index) with an explicit enqueue/list/update-status repository
(`apps/mobile/src/localdb/repositories/syncQueue.ts`). Queueing is explicit —
local mutations do NOT auto-queue yet; future feature code decides which
writes enqueue. Nothing drains the queue or contacts the backend.

A future Phase 9 engine consumes it safely and idempotently:
claim via `listPendingOperations` → `processing`, apply server-side keyed by
`(entity_type, entity_id)`, then `completed` or `failed` with a sanitized
error summary. An attempt counts once per claim; retries set `next_attempt_at`.

Original design follows:

```
(id, entity_type, entity_id, op, payload_json, base_version, created_at,
 attempts, last_error)
```

A sync run (triggered on app start, app foreground, and connectivity change)
pushes ops in order, per entity, then marks them applied. Ops are idempotent
and carry the version they were based on.

## Conflict policy (PROVISIONAL: versioned + last-write-wins, scoped)

Not every record is last-write-wins. The policy is scoped by record class:

- Each syncable record carries a monotonically increasing `version` and
  `updated_at`, device id, and (for progress items) the full value snapshot
  (e.g. exact reading position), so conflicts are detectable, not just guessed.
- On conflict for **progress items** (reading position, playback position):
  **last-write-wins** on `updated_at`; the loser's value is archived briefly
  for recovery, not merged.
- Playlists and bookmarks are item-based (add/remove ops) so concurrent edits
  usually merge naturally.
Records NOT under last-write-wins:

- **Playlist edits** — item-based add/remove ops that merge; a removal that
  wins over a concurrent add of the same item is resolved by op order, not
  timestamps, and is auditable.
- **Deletions** — tombstones win over concurrent edits (a deleted item does
  not resurrect because a late edit arrived).
- **Content permissions & moderation decisions** — always server-authoritative;
  the server's approval state is never overwritten by device writes.
- **Account data** — server is authoritative.

This is provisional: a "keep furthest read position" policy for reading
progress may serve readers better than LWW. Revisit in the sync phase
(ADR-003).

## Upload/download authorization (planned)

- Catalog downloads: API issues short-lived signed URLs only for approved items.
- User submission uploads: API-issued short-lived write URLs; content becomes
  visible only to reviewers until approved.
