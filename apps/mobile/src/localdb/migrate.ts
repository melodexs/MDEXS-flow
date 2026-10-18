/**
 * Migration runner (no Expo imports): walks ordered migrations, each inside
 * a transaction. Used by both the on-device initializer (db.ts) and the
 * Node test suite — the same production logic runs in both.
 */

import type { SqlDriver } from "./driver";
import { LocalDbError } from "./errors";
import { MIGRATIONS } from "./migrations";

/** PRAGMA user_version returns a single `user_version` column. */
interface PragmaRow {
  user_version: number;
}

/** Read the applied schema version. */
export async function readSchemaVersion(db: SqlDriver): Promise<number> {
  const row = await db.getFirstAsync<PragmaRow>("PRAGMA user_version");
  return Number(row?.user_version ?? 0);
}

/**
 * Apply pending migrations in order. Idempotent: applied migrations are
 * skipped. A failing migration rolls back atomically; no table drops or
 * data loss occur during normal startup.
 */
export async function applyMigrations(db: SqlDriver): Promise<void> {
  let fromVersion = await readSchemaVersion(db);
  for (const migration of MIGRATIONS) {
    if (fromVersion >= migration.version) continue;
    try {
      await db.withTransactionAsync(async () => {
        for (const statement of migration.statements) {
          await db.runAsync(statement);
        }
        await db.runAsync(`PRAGMA user_version = ${migration.version}`);
      });
      fromVersion = migration.version;
    } catch {
      throw new LocalDbError(
        "migration_failed",
        `Local database migration to version ${migration.version} (${migration.name}) failed; changes were rolled back. The previous data is intact.`
      );
    }
  }
}
