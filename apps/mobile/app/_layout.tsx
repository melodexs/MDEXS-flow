import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { AuthProvider } from "@/auth/AuthProvider";

/**
 * Root layout: navigation stack with the tab navigator mounted at the root.
 * Authentication screens live under (auth); the profile tab guards itself.
 * The player screen (Phase 6) lives here as a plain stack screen.
 */
export default function RootLayout() {
  return (
    <AuthProvider>
      <>
        <StatusBar style="auto" />
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="dev/health" options={{ title: "API Status" }} />
          <Stack.Screen name="(auth)/welcome" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)/sign-in" options={{ title: "Sign in" }} />
          <Stack.Screen name="(auth)/sign-up" options={{ title: "Create account" }} />
          <Stack.Screen name="(auth)/forgot-password" options={{ title: "Reset password" }} />
          <Stack.Screen name="player" options={{ title: "Now playing" }} />
        </Stack>
      </>
    </AuthProvider>
  );
}
