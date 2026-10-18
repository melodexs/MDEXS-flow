import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "MDEXS Flow",
  slug: "mdexs-flow",
  version: "0.1.0",
  orientation: "portrait",
  scheme: "mdexsflow",
  userInterfaceStyle: "automatic",
  platforms: ["android", "ios"],
  // expo-audio: microphone access is DISABLED (playback-only app) — the
  // plugin then only adds android.permission.MODIFY_AUDIO_SETTINGS.
  // Note: in the SDK 53 version of expo-audio the plugin has no
  // background-playback options (no Android media foreground service);
  // see ADR-008 for what is and is not configured here.
  plugins: [
    "expo-router",
    "expo-secure-store",
    ["expo-audio", { microphonePermission: false }],
  ],
  experiments: {
    // Enables loading env vars like EXPO_PUBLIC_API_BASE_URL via .env files.
    typedRoutes: true,
  },
  android: {
    package: "com.mdexs.flow",
  },
  ios: {
    bundleIdentifier: "com.mdexs.flow",
    // Required for audio to continue while the app is backgrounded
    // (Phase 6 playback; combined with setAudioModeAsync's
    // shouldPlayInBackground). Declared here so prebuild applies it.
    infoPlist: {
      UIBackgroundModes: ["audio"],
    },
  },
};

export default config;
