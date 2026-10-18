/**
 * Vitest setup: the only platform substitution in the test suite.
 * Expo's native UUID generator is replaced with Node's built-in
 * crypto.randomUUID. All SQL, migrations, and repositories run real code
 * against a real SQLite engine (sql.js WASM).
 */
import { vi } from "vitest";

vi.mock("expo-crypto", () => ({
  randomUUID: () => crypto.randomUUID(),
}));
