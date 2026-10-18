/**
 * Playback controller tests (Phase 6).
 *
 * These run the REAL PlaybackController and engine/queue logic against a
 * fake in-memory engine and fake file platform. They explicitly do NOT
 * prove native expo-audio behavior (background playback, interruptions,
 * codecs, actual device audio output) — that requires a physical
 * development build.
 */

import { describe, expect, it, vi } from "vitest";

import type { LibraryItem } from "@/localdb/domain";
import type {
  EngineStatus,
  PlaybackEngine,
  PlaybackPlatform,
} from "@/playback/engine";
import { buildQueue, isImportedAudio, assessPlayable } from "@/playback/engine";
import { PlaybackController } from "@/playback/PlaybackController";

/* ---------------------------------------------------------------- fake engine */

class FakePlayerStatus {
  playing = false;
  isBuffering = false;
  isLoaded = false;
  currentTime = 0;
  duration = 0;
  didJustFinish = false;
  playbackState = "idle";
}

class FakePlayer {
  readonly commands: string[] = [];
  status = new FakePlayerStatus();
  private readonly listeners = new Set<(status: EngineStatus) => void>();
  private source: string | null = null;
  failPlay = false;

  emit(patch: Partial<EngineStatus> = {}): void {
    const next = { ...this.statusSnapshot(), ...patch };
    this.status = Object.assign(new FakePlayerStatus(), next);
    for (const listener of [...this.listeners]) listener(this.statusSnapshot());
  }

  statusSnapshot(): EngineStatus {
    return { ...this.status };
  }

  play(): void {
    if (this.failPlay) throw new Error("engine: play failed");
    this.commands.push(`play:${this.source ?? "none"}`);
    this.status.playing = true;
    this.status.isLoaded = true;
    this.status.isBuffering = false;
    this.status.playbackState = "playing";
    this.emit();
  }

  pause(): void {
    this.commands.push("pause");
    this.status.playing = false;
    this.status.isBuffering = false;
    this.status.playbackState = "paused";
    this.emit();
  }

  replace(source: string): void {
    this.commands.push(`replace:${source}`);
    this.source = source;
    this.status = new FakePlayerStatus();
    this.status.playbackState = "loading";
    this.status.isBuffering = true;
    this.emit();
  }

  seekTo(seconds: number): void {
    if (!Number.isFinite(seconds)) throw new Error("engine: bad seek");
    this.commands.push(`seek:${Math.max(0, seconds).toFixed(2)}`);
    this.status.currentTime = Math.max(0, seconds);
    this.emit();
  }

  remove(): void {
    this.commands.push("remove");
  }

  onStatus(listener: (status: EngineStatus) => void): () => void {
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
    };
  }
}

class FakeEngine implements PlaybackEngine {
  readonly players: FakePlayer[] = [];
  modeCalls: unknown[] = [];
  failMode = false;
  /** Deferred used to test loads that are superseded mid-init. */
  private modeGate: Promise<void> | null = null;

  createPlayer(source: string | null): FakePlayer {
    const player = new FakePlayer();
    this.players.push(player);
    return player as unknown as FakePlayer;
  }

  async setAudioMode(mode: unknown): Promise<void> {
    this.modeCalls.push(mode);
    if (this.failMode) throw new Error("engine: mode failed");
    if (this.modeGate !== null) await this.modeGate;
  }

  setModeGate(promise: Promise<void> | null): void {
    this.modeGate = promise;
  }

  get lastPlayer(): FakePlayer {
    const last = this.players[this.players.length - 1];
    if (last === undefined) throw new Error("no player created yet");
    return last;
  }
}

/** Let the controller's pending async load continuation run to completion. */
async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function fakePlatform(files: Set<string>): PlaybackPlatform {
  return { fileExists: (uri) => files.has(uri) };
}

/* --------------------------------------------------------------- fixtures */

function audioItem(patch: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id: "item-1",
    media_type: "audio",
    title: "Track One",
    artist: null,
    author: null,
    album: null,
    description: null,
    original_filename: "Track One.mp3",
    file_path: "file:///documents/imported_audio/a.mp3",
    mime_type: "audio/mpeg",
    size_bytes: 1000,
    duration_ms: null,
    page_count: null,
    artwork_ref: null,
    origin: "device",
    unavailable: false,
    created_at: "2026-10-18T00:00:00Z",
    updated_at: "2026-10-18T00:00:00Z",
    ...patch,
  };
}

