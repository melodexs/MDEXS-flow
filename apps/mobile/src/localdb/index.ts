/**
 * Local data layer entry point: offline-first SQLite storage.
 *
 * Database access is local-only; nothing in this module requires the
 * network, an authenticated API session, or a signed-in user. Authentication
 * tokens remain exclusively in expo-secure-store (Phase 3) — never here.
 */

export { openLocalDatabase, getSchemaVersion } from "./db";
export { newId, nowIso } from "./ids";
export { applyMigrations, readSchemaVersion } from "./migrate";
export type { SqlDriver, SqlParams } from "./driver";
export { LocalDbError } from "./errors";
export type { LocalDbErrorCode } from "./errors";
export * from "./domain";
export * as libraryItems from "./repositories/libraryItems";
export * as progress from "./repositories/progress";
export * as bookmarks from "./repositories/bookmarks";
export * as playlists from "./repositories/playlists";
export * as history from "./repositories/history";
export * as syncQueue from "./repositories/syncQueue";
