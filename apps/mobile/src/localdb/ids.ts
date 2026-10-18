/**
 * ID and timestamp conventions for the local data layer.
 *
 * - IDs: RFC 4122 v4 UUID strings (expo-crypto randomUUID on device).
 * - Timestamps: ISO-8601 UTC strings, e.g. 2026-10-18T22:35:00.000Z.
 *
 * Tests inject a Node-native UUID generator via vitest module mocking;
 * only the platform RNG is substituted there — no storage code is mocked.
 */

import { randomUUID } from "expo-crypto";

export function newId(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
