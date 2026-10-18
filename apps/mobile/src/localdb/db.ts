/**
 * Database initialization and connection management for the on-device
 * SQLite database (expo-sqlite). Works fully offline; no network or
 * authenticated API request is needed to open, migrate, or read local
 * records. Authentication tokens stay in expo-secure-store (Phase 3) —
 * nothing auth-related is stored here.
 */

import * as ExpoSQLite from "expo-sqlite";

import type { SqlDriver } from "./driver";
import { LocalDbError } from "./errors";
import { applyMigrations, readSchemaVersion } from "./migrate";

const DATABASE_NAME = "mdexs_flow.db";

let driverPromise: Promise<SqlDriver> | null = null;

/**
 * Open (and, if needed, initialize/migrate) the local database.
 * Idempotent: repeated calls reuse the same connection and skip applied
 * migrations. If initialization fails, the failure is not cached and a
 * later call can retry.
 */
export function openLocalDatabase(): Promise<SqlDriver> {
  if (!driverPromise) {
    driverPromise = (async () => {
      const expoDb = await ExpoSQLite.openDatabaseAsync(DATABASE_NAME);
      const db: SqlDriver = {
        runAsync: async (sql, params) => {
          const result = await expoDb.runAsync(sql, params ?? []);
          // expo-sqlite v15 reports affected rows as `changes`.
          return { rowsAffected: result.changes, lastInsertRowId: result.lastInsertRowId };
        },
        getFirstAsync: (sql, params) => expoDb.getFirstAsync(sql, params ?? []),
        getAllAsync: (sql, params) => expoDb.getAllAsync(sql, params ?? []),
        // expo-sqlite's withTransactionAsync is void-typed, so the adapter
        // drives BEGIN/COMMIT/ROLLBACK itself to support return values.
        withTransactionAsync: async (task) => {
          await expoDb.execAsync("BEGIN");
          try {
            const result = await task();
            await expoDb.execAsync("COMMIT");
            return result;
          } catch (cause) {
            await expoDb.execAsync("ROLLBACK");
            throw cause;
          }
        },
      };
      await db.runAsync("PRAGMA foreign_keys = ON");
      await applyMigrations(db);
      return db;
    })().catch((cause: unknown) => {
      driverPromise = null;
      if (cause instanceof LocalDbError) throw cause;
      throw new LocalDbError("not_initialized", "The local database could not be opened.");
    });
  }
  return driverPromise;
}

/** Test/diagnostic hook: the applied schema version. */
export async function getSchemaVersion(db: SqlDriver): Promise<number> {
  return readSchemaVersion(db);
}
