/**
 * Production implementation of the audio-import platform boundary
 * (expo-document-picker + expo-file-system/next). Imported only by app
 * screens — Node tests provide their own fake platform instead, so this
 * module never loads outside Expo.
 *
 * Platform notes:
 * - expo-document-picker opens the native system picker (SAF on Android,
 *   the iOS document picker). No broad filesystem permission is requested;
 *   access is limited to what the user selects.
 * - `copyToCacheDirectory: true` makes the picked content readable after
 *   the picker closes; we then copy from there into app-managed storage,
 *   so no temporary picker URI is ever stored in SQLite.
 * - expo-file-system/next (SDK 53 `File`/`Directory`/`Paths`) is used
 *   exclusively; the legacy `FileSystem.*` API is NOT mixed in.
 */

import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system/next";

import type {
  AudioImportPlatform,
  AudioPickOutcome,
  PickedAudioFile,
} from "./audioImport";

const MANAGED_AUDIO_DIR_NAME = "imported_audio";

/** MIME hints offered to the picker. The picker may still show more files. */
const PICKER_MIME_TYPES: readonly string[] = [
  "audio/*",
  "application/ogg",
  "application/x-flac",
  "audio/x-wav",
  "audio/x-m4a",
  "audio/aac",
];

function managedDirectory(): Directory {
  return new Directory(Paths.document, MANAGED_AUDIO_DIR_NAME);
}

function toPickedFile(asset: DocumentPicker.DocumentPickerAsset): PickedAudioFile {
  return {
    uri: asset.uri,
    name: asset.name ?? null,
    mimeType: asset.mimeType ?? null,
    size: typeof asset.size === "number" ? asset.size : null,
  };
}

export function createExpoAudioImportPlatform(): AudioImportPlatform {
  return {
    async pickAudioFile(): Promise<AudioPickOutcome> {
      let result: DocumentPicker.DocumentPickerResult;
      try {
        result = await DocumentPicker.getDocumentAsync({
          type: PICKER_MIME_TYPES as DocumentPicker.DocumentPickerAsset["mimeType"][] & string[],
          multiple: false,
          copyToCacheDirectory: true,
        });
      } catch {
        return { status: "pick_failed", message: "The file picker could not be opened." };
      }
      if (result.canceled) return { status: "cancelled" };
      const asset = result.assets?.[0];
      if (!asset || typeof asset.uri !== "string" || asset.uri.length === 0) {
        return { status: "pick_failed", message: "No file could be read from the picker." };
      }
      return { status: "picked", file: toPickedFile(asset) };
    },

    ensureManagedAudioDirectory(): string | null {
      try {
        const dir = managedDirectory();
        if (!dir.exists) {
          dir.create();
        }
        return dir.exists ? dir.uri : null;
      } catch {
        return null;
      }
    },

    fileExists(uri: string): boolean {
      try {
        return new File(uri).exists;
      } catch {
        return false;
      }
    },

    fileSize(uri: string): number | null {
      try {
        return new File(uri).size;
      } catch {
        return null;
      }
    },

    copyFile(sourceUri: string, destinationUri: string): void {
      const source = new File(sourceUri);
      if (!source.exists) {
        throw new Error("The selected file is no longer readable.");
      }
      // Destination was verified not to exist by the orchestrator; copy()
      // therefore cannot overwrite an existing managed file.
      source.copy(new File(destinationUri));
    },

    deleteFile(uri: string): boolean {
      try {
        const file = new File(uri);
        if (!file.exists) return false;
        file.delete();
        return !file.exists;
      } catch {
        return false;
      }
    },
  };
}
