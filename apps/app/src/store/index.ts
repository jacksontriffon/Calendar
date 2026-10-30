/**
 * The app's calendar store: the one API that screens read and write through.
 *
 * Data is the shared `CalendarData` shape from @calendar/core, so the core
 * edits / applyOps / history helpers work on it directly. Every change goes
 * through `commit` (or `applyResult` / `undo`), which records History/Undo.
 *
 * This file is the contract. The implementation below is in-memory only;
 * the sync layer (src/sync) replaces it with the local-first, Supabase-backed
 * store (phase 3) without changing these exports.
 */
import { useSyncExternalStore } from 'react';
import {
  DEFAULT_PREFS,
  defaultCats,
  makeHistoryEntry,
  pushHistory,
  restoreEntry,
  type ApplyResult,
  type CalendarData,
  type HistoryEntry,
  type HistoryKind,
  type Prefs,
} from '@calendar/core';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

export interface StoreState {
  data: CalendarData;
  prefs: Prefs;
  /** newest first, device-only (as in the prototype) */
  history: HistoryEntry[];
  sync: SyncStatus;
}

export interface CalendarStore {
  getState(): StoreState;
  subscribe(listener: () => void): () => void;
  /** Replace the data, recording a history entry labelled `label`. */
  commit(next: CalendarData, label: string, kind?: HistoryKind): void;
  /** Apply the result of core `applyOps` / `applyResolved` (records its history entry). */
  applyResult(result: ApplyResult): void;
  /** Revert to just before `entryId` (default: the newest entry). */
  undo(entryId?: string): void;
  setPrefs(patch: Partial<Prefs>): void;
  /** New event id. Uuids, so ids are valid `events.id` values in Supabase. */
  newId(): string;
}

const uuid = (): string =>
  typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

export function createMemoryStore(initial?: Partial<StoreState>): CalendarStore {
  let state: StoreState = {
    data: { events: [], cats: defaultCats(), goals: [] },
    prefs: DEFAULT_PREFS,
    history: [],
    sync: 'idle',
    ...initial,
  };
  const listeners = new Set<() => void>();
  const set = (next: Partial<StoreState>) => {
    state = { ...state, ...next };
    listeners.forEach((l) => l());
  };
  const record = (entry: HistoryEntry | null) => (entry ? pushHistory(state.history, entry) : state.history);

  return {
    getState: () => state,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    commit(next, label, kind = 'edit') {
      const entry = makeHistoryEntry(label, kind, state.data, next, Date.now(), Math.random);
      set({ data: next, history: record(entry) });
    },
    applyResult(r) {
      if (r.empty) return;
      set({ data: r.data, history: record(r.history) });
    },
    undo(entryId) {
      const entry = entryId ? state.history.find((h) => h.id === entryId) : state.history[0];
      if (!entry) return;
      const r = restoreEntry(entry, state.data, Date.now(), Math.random);
      set({ data: r.data, history: record(r.entry) });
    },
    setPrefs(patch) {
      set({ prefs: { ...state.prefs, ...patch } });
    },
    newId: uuid,
  };
}

let store: CalendarStore = createMemoryStore();

/** Swap the implementation (the sync layer calls this once at startup; tests too). */
export function setStore(next: CalendarStore): void {
  store = next;
}

export const getStore = (): CalendarStore => store;

export function useStoreState<T>(select: (s: StoreState) => T): T {
  const s = store;
  return useSyncExternalStore(s.subscribe, () => select(s.getState()), () => select(s.getState()));
}

export const useCalendarData = () => useStoreState((s) => s.data);
export const usePrefs = () => useStoreState((s) => s.prefs);
export const useHistory = () => useStoreState((s) => s.history);
export const useSyncStatus = () => useStoreState((s) => s.sync);
