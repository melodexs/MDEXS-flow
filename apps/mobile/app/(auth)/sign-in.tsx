import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";

import { ApiRequestError } from "@/api/client";
import { useAuth } from "@/auth/AuthProvider";
import { Button } from "@/components/Button";
import { colors, radius, spacing, typography } from "@/theme";

import { useGoogleSignIn } from "@/auth/useGoogleSignIn";

/**
 * Sign-in screen: email/password + Google (when configured).
 * The server is authoritative for all validation; client checks are
 * purely for faster feedback.
 */
export default function SignInScreen() {
  const { signIn } = useAuth();
  const google = useGoogleSignIn();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = submitting || !email.trim() || !password;

  async function handleSignIn() {
    if (disabled) return;
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      router.replace("/(tabs)");
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(
          err.status === 0
            ? "Cannot reach the server. Check your connection and try again."
            : err.message
        );
      } else {
        setError("Sign-in failed. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Text style={styles.title}>Welcome back</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor={colors.textSecondary}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        accessibilityLabel="Email"
        value={email}
        onChangeText={setEmail}
      />
      <View style={styles.passwordRow}>
        <TextInput
          style={[styles.input, styles.passwordInput]}
          placeholder="Password"
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
          secureTextEntry={!showPassword}
          accessibilityLabel="Password"
          value={password}
          onChangeText={setPassword}
        />
        <Pressable
          onPress={() => setShowPassword((value) => !value)}
          accessibilityRole="button"
          accessibilityLabel={showPassword ? "Hide password" : "Show password"}
          style={styles.showToggle}
        >
          <Text style={styles.showToggleText}>{showPassword ? "Hide" : "Show"}</Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button
        label={submitting ? "Signing in…" : "Sign in"}
        onPress={handleSignIn}
        disabled={disabled}
      />

      <View style={styles.divider} />

      {google.available ? (
        <Button
          label={google.pending ? "Opening Google…" : "Continue with Google"}
          variant="secondary"
          onPress={google.signIn}
          disabled={google.pending || submitting}
        />
      ) : (
        <Text style={styles.note}>Google sign-in not configured on this build.</Text>
      )}

      <Pressable onPress={() => router.push("/(auth)/forgot-password")}>
        <Text style={styles.link}>Forgot your password?</Text>
      </Pressable>
      <Pressable onPress={() => router.push("/(auth)/sign-up")}>
        <Text style={styles.link}>
          New here? <Text style={styles.linkEmphasis}>Create an account</Text>
        </Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.xl,
    gap: spacing.md,
    justifyContent: "center",
  },
  title: { ...typography.title, marginBottom: spacing.lg },
  input: {
    ...typography.body,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.text,
    padding: spacing.md,
  },
  passwordRow: { flexDirection: "row", alignItems: "center" },
  passwordInput: { flex: 1 },
  showToggle: { padding: spacing.md },
  showToggleText: { ...typography.caption, color: colors.primary },
  error: { ...typography.caption, color: colors.danger },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  link: { ...typography.caption, color: colors.textSecondary, textAlign: "center" },
  linkEmphasis: { color: colors.primary, fontWeight: "600" },
  note: { ...typography.caption, color: colors.textSecondary, textAlign: "center" },
});
