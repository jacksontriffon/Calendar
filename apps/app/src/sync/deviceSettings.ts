/**
 * Device-local state of the phone-calendar bridge, kept in the app's device storage (MMKV / IndexedDB)
 * and never in Supabase:
 *  - per user: each phone calendar's `showInApp` / `canPublish`, this device's record of which of the
 *    user's events it published where, and the phone events the user removed (until reported);
 *  - per install: a stable id for this installation (`event_targets.device_id`).
 *
 * The per-user part lives under its own prefix, not the sync cache's, so the sync layer's sign-out
 * wipe doesn't touch it.
 */
import { scopedStore } from './kv';
import type { DeviceCalendarFlags, LocalTarget } from './deviceTypes';
import type { KeyValueStore } from './types';

export const devicePrefix = (userId: string): string => `calendar:v1:device:${userId}:`;
const INSTALL_KEY = 'calendar:v1:device:install-id';
const STATE_KEY = 'state';

export interface PersistedDevice {
  /** keyed by phone calendar key */
  calendars: Record<string, DeviceCalendarFlags>;
  /** keyed by `eventId|calendarKey` */
  targets: Record<string, LocalTarget>;
  /** `event_targets` rows to delete once the server is reachable */
  tombstones: Record<string, { event_id: string; device_calendar_key: string }>;
  /** removed phone events (`hidden_items.external_key`) */
  hidden: string[];
  /** hide / unhide not yet reported to the server */
  hiddenAdd: string[];
  hiddenRemove: string[];
}

export const emptyPersisted = (): PersistedDevice => ({ calendars: {}, targets: {}, tombstones: {}, hidden: [], hiddenAdd: [], hiddenRemove: [] });

export function userStore(base: KeyValueStore, userId: string): KeyValueStore {
  return scopedStore(base, devicePrefix(userId));
}

export async function loadPersisted(kv: KeyValueStore): Promise<PersistedDevice> {
  try {
    const raw = await kv.getItem(STATE_KEY);
    if (!raw) return emptyPersisted();
    const p = JSON.parse(raw) as Partial<PersistedDevice>;
    return {
      calendars: p.calendars && typeof p.calendars === 'object' ? p.calendars : {},
      targets: p.targets && typeof p.targets === 'object' ? p.targets : {},
      tombstones: p.tombstones && typeof p.tombstones === 'object' ? p.tombstones : {},
      hidden: Array.isArray(p.hidden) ? p.hidden.map(String) : [],
      hiddenAdd: Array.isArray(p.hiddenAdd) ? p.hiddenAdd.map(String) : [],
      hiddenRemove: Array.isArray(p.hiddenRemove) ? p.hiddenRemove.map(String) : [],
    };
  } catch {
    return emptyPersisted();
  }
}

export async function savePersisted(kv: KeyValueStore, p: PersistedDevice): Promise<void> {
  try {
    await kv.setItem(STATE_KEY, JSON.stringify(p));
  } catch {
    // Not persisted: settings fall back to defaults after a relaunch.
  }
}

const randomId = (): string =>
  typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

/** The stable per-install id (`event_targets.device_id`); created on first use. */
export async function loadInstallId(base: KeyValueStore, make: () => string = randomId): Promise<string> {
  try {
    const have = await base.getItem(INSTALL_KEY);
    if (have) return have;
  } catch {
    // fall through and make one
  }
  const id = make();
  try {
    await base.setItem(INSTALL_KEY, id);
  } catch {
    // This session still has an id; the next launch gets another.
  }
  return id;
}
