import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
} from "react-native";
import { router } from "expo-router";

import { ApiRequestError } from "@/api/client";
import { useAuth } from "@/auth/AuthProvider";
import { Button } from "@/components/Button";
import { colors, radius, spacing, typography } from "@/theme";

/**
 * Registration screen. Client-side checks are for fast feedback only;
 * the server re-validates everything authoritatively.
 */
export default function SignUpScreen() {
  const { signUp } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const passwordOk = password.length >= 10;
  const confirmOk = confirm.length > 0 && confirm === password;
  const disabled = submitting || !emailOk || !passwordOk || !confirmOk || !displayName.trim();

  async function handleSignUp() {
    if (disabled) return;
    setSubmitting(true);
    setError(null);
    try {
      await signUp(email.trim(), password, displayName.trim());
      router.replace("/(tabs)");
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(
          err.status === 0
            ? "Cannot reach the server. Check your connection and try again."
            : err.message
        );
      } else {
        setError("Registration failed. Please try again.");
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
      <Text style={styles.title}>Create your account</Text>

      <TextInput
        style={styles.input}
        placeholder="Display name"
        placeholderTextColor={colors.textSecondary}
        accessibilityLabel="Display name"
        value={displayName}
        onChangeText={setDisplayName}
      />
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
      <TextInput
        style={[styles.input, !emailOk && email.length > 0 && styles.invalid]}
        placeholder="Password (at least 10 characters)"
        placeholderTextColor={colors.textSecondary}
        autoCapitalize="none"
        secureTextEntry={!showPassword}
        accessibilityLabel="Password"
        value={password}
        onChangeText={setPassword}
      />
      <TextInput
        style={[styles.input, !confirmOk && confirm.length > 0 && styles.invalid]}
        placeholder="Confirm password"
        placeholderTextColor={colors.textSecondary}
        autoCapitalize="none"
        secureTextEntry={!showPassword}
        accessibilityLabel="Confirm password"
        value={confirm}
        onChangeText={setConfirm}
      />
      <Pressable
        onPress={() => setShowPassword((value) => !value)}
        accessibilityRole="button"
        accessibilityLabel={showPassword ? "Hide passwords" : "Show passwords"}
      >
        <Text style={styles.showToggle}>{showPassword ? "Hide passwords" : "Show passwords"}</Text>
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button
        label={submitting ? "Creating account…" : "Create account"}
        onPress={handleSignUp}
        disabled={disabled}
      />

      <Pressable onPress={() => router.push("/(auth)/sign-in")}>
        <Text style={styles.link}>
          Already have an account? <Text style={styles.linkEmphasis}>Sign in</Text>
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
  invalid: { borderColor: colors.danger },
  showToggle: { ...typography.caption, color: colors.primary, textAlign: "right" },
  error: { ...typography.caption, color: colors.danger },
  link: { ...typography.caption, color: colors.textSecondary, textAlign: "center" },
  linkEmphasis: { color: colors.primary, fontWeight: "600" },
});
