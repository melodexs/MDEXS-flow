/**
 * Activity history repository: raw listening/reading session records.
 * Nothing here measures real playback time yet — records are inserted by
 * future playback/reader integration (later phases).
 */

import type { SqlDriver } from "../driver";
import { newId, nowIso } from "../ids";
import { requireDriver } from "../driver";
import { LocalDbError } from "../errors";
import { type ActivityHistoryRecord, type ActivityType } from "../domain";

interface HistoryRow extends Omit<ActivityHistoryRecord, "activity_type"> {
  activity_type: string;
}

const SELECT = `SELECT id, library_item_id, activity_type, started_at, ended_at,
  duration_seconds, start_position_ms, end_position_ms, start_page, end_page, created_at
  FROM activity_history`;

export interface NewHistoryRecord {
  library_item_id: string;
  activity_type: ActivityType;
  started_at: string;
  ended_at?: string | null;
  duration_seconds: number;
  start_position_ms?: number | null;
  end_position_ms?: number | null;
  start_page?: number | null;
  end_page?: number | null;
}

function validate(record: NewHistoryRecord): void {
  if (!Number.isInteger(record.duration_seconds) || record.duration_seconds < 0) {
    throw new LocalDbError("validation_failed", "duration_seconds must be a non-negative integer.");
  }
  if (record.start_position_ms !== null && record.start_position_ms !== undefined && record.start_position_ms < 0) {
    throw new LocalDbError("validation_failed", "start_position_ms cannot be negative.");
  }
  if (record.end_position_ms !== null && record.end_position_ms !== undefined && record.end_position_ms < 0) {
    throw new LocalDbError("validation_failed", "end_position_ms cannot be negative.");
  }
  if (record.activity_type === "audio" && record.start_page !== null && record.start_page !== undefined) {
    throw new LocalDbError("validation_failed", "Audio history cannot include page values.");
  }
  if (record.activity_type === "pdf" && record.start_position_ms !== null && record.start_position_ms !== undefined) {
    throw new LocalDbError("validation_failed", "PDF history cannot include position values.");
  }
}

export async function insertHistoryRecord(
  db: SqlDriver,
  record: NewHistoryRecord
): Promise<ActivityHistoryRecord> {
  const driver = requireDriver(db);
  validate(record);
  const item = await driver.getFirstAsync<{ id: string }>(
    `SELECT id FROM library_items WHERE id = ?`,
    [record.library_item_id]
  );
  if (!item) {
    throw new LocalDbError("not_found", "Cannot record history for a missing library item.");
  }
  const id = newId();
  await driver.runAsync(
    `INSERT INTO activity_history (id, library_item_id, activity_type, started_at, ended_at,
      duration_seconds, start_position_ms, end_position_ms, start_page, end_page, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, record.library_item_id, record.activity_type, record.started_at,
      record.ended_at ?? null, record.duration_seconds,
      record.start_position_ms ?? null, record.end_position_ms ?? null,
      record.start_page ?? null, record.end_page ?? null, nowIso(),
    ]
  );
  const row = await driver.getFirstAsync<HistoryRow>(`${SELECT} WHERE id = ?`, [id]);
  if (!row) throw new LocalDbError("query_failed", "The history record could not be read back.");
  return { ...row, activity_type: row.activity_type as ActivityType };
}

function toDomain(row: HistoryRow): ActivityHistoryRecord {
  return { ...row, activity_type: row.activity_type as ActivityType };
}

/** History for one item, newest session first. */
export async function listHistoryForItem(
  db: SqlDriver,
  libraryItemId: string
): Promise<ActivityHistoryRecord[]> {
  const rows = await requireDriver(db).getAllAsync<HistoryRow>(
    `${SELECT} WHERE library_item_id = ? ORDER BY started_at DESC, id`,
    [libraryItemId]
  );
  return rows.map(toDomain);
}

/** Recent history across all items, newest first. */
export async function listRecentHistory(
  db: SqlDriver,
  limit?: number
): Promise<ActivityHistoryRecord[]> {
  const cap = limit ?? 50;
  if (!Number.isInteger(cap) || cap < 1) {
    throw new LocalDbError("validation_failed", "limit must be a positive integer.");
  }
  const rows = await requireDriver(db).getAllAsync<HistoryRow>(
    `${SELECT} ORDER BY started_at DESC, id LIMIT ?`,
    [cap]
  );
  return rows.map(toDomain);
}
