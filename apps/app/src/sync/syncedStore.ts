/**
 * The `CalendarStore` implementation behind the app: the sync engine holds the
 * data, preferences, series and sync status; this adds History/Undo, which stays
 * on the device (persisted next to the engine's cache, never synced).
 */
import {
  makeHistoryEntry,
  pushHistory,
  restoreEntry,
  sanitizeHistory,
  type ApplyResult,
  type HistoryEntry,
  type HistoryKind,
  type Prefs,
  type Series,
} from '@calendar/core';

import { uuid, type FullCalendarStore, type StoreState } from '../store';
import type { SyncEngine } from './engine';
import type { KeyValueStore } from './types';

const HISTORY_KEY = 'history';
const HISTORY_PERSIST_MS = 400;

export interface SyncedCalendarStore extends FullCalendarStore {
  readonly engine: SyncEngine;
  /** Write the history out and detach from the engine. The data stays on disk. */
  dispose(): Promise<void>;
  /** Detach without writing anything (sign-out: the caches are being wiped). */
  discard(): void;
}

export interface SyncedStoreOptions {
  engine: SyncEngine;
  /** Storage scoped to the same user as the engine. */
  kv: KeyValueStore;
  now?: () => number;
  random?: () => number;
}

export async function createSyncedStore(opts: SyncedStoreOptions): Promise<SyncedCalendarStore> {
  const { engine, kv } = opts;
  const now = opts.now ?? (() => Date.now());
  const random = opts.random ?? Math.random;

  let history: HistoryEntry[] = [];
  try {
    const raw = await kv.getItem(HISTORY_KEY);
    if (raw) history = sanitizeHistory(JSON.parse(raw));
  } catch {
    history = [];
  }

  const listeners = new Set<() => void>();
  let discarded = false;
  let historyTimer: ReturnType<typeof setTimeout> | null = null;

  const build = (): StoreState => ({
    data: engine.getData(),
    prefs: engine.getPrefs(),
    history,
    sync: engine.getStatus(),
    series: engine.getSeries(),
  });
  let state = build();

  const refresh = () => {
    const next = build();
    if (
      next.data === state.data &&
      next.prefs === state.prefs &&
      next.history === state.history &&
      next.sync === state.sync &&
      next.series === state.series
    ) {
      return;
    }
    state = next;
    listeners.forEach((l) => l());
  };
  const offEngine = engine.subscribe(refresh);

  const persistHistory = async () => {
    if (discarded) return;
    try {
      await kv.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
      // history is a convenience; losing a write is fine
    }
  };
  const scheduleHistory = () => {
    if (historyTimer || discarded) return;
    historyTimer = setTimeout(() => {
      historyTimer = null;
      void persistHistory();
    }, HISTORY_PERSIST_MS);
  };
  const record = (entry: HistoryEntry | null) => {
    if (!entry) return;
    history = pushHistory(history, entry);
    scheduleHistory();
  };

  return {
    engine,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    commit(next, label, kind: HistoryKind = 'edit') {
      record(makeHistoryEntry(label, kind, state.data, next, now(), random));
      engine.applyData(next);
      refresh();
    },
    applyResult(r: ApplyResult) {
      if (r.empty) return;
      record(r.history);
      engine.applyData(r.data);
      refresh();
    },
    undo(entryId) {
      const entry = entryId ? state.history.find((h) => h.id === entryId) : state.history[0];
      if (!entry) return;
      const r = restoreEntry(entry, state.data, now(), random);
      record(r.entry);
      engine.applyData(r.data);
      refresh();
    },
    setPrefs(patch: Partial<Prefs>) {
      engine.applyPrefs({ ...state.prefs, ...patch });
      refresh();
    },
    setSeries(next: Series[]) {
      engine.applySeries(next);
      refresh();
    },
    newId: uuid,
    async dispose() {
      offEngine();
      if (historyTimer) clearTimeout(historyTimer);
      historyTimer = null;
      await persistHistory();
      discarded = true;
    },
    discard() {
      discarded = true;
      offEngine();
      if (historyTimer) clearTimeout(historyTimer);
      historyTimer = null;
      listeners.clear();
    },
  };
}
