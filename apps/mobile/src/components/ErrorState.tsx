import { StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing, typography } from "@/theme";
import { Button } from "./Button";

interface ErrorStateProps {
  readonly message: string;
  readonly onRetry?: () => void;
}

/** Consistent full error state with optional retry action. */
export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <View style={styles.container} accessibilityLabel={`Error: ${message}`}>
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.message}>{message}</Text>
      {onRetry ? <Button label="Retry" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    margin: spacing.md,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  title: { ...typography.heading, color: colors.danger },
  message: { ...typography.body, color: colors.textSecondary, textAlign: "center" },
});
