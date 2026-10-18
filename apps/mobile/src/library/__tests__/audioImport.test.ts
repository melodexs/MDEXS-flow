/**
 * Audio import tests (Phase 5). The platform boundary (picker + filesystem)
 * is faked; everything else — orchestration, SQLite, the library
 * repository — is the REAL production code running against a real SQLite
 * engine (sql.js WASM). On-device expo behavior must still be verified on
 * a native development build.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { runAudioImport, type AudioImportPlatform, type PickedAudioFile } from "../audioImport";
import { joinUri, looksLikeSupportedAudio, safeExtension, titleFromFileName } from "../audioImport";
import type { SqlDriver } from "@/localdb/driver";
import * as libraryItems from "@/localdb/repositories/libraryItems";
import { createTestDriver } from "@/localdb/__tests__/testDriver";

const MANAGED_DIR = "file:///managed/audio/";

/** In-memory fake filesystem: uri -> bytes (represented as sizes). */
class FakeFs {
  files = new Map<string, number>();

  exists(uri: string): boolean {
    return this.files.has(uri);
  }

  size(uri: string): number | null {
    return this.files.get(uri) ?? null;
  }
}

interface PlatformOverrides {
  pickOutcome?:
    | { status: "cancelled" }
    | { status: "pick_failed"; message: string }
    | { status: "picked"; file: PickedAudioFile };
  copyThrows?: boolean;
  fileDisappearsAfterRecord?: boolean;
  recordCreationFails?: boolean;
  directoryUnavailable?: boolean;
}

function makePlatform(overrides: PlatformOverrides = {}): AudioImportPlatform & { fs: FakeFs } {
  const fs = new FakeFs();
  const platform: AudioImportPlatform = {
    async pickAudioFile() {
      if (!overrides.pickOutcome || overrides.pickOutcome.status === "cancelled") {
        return { status: "cancelled" as const };
      }
      return overrides.pickOutcome;
    },
    ensureManagedAudioDirectory() {
      return overrides.directoryUnavailable ? null : MANAGED_DIR;
    },
    fileExists(uri) {
      return fs.exists(uri);
    },
    fileSize(uri) {
      return fs.size(uri);
    },
    copyFile(sourceUri, destinationUri) {
      if (overrides.copyThrows) throw new Error("copy failed");
      const size = fs.size(sourceUri);
      if (size === null) throw new Error("source missing");
      fs.files.set(destinationUri, size);
    },
    deleteFile(uri) {
      if (!fs.exists(uri)) return false;
      if (overrides.fileDisappearsAfterRecord) return false; // simulate stuck delete
      fs.files.delete(uri);
      return true;
    },
  };
  return Object.assign(platform, { fs });
}

function mp3File(overrides: Partial<PickedAudioFile> = {}): PickedAudioFile {
  return {
    uri: "file:///cache/pick-1.mp3",
    name: "Night Drive.mp3",
    mimeType: "audio/mpeg",
    size: 2048,
    ...overrides,
  };
}

let db: SqlDriver;

beforeEach(async () => {
  db = await createTestDriver();
});

