/**
 * Audio import orchestration (Phase 5).
 *
 * Imports a user-selected audio file into app-managed storage and records it
 * in the local SQLite library. Works fully offline; no sign-in, no network,
 * no backend. Playback is NOT part of this phase — an imported item is not
 * claimed to be playable.
 *
 * Testability: all filesystem and picker access goes through the injected
 * `AudioImportPlatform` boundary. Node tests provide a fake platform; on
 * device the boundary is implemented by `createExpoAudioImportPlatform()`
 * (expo-document-picker + expo-file-system/next).
 */

import type { LibraryItem } from "@/localdb/domain";
import { LocalDbError } from "@/localdb/errors";
import type { SqlDriver } from "@/localdb/driver";
import { newId } from "@/localdb/ids";
import * as libraryItems from "@/localdb/repositories/libraryItems";

/** File extensions this build intends to support (picker/platform may differ). */
export const SUPPORTED_AUDIO_EXTENSIONS: readonly string[] = [
  "mp3",
  "m4a",
  "aac",
  "wav",
  "flac",
  "ogg",
  "oga",
];

/** A file handed over by the picker. URI must be readable by the app. */
export interface PickedAudioFile {
  readonly uri: string;
  readonly name: string | null;
  readonly mimeType: string | null;
  readonly size: number | null;
}

export type AudioPickOutcome =
  | { readonly status: "cancelled" }
  | { readonly status: "picked"; readonly file: PickedAudioFile }
  | { readonly status: "pick_failed"; readonly message: string };

/**
 * Platform boundary for audio import: native picker + file operations.
 * The managed directory is app-private storage that survives app restarts
 * (but not app uninstall).
 */
export interface AudioImportPlatform {
  /** Open the native picker for one audio file. Never uploads anything. */
  pickAudioFile(): Promise<AudioPickOutcome>;
  /** Ensure the app-managed audio directory exists; return its URI or null. */
  ensureManagedAudioDirectory(): string | null;
  fileExists(uri: string): boolean;
  fileSize(uri: string): number | null;
  /** Copy source to destination. Must refuse to overwrite an existing file. */
  copyFile(sourceUri: string, destinationUri: string): void;
  /** Delete a file; returns true only if it existed and was removed. */
  deleteFile(uri: string): boolean;
}

export type AudioImportResult =
  | { readonly status: "cancelled" }
  | { readonly status: "imported"; readonly item: LibraryItem }
  | { readonly status: "failed"; readonly message: string };

/** Extract a safe, lowercased extension from a filename. */
export function safeExtension(name: string | null): string | null {
  if (!name) return null;
  const match = /\.([a-z0-9]{1,8})\s*$/i.exec(name.trim());
  const ext = match?.[1];
  return ext ? ext.toLowerCase() : null;
}

/** Display title: filename without extension, trimmed; never empty. */
export function titleFromFileName(name: string | null): string {
  if (!name) return "Imported audio";
  const withoutExt = name.trim().replace(/\.[a-z0-9]{1,8}\s*$/i, "");
  const cleaned = withoutExt.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : "Imported audio";
}

/**
 * Decide whether a picked file plausibly looks like supported audio.
 * Extensions and MIME types are HINTS, not proof of valid audio content;
 * a pass here means "import it", not "it will decode".
 */
export function looksLikeSupportedAudio(file: PickedAudioFile): boolean {
  const ext = safeExtension(file.name);
  if (ext !== null && SUPPORTED_AUDIO_EXTENSIONS.includes(ext)) return true;
  const mime = file.mimeType?.toLowerCase() ?? null;
  if (mime !== null && (mime === "audio/*" || mime.startsWith("audio/"))) return true;
  return false;
}

/**
 * Import one picked audio file end-to-end. Sequence (defensible against
 * orphans and broken records):
 *  1. pick (cancellation records nothing, reports nothing)
 *  2. plausibility check (unsupported-looking files are refused)
 *  3. copy into app-managed storage under a fresh UUID name (never overwrites)
 *  4. verify the copy (exists, non-zero, byte size matches source when known)
 *  5. insert the SQLite record referencing the managed file
 *  6. verify the file still exists; if not, remove the just-created record
 * Any failure after step 3 removes ONLY the file this import created.
 */
