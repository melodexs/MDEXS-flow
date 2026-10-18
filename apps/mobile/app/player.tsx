import { useCallback, useMemo, useSyncExternalStore } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import { Button } from "@/components/Button";
import { playback } from "@/playback";
import { colors, spacing, typography } from "@/theme";

function formatClock(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Player screen (Phase 6): renders the playback controller's state.
 * ALL playback logic lives in the controller; this screen only reads
 * state via useSyncExternalStore and issues commands. Progress and
 * state updates come from the engine's status events, not a timer.
 */
export default function PlayerScreen() {
  const state = useSyncExternalStore(
    useCallback((notify: () => void) => playback.subscribe(notify), []),
    useCallback(() => playback.getState(), [])
  );

  const { phase, current, queue, index, positionSec, durationSec, message } = state;
  const hasTrack = current !== null;
  const canControl = hasTrack && phase !== "loading" && phase !== "error";
  const canSeek = canControl && phase !== "idle" && durationSec > 0;
  const queueHasNeighbors = queue.length > 1;

  const progressPercent = useMemo(() => {
    if (!hasTrack || durationSec <= 0) return 0;
    return Math.min(100, Math.max(0, (positionSec / durationSec) * 100));
  }, [hasTrack, positionSec, durationSec]);

  if (!hasTrack) {
    return (
      <View style={styles.container}>
        <Text style={styles.heading}>Nothing is playing</Text>
        <Text style={styles.hint}>
          {message ?? "Pick an imported audio item from your Library to start playback."}
        </Text>
        <Button label="Open Library" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading} numberOfLines={2}>
        {current.title}
      </Text>
      {current.artist !== null && (
        <Text style={styles.hint} numberOfLines={1}>
          {current.artist}
        </Text>
      )}
      {queue.length > 1 && (
        <Text style={styles.hint}>
          Track {index + 1} of {queue.length}
        </Text>
      )}

      {/* Progress: driven by engine status events, never a timer. */}
      <View
        style={styles.progressTrack}
        accessibilityLabel={`Progress ${formatClock(positionSec)} of ${formatClock(durationSec)}`}
      >
        <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
      </View>
      <View style={styles.timeRow}>
        <Text style={styles.time}>{formatClock(positionSec)}</Text>
        <Text style={styles.time}>
          {durationSec > 0 ? formatClock(durationSec) : "--:--"}
        </Text>
      </View>

      {phase === "loading" && (
        <View style={styles.stateRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.stateText}>Loading this track…</Text>
        </View>
      )}
      {phase === "completed" && (
        <View style={styles.stateRow}>
          <Text style={styles.completedText}>Completed</Text>
        </View>
      )}
      {phase === "error" && (
        <View style={styles.stateRow}>
          <Text style={styles.errorText}>{message ?? "Playback failed."}</Text>
        </View>
      )}

      <View style={styles.controlsRow}>
        <Button
          label="Previous"
          variant="secondary"
          disabled={!queueHasNeighbors}
          onPress={() => void playback.skipPrevious()}
        />
        <Button
          label={phase === "playing" ? "Pause" : "Play"}
          disabled={!canControl || phase === "idle"}
          onPress={() => void playback.toggle()}
        />
        <Button
          label="Next"
          variant="secondary"
          disabled={!queueHasNeighbors}
          onPress={() => void playback.skipNext()}
        />
      </View>

      <View style={styles.controlsRow}>
        <Button
          label="− 15s"
          variant="secondary"
          disabled={!canSeek}
          onPress={() => void playback.seekTo(positionSec - 15)}
        />
        <Button
          label="+ 15s"
          variant="secondary"
          disabled={!canSeek}
          onPress={() => void playback.seekTo(positionSec + 15)}
        />
        <Button
          label="Stop"
          variant="secondary"
          disabled={!canControl || phase === "idle"}
          onPress={() => void playback.stop()}
        />
      </View>

      {phase !== "error" && message !== null && (
        <Text style={styles.hint}>{message}</Text>
      )}
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
  heading: { ...typography.title },
  hint: { ...typography.caption },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
    overflow: "hidden",
    marginTop: spacing.md,
  },
  progressFill: {
    height: "100%",
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  time: { ...typography.caption },
  stateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  stateText: { ...typography.caption },
  completedText: { ...typography.caption, color: colors.success },
  errorText: { ...typography.caption, color: colors.danger },
  controlsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
