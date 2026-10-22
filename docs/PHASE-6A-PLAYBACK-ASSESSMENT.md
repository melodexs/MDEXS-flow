# Phase 6A — Native Playback Assessment (audit & engine decision)

- **Date:** 2026-10-19
- **Audited commit:** `64980f8` (local `main`; origin `main` at `9bc7bd3`)
- **Status:** Evidence-gathering phase. No engine migration, no push, no deploy.
- **Rule applied:** nothing below is labeled VERIFIED unless it was executed on a
  real native environment. Unit tests with the fake engine never count as VERIFIED.

---

## 1. Repository state and audited commit

| Item | Value (inspected 2026-10-19) |
|---|---|
| Branch | `main` |
| HEAD | `64980f8` (Phase 6; local only — origin at `9bc7bd3`) |
| Working tree | Clean before this audit; this document is the only new file |
| Native `android/` / `ios/` dirs | **None** — CNG / prebuild workflow (Expo-managed config, no committed native projects) |
| Expo / React Native / React | `expo ~53.0.0` (53.0.27 installed), `react-native 0.79.6`, `react 19.0.0` |
| Playback dependency | `expo-audio ~0.4.9` (the version `expo install` pins for SDK 53) |
| Other playback-relevant deps | `expo-file-system ~18.1.11` (next API), `expo-sqlite ~15.2.14`, `expo-document-picker ~13.1.6` |

The Phase 6 report's claims were re-verified against the actual files
(`src/playback/*`, `app/player.tsx`, `app/(tabs)/library.tsx`, `app.config.ts`)
and found accurate: the files exist as described, the controller is a singleton
with session tokens, the tests use a fake engine, and no native verification
was ever performed.

## 2. Actual dependency versions and configuration

- `expo-audio@0.4.9` — JS API surface confirmed in the installed package:
  `createAudioPlayer`, `setAudioModeAsync` (`shouldPlayInBackground`,
  `playsInSilentMode`, `interruptionMode`), `AudioPlayer.play/pause/replace/
  seekTo/remove`, `playbackStatusUpdate` events.
- Config plugin (installed source, `plugin/build/withAudio.js`): handles ONLY
  `NSMicrophoneUsageDescription` (iOS) and `RECORD_AUDIO` (skipped when
  `microphonePermission: false`) + `MODIFY_AUDIO_SETTINGS` (Android). It has
  **no** background-playback, foreground-service, or lock-screen options in
  0.4.9.
- `app.config.ts` (Phase 6): `["expo-audio", { microphonePermission: false }]`
  plugin; `ios.infoPlist.UIBackgroundModes: ["audio"]`. Verified resolving
  through `expo config --type prebuild --json` (plugins and Info.plist entry
  present in resolved config).

## 3. Current playback architecture (as inspected)

```
app/(tabs)/library.tsx ──┐            app/player.tsx (useSyncExternalStore)
                        ▼                       ▲
                 src/playback/index.ts  ────────┤
                        │                        │
        PlaybackController (singleton) ──── subscribe()/getState()
                        │  session tokens, one player, one status sub
                        ▼
              PlaybackEngine / PlaybackPlatform  (interfaces)
                        │
        expoPlaybackPlatform.ts (adapter: expo-audio +
        expo-file-system/next File.exists; app code only — never in tests)
```

- Validation before load: audio media_type, `file://` scheme required, file
  must exist on disk, metadata-only/PDF/unavailable rejected with path-free
  messages; no track substitution on failure.
- Queue: imported audio in Library order, rotated to the selection; dead
  files dropped; wrap-around prev/next; auto-advance on `didJustFinish`;
  final completion settles in `completed`.
- No progress persistence, no network, no schema changes (matches Phase 6 scope).
- Tests: 28 fake-engine controller tests (60 mobile total). Coverage: init-once,
  play/pause/resume/seek, queue construction and boundaries, completion,
  missing/metadata-only/unsupported rejection, engine init/playing failures,
  rapid track switching (superseded-load guard), listener dedupe/cleanup, stop.

## 4. Requirement-by-requirement assessment

Legend: VERIFIED (executed natively) · CODE-REVIEWED (supported by inspected
code / dependency source, not executed) · NOT VERIFIED (insufficient
evidence) · NOT SUPPORTED (dependency/architecture lacks it) · REQUIRES
IMPLEMENTATION (needs new work).

Native evidence gathered from the installed `expo-audio@0.4.9` sources:

