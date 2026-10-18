import { LocalDbError } from "./errors";

/**
 * Minimal SQL driver interface (the expo-sqlite async API subset).
 *
 * Repositories depend on this interface, not on expo-sqlite directly, so the
 * same code can be exercised in Node tests against a real SQLite engine
 * (sql.js WASM). On device, the implementation is expo-sqlite's
 * SQLiteDatabase.
 */

export type SqlParam = string | number | null;
export type SqlParams = SqlParam[];

export interface StatementResult {
  readonly rowsAffected: number;
  readonly lastInsertRowId: number | bigint;
}

export interface SqlDriver {
  /** Execute a statement; returns rows affected and the insert row id. */
  runAsync(sql: string, params?: SqlParams): Promise<StatementResult>;
  /** Run a query and return the first row, or null. */
  getFirstAsync<T>(sql: string, params?: SqlParams): Promise<T | null>;
  /** Run a query and return all rows. */
  getAllAsync<T>(sql: string, params?: SqlParams): Promise<T[]>;
  /** Run `task` inside a transaction; rolls back on thrown error. */
  withTransactionAsync<T>(task: () => Promise<T>): Promise<T>;
}

/** Ensure a non-null driver (guards repository entry points). */
export function requireDriver(db: SqlDriver | null | undefined): SqlDriver {
  if (!db) throw new LocalDbError("not_initialized", "The local database is not open yet.");
  return db;
}
