/**
 * Commit helpers: every user-facing change goes through the store's `commit`
 * (which records History) and then raises the 10 s Undo toast, as the
 * prototype's `toastLog` did.
 */
import type { CalendarData, HistoryKind } from '@calendar/core';

import { showToast } from '@/components/toast';
import { getStore } from '@/store';

/** Commit `next` with History, and show the Undo toast. No-op (no toast) when nothing changed. */
export function commitUndoable(next: CalendarData, label: string, kind: HistoryKind = 'edit'): string | null {
  const store = getStore();
  const prev = store.getState().history[0]?.id;
  store.commit(next, label, kind);
  const head = store.getState().history[0];
  if (!head || head.id === prev) return null;
  showToast({ label, undoId: head.id });
  return head.id;
}

/** Commit without a toast (e.g. the tick on a block, drags that show their own toast). */
export function commitQuiet(next: CalendarData, label: string, kind: HistoryKind = 'edit'): void {
  getStore().commit(next, label, kind);
}

/** Restore the state before a history entry, then offer to undo that revert in turn. */
export function undoEntry(id: string): void {
  const store = getStore();
  const entry = store.getState().history.find((h) => h.id === id);
  if (!entry) return;
  const prev = store.getState().history[0]?.id;
  store.undo(id);
  const head = store.getState().history[0];
  const label = 'Reverted · ' + String(entry.label).replace(/^Reverted · /, '');
  showToast({ label, undoId: head && head.id !== prev && head.kind === 'undo' ? head.id : null });
}
