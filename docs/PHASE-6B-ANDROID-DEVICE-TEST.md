# MDEXS Flow — Phase 6B: Android Development Build Preparation

Status: **build readiness only**. No Android build, installation, or device test
has been performed. Everything below marked NOT TESTED has not been observed on
a device. This document pairs with `docs/PHASE-6A-PLAYBACK-ASSESSMENT.md`.

## 1. Repository state at time of writing

- Branch `main`, HEAD `64980f8` (Phase 6), local only (origin at `9bc7bd3`).
- `docs/PHASE-6A-PLAYBACK-ASSESSMENT.md` still untracked — preserved, not modified.
- No native `android/` or `ios/` directories: the project uses Expo prebuild
  (CNG). Native Android files are generated on demand; they are not committed.
- `apps/mobile/eas.json` exists with a ready `development` profile
  (`developmentClient: true`, internal distribution, APK). No EAS project id is
  linked (`extra.eas.projectId` absent, no `.eas-project.json`), so EAS builds
  would first require `eas login` + `eas init` and an Expo account.
- Sandbox used for this phase: Linux, Node v24.21.0, pnpm 9.12.0. No Java/JDK,
  no Android SDK, no adb, no Xcode, not logged in to EAS. **This sandbox cannot
  produce an Android binary; the build must run on your machine or in EAS cloud.**

## 2. Recommended build route

**Route A — local development build (recommended).** One command, no cloud
account, fastest iteration, and you can read Gradle + Metro + adb logs directly.

Prerequisites on your computer (one-time setup):

