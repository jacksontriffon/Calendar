/**
 * Tiny global toast store. Anything can call `showToast` (event sheet, settings,
 * the sync layer's conflict toast); a mounted `<ToastHost />` renders it.
 */
import { useSyncExternalStore } from 'react';

export interface ToastItem {
  id: number;
  label: string;
  /** history entry id the Undo action restores; omit for a plain message */
  undoId?: string | null;
  /** custom action, used instead of the history undo */
  action?: { label: string; run: () => void };
}

let seq = 0;
let current: ToastItem | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const TOAST_MS = 10500;
export const TOAST_PLAIN_MS = 3200;

export function dismissToast(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (current) {
    current = null;
    emit();
  }
}

/** Show a toast. Undo toasts stay 10.5 s, plain ones 3.2 s (as in the prototype). */
export function showToast(t: Omit<ToastItem, 'id'>, ms?: number): number {
  if (timer) clearTimeout(timer);
  const item: ToastItem = { ...t, id: ++seq };
  current = item;
  emit();
  timer = setTimeout(dismissToast, ms ?? (t.undoId || t.action ? TOAST_MS : TOAST_PLAIN_MS));
  return item.id;
}

export const getToast = (): ToastItem | null => current;

export function subscribeToast(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export const useToastItem = (): ToastItem | null => useSyncExternalStore(subscribeToast, getToast, getToast);

/* The most recently mounted host renders the toast, so screens can each mount one. */
const hosts: string[] = [];
const hostListeners = new Set<() => void>();
/** Register a mounted host; returns the unregister function. */
export function registerHost(id: string): () => void {
  hosts.push(id);
  hostListeners.forEach((l) => l());
  return () => {
    const i = hosts.indexOf(id);
    if (i >= 0) hosts.splice(i, 1);
    hostListeners.forEach((l) => l());
  };
}
export const topHost = (): string | undefined => hosts[hosts.length - 1];
export function subscribeHosts(l: () => void): () => void {
  hostListeners.add(l);
  return () => {
    hostListeners.delete(l);
  };
}
