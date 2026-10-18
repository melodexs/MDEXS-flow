/**
 * Playback feature module (Phase 6): local audio playback of imported files.
 *
 * Pure, engine-independent logic (`engine.ts`, `PlaybackController.ts`) is
 * safe to import anywhere, including Node tests. The Expo adapters
 * (`expoPlaybackPlatform.ts`) pull in expo-audio and expo-file-system/next
 * and must only be imported by app code.
 */

import { PlaybackController } from "./PlaybackController";
import {
  createExpoPlaybackEngine,
  createExpoPlaybackPlatform,
} from "./expoPlaybackPlatform";

export {
  type EngineAudioMode,
  type EnginePlayerHandle,
  type EngineStatus,
  type Playability,
  type PlaybackEngine,
  type PlaybackPlatform,
  type QueueTrack,
  assessPlayable,
  buildQueue,
  isImportedAudio,
} from "./engine";

export {
  type PlaybackPhase,
  type PlaybackState,
  PLAYBACK_INIT_MODE,
  PlaybackController,
} from "./PlaybackController";

export {
  createExpoPlaybackEngine,
  createExpoPlaybackPlatform,
} from "./expoPlaybackPlatform";

/**
 * The app-wide playback singleton. One player, one status subscription,
 * one audio session for the entire app (see PlaybackController).
 */
export const playback = new PlaybackController(
  createExpoPlaybackEngine(),
  createExpoPlaybackPlatform()
);
