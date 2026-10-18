/**
 * Deterministic schema migrations for the local SQLite database.
 *
 * Versioning: PRAGMA user_version stores the applied schema version.
 * Each migration is a list of statements applied atomically; the runner
 * (db.ts) walks migrations in order and never re-runs applied ones.
 * Migrations must be append-only: edit a shipped migration only if it has
 * never been released; otherwise add a new one.
 */

export const SCHEMA_VERSION = 1;

export interface SchemaMigration {
  /** Version this migration upgrades the database TO. */
  version: number;
  name: string;
  statements: readonly string[];
}

export const MIGRATIONS: readonly SchemaMigration[] = [
  {
    version: 1,
    name: "initial local schema (library, progress, bookmarks, playlists, history, sync queue)",
    statements: [
      `CREATE TABLE library_items (
        id TEXT PRIMARY KEY NOT NULL,
        media_type TEXT NOT NULL CHECK (media_type IN ('audio','pdf')),
        title TEXT NOT NULL CHECK (length(trim(title)) > 0),
        artist TEXT,
        author TEXT,
        album TEXT,
        description TEXT,
        original_filename TEXT,
        file_path TEXT,
        mime_type TEXT,
        size_bytes INTEGER,
        duration_ms INTEGER,
        page_count INTEGER,
        artwork_ref TEXT,
        origin TEXT NOT NULL DEFAULT 'device' CHECK (origin IN ('device','catalog')),
        unavailable INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_library_items_created ON library_items (created_at DESC)`,
      `CREATE TABLE progress (
        id TEXT PRIMARY KEY NOT NULL,
        library_item_id TEXT NOT NULL REFERENCES library_items (id),
        progress_type TEXT NOT NULL CHECK (progress_type IN ('audio','pdf')),
        position_ms INTEGER,
        page INTEGER,
        completed INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        UNIQUE (library_item_id, progress_type)
      )`,
      `CREATE TABLE bookmarks (
        id TEXT PRIMARY KEY NOT NULL,
        library_item_id TEXT NOT NULL REFERENCES library_items (id),
        bookmark_type TEXT NOT NULL CHECK (bookmark_type IN ('audio','pdf')),
        position_ms INTEGER,
        page INTEGER,
        label TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_bookmarks_item ON bookmarks (library_item_id)`,
      `CREATE TABLE playlists (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE playlist_items (
        id TEXT PRIMARY KEY NOT NULL,
        playlist_id TEXT NOT NULL REFERENCES playlists (id),
        library_item_id TEXT NOT NULL REFERENCES library_items (id),
        position INTEGER NOT NULL,
        added_at TEXT NOT NULL,
        UNIQUE (playlist_id, library_item_id)
      )`,
      `CREATE INDEX idx_playlist_items_order ON playlist_items (playlist_id, position)`,
      `CREATE TABLE activity_history (
        id TEXT PRIMARY KEY NOT NULL,
        library_item_id TEXT NOT NULL REFERENCES library_items (id),
        activity_type TEXT NOT NULL CHECK (activity_type IN ('audio','pdf')),
        started_at TEXT NOT NULL,
        ended_at TEXT,
        duration_seconds INTEGER NOT NULL,
        start_position_ms INTEGER,
        end_position_ms INTEGER,
        start_page INTEGER,
        end_page INTEGER,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_activity_history_item ON activity_history (library_item_id, started_at DESC)`,
      `CREATE TABLE sync_queue (
        id TEXT PRIMARY KEY NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation_type TEXT NOT NULL CHECK (operation_type IN ('create','update','delete')),
        payload TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        last_attempt_at TEXT,
        last_error TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_sync_queue_pending ON sync_queue (status, created_at)`,
    ],
  },
];
