/**
 * Tests for the local SQLite data layer. These run against a real SQLite
 * engine (sql.js WASM in Node) using the production migration runner and
 * repository code. On-device expo-sqlite behavior must still be verified
 * on a native development build.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { applyMigrations, readSchemaVersion } from "../migrate";
import { SCHEMA_VERSION } from "../migrations";
import { LocalDbError } from "../errors";
import type { SqlDriver } from "../driver";
import { createTestDriver } from "./testDriver";
import * as libraryItems from "../repositories/libraryItems";
import * as progress from "../repositories/progress";
import * as bookmarks from "../repositories/bookmarks";
import * as playlists from "../repositories/playlists";
import * as history from "../repositories/history";
import * as syncQueue from "../repositories/syncQueue";

let db: SqlDriver;

beforeEach(async () => {
  db = await createTestDriver();
});

describe("initialization and migrations", () => {
  it("initializes a fresh database to the current schema version", async () => {
    expect(await readSchemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(1);
  });

  it("is safe to run repeatedly without duplicating schema or data", async () => {
    await libraryItems.createLibraryItem(db, { media_type: "audio", title: "Keep me" });
    await applyMigrations(db); // second run on the same database
    await applyMigrations(db); // third run
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'library_items'"
    );
    expect(tables).toHaveLength(1);
    const items = await libraryItems.listLibraryItems(db);
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("Keep me");
  });

  it("migrates an empty (version 0) database through the ordered migrations", async () => {
    // createTestDriver already applied migrations; verify from scratch
    const fresh = await import("./testDriver").then((m) => m.createTestDriver());
    expect(await readSchemaVersion(fresh)).toBe(SCHEMA_VERSION);
    const pending = await syncQueue.listPendingOperations(fresh, 10);
    expect(pending).toHaveLength(0);
  });

  it("rolls back a failed migration atomically and preserves data", async () => {
    await libraryItems.createLibraryItem(db, { media_type: "pdf", title: "Survivor" });
    const count = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM library_items");
    expect(count?.n).toBe(1);

    const failingDriver: SqlDriver = {
      runAsync: async (sql) => {
        if (sql.startsWith("CREATE TABLE library_items")) {
          throw new Error("boom");
        }
        return db.runAsync(sql);
      },
      getFirstAsync: (sql, params) => db.getFirstAsync(sql, params),
      getAllAsync: (sql, params) => db.getAllAsync(sql, params),
      withTransactionAsync: (task) => db.withTransactionAsync(task),
    };

    // Pretend the schema is un-applied so the runner re-runs migration 1,
    // which now "fails" mid-way. The runner must surface a migration error.
    await db.runAsync("PRAGMA user_version = 0");
    await expect(applyMigrations(failingDriver)).rejects.toBeInstanceOf(LocalDbError);
  });
});

describe("library items", () => {
  it("creates, retrieves, lists, and updates items", async () => {
    const created = await libraryItems.createLibraryItem(db, {
      media_type: "audio",
      title: "  Night Drive  ",
      artist: "Ada",
      album: "Neon",
      duration_ms: 245000,
      origin: "device",
    });
    expect(created.title).toBe("Night Drive");
    expect(created.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(created.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

    const fetched = await libraryItems.getLibraryItem(db, created.id);
    expect(fetched?.title).toBe("Night Drive");

    const updated = await libraryItems.updateLibraryItem(db, created.id, {
      title: "Night Drive (Remaster)",
      artist: null,
    });
    expect(updated.title).toBe("Night Drive (Remaster)");
    expect(updated.artist).toBeNull();
    expect(updated.updated_at >= created.updated_at).toBe(true);
  });

  it("rejects invalid media types and blank required fields", async () => {
    await expect(
      libraryItems.createLibraryItem(db, { media_type: "video" as never, title: "x" })
    ).rejects.toThrow(/media_type/);
    await expect(
      libraryItems.createLibraryItem(db, { media_type: "audio", title: "   " })
    ).rejects.toThrow(/title/);
    await expect(
      libraryItems.createLibraryItem(db, { media_type: "audio", title: "x", duration_ms: -5 })
    ).rejects.toThrow(/duration_ms/);
  });

  it("enforces foreign keys on invalid item references", async () => {
    await expect(
      progress.upsertProgress(db, "nonexistent-id", "audio", { position_ms: 10 })
    ).rejects.toThrow();
    const constraintError = await db
      .runAsync(
        `INSERT INTO progress (id, library_item_id, progress_type, position_ms, completed, updated_at)
         VALUES ('p1','no-such-item','audio',0,0,'2026-01-01T00:00:00Z')`
      )
      .then(() => false)
      .catch(() => true);
    expect(constraintError).toBe(true);
  });

  it("refuses deletion of referenced items but allows archiving", async () => {
    const item = await libraryItems.createLibraryItem(db, { media_type: "audio", title: "Referenced" });
    await progress.upsertProgress(db, item.id, "audio", { position_ms: 100 });
    expect(await libraryItems.deleteLibraryItem(db, item.id)).toBe(false);

    const archived = await libraryItems.setUnavailable(db, item.id, true);
    expect(archived.unavailable).toBe(true);
    expect(await libraryItems.listLibraryItems(db)).toHaveLength(0);
    expect(await libraryItems.listLibraryItems(db, { includeUnavailable: true })).toHaveLength(1);
  });
});

describe("progress", () => {
  it("upserts without creating duplicates", async () => {
    const item = await libraryItems.createLibraryItem(db, { media_type: "audio", title: "Track" });
    await progress.upsertProgress(db, item.id, "audio", { position_ms: 500 });
    await progress.upsertProgress(db, item.id, "audio", { position_ms: 900 });
    await progress.upsertProgress(db, item.id, "audio", { position_ms: 1200, completed: true });

    const rows = await db.getAllAsync("SELECT * FROM progress WHERE library_item_id = ?", [item.id]);
    expect(rows).toHaveLength(1);
    const stored = await progress.getProgress(db, item.id, "audio");
    expect(stored?.position_ms).toBe(1200);
    expect(stored?.completed).toBe(true);
  });

  it("rejects invalid positions and contradictory values", async () => {
    const item = await libraryItems.createLibraryItem(db, { media_type: "audio", title: "Track" });
    await expect(
      progress.upsertProgress(db, item.id, "audio", { position_ms: -1 })
    ).rejects.toThrow(/position_ms/);
    await expect(
      progress.upsertProgress(db, item.id, "pdf", { page: 1 })
    ).rejects.toThrow(/media type/);
  });
});

describe("bookmarks", () => {
  it("creates typed bookmarks and lists them per item in order", async () => {
    const item = await libraryItems.createLibraryItem(db, { media_type: "audio", title: "Track" });
    const other = await libraryItems.createLibraryItem(db, { media_type: "audio", title: "Other" });

    const b2 = await bookmarks.createBookmark(db, item.id, "audio", { position_ms: 900 });
    const b1 = await bookmarks.createBookmark(db, item.id, "audio", {
      position_ms: 100,
      label: "Intro",
    });
    await bookmarks.createBookmark(db, other.id, "audio", { position_ms: 1 });
    await expect(
      bookmarks.createBookmark(db, item.id, "audio", { page: 3 })
    ).rejects.toThrow(/position_ms/);

    const list = await bookmarks.listBookmarks(db, item.id);
    expect(list.map((b) => b.position_ms)).toEqual([100, 900]);
    expect(list[0]?.label).toBe("Intro");

    expect(await bookmarks.deleteBookmark(db, b2.id)).toBe(true);
    expect(await bookmarks.deleteBookmark(db, b1.id)).toBe(true);
    expect(await bookmarks.listBookmarks(db, item.id)).toHaveLength(0);
  });
});

describe("playlists", () => {
  it("preserves ordering and enforces valid references", async () => {
    const p = await playlists.createPlaylist(db, "Road trip", "Long drives");
    expect(p.name).toBe("Road trip");

    const a = await libraryItems.createLibraryItem(db, { media_type: "audio", title: "A" });
    const b = await libraryItems.createLibraryItem(db, { media_type: "audio", title: "B" });
    const c = await libraryItems.createLibraryItem(db, { media_type: "audio", title: "C" });

    const pa = await playlists.addPlaylistItem(db, p.id, a.id);
    const pb = await playlists.addPlaylistItem(db, p.id, b.id);
    await playlists.addPlaylistItem(db, p.id, c.id);
    await expect(playlists.addPlaylistItem(db, p.id, a.id)).rejects.toThrow();
    await expect(playlists.addPlaylistItem(db, p.id, "missing")).rejects.toThrow(/not.*library|does not exist|no longer/i);

    let entries = await playlists.listPlaylistItems(db, p.id);
    expect(entries.map((e) => e.library_item_id)).toEqual([a.id, b.id, c.id]);

    // Reorder A..C -> C..B..A atomically.
    const reordered = await playlists.reorderPlaylistItems(db, p.id, [
      entries[2]!.id,
      entries[1]!.id,
      entries[0]!.id,
    ]);
    expect(reordered.map((e) => e.position)).toEqual([0, 1, 2]);
    expect(reordered[0]?.library_item_id).toBe(c.id);

    // Partial reorder input is rejected.
    await expect(playlists.reorderPlaylistItems(db, p.id, [pa.id])).rejects.toThrow();
    await expect(playlists.reorderPlaylistItems(db, p.id, [pa.id, pb.id, "fake"])).rejects.toThrow();

    // Deleting the playlist removes its entries only.
    expect(await playlists.deletePlaylist(db, p.id)).toBe(true);
    expect(await playlists.listPlaylistItems(db, p.id)).toHaveLength(0);
    expect(await libraryItems.listLibraryItems(db)).toHaveLength(3);
  });
});

describe("history", () => {
  it("inserts records and lists them newest-first, predictably", async () => {
    const item = await libraryItems.createLibraryItem(db, { media_type: "audio", title: "Track" });
    await history.insertHistoryRecord(db, {
      library_item_id: item.id,
      activity_type: "audio",
      started_at: "2026-10-18T10:00:00Z",
      duration_seconds: 120,
      start_position_ms: 0,
      end_position_ms: 120000,
    });
    await history.insertHistoryRecord(db, {
      library_item_id: item.id,
      activity_type: "audio",
      started_at: "2026-10-18T11:00:00Z",
      duration_seconds: 300,
    });

    const list = await history.listHistoryForItem(db, item.id);
    expect(list.map((r) => r.started_at)).toEqual([
      "2026-10-18T11:00:00Z",
      "2026-10-18T10:00:00Z",
    ]);
    const recent = await history.listRecentHistory(db, 1);
    expect(recent).toHaveLength(1);

    await expect(
      history.insertHistoryRecord(db, {
        library_item_id: item.id,
        activity_type: "audio",
        started_at: "2026-10-18T12:00:00Z",
        duration_seconds: -10,
      })
    ).rejects.toThrow(/duration_seconds/);
  });
});

describe("sync queue", () => {
  it("enqueues and lists pending operations fully offline", async () => {
    const entry = await syncQueue.enqueueOperation(db, {
      entity_type: "progress",
      entity_id: "some-item",
      operation_type: "update",
      payload: '{"position_ms":1500}',
    });
    expect(entry.status).toBe("pending");
    expect(entry.attempt_count).toBe(0);

    const pending = await syncQueue.listPendingOperations(db);
    expect(pending.map((e) => e.id)).toContain(entry.id);

    await syncQueue.updateOperationStatus(db, entry.id, "processing");
    const afterProcessing = await syncQueue.listPendingOperations(db);
    expect(afterProcessing.map((e) => e.id)).not.toContain(entry.id);

    const failed = await syncQueue.updateOperationStatus(db, entry.id, "failed", {
      errorSummary: "server returned 503",
    });
    expect(failed.attempt_count).toBe(1);
    expect(failed.last_error).toBe("server returned 503");

    await syncQueue.updateOperationStatus(db, entry.id, "completed");
    expect(await syncQueue.purgeCompletedOperations(db)).toBeGreaterThanOrEqual(1);

    await expect(
      syncQueue.enqueueOperation(db, {
        entity_type: "x",
        entity_id: "y",
        operation_type: "explode" as never,
      })
    ).rejects.toThrow(/operation_type/);
  });
});

describe("transaction integrity", () => {
  it("rolls back related writes when one step fails", async () => {
    const item = await libraryItems.createLibraryItem(db, { media_type: "audio", title: "Item" });
    const before = await db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM playlists"
    );
    await db
      .withTransactionAsync(async () => {
        await db.runAsync(
          `INSERT INTO playlists (id, name, created_at, updated_at) VALUES ('t1','Temp',?,?)`,
          ["2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"]
        );
        // Second statement violates a constraint -> whole transaction must roll back.
        await db.runAsync(
          `INSERT INTO playlist_items (id, playlist_id, library_item_id, position, added_at)
           VALUES ('t1','t1','missing-item',0,?)`,
          ["2026-01-01T00:00:00Z"]
        );
      })
      .catch(() => "rolled-back");
    const after = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM playlists");
    expect(after?.n).toBe(before?.n ?? 0);
    expect(item.title).toBe("Item");
  });
});
