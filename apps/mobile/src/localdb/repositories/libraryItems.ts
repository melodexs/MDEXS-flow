/**
 * Library item repository: local media metadata (audio tracks and PDFs).
 *
 * Deletion policy is deliberate: an item referenced by progress, bookmarks,
 * playlist items, or history is NOT deleted; callers must archive it
 * (`setUnavailable`) or remove the references first. This prevents silently
 * corrupting user data. No sync queueing happens automatically here.
 */

import type { SqlDriver } from "../driver";
import { newId, nowIso } from "../ids";
import { requireDriver } from "../driver";
import { LocalDbError } from "../errors";
import {
  type ItemOrigin,
  type LibraryItem,
  type LibraryItemPatch,
  type MediaType,
  type NewLibraryItemInput,
  validateNewLibraryItem,
} from "../domain";

interface LibraryItemRow {
  id: string;
  media_type: string;
  title: string;
  artist: string | null;
  author: string | null;
  album: string | null;
  description: string | null;
  original_filename: string | null;
  file_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  duration_ms: number | null;
  page_count: number | null;
  artwork_ref: string | null;
  origin: string;
  unavailable: number;
  created_at: string;
  updated_at: string;
}

function toDomain(row: LibraryItemRow): LibraryItem {
  return {
    ...row,
    media_type: row.media_type as MediaType,
    origin: row.origin as ItemOrigin,
    unavailable: row.unavailable === 1,
  };
}

const SELECT = `SELECT id, media_type, title, artist, author, album, description,
  original_filename, file_path, mime_type, size_bytes, duration_ms, page_count,
  artwork_ref, origin, unavailable, created_at, updated_at FROM library_items`;

export async function createLibraryItem(
  db: SqlDriver,
  input: NewLibraryItemInput
): Promise<LibraryItem> {
  const driver = requireDriver(db);
  const v = validateNewLibraryItem(input);
  const item: LibraryItemRow = {
    id: newId(),
    media_type: v.media_type,
    title: v.title,
    artist: v.artist,
    author: v.author,
    album: v.album,
    description: v.description,
    original_filename: v.original_filename,
    file_path: v.file_path,
    mime_type: v.mime_type,
    size_bytes: v.size_bytes,
    duration_ms: v.duration_ms,
    page_count: v.page_count,
    artwork_ref: v.artwork_ref,
    origin: v.origin,
    unavailable: 0,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  await driver.runAsync(
    `INSERT INTO library_items (id, media_type, title, artist, author, album, description,
      original_filename, file_path, mime_type, size_bytes, duration_ms, page_count,
      artwork_ref, origin, unavailable, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      item.id, item.media_type, item.title, item.artist, item.author, item.album,
      item.description, item.original_filename, item.file_path, item.mime_type,
      item.size_bytes, item.duration_ms, item.page_count, item.artwork_ref,
      item.origin, item.unavailable, item.created_at, item.updated_at,
    ]
  );
  return toDomain(item);
}

export async function getLibraryItem(db: SqlDriver, id: string): Promise<LibraryItem | null> {
  const row = await requireDriver(db).getFirstAsync<LibraryItemRow>(`${SELECT} WHERE id = ?`, [id]);
  return row ? toDomain(row) : null;
}

/** List items, newest first; available items first unless `includeUnavailable`. */
export async function listLibraryItems(
  db: SqlDriver,
  options?: { includeUnavailable?: boolean }
): Promise<LibraryItem[]> {
  const includeUnavailable = options?.includeUnavailable ?? false;
  const rows = await requireDriver(db).getAllAsync<LibraryItemRow>(
    `${SELECT} ${includeUnavailable ? "" : "WHERE unavailable = 0"} ORDER BY created_at DESC, id`
  );
  return rows.map(toDomain);
}

export async function updateLibraryItem(
  db: SqlDriver,
  id: string,
  patch: LibraryItemPatch
): Promise<LibraryItem> {
  const driver = requireDriver(db);
  const existing = await getLibraryItem(driver, id);
  if (!existing) throw new LocalDbError("not_found", "That library item no longer exists.");

  const sets: string[] = [];
  const params: (string | null)[] = [];
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) throw new LocalDbError("validation_failed", "Title cannot be empty.");
    sets.push("title = ?");
    params.push(title);
  }
  for (const field of ["artist", "author", "album", "description", "artwork_ref"] as const) {
    const value = patch[field];
    if (value === undefined) continue;
    if (value !== null && value.trim().length === 0) {
      throw new LocalDbError("validation_failed", `${field} must be non-empty when provided.`);
    }
    sets.push(`${field} = ?`);
    params.push(value === null ? null : value.trim());
  }
  if (sets.length === 0) return existing;

  sets.push("updated_at = ?");
  params.push(nowIso());
  params.push(id);
  await driver.runAsync(
    `UPDATE library_items SET ${sets.join(", ")} WHERE id = ?`,
    params
  );
  const updated = await getLibraryItem(driver, id);
  if (!updated) throw new LocalDbError("not_found", "That library item no longer exists.");
  return updated;
}

/** Mark an item unavailable (archival) instead of destroying referenced data. */
export async function setUnavailable(
  db: SqlDriver,
  id: string,
  unavailable: boolean
): Promise<LibraryItem> {
  const driver = requireDriver(db);
  const existing = await getLibraryItem(driver, id);
  if (!existing) throw new LocalDbError("not_found", "That library item no longer exists.");
  await driver.runAsync(
    `UPDATE library_items SET unavailable = ?, updated_at = ? WHERE id = ?`,
    [unavailable ? 1 : 0, nowIso(), id]
  );
  return (await getLibraryItem(driver, id))!;
}

/**
 * Delete a library item. Refuses while the item is referenced by progress,
 * bookmarks, playlist items, or history — archive instead (setUnavailable).
 * Returns true when deleted, false when refused for being referenced.
 */
export async function deleteLibraryItem(db: SqlDriver, id: string): Promise<boolean> {
  const driver = requireDriver(db);
  const ref = await driver.getFirstAsync<{ refs: number }>(
    `SELECT
       (SELECT COUNT(*) FROM progress WHERE library_item_id = ?) +
       (SELECT COUNT(*) FROM bookmarks WHERE library_item_id = ?) +
       (SELECT COUNT(*) FROM playlist_items WHERE library_item_id = ?) +
       (SELECT COUNT(*) FROM activity_history WHERE library_item_id = ?) AS refs`,
    [id, id, id, id]
  );
  if ((ref?.refs ?? 0) > 0) return false;
  const result = await driver.runAsync(`DELETE FROM library_items WHERE id = ?`, [id]);
  return result.rowsAffected > 0;
}