export async function runAudioImport(
  db: SqlDriver,
  platform: AudioImportPlatform
): Promise<AudioImportResult> {
  let pick: AudioPickOutcome;
  try {
    pick = await platform.pickAudioFile();
  } catch (cause) {
    return {
      status: "failed",
      message: cause instanceof LocalDbError ? cause.message : "The file could not be opened.",
    };
  }

  if (pick.status === "cancelled") return { status: "cancelled" };
  if (pick.status === "pick_failed") return { status: "failed", message: pick.message };

  const file = pick.file;
  if (!looksLikeSupportedAudio(file)) {
    return {
      status: "failed",
      message: "That file does not look like a supported audio file.",
    };
  }

  const directoryUri = platform.ensureManagedAudioDirectory();
  if (directoryUri === null) {
    return { status: "failed", message: "The import storage could not be prepared." };
  }

  const ext = safeExtension(file.name);
  // Collision-resistant destination name: never derived from user input.
  const destinationUri = joinUri(directoryUri, `${newId()}${ext ? `.${ext}` : ""}`);

  // Refuse to overwrite, even for the (practically impossible) UUID collision.
  if (platform.fileExists(destinationUri)) {
    return { status: "failed", message: "The import could not claim a unique filename." };
  }

  try {
    platform.copyFile(file.uri, destinationUri);
  } catch {
    // The copy failed before a record exists. If a partial file was left
    // behind, it was created by THIS import (we verified non-existence
    // above), so removing it is safe.
    tryRemove(platform, destinationUri);
    return { status: "failed", message: "The file could not be copied into app storage." };
  }

  // Post-copy verification. If the destination is unusable, remove it —
  // it was created by this import.
  const destExists = platform.fileExists(destinationUri);
  const destSize = platform.fileSize(destinationUri);
  const sourceSize = file.size;
  if (!destExists || destSize === null || destSize === 0) {
    tryRemove(platform, destinationUri);
    return { status: "failed", message: "The copied file could not be verified." };
  }
  if (sourceSize !== null && destSize !== sourceSize) {
    // A partial copy was registered; discard it and fail honestly.
    tryRemove(platform, destinationUri);
    return { status: "failed", message: "The file copy was incomplete." };
  }

  // The managed file is verified; now create the record. If the record
  // cannot be written, remove the file this import created.
  let item: LibraryItem;
  try {
    item = await libraryItems.createLibraryItem(db, {
      media_type: "audio",
      title: titleFromFileName(file.name),
      original_filename: file.name,
      file_path: destinationUri,
      mime_type: file.mimeType,
      size_bytes: destSize,
      origin: "device",
    });
  } catch (cause) {
    tryRemove(platform, destinationUri);
    return {
      status: "failed",
      message: cause instanceof LocalDbError ? cause.message : "The library record could not be saved.",
    };
  }

  // Final consistency check: a record whose file is missing is not a
  // successful import. The record is brand new (unreferenced), so removing
  // it is safe per the repository's deletion policy.
  if (!platform.fileExists(destinationUri)) {
    try {
      await libraryItems.deleteLibraryItem(db, item.id);
    } catch {
      // Best effort; report the failure either way.
    }
    return { status: "failed", message: "The imported file disappeared after saving." };
  }

  return { status: "imported", item };
}

/** Best-effort removal of a file created by the current import. */
function tryRemove(platform: AudioImportPlatform, uri: string): void {
  try {
    platform.deleteFile(uri);
  } catch {
    // Cleanup is best-effort; the failure is reported as part of the import error.
  }
}

/**
 * Join a directory URI and a filename defensively: no untrusted input
 * reaches the path (names are UUIDs), and traversal-like inputs are
 * rejected outright.
 */
export function joinUri(directoryUri: string, fileName: string): string {
  if (fileName.length === 0 || fileName.includes("/") || fileName.includes("\\")) {
    throw new Error("Invalid managed filename");
  }
  const base = directoryUri.endsWith("/") ? directoryUri : `${directoryUri}/`;
  return `${base}${fileName}`;
}
