import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { colors, spacing, typography } from "@/theme";

export function Loading({ message = "Loading…" }: { readonly message?: string }) {
  return (
    <View style={styles.container} accessibilityLabel={message} accessibilityRole="text">
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.lg,
  },
  message: { ...typography.body, color: colors.textSecondary },
});
