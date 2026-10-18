import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Loading } from "@/components/Loading";
import { checkApiHealth } from "@/api/healthService";
import { getAppConfig } from "@/config/env";
import { colors, radius, spacing, typography } from "@/theme";
import type { HealthResponse } from "@mdexs-flow/contracts";

type Status = "idle" | "checking" | "ok" | "error";

/**
 * Development panel: displays backend connectivity state using the real
 * health contract (loading, success, unavailable, and error states, with
 * retry). This is a developer tool, not a product feature.
 */
export default function DevHealthScreen() {
  const [status, setStatus] = useState<Status>("idle");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setStatus("checking");
    setError(null);
    const result = await checkApiHealth();
    if (result.ok) {
      setHealth(result.health);
      setStatus("ok");
    } else {
      setError(`${result.code}: ${result.message}`);
      setStatus("error");
    }
  }, []);

  const config = getAppConfig();

  if (status === "checking") return <Loading message="Contacting the API…" />;
  if (status === "error" && error) return <ErrorState message={error} onRetry={check} />;
  if (status === "idle") {
    return (
      <View style={styles.container}>
        <EmptyState
          title="API status"
          message="Check connectivity to the configured MDEXS Flow API."
        />
        <Button label="Run health check" onPress={check} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Service</Text>
        <Row label="Service" value={health?.service ?? "—"} />
        <Row label="Status" value={health?.status ?? "—"} />
        <Row label="Environment" value={health?.environment ?? "—"} />
        <Row label="Version" value={health?.version ?? "—"} />
        <Row label="Database" value={health?.database.status ?? "—"} />
        <Row
          label="DB latency"
          value={health?.database.latency_ms != null ? `${health.database.latency_ms} ms` : "—"}
        />
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Client</Text>
        <Row label="API base URL" value={config.apiBaseUrl} />
        <Row label="API env" value={config.apiEnv} />
      </View>
      <Button label="Re-check" variant="secondary" onPress={check} />
    </View>
  );
}

function Row({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.md,
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  cardTitle: { ...typography.heading, marginBottom: spacing.xs },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  rowLabel: { ...typography.body, color: colors.textSecondary },
  rowValue: { ...typography.body, color: colors.text, fontWeight: "600" },
});
