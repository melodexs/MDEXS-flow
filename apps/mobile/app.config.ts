import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "MDEXS Flow",
  slug: "mdexs-flow",
  version: "0.1.0",
  orientation: "portrait",
  scheme: "mdexsflow",
  userInterfaceStyle: "automatic",
  platforms: ["android", "ios"],
  plugins: ["expo-router", "expo-secure-store"],
  experiments: {
    // Enables loading env vars like EXPO_PUBLIC_API_BASE_URL via .env files.
    typedRoutes: true,
  },
  android: {
    package: "com.mdexs.flow",
  },
  ios: {
    bundleIdentifier: "com.mdexs.flow",
  },
};

export default config;
