import { StyleSheet, Text, View } from "react-native";

import { colors, spacing, typography } from "@/theme";

/**
 * Password-reset placeholder.
 *
 * NOT IMPLEMENTED: password-reset email delivery requires a real,
 * configurable email provider, which this phase intentionally does not
 * add. The endpoint/service boundary is documented in docs/security.md.
 * Do not present this as a working flow.
 */
export default function ForgotPasswordScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Reset your password</Text>
      <Text style={styles.body}>
        Password reset emails are not available yet. Email delivery needs to be
        configured on the backend first.
      </Text>
      <Text style={styles.body}>
        If you signed in with Google, use the Google button on the sign-in screen.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: { ...typography.title },
  body: { ...typography.body, color: colors.textSecondary },
});
