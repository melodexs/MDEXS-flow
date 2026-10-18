import { View, StyleSheet, Text } from "react-native";
import { router } from "expo-router";

import { Button } from "@/components/Button";
import { colors, spacing, typography } from "@/theme";

/** Entry point for unauthenticated users. */
export default function WelcomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>MDEXS Flow</Text>
      <Text style={styles.subtitle}>
        Your music, books, and audiobooks — offline-first, everywhere you go.
      </Text>
      <Button label="Sign in" onPress={() => router.push("/(auth)/sign-in")} />
      <View style={styles.gap} />
      <Button
        label="Create account"
        variant="secondary"
        onPress={() => router.push("/(auth)/sign-up")}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: { ...typography.title, textAlign: "center" },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  gap: { height: spacing.sm },
});
