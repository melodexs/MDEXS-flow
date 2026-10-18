/**
 * Bookmark repository: audio time bookmarks and PDF page bookmarks.
 * Type/position consistency is enforced at the application boundary
 * (validation) in addition to the schema's CHECK constraints.
 */

import type { SqlDriver } from "../driver";
import { newId, nowIso } from "../ids";
import { requireDriver } from "../driver";
import { LocalDbError } from "../errors";
import { type Bookmark, type BookmarkType, validateBookmarkValue } from "../domain";

interface BookmarkRow {
  id: string;
  library_item_id: string;
  bookmark_type: string;
  position_ms: number | null;
  page: number | null;
  label: string | null;
  created_at: string;
  updated_at: string;
}

function toDomain(row: BookmarkRow): Bookmark {
  return { ...row, bookmark_type: row.bookmark_type as BookmarkType };
}

const SELECT = `SELECT id, library_item_id, bookmark_type, position_ms, page, label,
  created_at, updated_at FROM bookmarks`;

export async function createBookmark(
  db: SqlDriver,
  libraryItemId: string,
  bookmarkType: BookmarkType,
  value: { position_ms?: number | null; page?: number | null; label?: string | null }
): Promise<Bookmark> {
  const driver = requireDriver(db);
  const v = validateBookmarkValue(bookmarkType, value);
  const item = await driver.getFirstAsync<{ media_type: string }>(
    `SELECT media_type FROM library_items WHERE id = ?`,
    [libraryItemId]
  );
  if (!item) {
    throw new LocalDbError("not_found", "Cannot bookmark an item that does not exist.");
  }
  if (item.media_type !== bookmarkType) {
    throw new LocalDbError("validation_failed", "Bookmark type must match the item's media type.");
  }
  const id = newId();
  await driver.runAsync(
    `INSERT INTO bookmarks (id, library_item_id, bookmark_type, position_ms, page, label, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [id, libraryItemId, bookmarkType, v.position_ms, v.page, v.label, nowIso(), nowIso()]
  );
  const row = await driver.getFirstAsync<BookmarkRow>(`${SELECT} WHERE id = ?`, [id]);
  if (!row) throw new LocalDbError("query_failed", "The bookmark could not be read back.");
  return toDomain(row);
}

/** List bookmarks for an item, ordered naturally: audio by position, pdf by page. */
export async function listBookmarks(
  db: SqlDriver,
  libraryItemId: string
): Promise<Bookmark[]> {
  const rows = await requireDriver(db).getAllAsync<BookmarkRow>(
    `${SELECT} WHERE library_item_id = ?
     ORDER BY CASE WHEN position_ms IS NOT NULL THEN position_ms ELSE page END, created_at`,
    [libraryItemId]
  );
  return rows.map(toDomain);
}

export async function renameBookmarkLabel(
  db: SqlDriver,
  bookmarkId: string,
  label: string | null
): Promise<Bookmark> {
  const driver = requireDriver(db);
  if (label !== null && label.trim().length === 0) {
    throw new LocalDbError("validation_failed", "Label must be non-empty when provided.");
  }
  const result = await driver.runAsync(
    `UPDATE bookmarks SET label = ?, updated_at = ? WHERE id = ?`,
    [label === null ? null : label.trim(), nowIso(), bookmarkId]
  );
  if (result.rowsAffected === 0) {
    throw new LocalDbError("not_found", "That bookmark no longer exists.");
  }
  const row = await driver.getFirstAsync<BookmarkRow>(`${SELECT} WHERE id = ?`, [bookmarkId]);
  if (!row) throw new LocalDbError("not_found", "That bookmark no longer exists.");
  return toDomain(row);
}

/** Returns true when a row was deleted. */
export async function deleteBookmark(db: SqlDriver, bookmarkId: string): Promise<boolean> {
  const result = await requireDriver(db).runAsync(`DELETE FROM bookmarks WHERE id = ?`, [
    bookmarkId,
  ]);
  return result.rowsAffected > 0;
}
