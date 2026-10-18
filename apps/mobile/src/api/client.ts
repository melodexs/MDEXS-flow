/**
 * Typed fetch wrapper for the MDEXS Flow API.
 *
 * Three layers:
 * - `fetchJson`      low-level GET with timeout (unchanged, used by health).
 * - `publicJson`     JSON POST to public endpoints (register/login/refresh/...).
 * - `authFetch`     authenticated request with single-flight token refresh:
 *                   a 401 triggers ONE shared refresh; idempotent (GET/HEAD)
 *                   requests are retried at most once after a successful
 *                   refresh. Non-idempotent requests are never auto-replayed —
 *                   the caller receives the 401 and decides. No infinite
 *                   loops: a retry is never refreshed-and-retried again.
 *
 * Tokens live in memory here; persistent refresh-token storage is owned by
 * src/auth/tokenStore.ts + AuthProvider. Nothing is ever logged.
 */

import { isHealthResponse, type HealthResponse } from "@mdexs-flow/contracts";
import { getAppConfig } from "@/config/env";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

/** Default request timeout. Overridable per call. */
export const DEFAULT_TIMEOUT_MS = 10_000;

async function parseError(response: Response): Promise<never> {
  let code = `http_${response.status}`;
  let message = response.statusText || "Request failed";
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    if (body.error?.code) code = body.error.code;
    if (body.error?.message) message = body.error.message;
  } catch {
    // Non-JSON error body; keep defaults.
  }
  throw new ApiRequestError(response.status, code, message);
}

/** fetch with a timeout: rejects with ApiRequestError(code "timeout"). */
export async function fetchJson(
  path: string,
  options: { timeoutMs?: number } = {}
): Promise<Response> {
  const { apiBaseUrl } = getAppConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(`${apiBaseUrl}${path}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ApiRequestError(0, "timeout", "The request timed out.");
    }
    // Network-level failure (offline, DNS, refused connection).
    throw new ApiRequestError(0, "network_error", "Could not reach the API.");
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchHealth(timeoutMs?: number): Promise<HealthResponse> {
  const response = await fetchJson("/api/v1/health", { timeoutMs });
  if (!response.ok) await parseError(response);
  const body: unknown = await response.json();
  if (!isHealthResponse(body)) {
    throw new ApiRequestError(
      response.status,
      "contract_mismatch",
      "Response did not match the health contract"
    );
  }
  return body;
}

// ── Authenticated client ────────────────────────────────────────────

/** Current access token, kept in memory only. */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * Refresh hook installed once by the AuthProvider. Must return true when a
 * fresh session was installed, false otherwise (e.g. revoked token).
 */
export type RefreshHandler = () => Promise<boolean>;
let refreshHandler: RefreshHandler | null = null;

export function configureAuthRefresh(handler: RefreshHandler | null): void {
  refreshHandler = handler;
}

/** Single-flight: concurrent callers share one refresh attempt. */
let refreshInFlight: Promise<boolean> | null = null;

export async function ensureFreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  if (!refreshHandler) return false;
  refreshInFlight = refreshHandler().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

const IDEMPOTENT = new Set(["GET", "HEAD"]);

export interface AuthFetchOptions {
  accessToken?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: string;
  timeoutMs?: number;
  /** "json" parses and returns the body; "none" returns undefined. */
  expected?: "json" | "none";
}

/**
 * Authenticated request. Attaches the access token, refreshes once on an
 * authentication-expiry 401, and retries only idempotent methods once.
 */
export async function authFetch(
  path: string,
  options: AuthFetchOptions = {}
): Promise<unknown> {
  const method = options.method ?? "GET";

  const attempt = async (token: string | null): Promise<Response> => {
    const { apiBaseUrl } = getAppConfig();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      return await fetch(`${apiBaseUrl}${path}`, {
        method,
        headers: {
          Accept: "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: options.body,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new ApiRequestError(0, "timeout", "The request timed out.");
      }
      throw new ApiRequestError(0, "network_error", "Could not reach the API.");
    } finally {
      clearTimeout(timeout);
    }
  };

  let response = await attempt(options.accessToken ?? accessToken);
  if (response.status === 401 && IDEMPOTENT.has(method)) {
    // Auth expired: one shared refresh, at most one retry, no loops.
    const refreshed = await ensureFreshSession();
    if (refreshed) {
      response = await attempt(options.accessToken ?? accessToken);
      if (!response.ok) await parseError(response);
      return options.expected === "none" ? undefined : response.json();
    }
  }
  if (!response.ok) await parseError(response);
  return options.expected === "none" ? undefined : response.json();
}

/** JSON POST to a public endpoint (no access token involved). */
export async function publicJson(
  path: string,
  init: { method?: "POST" | "PUT" | "PATCH"; body?: string; timeoutMs?: number } = {}
): Promise<unknown> {
  const { apiBaseUrl } = getAppConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method: init.method ?? "POST",
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ApiRequestError(0, "timeout", "The request timed out.");
    }
    throw new ApiRequestError(0, "network_error", "Could not reach the API.");
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) await parseError(response);
  return response.json();
}
