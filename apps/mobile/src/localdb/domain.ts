/**
 * Domain types and boundary validation for the local data layer.
 *
 * Conventions:
 * - IDs: RFC 4122 v4 UUID strings (generated via expo-crypto randomUUID).
 * - Timestamps: ISO-8601 UTC strings (new Date().toISOString()).
 * - Booleans stored in SQLite as INTEGER 0/1; row types below are the raw
 *   shape. `toDomain` helpers in the repositories convert raw rows into
 *   the typed objects used by the rest of the app.
 */

export type MediaType = "audio" | "pdf";
export type ProgressType = "audio" | "pdf";
export type BookmarkType = "audio" | "pdf";
export type ActivityType = "audio" | "pdf";
export type ItemOrigin = "device" | "catalog";
export type QueueStatus = "pending" | "processing" | "completed" | "failed";
export type QueueOperation = "create" | "update" | "delete";

export const MEDIA_TYPES: readonly MediaType[] = ["audio", "pdf"];

export interface LibraryItem {
  id: string;
  media_type: MediaType;
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
  origin: ItemOrigin;
  unavailable: boolean;
  created_at: string;
  updated_at: string;
}

export interface NewLibraryItemInput {
  media_type: MediaType;
  title: string;
  artist?: string | null;
  author?: string | null;
  album?: string | null;
  description?: string | null;
  original_filename?: string | null;
  file_path?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  duration_ms?: number | null;
  page_count?: number | null;
  artwork_ref?: string | null;
  origin?: ItemOrigin;
}

export interface LibraryItemPatch {
  title?: string;
  artist?: string | null;
  author?: string | null;
  album?: string | null;
  description?: string | null;
  artwork_ref?: string | null;
}

export interface Progress {
  id: string;
  library_item_id: string;
  progress_type: ProgressType;
  position_ms: number | null;
  page: number | null;
  completed: boolean;
  updated_at: string;
}

export interface Bookmark {
  id: string;
  library_item_id: string;
  bookmark_type: BookmarkType;
  position_ms: number | null;
  page: number | null;
  label: string | null;
  created_at: string;
  updated_at: string;
}

export interface Playlist {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlaylistItem {
  id: string;
  playlist_id: string;
  library_item_id: string;
  position: number;
  added_at: string;
}

export interface ActivityHistoryRecord {
  id: string;
  library_item_id: string;
  activity_type: ActivityType;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
  start_position_ms: number | null;
  end_position_ms: number | null;
  start_page: number | null;
  end_page: number | null;
  created_at: string;
}

export interface QueueEntry {
  id: string;
  entity_type: string;
  entity_id: string;
  operation_type: QueueOperation;
  payload: string | null;
  attempt_count: number;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
  status: QueueStatus;
  created_at: string;
}

// ── Validation helpers ────────────────────────────────────────────────

function requireTrimmedString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationFailure(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalTrimmedString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationFailure(`${field} must be a non-empty string when provided.`);
  }
  return value.trim();
}

function optionalNonNegativeInt(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ValidationFailure(`${field} must be a non-negative integer when provided.`);
  }
  return value;
}

function optionalPositiveInt(value: unknown, field: string): number | null {
  const parsed = optionalNonNegativeInt(value, field);
  if (parsed !== null && parsed < 1) {
    throw new ValidationFailure(`${field} must be a positive integer when provided.`);
  }
  return parsed;
}

export function asMediaType(value: unknown): MediaType {
  if (value === "audio" || value === "pdf") return value;
  throw new ValidationFailure("media_type must be 'audio' or 'pdf'.");
}

export function asOrigin(value: unknown): ItemOrigin {
  if (value === "device" || value === "catalog") return value;
  throw new ValidationFailure("origin must be 'device' or 'catalog'.");
}

/** Exported for tests; production code uses the validation functions below. */
export class ValidationFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationFailure";
  }
}

export function validateNewLibraryItem(input: NewLibraryItemInput): ValidatedLibraryItemInput {
  return {
    media_type: asMediaType(input.media_type),
    title: requireTrimmedString(input.title, "title"),
    artist: optionalTrimmedString(input.artist, "artist"),
    author: optionalTrimmedString(input.author, "author"),
    album: optionalTrimmedString(input.album, "album"),
    description: optionalTrimmedString(input.description, "description"),
    original_filename: optionalTrimmedString(input.original_filename, "original_filename"),
    file_path: optionalTrimmedString(input.file_path, "file_path"),
    mime_type: optionalTrimmedString(input.mime_type, "mime_type"),
    size_bytes: optionalNonNegativeInt(input.size_bytes, "size_bytes"),
    duration_ms: optionalNonNegativeInt(input.duration_ms, "duration_ms"),
    page_count: optionalPositiveInt(input.page_count, "page_count"),
    artwork_ref: optionalTrimmedString(input.artwork_ref, "artwork_ref"),
    origin: input.origin === undefined ? "device" : asOrigin(input.origin),
  };
}

export interface ValidatedLibraryItemInput {
  media_type: MediaType;
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
  origin: ItemOrigin;
}

/** Validate an audio-position or pdf-page progress update. */
export function validateProgressValue(
  progressType: ProgressType,
  value: { position_ms?: number | null; page?: number | null; completed?: boolean }
): { position_ms: number | null; page: number | null; completed: boolean } {
  const position_ms = optionalNonNegativeInt(value.position_ms, "position_ms");
  const page = optionalPositiveInt(value.page, "page");
  const completed = value.completed ?? false;
  if (progressType === "audio" && position_ms === null) {
    throw new ValidationFailure("Audio progress requires position_ms.");
  }
  if (progressType === "pdf" && page === null) {
    throw new ValidationFailure("PDF progress requires page.");
  }
  if (progressType === "audio" && page !== null) {
    throw new ValidationFailure("Audio progress cannot include a page value.");
  }
  if (progressType === "pdf" && position_ms !== null) {
    throw new ValidationFailure("PDF progress cannot include position_ms.");
  }
  return { position_ms, page, completed };
}

/** Validate a typed bookmark: audio needs position_ms, pdf needs page. */
export function validateBookmarkValue(
  bookmarkType: BookmarkType,
  value: { position_ms?: number | null; page?: number | null; label?: string | null }
): { position_ms: number | null; page: number | null; label: string | null } {
  const position_ms = optionalNonNegativeInt(value.position_ms, "position_ms");
  const page = optionalPositiveInt(value.page, "page");
  const label = optionalTrimmedString(value.label, "label");
  if (bookmarkType === "audio") {
    if (position_ms === null) throw new ValidationFailure("Audio bookmarks require position_ms.");
    if (page !== null) throw new ValidationFailure("Audio bookmarks cannot include a page value.");
  } else {
    if (page === null) throw new ValidationFailure("PDF bookmarks require page.");
    if (position_ms !== null) {
      throw new ValidationFailure("PDF bookmarks cannot include position_ms.");
    }
  }
  return { position_ms, page, label };
}
