/**
 * Auth API calls. Public endpoints (register/login/refresh/google/logout)
 * never require an access token; /me does.
 */

import { ApiRequestError, authFetch, publicJson } from "./client";
import type { AuthUserSnapshot } from "@/auth/tokenStore";

export interface AuthSession {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  user: AuthUserSnapshot;
}

export async function apiRegister(
  email: string,
  password: string,
  displayName: string
): Promise<AuthSession> {
  return publicJson("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, display_name: displayName }),
  }) as Promise<AuthSession>;
}

export async function apiLogin(email: string, password: string): Promise<AuthSession> {
  return publicJson("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  }) as Promise<AuthSession>;
}

export async function apiRefresh(refreshToken: string): Promise<AuthSession> {
  return publicJson("/api/v1/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  }) as Promise<AuthSession>;
}

export async function apiLogout(refreshToken: string): Promise<void> {
  try {
    await publicJson("/api/v1/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch (error) {
    // Best-effort: local state is cleared regardless. Network failures here
    // must not keep the user signed in on the device.
    if (error instanceof ApiRequestError && error.status === 0) return;
    throw error;
  }
}

export async function apiGoogleLogin(idToken: string): Promise<AuthSession> {
  return publicJson("/api/v1/auth/google", {
    method: "POST",
    body: JSON.stringify({ id_token: idToken }),
  }) as Promise<AuthSession>;
}

export async function apiMe(accessToken?: string): Promise<AuthUserSnapshot> {
  const body = await authFetch("/api/v1/auth/me", {
    ...(accessToken ? { accessToken } : {}),
    expected: "json",
  });
  return body as AuthUserSnapshot;
}
