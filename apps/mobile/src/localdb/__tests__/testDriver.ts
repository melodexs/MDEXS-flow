/**
 * sql.js (WASM SQLite) implementation of the SqlDriver interface for Node
 * tests. This exercises the SAME migration runner and repository code that
 * runs on-device via expo-sqlite, against a real SQLite engine. It is NOT
 * the expo native module; on-device behavior must be verified on a native
 * development build.
 */

import initSqlJs, { type Statement } from "sql.js";

import type { SqlDriver, SqlParams, StatementResult } from "../driver";
import { applyMigrations } from "../migrate";

export async function createTestDriver(): Promise<SqlDriver> {
  const SQL = await initSqlJs();
  const database = new SQL.Database();

  const run = (sql: string, params: SqlParams = []): StatementResult => {
    const statement: Statement = database.prepare(sql);
    try {
      statement.bind(params);
      statement.step();
      const rowsAffected = database.getRowsModified();
      statement.free();
      const idResult = database.exec("SELECT last_insert_rowid()");
      const lastInsertRowId =
        idResult[0] && idResult[0].values[0] ? (idResult[0].values[0][0] as number) : 0;
      return { rowsAffected, lastInsertRowId };
    } catch (cause) {
      statement.free();
      throw cause;
    }
  };

  const rowsOf = (sql: string, params: SqlParams): Record<string, unknown>[] => {
    const statement = database.prepare(sql);
    try {
      statement.bind(params);
      const rows: Record<string, unknown>[] = [];
      while (statement.step()) {
        rows.push(statement.getAsObject());
      }
      return rows;
    } finally {
      statement.free();
    }
  };

  const driver: SqlDriver = {
    async runAsync(sql, params) {
      return run(sql, params ?? []);
    },
    async getFirstAsync(sql, params) {
      const rows = rowsOf(sql, params ?? []);
      return (rows[0] as never) ?? null;
    },
    async getAllAsync(sql, params) {
      return rowsOf(sql, params ?? []) as never[];
    },
    async withTransactionAsync(task) {
      run("BEGIN TRANSACTION");
      try {
        const result = await task();
        run("COMMIT");
        return result;
      } catch (cause) {
        try {
          run("ROLLBACK");
        } catch {
          // Rollback of an already-failed transaction; the original error matters.
        }
        throw cause;
      }
    },
  };

  // Mirror on-device initialization exactly: FK enforcement + production
  // migration runner.
  await driver.runAsync("PRAGMA foreign_keys = ON");
  await applyMigrations(driver);
  return driver;
}
