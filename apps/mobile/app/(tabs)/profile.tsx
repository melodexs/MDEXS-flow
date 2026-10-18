import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { apiMe } from "@/api/authApi";
import { ApiRequestError } from "@/api/client";
import { useAuth } from "@/auth/AuthProvider";
import type { AuthUserSnapshot } from "@/auth/tokenStore";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Loading } from "@/components/Loading";
import { colors, spacing, typography } from "@/theme";

/**
 * Profile: authenticated account view backed by GET /api/v1/auth/me.
 *
 * The navigation guard here is UX only — the backend enforces
 * authentication on every protected endpoint independently.
 */
export default function ProfileScreen() {
  const router = useRouter();
  const { status, user, offline, signOut } = useAuth();
  const [profile, setProfile] = useState<AuthUserSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Navigation guard: unauthenticated users are routed to the auth flow.
  useEffect(() => {
    if (status === "signedOut") router.replace("/(auth)/welcome");
  }, [status, router]);

  useEffect(() => {
    if (status !== "signedIn") return;
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const me = await apiMe();
        if (active) setProfile(me);
      } catch (err) {
        if (!active) return;
        if (err instanceof ApiRequestError && err.status === 0) {
          setError("Offline. Showing your last saved profile.");
          setProfile(user);
        } else if (err instanceof ApiRequestError) {
          setError(err.message);
          setProfile(user);
        } else {
          setError("Could not load your profile.");
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [status, user]);

  if (status === "restoring") return <Loading message="Restoring your session…" />;

  if (status === "signedOut") return <EmptyState title="Signed out" message="Redirecting…" />;

  const shown = profile ?? user;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Profile</Text>
      {offline ? <Text style={styles.offlineNote}>Offline — reconnect to sync your account.</Text> : null}
      {loading && !shown ? (
        <Loading message="Loading your profile…" />
      ) : error && !loading ? (
        <Text style={styles.error}>{error}</Text>
      ) : null}
      {shown ? (
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>Name</Text>
            <Text style={styles.value}>{shown.display_name}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Email</Text>
            <Text style={styles.value}>{shown.email}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Status</Text>
            <Text style={styles.value}>{shown.status}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Email verified</Text>
            <Text style={styles.value}>{shown.email_verified ? "Yes" : "No"}</Text>
          </View>
        </View>
      ) : null}
      <Button label="Sign out" variant="secondary" onPress={signOut} style={styles.signOut} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: { ...typography.title, marginTop: spacing.lg },
  offlineNote: { ...typography.caption, color: colors.danger },
  error: { ...typography.caption, color: colors.danger },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  label: { ...typography.body, color: colors.textSecondary },
  value: { ...typography.body, flexShrink: 1, textAlign: "right" },
  signOut: { marginTop: spacing.lg },
});
