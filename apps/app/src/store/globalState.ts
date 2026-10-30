/**
 * Global sync state that is not part of the calendar data: conflict
 * notices (OA 05) and the "session expired" flag.
 *
 * These live outside the swappable store on purpose: they keep working while
 * the store implementation is replaced (sign-in, sign-out, user switch), and
 * the sync layer can emit them without importing React.
 */
import { useCallback, useSyncExternalStore } from 'react';

/**
 * A remote change replaced a local edit that had not synced yet (last write
 * wins on `updated_at`). The UI shows a toast with an Undo button.
 */
export interface SyncConflict {
  id: string;
  /** epoch ms the conflict was detected */
  at: number;
  /** which table the row is in ('events', 'goals', 'categories', 'series', 'profiles') */
  table: string;
  rowId: string;
  /** what the user was editing: an event / goal title, a category name, "Settings" */
  label: string;
  /** Put the local edit back. It is newer than the remote one now, so it wins and syncs. */
  undo: () => void;
}

export type SyncConflictInput = Omit<SyncConflict, 'id' | 'at'>;

let conflicts: SyncConflict[] = [];
let conflictSeq = 0;
const conflictListeners = new Set<() => void>();
const notifyConflicts = () => conflictListeners.forEach((l) => l());

/** Called by the sync engine. Returns the queued conflict. */
export function emitSyncConflict(input: SyncConflictInput, now: number = Date.now()): SyncConflict {
  const c: SyncConflict = { ...input, id: `c${now.toString(36)}${++conflictSeq}`, at: now };
  conflicts = [...conflicts, c].slice(-20);
  notifyConflicts();
  return c;
}

/** Hide a conflict without undoing it (toast timed out or was dismissed). */
export function dismissSyncConflict(id: string): void {
  const next = conflicts.filter((c) => c.id !== id);
  if (next.length === conflicts.length) return;
  conflicts = next;
  notifyConflicts();
}

/** Run a conflict's undo, then dismiss it. */
export function undoSyncConflict(id: string): void {
  const c = conflicts.find((x) => x.id === id);
  if (!c) return;
  dismissSyncConflict(id);
  c.undo();
}

export function clearSyncConflicts(): void {
  if (!conflicts.length) return;
  conflicts = [];
  notifyConflicts();
}

/** Non-hook access (tests, imperative toasts). */
export function subscribeSyncConflicts(listener: () => void): () => void {
  conflictListeners.add(listener);
  return () => {
    conflictListeners.delete(listener);
  };
}
export const getSyncConflicts = (): readonly SyncConflict[] => conflicts;

/**
 * The newest undismissed conflict, or null. Render the OA 05 toast while it
 * is non-null; `undo()` puts the local edit back, `dismiss()` just hides it.
 */
export function useSyncConflict(): { conflict: SyncConflict | null; undo: () => void; dismiss: () => void } {
  const list = useSyncExternalStore(subscribeSyncConflicts, getSyncConflicts, getSyncConflicts);
  const conflict = list.length ? list[list.length - 1] : null;
  const id = conflict?.id;
  const undo = useCallback(() => {
    if (id) undoSyncConflict(id);
  }, [id]);
  const dismiss = useCallback(() => {
    if (id) dismissSyncConflict(id);
  }, [id]);
  return { conflict, undo, dismiss };
}

/* ---------- session expired ---------- */

let sessionExpired = false;
const expiredListeners = new Set<() => void>();

/** Called by the sync layer when the token refresh failed (or the server said 401). */
export function setSessionExpired(value: boolean): void {
  if (sessionExpired === value) return;
  sessionExpired = value;
  expiredListeners.forEach((l) => l());
}

export function subscribeSessionExpired(listener: () => void): () => void {
  expiredListeners.add(listener);
  return () => {
    expiredListeners.delete(listener);
  };
}
export const getSessionExpired = (): boolean => sessionExpired;

/**
 * True when the Supabase session can no longer be refreshed (revoked, or the
 * refresh token expired). Local edits keep working and queue up; show the
 * "session expired" state and send the user to sign in again. It resets to
 * false on the next sign-in.
 */
export function useSessionExpired(): boolean {
  return useSyncExternalStore(subscribeSessionExpired, getSessionExpired, getSessionExpired);
}
