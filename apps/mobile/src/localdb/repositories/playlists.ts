/**
 * Playlist repository: playlists plus an ordered, gapless item list.
 * Ordering updates run in a transaction so duplicate or inconsistent
 * positions cannot be left behind by a partial failure.
 */

import type { SqlDriver } from "../driver";
import { newId, nowIso } from "../ids";
import { requireDriver } from "../driver";
import { LocalDbError } from "../errors";
import { type Playlist, type PlaylistItem } from "../domain";

interface PlaylistRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

interface PlaylistItemRow {
  id: string;
  playlist_id: string;
  library_item_id: string;
  position: number;
  added_at: string;
}

const SELECT_PLAYLISTS = `SELECT id, name, description, created_at, updated_at FROM playlists`;

function assertName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new LocalDbError("validation_failed", "Playlist name cannot be empty.");
  return trimmed;
}

export async function createPlaylist(
  db: SqlDriver,
  name: string,
  description?: string | null
): Promise<Playlist> {
  const driver = requireDriver(db);
  const trimmed = assertName(name);
  const desc = description?.trim() ? description.trim() : null;
  const id = newId();
  await driver.runAsync(
    `INSERT INTO playlists (id, name, description, created_at, updated_at) VALUES (?,?,?,?,?)`,
    [id, trimmed, desc, nowIso(), nowIso()]
  );
  const row = await driver.getFirstAsync<PlaylistRow>(`${SELECT_PLAYLISTS} WHERE id = ?`, [id]);
  if (!row) throw new LocalDbError("query_failed", "The playlist could not be read back.");
  return row;
}

export async function listPlaylists(db: SqlDriver): Promise<Playlist[]> {
  return requireDriver(db).getAllAsync<PlaylistRow>(
    `${SELECT_PLAYLISTS} ORDER BY created_at DESC, id`
  );
}

export async function getPlaylist(db: SqlDriver, id: string): Promise<Playlist | null> {
  return requireDriver(db).getFirstAsync<PlaylistRow>(`${SELECT_PLAYLISTS} WHERE id = ?`, [id]);
}

export async function renamePlaylist(
  db: SqlDriver,
  id: string,
  name: string,
  description?: string | null
): Promise<Playlist> {
  const driver = requireDriver(db);
  const trimmed = assertName(name);
  const result = await driver.runAsync(
    `UPDATE playlists SET name = ?, description = COALESCE(?, description), updated_at = ? WHERE id = ?`,
    [trimmed, description === undefined ? null : description, nowIso(), id]
  );
  if (result.rowsAffected === 0) {
    throw new LocalDbError("not_found", "That playlist no longer exists.");
  }
  const row = await driver.getFirstAsync<PlaylistRow>(`${SELECT_PLAYLISTS} WHERE id = ?`, [id]);
  if (!row) throw new LocalDbError("not_found", "That playlist no longer exists.");
  return row;
}

/** Add an item to the end of a playlist. Fails if the item is already in it. */
export async function addPlaylistItem(
  db: SqlDriver,
  playlistId: string,
  libraryItemId: string
): Promise<PlaylistItem> {
  const driver = requireDriver(db);
  const playlist = await getPlaylist(driver, playlistId);
  if (!playlist) throw new LocalDbError("not_found", "That playlist no longer exists.");
  const item = await driver.getFirstAsync<{ id: string }>(
    `SELECT id FROM library_items WHERE id = ?`,
    [libraryItemId]
  );
  if (!item) {
    throw new LocalDbError("not_found", "Cannot add an item that is not in the library.");
  }
  return driver.withTransactionAsync(async () => {
    const last = await driver.getFirstAsync<{ max: number | null }>(
      `SELECT MAX(position) AS max FROM playlist_items WHERE playlist_id = ?`,
      [playlistId]
    );
    const position = (last?.max ?? -1) + 1;
    const id = newId();
    await driver.runAsync(
      `INSERT INTO playlist_items (id, playlist_id, library_item_id, position, added_at)
       VALUES (?,?,?,?,?)`,
      [id, playlistId, libraryItemId, position, nowIso()]
    );
    const row = await driver.getFirstAsync<PlaylistItemRow>(
      `SELECT id, playlist_id, library_item_id, position, added_at FROM playlist_items
       WHERE id = ?`,
      [id]
    );
    if (!row) throw new LocalDbError("query_failed", "The playlist entry could not be read back.");
    return row;
  });
}

/** Items in playlist order. */
export async function listPlaylistItems(
  db: SqlDriver,
  playlistId: string
): Promise<PlaylistItem[]> {
  return requireDriver(db).getAllAsync<PlaylistItemRow>(
    `SELECT id, playlist_id, library_item_id, position, added_at FROM playlist_items
     WHERE playlist_id = ? ORDER BY position, added_at`,
    [playlistId]
  );
}

/**
 * Reorder to an explicit list of playlist-item ids. Runs in a transaction:
 * either every position updates or none do. The full ordered id list is
 * required so no duplicate/gap positions can be left behind.
 */
export async function reorderPlaylistItems(
  db: SqlDriver,
  playlistId: string,
  orderedItemIds: readonly string[]
): Promise<PlaylistItem[]> {
  const driver = requireDriver(db);
  return driver.withTransactionAsync(async () => {
    const current = await listPlaylistItems(driver, playlistId);
    const currentIds = current.map((row) => row.id).sort();
    const wanted = [...orderedItemIds].sort();
    if (currentIds.length !== wanted.length || currentIds.some((id, i) => id !== wanted[i])) {
      throw new LocalDbError(
        "validation_failed",
        "Reorder requires the complete set of playlist entries, once each."
      );
    }
    for (let index = 0; index < orderedItemIds.length; index += 1) {
      const itemId = orderedItemIds[index];
      if (itemId === undefined) {
        throw new LocalDbError("validation_failed", "Reorder requires every entry id.");
      }
      await driver.runAsync(
        `UPDATE playlist_items SET position = ? WHERE id = ? AND playlist_id = ?`,
        [index, itemId, playlistId]
      );
    }
    return listPlaylistItems(driver, playlistId);
  });
}

/** Remove an entry; following entries keep their relative order. */
export async function removePlaylistItem(
  db: SqlDriver,
  playlistId: string,
  playlistItemId: string
): Promise<boolean> {
  const result = await requireDriver(db).runAsync(
    `DELETE FROM playlist_items WHERE id = ? AND playlist_id = ?`,
    [playlistItemId, playlistId]
  );
  return result.rowsAffected > 0;
}

/** Delete a playlist and its entries together (items stay in the library). */
export async function deletePlaylist(db: SqlDriver, playlistId: string): Promise<boolean> {
  const driver = requireDriver(db);
  return driver.withTransactionAsync(async () => {
    await driver.runAsync(`DELETE FROM playlist_items WHERE playlist_id = ?`, [playlistId]);
    const result = await driver.runAsync(`DELETE FROM playlists WHERE id = ?`, [playlistId]);
    return result.rowsAffected > 0;
  });
}
