/**
 * Phone calendars ("On this phone"): the public interface of the device bridge for the rest of the app.
 *
 * - `useDeviceCalendars()`        the phone's calendars with their device-local settings
 * - `useDeviceTargetStatus(id)`   where one of our events is published on phone calendars, and how that stands
 * - `setDeviceTargets(id, keys)`  which phone calendars a public event publishes to
 * - `setCalendarFlags(key, ...)`  Show in app / Can publish to for one phone calendar
 * - `useDeviceEvents()`           the phone's events (memory only, never uploaded)
 * - `useCalendarWithDevice()`     the one call the calendar view makes to show phone events next to ours
 *
 * Everything is a no-op on web, where `available` is false and the lists are empty.
 */
import { useEffect, useMemo } from 'react';
import { addDays, type CatMap, type CalendarData, type ProtoEvent } from '@calendar/core';

import { deviceCats, toProtoEvent } from '@/sync/deviceMap';
import type { DeviceCalendarFlags, DeviceEvent, PermissionState, TargetView } from '@/sync/deviceTypes';
import { getDeviceBridge, useDeviceBridgeHost, useDeviceState } from './host';

export { deviceSupported, useDeviceBridgeHost } from './host';
export { isItemId as isDeviceEventId } from '@/sync/deviceHash';
export type { DeviceEvent, DeviceCalendarFlags, PermissionState, TargetView } from '@/sync/deviceTypes';
export type { TargetStatus } from '@calendar/db';

/** Route of the phone-calendar flow (CA 4): priming, permission, Choose calendars. */
export const PHONE_CALENDARS_ROUTE = '/settings/calendars/phone';

export interface DeviceCalendarView {
  /** stable per account + calendar name (`event_targets.device_calendar_key`) */
  key: string;
  name: string;
  /** `#rrggbb` */
  color: string;
  /** iCloud, a Google address, "On device"... */
  account: string;
  /** Show in app */
  showInApp: boolean;
  /** Can publish to (always false for read-only calendars) */
  canPublish: boolean;
  /** the OS says events can't be added (birthdays, holidays, subscriptions) */
  readOnly: boolean;
}

export interface DeviceCalendarsResult {
  /** false on web or without permission */
  available: boolean;
  /** phone calendars, with duplicates of connected Google calendars left out (CA 4.5) */
  calendars: DeviceCalendarView[];
  /** the OS permission, once known */
  permission: PermissionState;
  /** false once the OS will not show its prompt again (send the user to Settings) */
  canAskAgain: boolean;
  /** the platform has phone calendars at all (false on web) */
  supported: boolean;
  /** the first permission check and calendar read are done */
  ready: boolean;
  loading: boolean;
  /** Google accounts whose duplicate phone calendars are hidden */
  duplicateAccounts: string[];
}

export function useDeviceCalendars(): DeviceCalendarsResult {
  useDeviceBridgeHost();
  const s = useDeviceState();
  return useMemo(
    () => ({
      available: s.available,
      calendars: s.calendars.map((c) => ({
        key: c.key,
        name: c.name,
        color: c.color,
        account: c.account,
        showInApp: c.showInApp,
        canPublish: c.canPublish,
        readOnly: c.readOnly,
      })),
      permission: s.permission,
      canAskAgain: s.canAskAgain,
      supported: s.supported,
      ready: s.ready,
      loading: s.loading,
      duplicateAccounts: s.duplicateAccounts,
    }),
    [s.available, s.calendars, s.permission, s.canAskAgain, s.supported, s.ready, s.loading, s.duplicateAccounts],
  );
}

const NO_TARGETS: TargetView[] = [];

/**
 * Where `eventId` is published on phone calendars. `queued` also means "done on the phone, not yet
 * reported". `mine: false` rows come from another device of the user: shown, never acted on.
 */
export function useDeviceTargetStatus(eventId: string): { key: string; status: TargetView['status']; mine: boolean }[] {
  const s = useDeviceState();
  return s.targets[eventId] ?? NO_TARGETS;
}

/** Which phone calendars a public event publishes to (the keys of `useDeviceCalendars`). An empty list un-publishes it. */
export function setDeviceTargets(eventId: string, calendarKeys: string[]): Promise<void> {
  return getDeviceBridge()?.setTargets(eventId, calendarKeys) ?? Promise.resolve();
}