function makeLibrary(): LibraryItem[] {
  return [
    audioItem({ id: "a", title: "Alpha", file_path: "file:///m/a.mp3" }),
    audioItem({ id: "b", title: "Beta", file_path: "file:///m/b.mp3" }),
    audioItem({ id: "pdf", media_type: "pdf", title: "Doc", file_path: "file:///m/d.pdf" }),
    audioItem({ id: "meta", title: "Sample", file_path: null }),
    audioItem({ id: "gone", title: "Missing", file_path: "file:///m/gone.mp3" }),
    audioItem({ id: "c", title: "Gamma", file_path: "file:///m/c.mp3" }),
  ];
}

function makeController(files: Set<string>) {
  const engine = new FakeEngine();
  const platform = fakePlatform(files);
  const controller = new PlaybackController(engine, platform);
  return { engine, controller };
}

const ALL_FILES = new Set([
  "file:///m/a.mp3",
  "file:///m/b.mp3",
  "file:///m/c.mp3",
]);

/* ------------------------------------------------------------ engine helpers */

describe("queue construction (buildQueue)", () => {
  // Structural queue building: imported audio records in list order,
  // rotated to the selection. File EXISTENCE is not checked here (the
  // controller applies that with the platform; see below).
  it("includes only imported audio records, in list order, rotated to the selection", () => {
    const queue = buildQueue(makeLibrary(), "b");
    expect(queue?.map((t) => t.id)).toEqual(["b", "gone", "c", "a"]);
  });

  it("rotates from the last item back to the beginning", () => {
    const queue = buildQueue(makeLibrary(), "c");
    expect(queue?.map((t) => t.id)).toEqual(["c", "a", "b", "gone"]);
  });

  it("returns null when the requested item is not playable", () => {
    const library = makeLibrary();
    expect(buildQueue(library, "meta")).toBeNull(); // metadata only
    expect(buildQueue(library, "pdf")).toBeNull(); // not audio
    expect(buildQueue(library, "nope")).toBeNull(); // unknown id
  });
});

describe("playability assessment (assessPlayable)", () => {
  const platform = fakePlatform(ALL_FILES);

  it("accepts an imported audio file that exists", () => {
    const result = assessPlayable(
      audioItem({ file_path: "file:///m/a.mp3" }),
      platform
    );
    expect(result.playable).toBe(true);
  });

  it("rejects PDF items with a clear message", () => {
    const result = assessPlayable(
      audioItem({ media_type: "pdf", file_path: "file:///m/d.pdf" }),
      platform
    );
    expect(result.playable).toBe(false);
    if (!result.playable) expect(result.reason).toContain("Only audio");
  });

  it("rejects metadata-only records without exposing paths", () => {
    const result = assessPlayable(audioItem({ file_path: null }), platform);
    expect(result.playable).toBe(false);
    if (!result.playable) {
      expect(result.reason).toContain("no imported audio file");
      expect(result.reason).not.toContain("file://");
    }
  });

  it("rejects records whose file is missing from the device", () => {
    const platformWithMissing = fakePlatform(new Set(["file:///m/a.mp3"]));
    const result = assessPlayable(
      audioItem({ file_path: "file:///m/lost.mp3" }),
      platformWithMissing
    );
    expect(result.playable).toBe(false);
    if (!result.playable) expect(result.reason).toContain("missing");
  });

  it("rejects non-file URIs (e.g. remote or content URIs)", () => {
    const result = assessPlayable(
      audioItem({ file_path: "https://example.com/x.mp3" }),
      platform
    );
    expect(result.playable).toBe(false);
    if (!result.playable) expect(result.reason).toContain("not stored on this device");
  });

  it("rejects unavailable items", () => {
    const result = assessPlayable(audioItem({ unavailable: true }), platform);
    expect(result.playable).toBe(false);
  });

  it("isImportedAudio is false for metadata-only and PDF records", () => {
    expect(isImportedAudio(audioItem({ file_path: "file:///m/a.mp3" }))).toBe(true);
    expect(
      isImportedAudio(audioItem({ media_type: "pdf", file_path: "file:///m/d.pdf" }))
    ).toBe(false); // pdf
    expect(isImportedAudio(audioItem({ file_path: null }))).toBe(false); // metadata only
    expect(
      isImportedAudio(audioItem({ file_path: "file:///m/lost.mp3" }))
    ).toBe(true); // structurally imported; existence is platform-level
  });
});