describe("audio import orchestration", () => {
  it("imports successfully: managed file + SQLite record with metadata", async () => {
    const platform = makePlatform({
      pickOutcome: { status: "picked", file: mp3File() },
    });
    platform.fs.files.set("file:///cache/pick-1.mp3", 2048);

    const result = await runAudioImport(db, platform);

    expect(result.status).toBe("imported");
    if (result.status !== "imported") return;

    // Managed file exists under the app-managed directory with a UUID name.
    const managedFiles = [...platform.fs.files.keys()].filter((k) =>
      k.startsWith(MANAGED_DIR)
    );
    expect(managedFiles).toHaveLength(1);
    expect(managedFiles[0]).toMatch(/\/[0-9a-f-]{36}\.mp3$/);

    // The record references the managed file, not the picker cache URI.
    expect(result.item.file_path).toBe(managedFiles[0]);
    expect(result.item.file_path).not.toContain("cache");
    expect(result.item.media_type).toBe("audio");
    expect(result.item.origin).toBe("device");
    expect(result.item.title).toBe("Night Drive");
    expect(result.item.original_filename).toBe("Night Drive.mp3");
    expect(result.item.mime_type).toBe("audio/mpeg");
    expect(result.item.size_bytes).toBe(2048);
    expect(result.item.duration_ms).toBeNull();
    expect(result.item.artist).toBeNull();

    // The record is durably in SQLite.
    const rows = await libraryItems.listLibraryItems(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(result.item.id);
  });

  it("picker cancellation creates no record and reports no failure", async () => {
    const platform = makePlatform(); // default outcome: cancelled
    const result = await runAudioImport(db, platform);
    expect(result).toEqual({ status: "cancelled" });
    expect(await libraryItems.listLibraryItems(db)).toHaveLength(0);
    expect([...platform.fs.files.keys()].filter((k) => k.startsWith(MANAGED_DIR))).toHaveLength(0);
  });

  it("picker failure is reported as a failed import, with no record", async () => {
    const platform = makePlatform({
      pickOutcome: { status: "pick_failed", message: "The file picker could not be opened." },
    });
    const result = await runAudioImport(db, platform);
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.message).toContain("picker");
    expect(await libraryItems.listLibraryItems(db)).toHaveLength(0);
  });

  it("rejects unsupported-looking files without copying or recording", async () => {
    const platform = makePlatform({
      pickOutcome: {
        status: "picked",
        file: mp3File({ name: "virus.exe", mimeType: "application/octet-stream", uri: "file:///cache/x.exe" }),
      },
    });
    platform.fs.files.set("file:///cache/x.exe", 100);
    const result = await runAudioImport(db, platform);
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.message).toContain("supported");
    expect([...platform.fs.files.keys()].filter((k) => k.startsWith(MANAGED_DIR))).toHaveLength(0);
    expect(await libraryItems.listLibraryItems(db)).toHaveLength(0);
  });

  it("copy failure leaves no managed file and no library record", async () => {
    const platform = makePlatform({
      pickOutcome: { status: "picked", file: mp3File() },
      copyThrows: true,
    });
    const result = await runAudioImport(db, platform);
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.message).toContain("copied");
    expect([...platform.fs.files.keys()].filter((k) => k.startsWith(MANAGED_DIR))).toHaveLength(0);
    expect(await libraryItems.listLibraryItems(db)).toHaveLength(0);
  });

  it("a zero-byte source is refused, not registered as a valid import", async () => {
    const platform = makePlatform({
      pickOutcome: { status: "picked", file: mp3File({ size: 0 }) },
    });
    platform.fs.files.set("file:///cache/pick-1.mp3", 0);
    const result = await runAudioImport(db, platform);
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.message).toContain("verified");
    expect(await libraryItems.listLibraryItems(db)).toHaveLength(0);
  });

  it("an incomplete copy (size mismatch) is removed and reported", async () => {
    const platform = makePlatform({
      pickOutcome: { status: "picked", file: mp3File({ size: 4096 }) },
    });
    // The fake copy reproduces the source's fake size; lie about it.
    platform.fs.files.set("file:///cache/pick-1.mp3", 1024); // source "is" 1024
    const result = await runAudioImport(db, platform);
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.message).toContain("incomplete");
    expect([...platform.fs.files.keys()].filter((k) => k.startsWith(MANAGED_DIR))).toHaveLength(0);
    expect(await libraryItems.listLibraryItems(db)).toHaveLength(0);
  });

  it("database failure after copying cleans up the newly created file", async () => {
    const platform = makePlatform({
      pickOutcome: { status: "picked", file: mp3File() },
    });
    platform.fs.files.set("file:///cache/pick-1.mp3", 2048);

    // Sabotage the driver after the copy: the record insert must fail.
    const sabotaged: SqlDriver = {
      runAsync: async (sql) => {
        if (sql.startsWith("INSERT INTO library_items")) {
          throw new Error("disk I/O error");
        }
        return db.runAsync(sql);
      },
      getFirstAsync: (sql, params) => db.getFirstAsync(sql, params),
      getAllAsync: (sql, params) => db.getAllAsync(sql, params),
      withTransactionAsync: (task) => db.withTransactionAsync(task),
    };

    const result = await runAudioImport(sabotaged, platform);
    expect(result.status).toBe("failed");
    // The file this import created was removed again.
    expect([...platform.fs.files.keys()].filter((k) => k.startsWith(MANAGED_DIR))).toHaveLength(0);
    // And no record was left behind.
    expect(await libraryItems.listLibraryItems(db)).toHaveLength(0);
  });

  it("never overwrites an existing managed file (destination collision)", async () => {
    let call = 0;
    const platform = makePlatform({
      pickOutcome: { status: "picked", file: mp3File() },
    });
    platform.fs.files.set("file:///cache/pick-1.mp3", 2048);
    // Make the first generated destination already exist, then refuse a
    // second collision by simulating the pre-copy existence check.
    const originalExists = platform.fileExists.bind(platform);
    platform.fileExists = (uri: string) => {
      if (uri.startsWith(MANAGED_DIR) && call === 0) {
        call += 1;
        return true; // simulate an existing file at the destination
      }
      return originalExists(uri);
    };

    const result = await runAudioImport(db, platform);
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.message).toContain("unique filename");
    // No copy happened: the only managed file is the pre-existing one.
    expect([...platform.fs.files.keys()].filter((k) => k.startsWith(MANAGED_DIR))).toHaveLength(0);
    expect(await libraryItems.listLibraryItems(db)).toHaveLength(0);
  });

  it("a record whose file disappears is not reported as successful", async () => {
    const platform = makePlatform({
      pickOutcome: { status: "picked", file: mp3File() },
    });
    platform.fs.files.set("file:///cache/pick-1.mp3", 2048);
    // Make the managed file vanish after the record is written: the third
    // destination check is the orchestrator's final consistency verification.
    const realExists = platform.fileExists.bind(platform);
    let destChecks = 0;
    platform.fileExists = (uri: string) => {
      if (uri.startsWith(MANAGED_DIR)) destChecks += 1;
      if (uri.startsWith(MANAGED_DIR) && destChecks >= 3) {
        platform.fs.files.delete(uri); // the file "disappears"
        return false;
      }
      return realExists(uri);
    };

    const result = await runAudioImport(db, platform);
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.message).toContain("disappeared");
    // The now-broken record was removed (fresh, unreferenced records may be deleted).
    expect(await libraryItems.listLibraryItems(db)).toHaveLength(0);
  });

  it("imports the same source twice: no overwrite, two distinct records (documented limitation)", async () => {
    const platform = makePlatform({
      pickOutcome: { status: "picked", file: mp3File() },
    });
    platform.fs.files.set("file:///cache/pick-1.mp3", 2048);

    const first = await runAudioImport(db, platform);
    const second = await runAudioImport(db, platform);
    expect(first.status).toBe("imported");
    expect(second.status).toBe("imported");
    if (first.status !== "imported" || second.status !== "imported") return;

    // Two separate managed files, two records; nothing overwritten.
    expect(first.item.file_path).not.toBe(second.item.file_path);
    expect(first.item.id).not.toBe(second.item.id);
    const rows = await libraryItems.listLibraryItems(db);
    expect(rows).toHaveLength(2);
  });

  it("missing optional metadata (no name, no mime) still imports", async () => {
    const platform = makePlatform({
      pickOutcome: {
        status: "picked",
        file: { uri: "file:///cache/plain", name: null, mimeType: null, size: 512 },
      },
    });
    platform.fs.files.set("file:///cache/plain", 512);
    // Without a name there is no extension; the audio MIME hint is the only
    // signal. A null mime + null name cannot be judged, so require at least one hint.
    const result = await runAudioImport(db, platform);
    // With BOTH name and mime missing, the file is refused (not identifiable).
    expect(result.status).toBe("failed");

    // Redo with an audio mime but no name: imports with fallback title.
    const db2 = await createTestDriver();
    const platform2 = makePlatform({
      pickOutcome: {
        status: "picked",
        file: { uri: "file:///cache/plain", name: null, mimeType: "audio/mpeg", size: 512 },
      },
    });
    platform2.fs.files.set("file:///cache/plain", 512);
    const result2 = await runAudioImport(db2, platform2);
    expect(result2.status).toBe("imported");
    if (result2.status !== "imported") return;
    expect(result2.item.title).toBe("Imported audio");
    expect(result2.item.original_filename).toBeNull();
    expect(result2.item.size_bytes).toBe(512);
    expect(result2.item.file_path).toMatch(/\/[0-9a-f-]{36}$/);
  });

  it("storage preparation failure is reported without copying", async () => {
    const platform = makePlatform({
      pickOutcome: { status: "picked", file: mp3File() },
      directoryUnavailable: true,
    });
    platform.fs.files.set("file:///cache/pick-1.mp3", 2048);
    const result = await runAudioImport(db, platform);
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.message).toContain("storage");
    expect(await libraryItems.listLibraryItems(db)).toHaveLength(0);
  });
});

