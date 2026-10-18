/**
 * Playback controller (Phase 6).
 *
 * Owns ALL playback logic: engine lifecycle, track validation, the queue,
 * play/pause/seek/skip, completion, and error handling. UI screens only
 * subscribe to state and call command methods — they never touch the
 * engine. The controller depends exclusively on the injectable engine and
 * platform boundaries from `./engine`, so Node tests exercise this real
 * code with a fake engine.
 *
 * Consistency guarantees:
 * - One player, one status subscription for the whole app. No duplicate
 *   event sources.
 * - Every load starts a new session token; status events from an abandoned
 *   load are ignored, so rapidly switching tracks cannot leave mixed state.
 * - Progress and state come from the ENGINE's status events, not a timer.
 * - Playback state lives only in memory; nothing is persisted to SQLite in
 *   this phase (progress persistence is a deliberately separate feature).
 */

import type { LibraryItem } from "@/localdb/domain";

import {
  type EngineAudioMode,
  type EnginePlayerHandle,
  type EngineStatus,
  type PlaybackEngine,
  type PlaybackPlatform,
  assessPlayable,
  buildQueue,
  type QueueTrack,
} from "./engine";

export type PlaybackPhase =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "completed"
  | "error";

export interface PlaybackState {
  readonly phase: PlaybackPhase;
  /** Index of the current track in the queue; -1 when none is loaded. */
  readonly index: number;
  readonly queue: readonly QueueTrack[];
  readonly current: QueueTrack | null;
  /** Playback position in seconds (from engine status events). */
  readonly positionSec: number;
  /** Known duration in seconds; 0 while unavailable. */
  readonly durationSec: number;
  /** Last user-facing error/info message, if any. */
  readonly message: string | null;
}

/** The audio-session configuration applied once at first playback. */
export const PLAYBACK_INIT_MODE: EngineAudioMode = {
  playsInSilentMode: true,
  shouldPlayInBackground: true,
  // A music player: other audio should pause rather than mix or duck.
  interruptionMode: "doNotMix",
};

const LOADING_HINT = "Loading this track…";

function initialState(): PlaybackState {
  return {
    phase: "idle",
    index: -1,
    queue: [],
    current: null,
    positionSec: 0,
    durationSec: 0,
    message: null,
  };
}

export class PlaybackController {
  private state: PlaybackState = initialState();
  private readonly listeners = new Set<() => void>();
  private player: EnginePlayerHandle | null = null;
  private stopStatusListener: (() => void) | null = null;
  private initPromise: Promise<void> | null = null;
  /** Monotonic token; status events from an older session are ignored. */
  private session = 0;
  /** Session whose status events are currently accepted (set before replace). */
  private statusToken = 0;

  constructor(
    private readonly engine: PlaybackEngine,
    private readonly platform: PlaybackPlatform
  ) {}

  /** Current immutable state snapshot (for useSyncExternalStore). */
  getState(): PlaybackState {
    return this.state;
  }

  /**
   * Subscribe to state changes. Subscribing the same listener twice is a
   * no-op (duplicate-listener prevention); the returned unsubscribe is
   * idempotent. Returns a tear-down function.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private setState(patch: Partial<PlaybackState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  /** Configure the audio session exactly once per controller. */
  private ensureReady(): Promise<void> {
    if (this.initPromise === null) {
      this.initPromise = this.engine.setAudioMode(PLAYBACK_INIT_MODE).catch(
        (cause: unknown) => {
          // Allow a later retry instead of permanently bricking playback.
          this.initPromise = null;
          throw cause;
        }
      );
    }
    return this.initPromise;
  }

  private ensurePlayer(): EnginePlayerHandle {
    if (this.player === null) {
      this.player = this.engine.createPlayer(null);
      this.attachStatusListener();
    }
    return this.player;
  }

  /** One status subscription for the controller's lifetime. */
  private attachStatusListener(): void {
    const player = this.player;
    if (player === null || this.stopStatusListener !== null) return;
    this.stopStatusListener = player.onStatus((status: EngineStatus) => {
      // Only accept events for the most recent load; a superseded load's
      // trailing events (before or during a replace) must not mutate state.
      if (this.statusToken !== this.session) return;
      this.handleStatus(status);
    });
  }

  private handleStatus(status: EngineStatus): void {
    if (status.playbackState === "error") {
      this.setState({
        phase: "error",
        message:
          "This track could not be played. The file may be corrupted or in an unsupported format.",
        positionSec: 0,
      });
      return;
    }
    if (status.didJustFinish) {
      void this.handleCompletion();
      return;
    }
    if (this.state.phase === "error" || this.state.phase === "idle") return;
    const phase = status.playing
      ? "playing"
      : status.isBuffering
        ? "loading"
        : status.isLoaded
          ? "paused"
          : this.state.phase;
    const message = this.state.message === LOADING_HINT ? null : this.state.message;
    this.setState({
      phase,
      positionSec: status.currentTime,
      durationSec: status.duration > 0 ? status.duration : this.state.durationSec,
      message,
    });
  }

  private async handleCompletion(): Promise<void> {
    const last = this.state.index >= this.state.queue.length - 1;
    if (last) {
      this.setState({
        phase: "completed",
        positionSec: this.state.durationSec,
        message: null,
      });
      return;
    }
    // Auto-advance within the queue.
    await this.loadIndex(this.state.index + 1, true);
  }

