import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";

import { colors, radius, spacing, typography } from "@/theme";

interface ButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: "primary" | "secondary";
  readonly disabled?: boolean;
  readonly style?: StyleProp<ViewStyle>;
}

/** Reusable button. Kept dependency-free; no UI framework. */
export function Button({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  style,
}: ButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        (pressed || disabled) && styles.dimmed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text style={[styles.label, variant === "secondary" && styles.secondaryLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    minHeight: 44,
  },
  primary: { backgroundColor: colors.primary },
  secondary: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: colors.primary,
  },
  label: { ...typography.body, color: "#FFFFFF", fontWeight: "600" },
  secondaryLabel: { color: colors.primary },
  dimmed: { opacity: 0.85 },
  disabled: { opacity: 0.4 },
});
