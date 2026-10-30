/**
 * Types of the phone-calendar bridge (`device.ts`). Platform independent: the native `expo-calendar`
 * calls sit behind `DeviceCalendarApi`, the supabase calls behind `DeviceRemote`, so the bridge is
 * tested without either.
 */
import type { TargetStatus } from '@calendar/db';

/* ---------- the OS calendar, as the bridge sees it ---------- */

export type DevicePlatform = 'ios' | 'android' | 'web';

export interface DevicePermission {
  status: 'granted' | 'denied' | 'undetermined';
  /** false once the OS will no longer show its prompt (the user has to use Settings) */
  canAskAgain: boolean;
}

/** A calendar as the OS reports it. */
export interface RawCalendar {
  id: string;
  title: string;
  /** `#rrggbb` */
  color: string;
  /** iCloud, Gmail, "On my iPhone"... (iOS: the source name; Android: the owner account) */
  account: string;
  /** false for subscribed / birthday / holiday calendars */
  allowsModifications: boolean;
  /** Android: the calendar's internal name (for Google calendars: the account email) */
  internalName?: string | null;
}

/** An event (or one occurrence of a repeating one) as the OS reports it. */
export interface RawEvent {
  id: string;
  calendarId: string;
  title: string;
  startDate: string | Date;
  endDate: string | Date;
  allDay: boolean;
  location?: string | null;
  /** iOS: false when somebody else organises the event */
  organizerIsCurrentUser?: boolean;
  /** Android: the organizer's address */
  organizerEmail?: string | null;
  notes?: string | null;
}

/** What the bridge writes into the phone calendar for one of OUR events. */
export interface DeviceEventWrite {
  title: string;
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  timeZone: string;
  notes: string;
}

export interface DeviceCalendarApi {
  readonly platform: DevicePlatform;
  /** false on web (and anywhere expo-calendar is missing): the bridge then does nothing at all */
  readonly supported: boolean;
  getPermission(): Promise<DevicePermission>;
  requestPermission(): Promise<DevicePermission>;
  getCalendars(): Promise<RawCalendar[]>;
  getEvents(calendarIds: string[], from: Date, to: Date): Promise<RawEvent[]>;
  createEvent(calendarId: string, details: DeviceEventWrite): Promise<string>;
  updateEvent(eventId: string, details: DeviceEventWrite): Promise<void>;
  deleteEvent(eventId: string): Promise<void>;
  /** Calendar-change notifications, where the platform has them. expo-calendar has none, so the bridge also refreshes on foreground. */
  onChange?(cb: () => void): () => void;
}

/* ---------- calendars ---------- */

/** A phone calendar with its device-local settings. */
export interface DeviceCalendarInfo {
  /** `event_targets.device_calendar_key` (see `calendarKey`) */
  key: string;
  /** the OS id of the calendar on this phone (never leaves the device) */
  id: string;
  name: string;
  color: string;
  account: string;
  /** the OS says events can't be added (birthdays, holidays, subscriptions) */
  readOnly: boolean;
  showInApp: boolean;
  /** forced off for read-only calendars */
  canPublish: boolean;
}

export interface DeviceCalendarFlags {
  showInApp: boolean;
  canPublish: boolean;
}

/* ---------- events read from the phone (memory only) ---------- */

export interface DeviceEvent {
  /** `dev_…`: the id this occurrence has in the calendar view */
  id: string;
  /** `hidden_items.external_key` (all occurrences of a repeating event) */
  hiddenKey: string;
  calendarKey: string;
  calendarName: string;
  color: string;
  account: string;
  title: string;
  /** `YYYY-MM-DD` of the start, floating local time */
  day: string;
  /** minutes past midnight of `day` */
  start: number;
  /** minutes past midnight of `day`, up to start + 1440 */
  end: number;
  allDay: boolean;
  days: number;
  /** false when somebody else organised it (where the OS says), or the calendar is read-only */
  isMine: boolean;
  readOnlyCalendar: boolean;
  location: string | null;
}

