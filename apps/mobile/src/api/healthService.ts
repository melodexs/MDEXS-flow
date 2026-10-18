/**
 * Health-check service: a small, typed façade over the API client used by
 * the development status screen. Single source of truth for the
 * HealthResponse type via @mdexs-flow/contracts.
 */

import { ApiRequestError, fetchHealth } from "@/api/client";
import type { HealthResponse } from "@mdexs-flow/contracts";

export type HealthCheckResult =
  | { readonly ok: true; readonly health: HealthResponse }
  | { readonly ok: false; readonly code: string; readonly message: string };

export async function checkApiHealth(timeoutMs?: number): Promise<HealthCheckResult> {
  try {
    const health = await fetchHealth(timeoutMs);
    return { ok: true, health };
  } catch (err) {
    if (err instanceof ApiRequestError) {
      return { ok: false, code: err.code, message: err.message };
    }
    return { ok: false, code: "unknown", message: String(err) };
  }
}
