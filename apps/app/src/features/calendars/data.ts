/**
 * Hooks over the shared calendars store (./store.ts): Google accounts and calendars, event targets,
 * hidden events, imported-event metadata and category defaults. Every hook keeps the store loaded and
 * its Realtime channel open while a component uses it.
 */
import type { EventTarget, GoogleCalendar, HiddenItem } from '@calendar/db';
import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { supabase } from '@/lib/supabase';
import { hiddenKeySet, type GoogleEventMeta } from './hidden';
import { CalendarsStore, type CalendarsState, type CategoryDefaults, type LoadState, type TargetOp } from './store';
import { buildAccountViews, type AccountView } from './view';

let singleton: CalendarsStore | null = null;

/** The app's one calendars store, on the app's Supabase client. */
export function getCalendarsStore(): CalendarsStore {
  if (!singleton) singleton = new CalendarsStore({ client: supabase });
  return singleton;
}

/** Keep the store loaded and its Realtime channel open while this component is mounted. */
export function useCalendarsLoaded(): void {
  const store = getCalendarsStore();
  useEffect(() => store.acquire(), [store]);
}

/** Select a slice of the store state, without keeping it loaded (keep `select` returning stable references). */
export function useStoreSlice<T>(select: (s: CalendarsState) => T): T {
  const store = getCalendarsStore();
  return useSyncExternalStore(store.subscribe, () => select(store.getState()), () => select(store.getState()));
}

/** `useCalendarsLoaded` + `useStoreSlice`: what a screen uses. */
export function useCalendarsSelector<T>(select: (s: CalendarsState) => T): T {
  useCalendarsLoaded();
  return useStoreSlice(select);
}

const EMPTY_TARGETS: EventTarget[] = [];
const EMPTY_OPS: TargetOp | undefined = undefined;

export interface GoogleAccountsData {
  views: AccountView[];
  calendars: GoogleCalendar[];
  load: LoadState;
  error: string | null;
  syncing: boolean;
  refresh: () => Promise<void>;
}

/** Google accounts with their calendars, counts and last-synced time, with loading / error state. */
export function useGoogleAccounts(): GoogleAccountsData {
  const accounts = useCalendarsSelector((s) => s.accounts);
  const calendars = useCalendarsSelector((s) => s.calendars);
  const load = useCalendarsSelector((s) => s.load);
  const error = useCalendarsSelector((s) => s.error);
  const syncing = useCalendarsSelector((s) => s.syncing);
  const views = useMemo(() => buildAccountViews(accounts, calendars), [accounts, calendars]);
  return { views, calendars, load, error, syncing, refresh: getCalendarsStore().refresh };
}

/** The `event_targets` rows of one event. */
export function useEventTargets(eventId: string): EventTarget[] {
  const all = useCalendarsSelector((s) => s.targets);
  return useMemo(() => {
    const mine = all.filter((t) => t.event_id === eventId);
    return mine.length ? mine : EMPTY_TARGETS;
  }, [all, eventId]);
}

/** The client's own in-flight (or failed) attempt to set an event's Google targets. */
export function useEventTargetOp(eventId: string): TargetOp | undefined {
  return useCalendarsSelector((s) => s.ops[eventId] ?? EMPTY_OPS);
}

export function useHiddenItems(): HiddenItem[] {
  return useCalendarsSelector((s) => s.hidden);
}

/** Calendar, Google event id and organizer of an imported event (null for the app's own events). */
export function useGoogleEventMeta(eventId: string): GoogleEventMeta | null {
  return useCalendarsSelector((s) => s.meta[eventId] ?? null);
}

export function useCategoryDefaults(name: string | null | undefined): CategoryDefaults | null {
  return useCalendarsSelector((s) => (name ? s.categories[name] ?? null : null));
}

/** The set the calendar view filters by (`hiddenKey(source, key)`). */
export function useHiddenKeySet(): ReadonlySet<string> {
  const hidden = useHiddenItems();
  return useMemo(() => hiddenKeySet(hidden), [hidden]);
}