/** Show in app / Can publish to for one phone calendar (device-local; read-only calendars never publish). */
export function setCalendarFlags(key: string, flags: Partial<DeviceCalendarFlags>): Promise<void> {
  return getDeviceBridge()?.setCalendarFlags(key, flags) ?? Promise.resolve();
}

/** Show the OS calendar permission prompt (call after the priming screen). */
export async function requestDevicePermission(): Promise<PermissionState> {
  const b = getDeviceBridge();
  if (!b) return 'undetermined';
  return (await b.requestPermission()).status;
}

/** Re-read the permission, calendars and events now. */
export function refreshDeviceCalendars(): Promise<void> {
  return getDeviceBridge()?.refresh() ?? Promise.resolve();
}

const dateOf = (v: Date | string): Date => (v instanceof Date ? v : new Date(v.length === 10 ? v + 'T00:00:00' : v));

/** The phone's events (memory only), optionally just those starting in `range` (`Date` or `YYYY-MM-DD`). */
export function useDeviceEvents(range?: { from: Date | string; to: Date | string }): DeviceEvent[] {
  useDeviceBridgeHost();
  const { events } = useDeviceState();
  const hasRange = !!range;
  const from = range ? +dateOf(range.from) : 0;
  const to = range ? +dateOf(range.to) : 0;
  useEffect(() => {
    if (hasRange) getDeviceBridge()?.requestRange(new Date(from), new Date(to));
  }, [hasRange, from, to]);
  return useMemo(() => {
    if (!hasRange) return events;
    return events.filter((e) => {
      const d = +dateOf(e.day);
      return d >= from && d <= to;
    });
  }, [events, hasRange, from, to]);
}

/** Phone events the user removed, for Settings → Calendars → Hidden events. */
export function useHiddenDeviceEvents(): DeviceEvent[] {
  return useDeviceState().hidden;
}

/** Show a removed phone event again (`DeviceEvent.hiddenKey`). */
export function unhideDeviceEvent(hiddenKey: string): void {
  getDeviceBridge()?.unhideEvent(hiddenKey);
}

/** Remove (hide) a phone event in this app only. Returns it for the Undo toast; null when it is gone. */
export function hideDeviceEvent(id: string): DeviceEvent | null {
  return getDeviceBridge()?.hideEvent(id) ?? null;
}

/** One phone event by its calendar-view id (`dev_…`), hidden ones included. */
export function getDeviceEvent(id: string): DeviceEvent | null {
  return getDeviceBridge()?.getEvent(id) ?? null;
}

/** Live version of `getDeviceEvent`: re-renders when events load. */
export function useDeviceEvent(id: string): DeviceEvent | null {
  const s = useDeviceState();
  return useMemo(() => s.events.find((e) => e.id === id) ?? s.hidden.find((e) => e.id === id) ?? null, [s.events, s.hidden, id]);
}

/** Subtitle of the "On this phone" row in Settings. */
export function usePhoneCalendarsSummary(): string {
  const s = useDeviceState();
  if (!s.supported) return 'Available in the mobile app';
  if (!s.ready) return '';
  if (s.permission !== 'granted') return s.permission === 'denied' ? 'Access is off' : 'Not connected';
  const shown = s.calendars.filter((c) => c.showInApp).length;
  return s.calendars.length ? `${shown} of ${s.calendars.length} shown` : 'No calendars';
}

/**
 * The calendar view's one call: our data plus the phone's events, read-only, in the phone calendars'
 * colours. Phone events never enter the store; this only concatenates them for rendering. Also keeps
 * the bridge alive and tells it which part of the calendar is on screen. With nothing from the phone,
 * returns `data`'s own arrays.
 */
export function useCalendarWithDevice(data: CalendarData, focus: Date): { events: ProtoEvent[]; cats: CatMap } {
  useDeviceBridgeHost();
  const { events, calendars } = useDeviceState();
  const t = focus.getTime();
  useEffect(() => {
    const f = new Date(t);
    getDeviceBridge()?.requestRange(addDays(f, -45), addDays(f, 45));
  }, [t]);
  return useMemo(() => {
    if (!events.length) return { events: data.events, cats: data.cats };
    return {
      events: data.events.concat(events.map(toProtoEvent)),
      cats: { ...data.cats, ...deviceCats(calendars) },
    };
  }, [data.events, data.cats, events, calendars]);
}
