# MDEXS Flow — Mobile App

React Native + Expo (managed workflow with development builds) in TypeScript.

## Prerequisites

- Node 20+, pnpm 9 (`corepack enable`)
- An Android emulator/device and/or Xcode simulator (for development builds)

## Setup

```bash
# from the monorepo root
pnpm install

# start the API (terminal 1)
pnpm api:install && pnpm api:dev

# start the app (terminal 2)
pnpm mobile start
```

Local environment: create `apps/mobile/.env` with non-secret values only:

```
EXPO_PUBLIC_API_BASE_URL=http://localhost:8000
EXPO_PUBLIC_API_ENV=development
```

## Connecting to the local API (networking guide)

"localhost" is **not** always your development machine. Set
`EXPO_PUBLIC_API_BASE_URL` in `apps/mobile/.env` per your setup:

| Setup | Value to use |
|---|---|
| Android emulator | `http://10.0.2.2:8000` (Android's alias for your machine's localhost) |
| iOS simulator | `http://localhost:8000` (the simulator shares your machine's network) |
| Physical Android/iPhone on the same Wi-Fi | `http://<your-machine-LAN-IP>:8000` — find it with `ipconfig`/`ifconfig`; do not commit a personal IP |
| Production | the deployed HTTPS API URL only |

Only `EXPO_PUBLIC_*` values are embedded in the app bundle, and they must
never contain secrets: no Neon connection string, no object-storage keys,
no signing keys, no admin tokens. Those stay backend-only by architecture
(see `docs/security.md`).

## Why a development build, not Expo Go

Planned MDEXS Flow features need native modules and permissions that Expo Go
cannot provide:

- Background audio playback (Android foreground service, iOS background audio mode)
- Local file import (`expo-document-picker`/`expo-file-system` app-sandbox copies)
- Resumable offline downloads
- PDF rendering (WebView/PDF.js or a native viewer module)
- OCR and bundled offline TTS voices (later phases)

So the app is configured for EAS development builds (`eas.json`):
`eas build --profile development`. Expo Go is only sufficient for these early
navigation-shell screens.

## Commands

- `pnpm mobile start` — Metro bundler (dev client)
- `pnpm mobile android` / `pnpm mobile ios` — run on device/simulator
- `pnpm mobile typecheck` — strict TypeScript check

## Status (Phase 2)

Implemented: navigation shell (Expo Router, 5 tabs), theme, reusable
components, typed env config, dev API-status panel using the shared contracts.

Not implemented: import, playback, PDF reading, downloads, sync, auth —
see the roadmap in `docs/architecture.md`. The app has **not** been run on a
physical Android/iOS device yet in this phase.

## Authentication (Phase 3)

- **Screens:** `(auth)/welcome`, `(auth)/sign-in`, `(auth)/sign-up`,
  `(auth)/forgot-password` (explicit placeholder — email provider not yet
  chosen), and the profile tab (authenticated `/me` view + sign-out).
- **State:** `src/auth/AuthProvider.tsx` restores a session on app start by
  refreshing the stored credential. If the network is down during restore,
  the user is not logged out — the session is kept with an `offline` flag and
  cloud calls surface errors until connectivity returns. The backend remains
  the authority; client-side guards are UX only.
- **Secure storage:** refresh tokens live in `expo-secure-store`
  (iOS Keychain / Android Keystore). The access token is held in memory only.
  Sign-out clears secure storage. Requires a native development build.
- **API client:** `src/api/client.ts` attaches the access token, refreshes
  single-flight on an auth-expiry 401, and retries only idempotent requests
  once — no replay of non-idempotent operations, no refresh loops.

### Google sign-in configuration (native dev builds only)

1. Create OAuth 2.0 client IDs in Google Cloud Console (Web + iOS).
2. Backend: set `GOOGLE_WEB_CLIENT_ID` (and `GOOGLE_IOS_CLIENT_ID` if used)
   in the API environment.
3. Mobile: set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` in `apps/mobile/.env`.
   The button only appears when this is configured. The app never holds a
   client secret; the backend verifies the OIDC id_token itself.

End-to-end Google sign-in has **not** been tested yet (no real client IDs);
the integration boundary and backend verification are implemented and tested.

## Local database (Phase 4)

Offline-first local storage lives in `src/localdb/` and requires no network
and no sign-in:

- `db.ts` — opens `mdexs_flow.db` via expo-sqlite, enables foreign keys,
  applies migrations; `openLocalDatabase()` is idempotent.
- `migrations.ts` / `migrate.ts` — ordered, versioned schema migrations
  (`PRAGMA user_version`); applied atomically, never destructive.
- `domain.ts` — typed domain objects + boundary validation.
- `repositories/` — `libraryItems`, `progress`, `bookmarks`, `playlists`,
  `history`, `syncQueue`. Parameterized SQL only; multi-step writes run in
  transactions; referenced items are archived, never cascaded-deleted.
- `driver.ts` — the minimal `SqlDriver` interface both expo-sqlite (device)
  and sql.js (tests) implement.

Design notes: ADR-006. Boundary with cloud Neon PostgreSQL: the API owns
account data; SQLite is the offline working set. Auth tokens stay in
expo-secure-store, never in SQLite. Binary media is never stored in rows —
import (Phase 5+) will create app-managed files and store references.

The sync queue (`repositories/syncQueue.ts`) records pending operations for
the Phase 9 sync engine. Nothing drains it or calls the network today.

Run the local-data-layer tests (real SQLite via sql.js WASM in Node):

```bash
cd apps/mobile && pnpm test
```

## Local audio import (Phase 5)

"Import audio" on the Library screen copies a user-selected audio file
into app-managed storage and records it in SQLite. Fully offline; no
account, network, or backend involved.

- Selection: `expo-document-picker` (native system picker). Supported
  extensions: MP3, M4A, AAC, WAV, FLAC, OGG — as selection hints; actual
  decode support depends on the device. Cancellation is silent.
- Storage: `<app documents>/imported_audio/<uuid>.<ext>` via
  `expo-file-system/next`. The original file is never modified or moved;
  the picker URI is never stored (only the managed copy's URI is).
- SQLite: `library_items` row with `origin: "device"`, `file_path`
  (managed URI), `original_filename`, `mime_type`, `size_bytes`.
  Duration/artist/album are not extracted in this phase (would need a
  native tag reader).
- Duplicates: no content dedup — importing the same file twice creates
  two records and two copies. Files are never overwritten (UUID names).
- Failures: a failed copy leaves no record; a failed record write
  deletes the copy this import created; a record whose file vanished is
  removed. Import errors surface inline on the Library screen.
- Lifecycle: imports survive app restarts and sign-out; deleting an
  item does NOT delete its file (orphan cleanup is future work).
  Uninstalling the app removes app-managed files — imports do NOT
  survive reinstall.
- Needs physical-device verification: native picker behavior
  (Android SAF `content://` URIs, iOS picker filters, OGG availability),
  large-file copy performance, storage-permission edge cases.

Design: ADR-007.

## Local audio playback (Phase 6)

Tapping an imported audio row in the Library starts playback and opens
the player screen. Playback is fully offline; no account or network is
involved, and metadata-only development samples cannot be played.

- Engine: `expo-audio ~0.4.9` (the Expo SDK 53 version). See ADR-008.
- Player screen (`app/player.tsx`): title, position/duration, progress,
  play/pause, previous/next, ±15s seek, stop; loading, completed, and
  error states are shown inline and controls are disabled when
  unavailable. Progress updates come from engine status events, not a
  timer.
- Queue: the imported audio items currently listed in the Library, in
  list order, rotated so the tapped item is first. Next/previous wrap
  at the boundaries. Files missing from storage are dropped from the
  queue at load time; if the current track's file is gone you get an
  error, never a substituted track.
- Errors: a track that fails to load or decode (missing file,
  unsupported codec, engine failure) shows a message on the player
  screen. No file is ever deleted automatically.

### Native configuration (applied by `npx expo prebuild` / dev builds)

- `app.config.ts` registers the `expo-audio` config plugin with
  microphone access disabled (adds only
  `android.permission.MODIFY_AUDIO_SETTINGS` on Android) and sets iOS
  `UIBackgroundModes: ["audio"]`.
- Background playback uses `setAudioModeAsync({ shouldPlayInBackground:
  true })` plus the iOS background mode. **On Android this is not
  guaranteed**: the SDK-53 version of expo-audio ships no media
  foreground service, so the OS may stop audio while the app is
  backgrounded. Upgrading expo-audio on a later SDK is the documented
  path to a proper foreground service and lock-screen controls.
- This feature requires a development build; it will not work in
  Expo Go (native audio module + background modes).

### Manual device-test checklist (not covered by automated tests)

1. Build and run a dev build: `pnpm android` / `pnpm ios` from
   `apps/mobile` (or `npx expo run:android` / `run:ios`).
2. Import a real MP3/M4A file on the device, then play it: verify
   start, pause/resume, ±15s seek, stop, and that the title and
   durations display.
3. With at least three imported files: verify next/previous, wrap-around
   at the queue ends, and auto-advance on track completion.
4. Delete a managed file (e.g. via a file manager on a debug build or by
   clearing app storage) and confirm the player shows a missing-file
   error instead of crashing.
5. Verify an unsupported/corrupted file shows the error state.
6. Background: lock the screen / background the app during playback —
   iOS is expected to continue; Android is NOT guaranteed on SDK 53.
7. Trigger an interruption (incoming call, another audio app) and check
   the player state reflects it on return.
