/**
 * Playback engine boundary (Phase 6).
 *
 * The controller and all queue/track logic live in `PlaybackController.ts`
 * and depend ONLY on the interfaces here. The production adapter
 * (`expoPlaybackPlatform.ts`) maps these onto expo-audio (~0.4.9, the
 * Expo SDK 53 version) and is imported only by app screens; Node tests
 * inject a fake engine, so no native audio module ever loads in the test
 * environment.
 *
 * Engine choice: expo-audio is first-party, native to the New Architecture,
 * compiles with Expo SDK 53 / RN 0.79.6, and needs no third-party native
 * patches. See ADR-008 for the full comparison and trade-offs
 * (no lock-screen/media-notification controls in this SDK-53 version).
 */

import type { LibraryItem } from "@/localdb/domain";

/** Normalized playback status emitted by the engine. */
export interface EngineStatus {
  /** Whether the engine is actively producing audio. */
  readonly playing: boolean;
  /** Whether the engine is still buffering/loading the track. */
  readonly isBuffering: boolean;
  /** Whether the track's media has been loaded. */
  readonly isLoaded: boolean;
  /** Playback position in seconds. */
  readonly currentTime: number;
  /** Track duration in seconds (0 while unknown). */
  readonly duration: number;
  /** True on the status update in which playback just completed. */
  readonly didJustFinish: boolean;
  /** Engine playback state string; "error" marks a failed track. */
  readonly playbackState: string;
}

/** A single handle to the underlying audio player. */
export interface EnginePlayerHandle {
  /** Start or resume playback. */
  play(): void;
  /** Pause playback (position is kept). */
  pause(): void;
  /** Swap the audio source without recreating the player. */
  replace(source: string): void;
  /** Seek to an absolute position in seconds. */
  seekTo(seconds: number): void;
  /** Release native resources held by the player. */
  remove(): void;
  /**
   * Subscribe to playback status updates. Returns an idempotent
   * unsubscribe function.
   */
  onStatus(listener: (status: EngineStatus) => void): () => void;
}

/** Runtime audio-session configuration for the engine. */
export interface EngineAudioMode {
  /** Play even when the device is in silent mode (iOS). */
  readonly playsInSilentMode: boolean;
  /** Keep the audio session active when the app is backgrounded. */
  readonly shouldPlayInBackground: boolean;
  /** How this session competes with other audio sessions. */
  readonly interruptionMode: "mixWithOthers" | "doNotMix" | "duckOthers";
}

/** The native playback engine (expo-audio in production). */
export interface PlaybackEngine {
  /** Create a player; the optional initial source may be null. */
  createPlayer(source: string | null): EnginePlayerHandle;
  /** Configure the shared audio session. Idempotent per session. */
  setAudioMode(mode: EngineAudioMode): Promise<void>;
}

/** Platform boundary for file checks before playback. */
export interface PlaybackPlatform {
  /** Whether the app-managed audio file still exists at this URI. */
  fileExists(uri: string): boolean;
}

/** A library item reduced to what the queue and player need. */
export interface QueueTrack {
  /** Library item id. */
  readonly id: string;
  readonly title: string;
  readonly artist: string | null;
  /** App-managed `file://` URI of the imported audio file. */
  readonly fileUri: string;
}

/** User-facing assessment of whether a library item can be played. */
export type Playability =
  | { readonly playable: true; readonly track: QueueTrack }
  | { readonly playable: false; readonly reason: string };

/** True when the item is an imported audio file that may be playable. */
export function isImportedAudio(item: LibraryItem): boolean {
  return (
    item.media_type === "audio" &&
    !item.unavailable &&
    item.file_path !== null &&
    item.file_path.startsWith("file://")
  );
}

/**
 * Assess whether a library item can be played right now, without throwing.
 * Errors are user-facing messages; filesystem paths are never exposed.
 */
export function assessPlayable(
  item: LibraryItem,
  platform: PlaybackPlatform
): Playability {
  if (item.media_type !== "audio") {
    return { playable: false, reason: "Only audio items can be played." };
  }
  if (item.unavailable) {
    return { playable: false, reason: "This item is marked unavailable." };
  }
  const fileUri = item.file_path;
  if (fileUri === null || fileUri.trim() === "") {
    return {
      playable: false,
      reason: "This item has no imported audio file (metadata only).",
    };
  }
  if (!fileUri.startsWith("file://")) {
    return {
      playable: false,
      reason: "This item's audio is not stored on this device.",
    };
  }
  if (!platform.fileExists(fileUri)) {
    return {
      playable: false,
      reason: "The audio file for this item is missing from the device.",
    };
  }
  return {
    playable: true,
    track: {
      id: item.id,
      title: item.title,
      artist: item.artist,
      fileUri,
    },
  };
}

/**
 * Queue policy: queue entries come only from imported audio records
 * (`isImportedAudio`), in the order the Library displays them, rotated so
 * the requested item comes first. Next/previous wrap around at the ends.
 * Returns null when the requested item is not among the playable entries.
 * A metadata-only, PDF, missing-file, or non-file record is never enqueued.
 */
export function buildQueue(
  items: readonly LibraryItem[],
  startId: string
): QueueTrack[] | null {
  const playable: QueueTrack[] = [];
  let startIndex = -1;
  for (const item of items) {
    if (!isImportedAudio(item)) continue;
    if (item.id === startId) startIndex = playable.length;
    playable.push({
      id: item.id,
      title: item.title,
      artist: item.artist,
      fileUri: item.file_path as string,
    });
  }
  if (startIndex === -1) return null;
  const rotated = playable.slice(startIndex).concat(playable.slice(0, startIndex));
  return rotated.length > 0 ? rotated : null;
}
