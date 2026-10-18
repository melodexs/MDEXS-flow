import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";

import { Loading } from "@/components/Loading";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/Button";
import {
  LocalDbError,
  type LibraryItem,
  libraryItems,
  openLocalDatabase,
} from "@/localdb";
import { createExpoAudioImportPlatform, runAudioImport } from "@/library";
import { colors, radius, spacing, typography } from "@/theme";

type LoadState = "loading" | "ready" | "error";

function formatBytes(bytes: number | null): string | null {
  if (bytes === null || bytes <= 0) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Library: backed entirely by the local SQLite database (offline-first).
 * No sign-in or network request is required to read local records or to
 * import audio files. "Import audio" copies a picked file into app-managed
 * storage and records it locally. The "Add sample item" action is a
 * clearly-labeled development action that stores metadata only — no file.
 */
export default function LibraryScreen() {
  const [state, setState] = useState<LoadState>("loading");
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const db = await openLocalDatabase();
      const rows = await libraryItems.listLibraryItems(db);
      setItems(rows);
      setError(null);
      setState("ready");
    } catch (cause) {
      setError(
        cause instanceof LocalDbError
          ? cause.message
          : "The local library could not be loaded."
      );
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const importAudio = useCallback(async () => {
    if (importing) return; // guard against repeated submissions
    setImporting(true);
    setImportError(null);
    try {
      const db = await openLocalDatabase();
      const result = await runAudioImport(db, createExpoAudioImportPlatform());
      if (result.status === "imported") {
        await load(); // refresh the list with the new item
      } else if (result.status === "failed") {
        // Cancellation is silent; only real failures surface.
        setImportError(result.message);
      }
    } catch (cause) {
      setImportError(
        cause instanceof LocalDbError
          ? cause.message
          : "The import could not be completed."
      );
    } finally {
      setImporting(false);
    }
  }, [importing, load]);

  const addSampleItem = useCallback(async () => {
    try {
      const db = await openLocalDatabase();
      await libraryItems.createLibraryItem(db, {
        media_type: "audio",
        title: `Sample track ${new Date().toLocaleTimeString()}`,
        artist: "Sample data (no real file)",
        description: "Metadata-only sample record created from the Library screen.",
        origin: "device",
      });
      await load();
    } catch (cause) {
      setError(cause instanceof LocalDbError ? cause.message : "Could not add the sample item.");
      setState("error");
    }
  }, [load]);

  const importButton = (
    <Button
      label={importing ? "Importing…" : "Import audio"}
      onPress={() => void importAudio()}
      disabled={importing}
    />
  );

  if (state === "loading") return <Loading message="Opening your local library…" />;

  if (state === "error") {
    return (
      <View style={styles.container}>
        <EmptyState title="Library unavailable" message={error ?? "Something went wrong."} />
        <Button label="Try again" onPress={() => void load()} />
      </View>
    );
  }

  const listHeader = (
    <View style={styles.headerBlock}>
      {importButton}
      {importing && (
        <View style={styles.importingRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.importingText}>Copying the selected audio file…</Text>
        </View>
      )}
      {importError !== null && <Text style={styles.importError}>{importError}</Text>}
    </View>
  );

  if (items.length === 0) {
    return (
      <View style={styles.container}>
        <EmptyState
          title="Your library"
          message="Import audio files from your device — they stay on this device, no account needed."
        />
        {listHeader}
        <Button label="Add sample item (dev)" variant="secondary" onPress={() => void addSampleItem()} />
        <Text style={styles.sampleNote}>
          The sample action is for development only — it stores metadata locally, no real file.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={listHeader}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
        }
        renderItem={({ item }) => {
          const isImportedFile = item.media_type === "audio" && item.file_path !== null;
          const sizeLabel = formatBytes(item.size_bytes);
          const subtitle = isImportedFile
            ? `Imported audio${sizeLabel ? ` · ${sizeLabel}` : ""}`
            : item.artist ?? item.author ?? "Metadata only";
          return (
            <View style={styles.row}>
              <View style={styles.iconBadge}>
                <Text style={styles.iconText}>{item.media_type === "audio" ? "♪" : "PDF"}</Text>
              </View>
              <View style={styles.meta}>
                <Text style={styles.title} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.subtitle} numberOfLines={1}>
                  {subtitle}
                </Text>
              </View>
              <Text style={styles.date}>{item.created_at.slice(0, 10)}</Text>
            </View>
          );
        }}
        ListFooterComponent={
          <View style={styles.footerBlock}>
            <Button
              label="Add sample item (dev)"
              variant="secondary"
              onPress={() => void addSampleItem()}
            />
            <Text style={styles.sampleNote}>
              The sample action is for development only — it stores metadata locally, no real file.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
  },
  headerBlock: {
    marginBottom: spacing.md,
  },
  importingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  importingText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  importError: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.sm,
  },
  footerBlock: {
    marginTop: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  iconBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: { ...typography.caption, color: "#FFFFFF", fontWeight: "700" },
  meta: { flex: 1 },
  title: { ...typography.body, color: colors.text },
  subtitle: { ...typography.caption, color: colors.textSecondary },
  date: { ...typography.caption, color: colors.textSecondary },
  sampleNote: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: "center",
    marginTop: spacing.sm,
  },
});
