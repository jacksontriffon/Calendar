/**
 * One refresh of the widget snapshot, shared by the background task and the
 * foreground hook. React-free and dependency-injected so it is unit-tested.
 *
 * Order matters: apply checks tapped on the widget first (so they reach the
 * server in the same sync), then pull, then write the snapshot from the result.
 */
import type { CalendarData, Prefs } from '@calendar/core';

import type { DeviceKv } from '@/lib/deviceKv';

import { drainDoneOps, type DrainResult, type DrainStore } from './queue';
import type { PhoneEvents } from './snapshot';
import type { SnapshotWriter } from './writer';
import type { Clock, WidgetStorage } from './types';

/** Where a refresh gets its data. */
export interface Source {
  user: { id: string; name: string | null };
  store: {
    getState(): { data: CalendarData; prefs: Prefs };
    commit: DrainStore['commit'];
  };
  /** Pull from the server (and push local writes) before the snapshot is written. */
  sync?: () => Promise<void>;
  /** The phone's calendar events, read at refresh time (null: none, or not available here). */
  phone?: () => Promise<PhoneEvents | null> | PhoneEvents | null;
  /** Release anything the source opened (the headless engine). */
  finish?: () => Promise<void>;
}

export interface RefreshDeps {
  writer: SnapshotWriter;
  storage: WidgetStorage;
  kv: DeviceKv;
  clock: () => Clock;
  hidePrivate: () => boolean;
  /** The live store, when the app UI is running in this JS runtime. */
  live: () => Source | null;
  /** Headless (background task, app not running): open the on-device cache. Null when signed out. */
  headless: () => Promise<Source | null>;
  now?: () => Date;
}

export type RefreshOutcome = { via: 'live' | 'headless'; wrote: boolean; drained: DrainResult } | { via: 'signedOut' };

export async function refreshWidgetSnapshot(deps: RefreshDeps): Promise<RefreshOutcome> {
  const now = deps.now ?? (() => new Date());
  const live = deps.live();
  const src = live ?? (await deps.headless());
  if (!src) {
    deps.writer.clear();
    return { via: 'signedOut' };
  }
  try {
    const drained = drainDoneOps({ storage: deps.storage, kv: deps.kv, store: src.store, now: now() });
    try {
      await src.sync?.();
    } catch {
      // offline: write what we have; the snapshot ages and the widget shows "Updated 3h ago"
    }
    let phone: PhoneEvents | null = null;
    try {
      phone = (await src.phone?.()) ?? null;
    } catch {
      // no phone calendars this time: the widget still shows everything else
    }
    const { data, prefs } = src.store.getState();
    // Forced: a refresh is what moves `writtenAt`, which the stale state counts from.
    const wrote = deps.writer.writeNow({ data, prefs, user: src.user, clock: deps.clock(), hidePrivate: deps.hidePrivate(), phone }, true);
    return { via: live ? 'live' : 'headless', wrote, drained };
  } finally {
    await src.finish?.();
  }
}
