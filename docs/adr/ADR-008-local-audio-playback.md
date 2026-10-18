# ADR-008: Local audio playback engine and architecture

- **Status:** Accepted (Phase 6)
- **Date:** 2026-10-18
- **Deciders:** Okoh Destiny, Superagent
- **Related:** ADR-007 (local audio import), docs/decisions.md (D-P6-*)

## Context

Phase 5 imports audio files into app-managed storage with `file://` URIs
in `library_items`. Phase 6 must play those files locally: play/pause,
seek, a queue over library items, visible state, and graceful failures —
with no network, no sign-in, and no persistence of progress in this
phase. The project targets Expo SDK 53 (React Native 0.79.6, New
Architecture enabled by default) and development builds, not Expo Go.

## Engine decision: expo-audio ~0.4.9

Candidates considered:

1. **expo-audio ~0.4.9** (the SDK-53-pinned version, resolved by
   `expo install`). First-party; native New Architecture module
   (`createAudioPlayer`, status events via `playbackStatusUpdate`,
   `replace()`, `seekTo()`, `setAudioModeAsync`); compiles with SDK 53
   and RN 0.79.6 with no patches; verified against the actual installed
   package (API surface and config plugin read from node_modules).
2. **react-native-track-player 4.1.1**: the standard choice for
   lock-screen/notification controls and an Android media foreground
   service, but it predates RN 0.79 / Kotlin 2.x and has open SDK-53
   compile breakage (doublesymmetry#2472; community guides require
   native patches to build on SDK 51+). Vendoring native patches into
   MDEXS Flow's dev-build pipeline is a maintenance liability this
   phase cannot justify.

**Trade-offs accepted with expo-audio on SDK 53 (verified in the
installed 0.4.9 package, not assumed from newer docs):**

- The 0.4.9 config plugin only adds `MODIFY_AUDIO_SETTINGS` (and
  microphone permissions, which this app disables). It has NO
  `enableBackgroundPlayback` option, NO Android media foreground
  service, and NO lock-screen / media-notification API — those arrive in
  later major versions of expo-audio (SDK 54+).
- Consequence: background playback is configured via
  `setAudioModeAsync({ shouldPlayInBackground: true })` plus the iOS
  `UIBackgroundModes: ["audio"]` Info.plist entry (app.config.ts, which
  prebuild applies). On iOS this is the documented mechanism. On
  Android, without a foreground service, sustained background playback
  CANNOT be promised: the OS may stop audio once the process is
  considered backgrounded. In-app controls are therefore the only
  guaranteed interface in this phase. When the project moves past
  SDK 53, upgrading expo-audio brings the media foreground service and
  lock-screen controls; the PlaybackController boundary does not need to
  change shape for that.
- Interruptions (calls, other apps' audio) and headphone/Bluetooth
  disconnection are handled inside expo-audio's audio-session layer
  (0.4.9 exposes no explicit interruption callbacks); the controller
  simply reflects engine-reported state. Platform behavior differs and
  is not claimed to be identical on Android and iOS.

## Architecture

- **Injectables in `src/playback/engine.ts`**: `PlaybackEngine`,
  `PlaybackPlatform`, plus pure logic — `assessPlayable` (validation),
  `buildQueue` (queue policy), `isImportedAudio`. The production adapter
  (`expoPlaybackPlatform.ts`) maps these onto expo-audio +
  expo-file-system/next and is imported only by app code. Node tests
  run the REAL controller against a fake engine.
- **`PlaybackController`** (singleton `playback` in
  `src/playback/index.ts`): one player, one status subscription, one
  audio-session setup for the whole app. All UI reads state via
  `useSyncExternalStore` and issues commands (`toggle`, `seekTo`,
  `skipNext`, `skipPrevious`, `stop`).
- **Race safety**: every load bumps a monotonic session token; loads
  superseded mid-init never touch the player, and status events from an
  abandoned load are ignored (the accepted-events token is set
  immediately before `replace()`). Rapid track switching cannot leave
  mixed state; a test pins this behavior.
- **Progress**: from the engine's `playbackStatusUpdate` events only —
  never `setInterval`. Nothing is persisted to SQLite in this phase;
  progress persistence is a deliberately separate later feature.

## Validation and file handling

Before load: the item must be `media_type: "audio"`, not `unavailable`,
have a `file://` `file_path` (metadata-only records and remote/content
URIs are rejected), and the file must still exist
(expo-file-system/next `File.exists`). Failures produce user-facing
messages that never contain filesystem paths; no other track is ever
substituted, and no file is deleted automatically on failure. The
picker's temporary cache URIs are never stored (Phase 5), so they cannot
be confused with managed URIs.

## Queue policy

Starting a track from the Library builds the queue from the imported
audio records currently listed, in list order, rotated so the selected
item is first; entries whose files no longer exist are dropped at load
time. Next wraps last→first and previous wraps first→last (predictable,
documented, and consistent with the rotation). PDFs, metadata-only
records, and non-file URIs are never enqueued. Track completion
auto-advances to the next entry; the final track settles in
`completed` (resume then restarts it from zero). No playlist editing in
this phase.

## Consequences

- Automated tests cover the controller, validation, queue, transitions,
  and listener lifecycle with a fake engine (28 tests). They do NOT
  prove native behavior: actual device playback, background
  continuation, interruptions, codec support (device-dependent; OGG in
  particular varies on Android), and `file://` acceptance by the
  native player on each platform all require a physical development
  build to verify.
- expo-audio adds one native dependency; no slider/notification/media
  libraries were added. Seeking uses ±15s buttons instead of a slider to
  avoid another native dependency (@react-native-community/slider);
  the controller's `seekTo` supports a future slider unchanged.
- Upgrade path: newer expo-audio majors (SDK 54+) provide the Android
  media playback foreground service, lock-screen controls, and richer
  interruption events; adopting them is a version-bump change within
  the same engine boundary, not an architectural rewrite.
