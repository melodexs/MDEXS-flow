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
