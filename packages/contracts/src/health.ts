/**
 * Health contract.
 *
 * Mirrors services/api/app/modules/health/schemas.py (HealthResponse) and
 * tests/test_health.py. The FastAPI service is the source of truth: this
 * package should be regenerated or updated from /openapi.json whenever the
 * Python schema changes (see README.md for the planned generation workflow).
 */

export const API_VERSION = "0.1.0";

export const DATABASE_STATUS = {
  skipped: "skipped",
  connected: "connected",
  unavailable: "unavailable",
} as const;

export type DatabaseStatus = (typeof DATABASE_STATUS)[keyof typeof DATABASE_STATUS];

export interface DatabaseHealth {
  status: DatabaseStatus;
  latency_ms: number | null;
}

export interface HealthResponse {
  service: string;
  status: string;
  environment: "development" | "production";
  version: string;
  database: DatabaseHealth;
}

/** Type guard validating an unknown payload against HealthResponse. */
export function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.service === "string" &&
    typeof v.status === "string" &&
    (v.environment === "development" || v.environment === "production") &&
    typeof v.version === "string" &&
    typeof v.database === "object" &&
    v.database !== null &&
    typeof (v.database as Record<string, unknown>).status === "string" &&
    ((v.database as Record<string, unknown>).latency_ms === null ||
      typeof (v.database as Record<string, unknown>).latency_ms === "number")
  );
}

/** Error envelope contract shared by all API failures. */
export interface ApiError {
  error: {
    code: string;
    message: string;
    details: unknown | null;
  };
}