/* ---------- publishing our events to a phone calendar ---------- */

export type TargetErrorCode = 'permission' | 'no_calendar' | 'not_allowed' | 'write_failed';

/** This device's record of one (event, phone calendar) pair. */
export interface LocalTarget {
  eventId: string;
  calendarKey: string;
  /** the OS id of our copy of the event, once created */
  externalId: string | null;
  /** fingerprint of the event as last written to the phone */
  fingerprint: string | null;
  status: TargetStatus;
  error: TargetErrorCode | null;
  /** the row in `event_targets` is out of date (offline, or the event isn't on the server yet) */
  remoteDirty: boolean;
  /** the `event_targets` row exists (or was last written) on the server */
  remoteKnown: boolean;
  /** the user un-ticked it (or the event went private / was deleted) but the phone copy could not be removed yet */
  removing: boolean;
  syncedAt: string | null;
}

/** What the UI shows for one target. `queued` also covers "done on the phone, not yet reported". */
export interface TargetView {
  key: string;
  status: TargetStatus;
  /** this device published it (false: another device did; shown, never acted on) */
  mine: boolean;
}

/** An `event_targets` device row as read back from the server (columns about OUR events only). */
export interface RemoteTargetRow {
  event_id: string;
  device_id: string;
  device_calendar_key: string;
  external_id: string | null;
  fingerprint: string | null;
  status: TargetStatus;
}

/** The only columns the bridge ever writes to `event_targets`. */
export interface TargetWrite {
  event_id: string;
  kind: 'device';
  device_id: string;
  device_calendar_key: string;
  external_id: string | null;
  fingerprint: string | null;
  status: TargetStatus;
  error: TargetErrorCode | null;
  synced_at: string | null;
}

export interface GoogleCalendarRef {
  name: string;
  accountEmail: string;
}

/**
 * Everything the bridge says to the server. Deliberately narrow: nothing in here can carry a phone
 * event's title, time or id. `supabase` is imported by `deviceRemote.ts` and nowhere else in the bridge.
 */
export interface DeviceRemote {
  fetchTargets(): Promise<RemoteTargetRow[]>;
  upsertTargets(rows: TargetWrite[]): Promise<void>;
  deleteTargets(keys: { event_id: string; device_id: string; device_calendar_key: string }[]): Promise<void>;
  fetchHiddenKeys(): Promise<string[]>;
  insertHidden(key: string): Promise<void>;
  deleteHidden(key: string): Promise<void>;
  /** Connected Google calendars with their account emails (for duplicate hiding). Read only. */
  fetchGoogleCalendars(): Promise<GoogleCalendarRef[]>;
}

/* ---------- bridge state ---------- */

export type PermissionState = 'unknown' | 'granted' | 'denied' | 'undetermined';

export interface DeviceState {
  /** the platform has phone calendars at all (false on web) */
  supported: boolean;
  /** settings are loaded and the permission is known */
  ready: boolean;
  permission: PermissionState;
  canAskAgain: boolean;
  /** permission granted and the calendar list is available */
  available: boolean;
  /** phone calendars, duplicates of connected Google calendars left out */
  calendars: DeviceCalendarInfo[];
  /** Google accounts whose duplicate phone calendars are hidden (CA 4.5) */
  duplicateAccounts: string[];
  /** phone events in the window, minus the ones the user removed */
  events: DeviceEvent[];
  /** phone events in the window the user removed (for Hidden events) */
  hidden: DeviceEvent[];
  /** per event id: where it is published, and how that stands */
  targets: Record<string, TargetView[]>;
  loading: boolean;
}

export const EMPTY_DEVICE_STATE: DeviceState = {
  supported: false,
  ready: false,
  permission: 'unknown',
  canAskAgain: true,
  available: false,
  calendars: [],
  duplicateAccounts: [],
  events: [],
  hidden: [],
  targets: {},
  loading: false,
};