describe("PlaybackController", () => {
  it("initializes the audio session once, plays, and drops dead entries from the queue", async () => {
    const { engine, controller } = makeController(ALL_FILES);
    const started = await controller.playFromQueue(makeLibrary(), "a");
    expect(started).toBe(true);

    const state = controller.getState();
    expect(state.phase).toBe("playing");
    expect(state.current?.id).toBe("a");
    expect(state.queue.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(engine.modeCalls).toHaveLength(1);
    expect(engine.lastPlayer.commands).toContain("replace:file:///m/a.mp3");

    // A second play does not reconfigure the audio session.
    await controller.playFromQueue(makeLibrary(), "b");
    expect(engine.modeCalls).toHaveLength(1);
  });

  it("engine initialization failure yields an error state and can be retried", async () => {
    const { engine, controller } = makeController(ALL_FILES);
    engine.failMode = true;

    const first = await controller.playFromQueue(makeLibrary(), "a");
    expect(first).toBe(true); // accepted; the failure happens during load
    expect(controller.getState().phase).toBe("error");
    expect(controller.getState().message).toContain("could not be started");

    engine.failMode = false;
    await controller.playFromQueue(makeLibrary(), "a");
    expect(controller.getState().phase).toBe("playing");
    expect(engine.modeCalls).toHaveLength(2); // retried after the failure
  });

  it("rejects a metadata-only record without creating a player", async () => {
    const { engine, controller } = makeController(ALL_FILES);
    const started = await controller.playFromQueue(makeLibrary(), "meta");
    expect(started).toBe(false);
    expect(controller.getState().phase).toBe("error");
    expect(controller.getState().message).toContain("no imported audio file");
    expect(engine.players).toHaveLength(0); // nothing was loaded or substituted
  });

  it("rejects a record whose file is missing; never substitutes a track", async () => {
    const { engine, controller } = makeController(ALL_FILES);
    const started = await controller.playFromQueue(makeLibrary(), "gone");
    expect(started).toBe(false);
    expect(controller.getState().message).toContain("missing");
    expect(engine.players).toHaveLength(0);
  });

  it("rejects a PDF record", async () => {
    const { controller } = makeController(ALL_FILES);
    const started = await controller.playFromQueue(makeLibrary(), "pdf");
    expect(started).toBe(false);
    expect(controller.getState().message).toContain("Only audio");
  });

  it("rejects an item that is not in the provided library", async () => {
    const { engine, controller } = makeController(ALL_FILES);
    const started = await controller.playFromQueue(makeLibrary(), "nope");
    expect(started).toBe(false);
    expect(controller.getState().message).toContain("no longer in your library");
    expect(engine.players).toHaveLength(0);
  });

  it("pause and resume keep the track and position", async () => {
    const { engine, controller } = makeController(ALL_FILES);
    await controller.playFromQueue(makeLibrary(), "a");
    const player = engine.lastPlayer;

    await controller.pause();
    expect(controller.getState().phase).toBe("paused");

    player.status.currentTime = 12;
    player.emit(); // engine reports position while paused (e.g. after seek)
    expect(controller.getState().positionSec).toBe(12);

    await controller.resume();
    expect(controller.getState().phase).toBe("playing");
    expect(player.commands).toContain("play:file:///m/a.mp3");
  });

  it("toggle switches between playing and paused", async () => {
    const { controller } = makeController(ALL_FILES);
    await controller.playFromQueue(makeLibrary(), "a");
    await controller.toggle();
    expect(controller.getState().phase).toBe("paused");
    await controller.toggle();
    expect(controller.getState().phase).toBe("playing");
  });

  it("seek clamps to the track duration and reports clamped position", async () => {
    const { engine, controller } = makeController(ALL_FILES);
    await controller.playFromQueue(makeLibrary(), "a");
    const player = engine.lastPlayer;

    player.status.duration = 100;
    player.emit();
    expect(controller.getState().durationSec).toBe(100);

    await controller.seekTo(500);
    expect(player.commands).toContain("seek:100.00");

    await controller.seekTo(-10);
    expect(player.commands).toContain("seek:0.00");
  });

  it("next and previous wrap at queue boundaries", async () => {
    const { controller } = makeController(ALL_FILES);
    await controller.playFromQueue(makeLibrary(), "a");

    await controller.skipNext();
    expect(controller.getState().current?.id).toBe("b");
    await controller.skipPrevious();
    expect(controller.getState().current?.id).toBe("a");
    await controller.skipPrevious(); // wraps to last
    expect(controller.getState().current?.id).toBe("c");
    await controller.skipNext(); // wraps to first
    expect(controller.getState().current?.id).toBe("a");
  });

  it("completion advances to the next track automatically", async () => {
    const { engine, controller } = makeController(ALL_FILES);
    await controller.playFromQueue(makeLibrary(), "a");
    const player = engine.lastPlayer;

    player.emit({ duration: 60 }); // engine reports the track length
    player.emit({ didJustFinish: true, currentTime: 60 });
    await flushAsync(); // auto-advance load runs asynchronously

    const state = controller.getState();
    expect(state.current?.id).toBe("b");
    expect(state.phase).toBe("playing");
  });

  it("completion of the final queue track settles in completed without looping", async () => {
    const { engine, controller } = makeController(ALL_FILES);
    // Queue for "c" is [c, a, b]; skip to the last entry first.
    await controller.playFromQueue(makeLibrary(), "c");
    const player = engine.lastPlayer;
    await controller.skipNext(); // a
    await controller.skipNext(); // b (last)
    expect(controller.getState().current?.id).toBe("b");

    player.emit({ duration: 60 });
    player.emit({ didJustFinish: true, currentTime: 60 });
    await flushAsync();

    const state = controller.getState();
    expect(state.phase).toBe("completed");
    expect(state.current?.id).toBe("b");
    expect(state.positionSec).toBe(60);

    // Resume after completion restarts from the beginning.
    await controller.resume();
    expect(player.commands).toContain("seek:0.00");
    expect(controller.getState().phase).toBe("playing");
  });

  it("engine-reported playback errors surface as user-facing error state", async () => {
    const { engine, controller } = makeController(ALL_FILES);
    await controller.playFromQueue(makeLibrary(), "a");
    const player = engine.lastPlayer;

    player.emit({ playbackState: "error", playing: false });

    const state = controller.getState();
    expect(state.phase).toBe("error");
    expect(state.message).toContain("could not be played");
    // No path leaked into the message.
    expect(state.message).not.toContain("file://");
  });

  it("a throwing play() reports an error and a later track recovers", async () => {
    const { engine, controller } = makeController(ALL_FILES);
    await controller.playFromQueue(makeLibrary(), "a");
    const player = engine.lastPlayer;

    player.failPlay = true;
    await controller.skipNext();
    expect(controller.getState().phase).toBe("error");
    expect(controller.getState().message).toContain("could not be started");

    player.failPlay = false;
    await controller.playFromQueue(makeLibrary(), "b");
    expect(controller.getState().phase).toBe("playing");
  });

  it("rapid track switching ignores stale loads and keeps consistent state", async () => {
    const { engine, controller } = makeController(ALL_FILES);
    // Gate the audio-mode promise to hold the first load mid-init.
    let releaseMode!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseMode = resolve;
    });
    engine.setModeGate(gate);

    const first = controller.playFromQueue(makeLibrary(), "a"); // pending
    const second = controller.playFromQueue(makeLibrary(), "b"); // supersedes it
    releaseMode();
    await Promise.all([first, second]);

    const state = controller.getState();
    expect(state.current?.id).toBe("b");
    expect(state.phase).toBe("playing");
    // Only ONE replace happened: the superseded load never touched the player.
    expect(engine.lastPlayer.commands.filter((c) => c.startsWith("replace"))).toEqual([
      "replace:file:///m/b.mp3",
    ]);
  });

  it("stops: pauses, rewinds, and returns to idle", async () => {
    const { engine, controller } = makeController(ALL_FILES);
    await controller.playFromQueue(makeLibrary(), "a");
    const player = engine.lastPlayer;

    await controller.stop();
    const state = controller.getState();
    expect(state.phase).toBe("idle");
    expect(state.positionSec).toBe(0);
    expect(player.commands).toContain("pause");
    expect(player.commands).toContain("seek:0.00");
  });

  it("subscribes a listener once, notifies on change, and unsubscribes idempotently", async () => {
    const { controller } = makeController(ALL_FILES);
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);

    // Duplicate registration of the SAME listener is a no-op.
    controller.subscribe(listener);

    await controller.playFromQueue(makeLibrary(), "a");
    // Each state change notifies once, regardless of duplicate subscribe.
    const callsAfterPlay = listener.mock.calls.length;
    expect(callsAfterPlay).toBeGreaterThan(0);

    unsubscribe();
    unsubscribe(); // idempotent
    await controller.pause();
    expect(listener.mock.calls.length).toBe(callsAfterPlay);
  });

  it("dispose removes the status subscription and releases the player", async () => {
    const { engine, controller } = makeController(ALL_FILES);
    await controller.playFromQueue(makeLibrary(), "a");
    const player = engine.lastPlayer;

    controller.dispose();

    expect(player.commands).toContain("remove");
    expect(controller.getState().phase).toBe("idle");
    expect(controller.getState().current).toBeNull();

    // Status events after dispose no longer mutate state.
    player.emit({ playbackState: "error" });
    expect(controller.getState().phase).toBe("idle");
  });
});
