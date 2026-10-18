/**
 * Progress repository: one active progress record per (item, type), enforced
 * by a UNIQUE constraint and implemented as an upsert so the application
 * cannot create duplicates.
 */

import type { SqlDriver } from "../driver";
import { newId, nowIso } from "../ids";
import { requireDriver } from "../driver";
import { LocalDbError } from "../errors";
import {
  type Progress,
  type ProgressType,
  validateProgressValue,
} from "../domain";

interface ProgressRow {
  id: string;
  library_item_id: string;
  progress_type: string;
  position_ms: number | null;
  page: number | null;
  completed: number;
  updated_at: string;
}

function toDomain(row: ProgressRow): Progress {
  return { ...row, progress_type: row.progress_type as ProgressType, completed: row.completed === 1 };
}

export async function upsertProgress(
  db: SqlDriver,
  libraryItemId: string,
  progressType: ProgressType,
  value: { position_ms?: number | null; page?: number | null; completed?: boolean }
): Promise<Progress> {
  const driver = requireDriver(db);
  const v = validateProgressValue(progressType, value);

  const item = await driver.getFirstAsync<{ media_type: string }>(
    `SELECT media_type FROM library_items WHERE id = ?`,
    [libraryItemId]
  );
  if (!item) {
    throw new LocalDbError("not_found", "Cannot set progress for an item that does not exist.");
  }
  if (item.media_type !== progressType) {
    throw new LocalDbError(
      "validation_failed",
      "Progress type must match the item's media type."
    );
  }

  await driver.runAsync(
    `INSERT INTO progress (id, library_item_id, progress_type, position_ms, page, completed, updated_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT (library_item_id, progress_type)
     DO UPDATE SET position_ms = excluded.position_ms, page = excluded.page,
       completed = excluded.completed, updated_at = excluded.updated_at`,
    [newId(), libraryItemId, progressType, v.position_ms, v.page, v.completed ? 1 : 0, nowIso()]
  );

  const row = await driver.getFirstAsync<ProgressRow>(
    `SELECT id, library_item_id, progress_type, position_ms, page, completed, updated_at
     FROM progress WHERE library_item_id = ? AND progress_type = ?`,
    [libraryItemId, progressType]
  );
  if (!row) throw new LocalDbError("query_failed", "The progress record could not be read back.");
  return toDomain(row);
}

export async function getProgress(
  db: SqlDriver,
  libraryItemId: string,
  progressType: ProgressType
): Promise<Progress | null> {
  const row = await requireDriver(db).getFirstAsync<ProgressRow>(
    `SELECT id, library_item_id, progress_type, position_ms, page, completed, updated_at
     FROM progress WHERE library_item_id = ? AND progress_type = ?`,
    [libraryItemId, progressType]
  );
  return row ? toDomain(row) : null;
}
