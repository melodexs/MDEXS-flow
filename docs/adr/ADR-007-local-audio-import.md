# ADR-007: Local audio file import

- **Status:** Accepted (Phase 5)
- **Date:** 2026-10-18
- **Deciders:** Okoh Destiny, Superagent
- **Related:** ADR-006 (Local SQLite data layer), docs/offline-sync.md

## Context

Phase 4 gave MDEXS Flow an offline-first SQLite library, but the only way to
get content in was a metadata-only sample action. Phase 5 adds real local
content: the user selects an audio file from their device and it becomes a
library item. Playback is explicitly out of scope — importing must not
imply playability. The import must work with no account, no network, and no
backend, and must never touch the user's original file.

## Decision

1. **Selection via expo-document-picker (~13.1.6)** with audio MIME hints
   (`audio/*`, `application/ogg`, `audio/x-m4a`, …) and
   `copyToCacheDirectory: true`. The picker grants access only to what the
   user selects — no broad filesystem permission is requested. The cache
   copy is a staging area only; a picker URI is never stored in SQLite.

2. **Storage via expo-file-system/next (18.1.x, the SDK 53 `File`/
   `Directory`/`Paths` API)** in `<app documents>/imported_audio/`. Legacy
   `FileSystem.*` and `next` APIs are never mixed. Files land under fresh
   UUIDv4 names with a sanitized, whitelisted extension — never under the
   user-supplied filename — so path traversal and overwrites are
   structurally impossible (`joinUri` rejects `/` and `\`).

3. **One injectable platform boundary.** The orchestrator
   (`src/library/audioImport.ts`) depends on an `AudioImportPlatform`
   interface; the Expo implementation (`expoAudioPlatform.ts`) is passed in
   by the screen. Node tests run the REAL orchestrator and repository code
   against real SQLite (sql.js) with a fake platform — only the native
   picker/filesystem edge is substituted.

4. **Import sequence (minimizes orphans and broken records):**
   pick → plausibility check (extension/MIME are hints, not proof) →
   ensure managed directory → refuse if the destination already exists →
   copy → verify (exists, non-zero, byte size matches the source when
   known) → insert the SQLite record (`origin: "device"`, `file_path` =
   managed URI) → final existence check; a record whose file vanished is
   deleted again. Every failure path removes ONLY the file the current
   import created; pre-existing managed files are never deleted.

5. **No schema change.** The Phase 4 `library_items` table already carries
   `original_filename`, `file_path`, `mime_type`, `size_bytes`,
   `duration_ms`, and `origin` — exactly what import needs. `duration_ms`,
   `artist`, and `album` stay NULL in this phase: reading audio tags would
   require a large native dependency, and best-effort metadata must not
   block a valid import.

6. **Duplicate policy (documented limitation).** Imported files get UUID
   names, so an import can never overwrite another. But there is no
   content-based dedup: the schema has no content-hash column, hashing
   every file is a cost the library can't justify yet, and a picker
   re-selection produces a fresh cache copy indistinguishable from a
   first pick. Selecting the same source twice therefore creates two
   records and two managed copies. If dedup becomes a real need, the
   justified route is a `content_hash` column (append-only migration) plus
   hashing at import time — deliberately deferred.

7. **Lifecycle.** Sign-out, network changes, and app restarts never
   delete managed files; SQLite references persist with them. Deleting a
   library item does NOT delete its managed file in this phase — a safe
   orphan-cleanup routine is future work, and none was bolted on to claim
   completeness. Uninstalling the app removes app-managed storage with it
   (platform behavior); imports do not survive reinstall.

## Consequences

- Verified in Node: orchestration, SQLite integration, rollback paths.
  NOT verified: the native picker dialog, SAF/content URIs on Android,
  iOS document picker behavior, and actual device storage — these need a
  physical dev build (the Node suite and Expo Doctor cannot prove them).
- Known platform caveats to verify on device: some Android pickers hand
  back `content://` URIs (handled by `copyToCacheDirectory: true`), OGG
  support varies by Android version/device, iOS may show non-audio files
  under some MIME filters, and very large files make the synchronous
  `File.copy()` block the JS thread (a worker/streaming copy is future
  work if imports feel janky on device).
- The expo-file-system 18.1.11 package resolves `expo-file-system/next`
  to its TS source (`main: src/index.ts`), which fails typecheck under
  `strict` due to an upstream `streams.ts` bug. The mobile tsconfig maps
  the import to the package's built `.d.ts` — types without patching
  vendor code. Revisit when upgrading past SDK 53.