- `android/src/main/AndroidManifest.xml`: only `RECORD_AUDIO` +
  `MODIFY_AUDIO_SETTINGS`. No service, no `FOREGROUND_SERVICE*` permissions.
- `android/.../AudioModule.kt`: full `AudioFocusRequest` handling —
  `AUDIOFOCUS_LOSS` → pause all; `LOSS_TRANSIENT` → pause, auto-resume on
  `GAIN`; `LOSS_TRANSIENT_CAN_DUCK` → duck (duckOthers) or pause. **No
  `ACTION_AUDIO_BECOMING_NOISY` receiver** anywhere in the package.
- `android/.../AudioPlayer.kt`: `Player.STATE_ENDED` → `didJustFinish` status.
- `ios/AudioModule.swift`: `AVAudioSession` category `.playback` (no
  recording) with options; `interruptionNotification` observer (began →
  pause or duck; ended → session reactivation/resume); `routeChangeNotification`
  observer with `.oldDeviceUnavailable` → `pauseAllPlayers()`; internal
  `shouldPlayInBackground` flag gates pausing when the app backgrounds.
- **No** `MPNowPlayingInfoCenter`/`MPRemoteCommandCenter` (iOS) and no
  `MediaSession`/notification (Android) references exist anywhere in the
  package — lock-screen/system media controls are absent, not merely
  unconfigured.

