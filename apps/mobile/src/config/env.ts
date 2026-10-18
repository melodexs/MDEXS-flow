/**
 * Typed configuration layer for environment-dependent settings.
 *
 * Only EXPO_PUBLIC_* variables are embedded in the app bundle — these must
 * never contain secrets. Privileged keys (storage credentials, database
 * strings, admin tokens) are backend-only by architecture.
 */

type ApiEnv = "development" | "production" | "preview";

export interface AppConfig {
  apiBaseUrl: string;
  apiEnv: ApiEnv;
}

function normalizeBaseUrl(value: string | undefined): string {
  if (!value) {
    // Local development default: the FastAPI service run from the monorepo.
    return "http://localhost:8000";
  }
  return value.replace(/\/+$/, "");
}

export function getAppConfig(): AppConfig {
  const apiEnv = (process.env.EXPO_PUBLIC_API_ENV as ApiEnv | undefined) ?? "development";
  return {
    apiBaseUrl: normalizeBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL),
    apiEnv,
  };
}
