/**
 * The app-side wiring of the widget feature: one writer on the platform's
 * shared storage, the live-store registry, and the headless source the
 * background task uses when the app UI is not running. Everything with logic
 * lives in the pure modules (snapshot, queue, writer, refresh); this file only
 * connects them to the store, Supabase and the device.
 */
import type { ProtoEvent } from '@calendar/core';

import { getDeviceState } from '@/features/calendars/device/host';
import { getDeviceKv } from '@/lib/deviceKv';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { getStore } from '@/store';
import { createSupabaseRemote, scopedStore, SyncEngine, userPrefix } from '@/sync';
import { DeviceBridge } from '@/sync/device';
import { createDeviceApi } from '@/sync/deviceApi';
import { createDeviceRemote } from '@/sync/deviceRemote';
import { createNetworkMonitor } from '@/sync/network';
import { createDeviceStore } from '@/sync/storage';

import { deviceClock } from './clock';
import { phoneEventsOf } from './phone';
import { parseSnapshot } from './read';
import { refreshWidgetSnapshot, type RefreshOutcome, type Source } from './refresh';
import type { PhoneEvents } from './snapshot';
import { widgetStorage } from './storage';
import { APP_KEYS, KEYS } from './types';
import { createSnapshotWriter } from './writer';

export const writer = createSnapshotWriter({ storage: widgetStorage });

/* ---------- settings ---------- */

/** The widget setting "Hide private titles" (the spec's privacy control for the home screen). */
export const hidePrivateTitles = (): boolean => getDeviceKv().getString(APP_KEYS.hidePrivate) === '1';

/** Turn "Hide private titles" on or off. The Settings screen can call this; the widget redraws on the next write. */
export function setHidePrivateTitles(on: boolean): void {
  getDeviceKv().set(APP_KEYS.hidePrivate, on ? '1' : '0');
  void refreshNow();
}

/* ---------- live store ---------- */

let live: (() => Source | null) | null = null;

/** The mounted `<WidgetSync />` registers the live store here so background refreshes in the same JS runtime reuse it. */
export function setLiveSource(fn: (() => Source | null) | null): void {
  live = fn;
}

/* ---------- headless source ---------- */

/**
 * The app is not running (iOS BGTask / Android WorkManager started a bare JS
 * runtime): open the signed-in user's on-device cache with a short-lived sync
 * engine, so the refresh can apply queued checks, pull, and rebuild the snapshot.
 * Null when there is no session (signed out).
 */
export async function headlessSource(): Promise<Source | null> {
  if (!isSupabaseConfigured) return null;
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) return null;
  const userId = session.user.id;
  const meta = (session.user.user_metadata ?? {}) as { full_name?: string; name?: string };
  const previous = parseSnapshot(widgetStorage.get(KEYS.snapshot));
  const name = meta.full_name ?? meta.name ?? previous?.session.name ?? null;

  const kv = scopedStore(createDeviceStore(), userPrefix(userId));
  const engine = await SyncEngine.create({
    userId,
    kv,
    remote: createSupabaseRemote(supabase, userId),
    net: createNetworkMonitor(),
    onConflict: () => undefined,
    onAuthError: () => undefined,
  });
  return {
    user: { id: userId, name },
    store: {
      getState: () => ({ data: engine.getData(), prefs: engine.getPrefs() }),
      commit: (next) => engine.applyData(next),
    },
    sync: () => engine.refresh(),
    phone: () => headlessPhoneEvents(userId, () => engine.getData()),
    finish: () => engine.stop(),
  };
}

/**
 * The phone's events with the app closed: a short-lived bridge that only reads. It starts with
 * `setStoreReady(false)`, so it publishes and removes nothing, and `refreshEveryMs: 0` keeps it from
 * leaving a timer behind. Null on web, without calendar permission, or with no calendar switched on.
 */
async function headlessPhoneEvents(userId: string, data: () => { events: readonly ProtoEvent[] }): Promise<PhoneEvents | null> {
  const api = createDeviceApi();
  if (!api.supported) return null;
  const bridge = new DeviceBridge({
    api,
    base: createDeviceStore(),
    userId,
    remote: createDeviceRemote(supabase),
    store: { getState: () => ({ data: data() }), subscribe: () => () => undefined },
    refreshEveryMs: 0,
    retryMs: 0,
  });
  bridge.setStoreReady(false);
  try {
    await bridge.start();
    await bridge.idle();
    return phoneEventsOf(bridge.getState());
  } finally {
    await bridge.stop();
  }
}

/* ---------- refresh ---------- */

/** Apply queued checks, pull, and write the snapshot. Used by the background task, the foreground hook and the Android Retry button. */
export function refreshNow(): Promise<RefreshOutcome> {
  return refreshWidgetSnapshot({
    writer,
    storage: widgetStorage,
    kv: getDeviceKv(),
    clock: deviceClock,
    hidePrivate: hidePrivateTitles,
    live: () => (live ? live() : null),
    headless: headlessSource,
  });
}

/** The live store as a refresh source (used by `<WidgetSync />`). */
export const liveStoreSource = (user: { id: string; name: string | null }): Source => ({
  user,
  store: getStore(),
  phone: () => phoneEventsOf(getDeviceState()),
});
