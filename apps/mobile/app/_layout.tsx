import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { AuthProvider } from "@/auth/AuthProvider";

/**
 * Root layout: navigation stack with the tab navigator mounted at the root.
 * Authentication screens live under (auth); the profile tab guards itself.
 * Player/reader modals will be added here in later phases.
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
        </Stack>
      </>
    </AuthProvider>
  );
}
