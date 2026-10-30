/**
 * Writes the snapshot to the widget's shared storage: debounced on store
 * changes, immediately on foreground and background refresh, and cleared on
 * sign-out (no snapshot means the widget shows the sign-in card).
 *
 * WidgetKit limits how often timelines may reload, so a write that would not
 * change anything the widget shows is skipped. `writtenAt` is the one field
 * that always changes, so an unchanged snapshot is still re-written every few
 * minutes: that keeps "Updated 3h ago" honest while the app is open.
 */
import { buildSnapshot, fingerprint, type BuildInput } from './snapshot';
import { KEYS, type WidgetStorage } from './types';

export type WriteInput = Omit<BuildInput, 'now'>;

export interface WriterOptions {
  storage: WidgetStorage;
  /** Trailing debounce for store changes. */
  debounceMs?: number;
  /** An unchanged snapshot is still re-written when the last write is older than this. */
  refreshMs?: number;
  now?: () => Date;
  /** Overridable for tests. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

export interface SnapshotWriter {
  /** Debounced: call on every store change. */
  schedule(input: WriteInput): void;
  /** Write now. `force` re-writes even if nothing changed. Returns true when a snapshot was written. */
  writeNow(input: WriteInput, force?: boolean): boolean;
  /** Sign-out: remove the snapshot and the queue so the widget shows the sign-in card. */
  clear(): void;
  /** Write a pending debounced input now. */
  flush(): void;
  cancel(): void;
}

export function createSnapshotWriter(opts: WriterOptions): SnapshotWriter {
  const { storage } = opts;
  const debounceMs = opts.debounceMs ?? 800;
  const refreshMs = opts.refreshMs ?? 5 * 60000;
  const nowFn = opts.now ?? (() => new Date());
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));

  let lastFingerprint = '';
  let lastWriteMs = 0;
  let timer: unknown = null;
  let pending: WriteInput | null = null;

  const cancel = () => {
    if (timer != null) clearTimer(timer);
    timer = null;
    pending = null;
  };

  const writeNow = (input: WriteInput, force = false): boolean => {
    if (timer != null) {
      clearTimer(timer);
      timer = null;
      pending = null;
    }
    const now = nowFn();
    const snap = buildSnapshot({ ...input, now });
    if (!snap) {
      clear();
      return false;
    }
    const fp = fingerprint(snap);
    if (!force && fp === lastFingerprint && now.getTime() - lastWriteMs < refreshMs) return false;
    storage.set(KEYS.snapshot, JSON.stringify(snap));
    lastFingerprint = fp;
    lastWriteMs = now.getTime();
    void storage.reload();
    return true;
  };

  const clear = () => {
    cancel();
    lastFingerprint = '';
    lastWriteMs = 0;
    storage.remove(KEYS.snapshot);
    storage.remove(KEYS.ops);
    storage.remove(KEYS.ack);
    void storage.reload();
  };

  return {
    schedule(input) {
      pending = input;
      if (timer != null) clearTimer(timer);
      timer = setTimer(() => {
        timer = null;
        const p = pending;
        pending = null;
        if (p) writeNow(p);
      }, debounceMs);
    },
    writeNow,
    clear,
    flush() {
      if (pending) writeNow(pending);
    },
    cancel,
  };
}
