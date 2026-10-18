/**
 * Library feature modules (Phase 5): local audio import.
 */

export {
  type AudioImportPlatform,
  type AudioImportResult,
  type AudioPickOutcome,
  type PickedAudioFile,
  SUPPORTED_AUDIO_EXTENSIONS,
  joinUri,
  looksLikeSupportedAudio,
  runAudioImport,
  safeExtension,
  titleFromFileName,
} from "./audioImport";
export { createExpoAudioImportPlatform } from "./expoAudioPlatform";