1. **Node.js ≥ 18** and **pnpm** (`npm i -g pnpm`).
2. **Java JDK 17** (required by RN 0.79's Gradle; JDK 21 also generally works).
   Install via your package manager or Android Studio's bundled JDK.
3. **Android Studio** → SDK Manager: install the latest **Android SDK Platform**,
   **SDK Platform-Tools** (includes adb), and **SDK Build-Tools**.
4. Set environment variables (paths typical for your OS):
   - `ANDROID_HOME=$HOME/Library/Android/sdk` (macOS) or
     `$HOME/Android/Sdk` (Linux/Windows)
   - add `$ANDROID_HOME/platform-tools` to `PATH` so `adb` works.
5. Accept licenses: `yes | sdkmanager --licenses` (or via Android Studio).

Build and install, **all from `apps/mobile`** (the Expo app root — not the
monorepo root):

```bash
cd apps/mobile
pnpm install            # workspace deps (run once, from repo root also fine)
pnpm android            # = expo run:android: prebuild + Gradle + install + Metro
```

The first run compiles the native app (10–30 min) and installs it on the
connected phone. Subsequent runs are fast. Leave the terminal running — it is
the Metro dev server. To reinstall/rebuild only the JS, just reload in the app.

If you prefer an emulator: create an AVD in Android Studio (Device Manager) and
run `pnpm android` with it started. Physical device is better for this phase
(background playback, lock screen, headphones are not meaningfully testable on
an emulator).

**Route B — EAS cloud build (fallback).** No local Android toolchain needed.
Prerequisites: an Expo account (free), `eas login`, then link the project:

```bash
cd apps/mobile
npx eas login
npx eas init            # creates the project id; prints a change to app.config.ts
npx eas build --profile development --platform android
```

EAS builds an APK in the cloud and gives a download link/QR. Install it on the
phone, then run `pnpm start` locally and open the app with the dev client.
Do not commit the `eas init` output or any credentials.

## 3. Connecting the phone (beginner's guide)

1. On the phone: **Settings → About phone → tap "Build number" 7 times** —
   Developer options unlock.
2. **Settings → System → Developer options → enable USB debugging.**
3. Connect the phone to your computer with a USB cable; on the phone accept the
   "Allow USB debugging?" dialog (check "always allow" for this computer).
4. Verify from your computer:
   ```bash
   adb devices          # run from apps/mobile; shows "<serial>  device"
   ```
   If nothing shows: swap the USB cable (some are power-only), and on the
   phone toggle USB debugging off/on. If unauthorized, revoke and re-accept.

## 4. Running the app and inspecting logs

```bash
cd apps/mobile
pnpm android           # build + install + start Metro
```

The app opens on the phone automatically. If it does not launch, check that
Metro is still running in that terminal, shake the phone (or run
`adb shell input keyevent 82`) and choose "Reload".

Logs, in order of usefulness:

```bash
adb logcat -s ReactNativeJS Expo   # JS-level: app logs, playback errors
adb logcat | grep -iE "audio|player|expo"   # native audio stack
adb logcat                        # everything (noisy)
```

**Capturing errors safely:** when playback fails, copy the log lines around the
error (the stack trace and any `ReactNativeJS` messages). Before sharing a log:
do not paste anything containing tokens, passwords, email addresses, or file
paths under your home directory — trim them. The app never logs secrets; Expo
dev logs can still contain device paths. When in doubt, share only the lines
mentioning `audio`, `player`, `Expo`, or an exception name — not the whole dump.

## 5. Manual test checklist

Rules for filling this in:

- Record what actually happened, not what should happen.
- **Background playback, lock-screen behavior, notification/media controls, and
  headphone-disconnection behavior are known areas of concern** (Phase 6A: the
  SDK-53 expo-audio engine provides no Android media foreground service and no
  lock-screen/media-session integration). They must not be assumed to work;
  observe them and write down exactly what happens.
- Tests 1–12 need only the phone + USB. Tests 13–16 also need headphones
  (wired or Bluetooth) and another app that plays audio (e.g. YouTube/Music).

| ID | Test | Steps | Expected result | Actual result | Status | Notes |
|----|------|-------|-----------------|---------------|--------|-------|
| A-01 | App launch | Open the installed app | App opens on Home without crashing | | NOT TESTED | |
| A-02 | Import MP3 | Library tab → "Import audio" → pick an .mp3 from device storage | Row appears in Library with a size subtitle; no error | | NOT TESTED | |
| A-03 | Import other format | "Import audio" → pick .m4a/.wav/.ogg/.flac if available | Row appears; picker may limit choices per device | | NOT TESTED | OGG support varies by device |
| A-04 | Play | Tap an imported item | Playback starts; player screen opens; title shown | | NOT TESTED | Speaker output: check volume/silent switch |
| A-05 | Pause/resume | Press play/pause repeatedly | Pauses and resumes at the same position; no double audio | | NOT TESTED | |
| A-06 | Seek | Press -15s and +15s | Position jumps by ~15s either way; progress bar moves | | NOT TESTED | |
| A-07 | Next/previous | Press next, then previous with ≥2 items in Library | Predictable track switch; wrap-around at ends | | NOT TESTED | |
| A-08 | Track completion | Play the last track; let it finish (seek near end) | Shows "Completed"; auto-advances when not final; no crash | | NOT TESTED | |
| A-09 | Missing file | Import a file, then delete/move the source on device; play the item | Clear error message; no crash; no silent substitution | | NOT TESTED | Imported copies live in app storage, so removing the source should NOT break it — testing requires clearing app data or adb rm |
| A-10 | Airplane mode | Enable airplane mode; import and play | Import+playback work fully offline | | NOT TESTED | |
| A-11 | Restart persistence | Force-stop the app; reopen; open Library | Imported items still listed and playable | | NOT TESTED | Do NOT uninstall — uninstall deletes app-managed files |
| A-12 | Background playback | Start playback; press Home; wait 2–5 min | Audio may continue briefly; not guaranteed to persist (no foreground service in this engine version) | | NOT TESTED | KNOWN CONCERN — record exact behavior/duration |
| A-13 | Lock screen | Start playback; press power button to lock | Same as above — audio may stop; observe and record | | NOT TESTED | KNOWN CONCERN |
| A-14 | Notification/media controls | While playing (foreground and background), check the notification shade and lock screen | No media notification/lock-screen controls exist in this engine version — absence is expected, not a bug in our app | | NOT TESTED | KNOWN CONCERN — expected NOT SUPPORTED |
| A-15 | Headphone disconnect | Play via wired or Bluetooth headphones; unplug/disconnect | Playback may pause or continue on speaker — record what happens (engine has no Android BECOMING_NOISY handling) | | NOT TESTED | KNOWN CONCERN |
| A-16 | Audio interruption | Play; start a call or play audio in another app; end the interruption | App should lose/pause audio focus; record resume behavior | | NOT TESTED | KNOWN CONCERN — verify resume behavior |

## 6. What "done" means for this phase

- A development build installs and launches on a physical Android phone.
- Every row above has an actual result and a status (PASS/FAIL/PARTIAL) recorded
  from a real device session — replacing NOT TESTED.
- Background/lock-screen/notification/headphone rows record observed behavior
  with times (e.g. "audio stopped after ~1 min backgrounded"), not assumptions.
- Results feed back into the Phase 6A recommendation before any engine change
  or Phase 7 work is approved.

**Explicitly not verified as of this document:** any native build, any device
installation, any actual playback, background audio, lock-screen behavior,
notification controls, headphone behavior, or interruption handling.
