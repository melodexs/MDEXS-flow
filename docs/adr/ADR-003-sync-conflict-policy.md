# ADR-003: Provisional sync conflict policy (last-write-wins, versioned)

Status: proposed (provisional) — 2026-10-18

## Context

Offline-first usage means the same record (e.g. reading position) can change
on two devices before either syncs. The policy must keep sync predictable
without complex merge UIs.

## Decision (provisional)

- Versioned updates: every syncable record carries a version, updated_at,
  device id, and a full value snapshot.
- Progress items (reading position, playback position): **last-write-wins**
  by `updated_at`; the losing value is archived briefly for recovery.
- Playlists/bookmarks: item-based add/remove ops that merge naturally.
- Enough information is retained to detect and audit conflicts; nothing is
  silently merged.

## Why provisional

"Keep the furthest reading position" may serve readers better than LWW.
The final call is deferred to the sync phase (Phase 9) when real usage
shapes are visible; the schema designed in Phase 4 must support either.

## Consequences

- The Phase 4 SQLite/cloud schemas include version + snapshot fields from
  the start (cheap now, expensive to retrofit).
