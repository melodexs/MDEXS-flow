import { StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing, typography } from "@/theme";

interface EmptyStateProps {
  readonly title: string;
  readonly message: string;
}

/** Consistent empty state for lists and screens without content yet. */
export function EmptyState({ title, message }: EmptyStateProps) {
  return (
    <View style={styles.container} accessibilityLabel={`${title}: ${message}`}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    margin: spacing.md,
    padding: spacing.xl,
    gap: spacing.xs,
  },
  title: { ...typography.heading },
  message: { ...typography.body, color: colors.textSecondary, textAlign: "center" },
});
