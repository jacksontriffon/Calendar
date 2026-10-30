/**
 * The app's calendar store: the one API that screens read and write through.
 *
 * Data is the shared `CalendarData` shape from @calendar/core, so the core
 * edits / applyOps / history helpers work on it directly. Every change goes
 * through `commit` (or `applyResult` / `undo`), which records History/Undo.
 *
 * This file is the contract. `createMemoryStore` is the in-memory
 * implementation (signed-out state, tests); the sync layer (src/sync)
 * swaps in the local-first, Supabase-backed store with `setStore` once a user
 * is signed in, without changing these exports.
 *
 * Additions on top of the original contract (all additive):
 *  - `StoreState.series` and `setSeries()`: weekly series rows (events refer
 *    to them with `ProtoEvent.seriesId`).
 *  - `getStore()` returns a stable facade that delegates to the current
 *    implementation, so `useStoreState` keeps working when `setStore` swaps it.
 *  - `useSyncConflict()` / `useSessionExpired()` (see ./globalState).
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
  type Series,
} from '@calendar/core';

export {
  clearSyncConflicts,
  dismissSyncConflict,
  emitSyncConflict,
  getSessionExpired,
  getSyncConflicts,
  setSessionExpired,
  subscribeSessionExpired,
  subscribeSyncConflicts,
  undoSyncConflict,
  useSessionExpired,
  useSyncConflict,
  type SyncConflict,
} from './globalState';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

export interface StoreState {
  data: CalendarData;
  prefs: Prefs;
  /** newest first, device-only (as in the prototype) */
  history: HistoryEntry[];
  sync: SyncStatus;
  /** weekly series rows; events point at them with `seriesId` */
  series: Series[];
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

/** `CalendarStore` plus the additions the synced store provides. */
export interface FullCalendarStore extends CalendarStore {
  /**
   * Replace the weekly series list. Call it in the same tick as the `commit`
   * that creates or removes the events of a series; series rows are always
   * written before the events that refer to them. Not recorded in History.
   */
  setSeries(next: Series[]): void;
}

export const uuid = (): string =>
  typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

export function createMemoryStore(initial?: Partial<StoreState>): FullCalendarStore {
  let state: StoreState = {
    data: { events: [], cats: defaultCats(), goals: [] },
    prefs: DEFAULT_PREFS,
    history: [],
    sync: 'idle',
    series: [],
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
    setSeries(next) {
      set({ series: next });
    },
    newId: uuid,
  };
}

let current: FullCalendarStore = createMemoryStore();
const listeners = new Set<() => void>();
let detach: (() => void) | null = null;

const onCurrentChange = () => listeners.forEach((l) => l());
const attach = () => {
  detach?.();
  detach = listeners.size ? subscribeTo(current) : null;
};
const subscribeTo = (s: CalendarStore) => s.subscribe(onCurrentChange);

/**
 * The store screens talk to. It never changes identity: it forwards to
 * whichever implementation `setStore` installed last, and re-notifies its
 * subscribers when that changes, so a swap after first render is safe.
 */
const facade: FullCalendarStore = {
  getState: () => current.getState(),
  subscribe(listener) {
    listeners.add(listener);
    if (listeners.size === 1) attach();
    return () => {
      listeners.delete(listener);
      if (!listeners.size) attach();
    };
  },
  commit: (next, label, kind) => current.commit(next, label, kind),
  applyResult: (r) => current.applyResult(r),
  undo: (entryId) => current.undo(entryId),
  setPrefs: (patch) => current.setPrefs(patch),
  setSeries: (next) => current.setSeries(next),
  newId: () => current.newId(),
};

/** Swap the implementation (the sync layer calls this when the user changes; tests too). */
export function setStore(next: CalendarStore): void {
  current = withSeries(next);
  attach();
  onCurrentChange();
}

/** A store written against the original contract has no series support; give it a no-op. */
const withSeries = (s: CalendarStore): FullCalendarStore =>
  typeof (s as Partial<FullCalendarStore>).setSeries === 'function' ? (s as FullCalendarStore) : Object.assign(s, { setSeries: () => {} });

export const getStore = (): FullCalendarStore => facade;

export function useStoreState<T>(select: (s: StoreState) => T): T {
  const s = facade;
  return useSyncExternalStore(s.subscribe, () => select(s.getState()), () => select(s.getState()));
}

export const useCalendarData = () => useStoreState((s) => s.data);
export const usePrefs = () => useStoreState((s) => s.prefs);
export const useHistory = () => useStoreState((s) => s.history);
export const useSyncStatus = () => useStoreState((s) => s.sync);
export const useSeries = () => useStoreState((s) => s.series);
