import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

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
import { isImportedAudio, playback } from "@/playback";
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
 * storage and records it locally. Tapping an imported audio row starts
 * playback and opens the player screen; tapping a metadata-only row is
 * disabled (dev samples are never playable). The "Add sample item" action
 * is a clearly-labeled development action that stores metadata only —
 * no file.
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

  /**
   * Start playback of an imported audio item. Builds the queue from the
   * imported audio visible in the Library (selection first, list order,
   * wrap-around skip; see buildQueue). Metadata-only samples and PDFs are
   * rejected inline and never navigate. A missing file surfaces the same
   * way instead of silently substituting another track.
   */
  const playItem = useCallback(async (item: LibraryItem) => {
    if (!isImportedAudio(item)) {
      setImportError("This item has no imported audio file (metadata only).");
      return;
    }
    setImportError(null);
    const started = await playback.playFromQueue(items, item.id);
    if (started) router.push("/player");
    else setImportError(playback.getState().message ?? "This track could not be played.");
  }, [items]);

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
          const playable = isImportedAudio(item);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={playable ? `Play ${item.title}` : item.title}
              disabled={!playable}
              onPress={() => void playItem(item)}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
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
              {playable ? (
                <Text style={styles.playGlyph}>▶</Text>
              ) : (
                <Text style={styles.date}>{item.created_at.slice(0, 10)}</Text>
              )}
            </Pressable>
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
  rowPressed: {
    backgroundColor: colors.border,
  },
  playGlyph: { ...typography.caption, color: colors.primary, fontWeight: "700" },
  sampleNote: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: "center",
    marginTop: spacing.sm,
  },
});
