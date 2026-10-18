import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { colors, spacing, typography } from "@/theme";

/**
 * Home screen. Phase 2 scope: navigation shell + dev connectivity panel
 * entry only. Player/reader/download features arrive in later phases.
 */
export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>MDEXS Flow</Text>
      <Text style={styles.subtitle}>
        Offline-first music, reading, and listening. Foundation build.
      </Text>
      <View style={styles.actions}>
        <Button label="API status" variant="secondary" onPress={() => router.push("/dev/health")} />
      </View>
      <Text style={styles.note}>
        Import, playback, PDF reading, and downloads are implemented in later phases.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: { ...typography.title },
  subtitle: { ...typography.body, color: colors.textSecondary },
  actions: { marginTop: spacing.md },
  note: { ...typography.caption, marginTop: spacing.lg },
});
