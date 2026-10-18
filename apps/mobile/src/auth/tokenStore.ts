/**
 * Secure on-device credential storage (expo-secure-store).
 *
 * Platform notes (see docs in apps/mobile/README.md):
 * - iOS: values are stored in the Keychain.
 * - Android: values are stored in the Android Keystore (encrypted);
 *   requires the device to have a secure lock screen if a biometric
 *   policy is set — we use the default non-biometric policy.
 * - Web (Expo Web): expo-secure-store has limited support; authentication
 *   is targeted at native development builds only.
 *
 * Access tokens are kept in memory only (never persisted); refresh tokens
 * are persisted here. Tokens are never logged or sent to analytics.
 */

import * as SecureStore from "expo-secure-store";

const REFRESH_TOKEN_KEY = "mdexs.auth.refreshToken";
const USER_KEY = "mdexs.auth.userSnapshot";

export async function saveRefreshToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
}

export async function loadRefreshToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  } catch {
    // Storage unavailable (e.g. simulator quirk): fail safe as signed out.
    return null;
  }
}

/** Persist a safe user snapshot (no credentials) for offline display. */
export async function saveUserSnapshot(user: AuthUserSnapshot): Promise<void> {
  try {
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
  } catch {
    // Non-fatal: profile can be re-fetched from /me.
  }
}

export async function loadUserSnapshot(): Promise<AuthUserSnapshot | null> {
  try {
    const raw = await SecureStore.getItemAsync(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUserSnapshot) : null;
  } catch {
    return null;
  }
}

export async function clearAuthStorage(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
  } catch {
    // Nothing else to do; treat as cleared.
  }
}

export interface AuthUserSnapshot {
  id: string;
  email: string;
  display_name: string;
  status: string;
  email_verified: boolean;
}