| # | Requirement | Android (expo-audio 0.4.9) | iOS (expo-audio 0.4.9) |
|---|---|---|---|
| 1 | Import file, available offline | CODE-REVIEWED | CODE-REVIEWED |
| 2 | Play / pause / resume / stop | CODE-REVIEWED | CODE-REVIEWED |
| 3 | Seek; position + duration | CODE-REVIEWED | CODE-REVIEWED |
| 4 | Prev / next queue item | CODE-REVIEWED | CODE-REVIEWED |
| 5 | Auto-advance on completion | CODE-REVIEWED (STATE_ENDED → didJustFinish → controller advances) | CODE-REVIEWED |
| 6 | Continue in background | **NOT SUPPORTED** (no media foreground service; OS may freeze background playback; not reliable) | **CODE-REVIEWED** (.playback category + UIBackgroundModes audio + shouldPlayInBackground; never executed) |
| 7 | Continue while screen locked | **NOT SUPPORTED** (same as #6) | **CODE-REVIEWED** (background audio covers lock; not executed) |
| 8 | Lock-screen track info + controls | **NOT SUPPORTED** | **NOT SUPPORTED** |
| 9 | Notification / media controls (Android) | **NOT SUPPORTED** | n/a |
| 10 | Interruptions (calls, focus, headphone unplug) | Focus: **CODE-REVIEWED** (native listener handles loss/duck/gain). Headphone unplug: **NOT SUPPORTED** (no BECOMING_NOISY receiver; audio may continue on speaker) | **CODE-REVIEWED** (interruption + route-change observers pause on call/unplug) |
| 11 | Release resources on stop/end | CODE-REVIEWED (single player; `remove()`/SharedObject; no duplicate players by construction) | CODE-REVIEWED |
| 12 | No duplicate players / stale callbacks / races | CODE-REVIEWED (single player singleton, session tokens; 28 fake-engine tests — not native proof) | CODE-REVIEWED |
| 13 | Graceful missing/moved/unsupported recovery | CODE-REVIEWED (pre-load validation + engine-error phase) | CODE-REVIEWED |
| 14 | Works with no network | CODE-REVIEWED (file:// sources only; no network code in path) | CODE-REVIEWED |

Nothing above is VERIFIED: no native build of this app has ever been produced,
and no device or emulator test has been executed.

## 5. Engine options and compatibility evidence

### Option A — Retain expo-audio ~0.4.9 (status quo)

- Compatibility: certain (SDK-53-pinned first-party module, installed and
  typechecking; `expo-doctor` 18/18).
- Dev build required: yes (also required by `expo-file-system/next`, which
  Expo Go does not support).
- Background: iOS code-reviewed-yes / Android effectively no (§4).
- Lock screen / notification: no, both platforms (absent from the package
  source, not just unconfigured).
- Interruptions: strongest part of 0.4.9 — real native focus/interruption/
  route-change handling (see §4 evidence).
- Migration cost: none (current state).

### Option B — react-native-track-player 4.1.2

Would provide Android foreground service + MediaSession notification, iOS
lock-screen/remote-command controls, queue/completion events — exactly the
missing capabilities. Compatibility evidence (researched 2026-10-19):

- v4.1.1 on SDK 53 fails to compile: `"onBind overrides nothing"` Kotlin error
  (issue #2472, closed as duplicate of #2455 "Task
  :react-native-track-player:compileDebugKotlin FAILED").
- v4.1.2 (published 2025-08-12) still **breaks builds with Kotlin 2.x /
  Expo SDK 53**; the fixes exist only in the (unpublished) `main` branch —
  issues #2600/#2601, state "open" as of early 2026.
- Workaround in the community is `patch-package` against unreleased commits —
  i.e., shipping an SDK-53 app on track-player means carrying patches for
  code the maintainers have not released.
- Migration from our boundary: moderate (the `PlaybackEngine` interface maps
  cleanly onto `TrackPlayer`), but the build risk sits in native compilation,
  not in JS.

Verdict: **not viable on SDK 53 without unreleased-code patches.**

### Option C — Other credible options

- **expo-av (SDK 53)**: deprecated successor-of-nothing; also lacks lock-screen
  controls; would be a regression and adds a second audio stack. Rejected.
- **Newer expo-audio (1.x / 55.x)**: the majors after SDK 53 add a media
  playback foreground service and lock-screen APIs (`AudioControlsService`,
  `setActiveForLockScreen` in current Expo docs). Requires an Expo SDK
  upgrade (54/55), which this phase is explicitly forbidden from shortcutting.
  This is the **strategic path of least risk** once an SDK upgrade is on the
  table.
- **Custom MediaSession/foreground-service module** on top of expo-audio 0.4.9
  (config plugin + Kotlin/Swift): technically possible, but it duplicates what
  Expo already ships in later expo-audio versions, must satisfy Android
  14 FGS permission + Play media-playback policy, and creates permanent
  custom native maintenance. Poor cost/benefit vs. an SDK upgrade.
- **react-native-video**: video-first API; heavier and awkward for a music
  player; not credible here.

Build verification of any option in this environment: **impossible** — the
sandbox is Linux without Java, without an Android SDK (`ANDROID_HOME` unset),
and without Xcode. No native build can run here.

## 6. Recommendation

**Retain expo-audio ~0.4.9. Do not migrate to react-native-track-player on
SDK 53; do not patch-package around it.** Rationale:

1. The published track-player releases are demonstrably broken on this exact
   SDK/Kotlin combination; adopting it means carrying patches of unreleased
   code — the highest-maintenance option available.
2. All in-app playback requirements (#1–#5, #11–#14) are already implemented
   behind our engine boundary; the missing capabilities (#6–#9) are native-
   platform features, and the lowest-risk route to them is the first-party
   one: upgrade Expo SDK (54/55) and pick up expo-audio's built-in
   AudioControlsService + lock-screen APIs, adapting only
   `expoPlaybackPlatform.ts` + `app.config.ts` (the boundary was designed for
   exactly this swap).
3. Before any of that, the existing engine must actually be verified on
   hardware — no native behavior of this app has ever been executed.

Decision requested now: none required beyond accepting "retain current
engine". Approvals that would start future work: (a) physical device test
run of Phase 6 (§11), (b) an Expo SDK upgrade project (brings requirements
#6–#9 via newer expo-audio), (c) optionally revisiting track-player after
its next stable release actually publishes the SDK-53 fixes.

## 7. Required changes for the recommended option (retention)

- **None to code.** No code change in this phase is justified: no failing
  test or inspected defect demonstrates a bug in the current implementation.
- Documentation: this file.
- Device verification: §11 checklist. Emulator can cover most functional
  items (#1–#5, #13, #14); background, lock screen, notifications, call
  interruptions, and headphone behavior genuinely require a physical device.

## 8. Build and device-testing requirements

- Dev build (not Expo Go): `pnpm android` / `pnpm ios` from `apps/mobile`
  (scripts = `expo run:android` / `expo run:ios`), or `npx expo prebuild`
  then native builds. Prebuild config already validated in this environment.
- This environment cannot produce either native build (no Java/Android SDK on
  Linux; no Xcode possible). Build readiness is therefore only
  config-validated, never build-verified.
- Android: watch for Kotlin/AGP versions from RN 0.79.6 template on first
  build; iOS: simulator can play audio but NOT prove background/lock-screen
  (those need a physical device).

## 9. Known limitations and unresolved questions

- Android headphone unplug (`BECOMING_NOISY`) is not handled by expo-audio
  0.4.9 → audio may continue on the loudspeaker after unplugging. If this
  matters on device, an explicit pause-on-unplug can be layered in JS/native
  later, or it disappears with the newer expo-audio.
- Android sustained background playback: not supported by this engine
  version, by design (no FGS). Don't promise it.
- Codec support is device/OS dependent (notably OGG family on iOS, FLAC on
  older Android); no codec probing exists in-app.
- Unresolved until hardware: whether `file://` URIs from expo-file-system
  feed expo-audio's Android `MediaPlayer`/ExoPlayer path without conversion,
  and what a corrupted file surfaces as (status `error` vs. silent stop).
- Duration for VBR files, buffering stalls on local files, and
  `seekTo` tolerance behavior are all untested natively.

## 10. Exact commands executed and results (2026-10-19)

| Command | Result | What it proves |
|---|---|---|
| `git status -sb`, `git log --oneline -4` | clean tree, HEAD `64980f8`, no native dirs | repository state (§1) |
| `pnpm typecheck` (apps/mobile) | PASS | TS only; no native code |
| `pnpm lint` (apps/mobile) | PASS (0 errors, 0 warnings) | static only |
| `pnpm test` (apps/mobile) | PASS 60/60 (3 files) | **fake engine / fake platform**; not native |
| `pnpm -r test` (workspace) | PASS contracts 3/3, mobile 60/60 | same caveat |
| `pytest` (services/api, venv) | PASS 42/42 | backend; unaffected by playback |
| `ruff check app tests` (services/api) | PASS | backend only |
| `npx expo-doctor` | 18/18 | dependency/config hygiene; NOT native build |
| `npx expo config --type prebuild --json` | resolves (plugins incl. expo-audio; UIBackgroundModes present) | prebuild config correctness only |
| `java -version`, `$ANDROID_HOME`, `xcodebuild -version` | all absent (Linux sandbox) | **no native build possible here** |

No command in this environment executed real audio. All playback testing in
this repo to date is fake-engine.

## 11. Manual device-test checklist

Emulator/simulator-sufficient: 1–5, 13, 14 (functional playback, seek, queue,
completion, missing/unsupported file errors, airplane mode).
Physical device required: 6–10, 12 (background, lock screen, notifications,
interruptions, headphones), plus final persistence re-check.

1. [ ] Import a supported local audio file (MP3, M4A, WAV; FLAC/OGG where the
       device supports them).
2. [ ] Play, pause, resume repeatedly; rapid taps — no overlapping audio.
3. [ ] Seek ±15s and to a boundary (0 / end); position and duration update.
4. [ ] Next/previous wrap around the queue; title/state update per track.
5. [ ] Let a track finish → verify auto-advance; finish the final track →
       app settles in "completed" without looping.
6. [ ] Lock the screen while playing (Android: expect playback to stop or be
       unreliable — known limitation; iOS: expect continuation).
7. [ ] Background the app during playback (same expectations as 6).
8. [ ] Lock-screen info/controls (expect NONE on either platform with
       expo-audio 0.4.9 — confirm and record actual behavior).
9. [ ] Android notification/media controls (expect NONE — confirm).
10. [ ] Receive/simulate a call: audio should pause on focus loss, and on
        iOS resume after the call if the system requests it.
11. [ ] Unplug wired / disconnect Bluetooth headphones mid-playback:
        iOS should pause; **Android is expected to keep playing on the
        speaker (known engine gap — record actual behavior).**
12. [ ] Delete an imported file via a file manager (or make one unreadable),
        then play it: expect a graceful "missing" error, no crash, no
        substitution.
13. [ ] Import a renamed PDF or truncated MP3: picker/validations reject or
        playback shows the error state; no fake success.
14. [ ] Airplane mode: import/play/queue all still work (no network path).
15. [ ] Stop playback and reopen the app: library and files persist; no
        lingering audio or notification.
16. [ ] Play a long track (~10 min) with screen on: no stalled progress,
        no memory warnings (basic resource sanity).

## 12. Decision recommendation

- **Retain** the current engine (expo-audio ~0.4.9) for the present phase.
- **Approve a physical device test run** of the checklist above before any
  further feature work rides on playback.
- **Defer** background/lock-screen/notification requirements (#6–#9) to a
  planned Expo SDK upgrade (≥54), where first-party expo-audio delivers them
  without patching; revisit react-native-track-player only after it ships a
  stable release containing the SDK-53/Kotlin fixes.