describe("import helpers", () => {
  it("derives safe extensions", () => {
    expect(safeExtension("Song.MP3")).toBe("mp3");
    expect(safeExtension("song.m4a")).toBe("m4a");
    expect(safeExtension("noext")).toBeNull();
    expect(safeExtension(null)).toBeNull();
    expect(safeExtension("weird.exe.bin.exe")).toBe("exe");
  });

  it("derives display titles from filenames", () => {
    expect(titleFromFileName("Night Drive.mp3")).toBe("Night Drive");
    expect(titleFromFileName("  spaced  out  .flac ")).toBe("spaced out");
    expect(titleFromFileName(".mp3")).toBe("Imported audio");
    expect(titleFromFileName(null)).toBe("Imported audio");
  });

  it("classifies plausible audio by extension or mime hint", () => {
    expect(looksLikeSupportedAudio(mp3File())).toBe(true);
    expect(
      looksLikeSupportedAudio({ uri: "u", name: "podcast.opus", mimeType: "audio/ogg", size: 1 })
    ).toBe(true); // mime hint passes even for unlisted .opus
    expect(
      looksLikeSupportedAudio({ uri: "u", name: "doc.pdf", mimeType: "application/pdf", size: 1 })
    ).toBe(false);
  });

  it("joins URIs while rejecting traversal-like filenames", () => {
    expect(joinUri("file:///a", "b.mp3")).toBe("file:///a/b.mp3");
    expect(joinUri("file:///a/", "b.mp3")).toBe("file:///a/b.mp3");
    expect(() => joinUri("file:///a", "../evil.mp3")).toThrow();
    expect(() => joinUri("file:///a", "a/b.mp3")).toThrow();
  });
});
