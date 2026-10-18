import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";

import { Loading } from "@/components/Loading";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/Button";
import {
  LocalDbError,
  type LibraryItem,
  libraryItems,
  openLocalDatabase,
} from "@/localdb";
import { colors, radius, spacing, typography } from "@/theme";

type LoadState = "loading" | "ready" | "error";

/**
 * Library: backed entirely by the local SQLite database (offline-first).
 * No sign-in or network request is required to read local records.
 * The "Add sample item" action creates a clearly-labeled metadata-only
 * record; real file import arrives in a later phase.
 */
export default function LibraryScreen() {
  const [state, setState] = useState<LoadState>("loading");
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setState((prev) => (prev === "loading" ? prev : prev));
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

  if (state === "loading") return <Loading message="Opening your local library…" />;

  if (state === "error") {
    return (
      <View style={styles.container}>
        <EmptyState title="Library unavailable" message={error ?? "Something went wrong."} />
        <Button label="Try again" onPress={() => void load()} />
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View style={styles.container}>
        <EmptyState
          title="Your library"
          message="Imported music, PDFs, and downloaded catalog items will appear here."
        />
        <Button label="Add sample item" variant="secondary" onPress={() => void addSampleItem()} />
        <Text style={styles.sampleNote}>
          The sample action only stores metadata locally — no real file is imported.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.iconBadge}>
              <Text style={styles.iconText}>{item.media_type === "audio" ? "♪" : "PDF"}</Text>
            </View>
            <View style={styles.meta}>
              <Text style={styles.title} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {item.media_type === "audio"
                  ? item.artist ?? "Unknown artist"
                  : item.author ?? "Unknown author"}
              </Text>
            </View>
            <Text style={styles.date}>{item.created_at.slice(0, 10)}</Text>
          </View>
        )}
        ListFooterComponent={
          <Button label="Add sample item" variant="secondary" onPress={() => void addSampleItem()} />
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
