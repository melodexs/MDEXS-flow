/**
 * Production implementation of the playback boundaries (Phase 6):
 * expo-audio ~0.4.9 (the Expo SDK 53 version) + expo-file-system/next.
 *
 * Imported only by app code — never by Node tests, which inject a fake
 * engine and fake file platform instead.
 *
 * Platform notes (verified against expo-audio 0.4.9 API surface):
 * - `createAudioPlayer(source)` returns a SharedObject emitting
 *   `playbackStatusUpdate` events; the adapter normalizes them into the
 *   engine's `EngineStatus` shape.
 * - `setAudioModeAsync` configures the shared audio session
 *   (background playback, silent-mode behavior, interruption policy).
 * - expo-audio on SDK 53 provides NO lock-screen / media-notification
 *   controls and no Android media foreground service; those arrive in
 *   later major versions of expo-audio (see ADR-008). Background
 *   continuation relies on `shouldPlayInBackground` + the iOS
 *   `UIBackgroundModes: ["audio"]` Info.plist entry (app.config.ts).
 * - Local `file://` URIs produced by expo-file-system are passed directly
 *   as the player source. `File.exists()` verifies presence before load;
 *   engine playback-state errors surface through status events.
 */

import { File } from "expo-file-system/next";
import {
  createAudioPlayer,
  PLAYBACK_STATUS_UPDATE,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStatus,
} from "expo-audio";

import type {
  EngineAudioMode,
  EnginePlayerHandle,
  EngineStatus,
  PlaybackEngine,
  PlaybackPlatform,
} from "./engine";

function toEngineStatus(status: AudioStatus): EngineStatus {
  return {
    playing: status.playing,
    isBuffering: status.isBuffering,
    isLoaded: status.isLoaded,
    currentTime: status.currentTime,
    duration: status.duration,
    didJustFinish: status.didJustFinish,
    playbackState: status.playbackState,
  };
}

/** Wrap expo-audio's AudioPlayer in the engine's player handle. */
function toHandle(player: AudioPlayer): EnginePlayerHandle {
  return {
    play(): void {
      player.play();
    },
    pause(): void {
      player.pause();
    },
    replace(source: string): void {
      player.replace(source);
    },
    seekTo(seconds: number): void {
      void player.seekTo(seconds).catch(() => {
        // Seek rejections surface through status events; the controller
        // handles engine-reported errors there.
      });
    },
    remove(): void {
      try {
        player.remove();
      } catch {
        // SharedObject may already be released.
      }
    },
    onStatus(listener: (status: EngineStatus) => void): () => void {
      const subscription = player.addListener(PLAYBACK_STATUS_UPDATE, (status) => {
        listener(toEngineStatus(status));
      });
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        try {
          subscription.remove();
        } catch {
          // Player already released.
        }
      };
    },
  };
}

/** Production playback engine backed by expo-audio. */
export function createExpoPlaybackEngine(): PlaybackEngine {
  return {
    createPlayer(source: string | null): EnginePlayerHandle {
      return toHandle(createAudioPlayer(source));
    },
    async setAudioMode(mode: EngineAudioMode): Promise<void> {
      await setAudioModeAsync({
        playsInSilentMode: mode.playsInSilentMode,
        shouldPlayInBackground: mode.shouldPlayInBackground,
        interruptionMode: mode.interruptionMode,
      });
    },
  };
}

/** Production file-check platform backed by expo-file-system/next. */
export function createExpoPlaybackPlatform(): PlaybackPlatform {
  return {
    fileExists(uri: string): boolean {
      try {
        return new File(uri).exists;
      } catch {
        // Malformed or inaccessible URIs are treated as missing files.
        return false;
      }
    },
  };
}