  /**
   * Start playing an item, building a predictable queue from the given
   * library items (see `buildQueue`). Returns false and records the reason
   * when the item cannot be played — no track is substituted.
   */
  async playFromQueue(
    items: readonly LibraryItem[],
    itemId: string
  ): Promise<boolean> {
    const selected = items.find((item) => item.id === itemId);
    if (selected === undefined) {
      this.setState({
        ...initialState(),
        phase: "error",
        message: "This item is no longer in your library.",
      });
      return false;
    }
    const assessment = assessPlayable(selected, this.platform);
    if (!assessment.playable) {
      this.setState({ ...initialState(), phase: "error", message: assessment.reason });
      return false;
    }
    const structural = buildQueue(items, itemId) ?? [assessment.track];
    // Existence filter: queue entries must reference files that are still
    // present, so skipping never lands on a dead entry.
    const queue = structural.filter((track) => this.platform.fileExists(track.fileUri));
    const index = Math.max(0, queue.findIndex((t) => t.id === itemId));
    await this.loadQueue(queue, index, true);
    return true;
  }

  /** Replace the queue and load a track. */
  private async loadQueue(
    queue: readonly QueueTrack[],
    index: number,
    autoplay: boolean
  ): Promise<void> {
    this.session += 1;
    const token = this.session;
    const track = queue[index];
    if (track === undefined) return;
    this.setState({
      phase: "loading",
      queue: [...queue],
      index,
      current: track,
      positionSec: 0,
      durationSec: 0,
      message: LOADING_HINT,
    });
    try {
      await this.ensureReady();
      if (token !== this.session) return; // superseded mid-load
      this.statusToken = token; // accept engine events for this load
      const player = this.ensurePlayer();
      player.replace(track.fileUri);
      if (autoplay) player.play();
    } catch {
      if (token !== this.session) return;
      this.setState({
        phase: "error",
        message: "Playback could not be started. Please try again.",
      });
    }
  }

  private async loadIndex(index: number, autoplay: boolean): Promise<void> {
    const track = this.state.queue[index];
    if (track === undefined) return;
    await this.loadQueue(this.state.queue, index, autoplay);
  }

  /** True when a command may act on the player right now. */
  private ready(): boolean {
    return this.player !== null && this.state.current !== null;
  }

  /** Toggle between playing and paused; no-op while loading or idle. */
  async toggle(): Promise<void> {
    if (this.state.phase === "playing") {
      await this.pause();
      return;
    }
    await this.resume();
  }

  /** Pause the current track. */
  async pause(): Promise<void> {
    if (!this.ready() || this.state.phase !== "playing") return;
    try {
      this.player?.pause();
      this.setState({ phase: "paused", message: null });
    } catch {
      this.setState({ phase: "error", message: "Playback could not be paused." });
    }
  }

  /** Resume the current track; restarts when the track had completed. */
  async resume(): Promise<void> {
    if (!this.ready()) return;
    if (this.state.phase === "loading" || this.state.phase === "error") return;
    try {
      if (this.state.phase === "completed") await this.seekTo(0);
      this.player?.play();
      this.setState({ phase: "playing", message: null });
    } catch {
      this.setState({ phase: "error", message: "Playback could not be resumed." });
    }
  }

  /** Seek to an absolute position, clamped to the track duration. */
  async seekTo(seconds: number): Promise<void> {
    if (!this.ready()) return;
    const duration = this.state.durationSec;
    const clamped = !Number.isFinite(seconds)
      ? 0
      : duration > 0
        ? Math.min(Math.max(seconds, 0), duration)
        : Math.max(seconds, 0);
    try {
      this.player?.seekTo(clamped);
      this.setState({ positionSec: clamped });
    } catch {
      this.setState({ phase: "error", message: "Seeking is not available right now." });
    }
  }

  /** Next track; wraps at the end of the queue. No-op without a queue. */
  async skipNext(): Promise<void> {
    if (this.state.queue.length === 0) return;
    const next = (this.state.index + 1) % this.state.queue.length;
    await this.loadIndex(next, true);
  }

  /** Previous track; wraps at the start of the queue. No-op without a queue. */
  async skipPrevious(): Promise<void> {
    if (this.state.queue.length === 0) return;
    const prev =
      (this.state.index - 1 + this.state.queue.length) % this.state.queue.length;
    await this.loadIndex(prev, true);
  }

  /** Stop: pause, rewind to the start, and clear the active phase. */
  async stop(): Promise<void> {
    if (!this.ready()) return;
    try {
      this.player?.pause();
      this.player?.seekTo(0);
    } catch {
      // Stopping is best-effort; the phase still resets.
    }
    this.setState({ phase: "idle", positionSec: 0, message: null });
  }

  /** Release all engine resources and listeners. */
  dispose(): void {
    if (this.stopStatusListener !== null) {
      this.stopStatusListener();
      this.stopStatusListener = null;
    }
    try {
      this.player?.remove();
    } catch {
      // Best-effort teardown.
    }
    this.player = null;
    this.session += 1;
    this.state = initialState();
    this.emit();
  }
}
