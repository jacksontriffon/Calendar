/**
 * The widget snapshot (Design Spec WG 5) and the constants shared by the app,
 * the iOS extension (Swift) and the Android widget.
 *
 * The app writes ONE snapshot after every sync and local edit. Widgets never
 * need the network to draw. All time maths (the now line, "ends in", "left
 * today") is done by the widget at draw time from `s` / `e`, so an old
 * snapshot still reads correctly for time.
 *
 * Differences from the WG 5 sample, all additive:
 *  - `day`: the local date the `today*` goal numbers were computed for, so a
 *    widget can tell they are yesterday's after midnight.
 *  - `tokens`: both colour schemes and the category swatches, so the native
 *    code does not hard-code them. Which scheme is used is still read from the
 *    system when the widget draws.
 *  - events carry `hue` (the resolved swatch hue) and `goal` (the goal id the
 *    session counts toward) so a queued check can move the right ring at once.
 *  - `prefs.hidePrivate` is the spec's "Hide private titles" widget setting.
 */

export const SNAPSHOT_VERSION = 1;

/** iOS App Group shared by the app and the widget extension (see app.config.ts). */
export const APP_GROUP = 'group.com.claudecalendar.app';

/** Keys in the shared storage (iOS: App Group UserDefaults, Android: the device KV). */
export const KEYS = {
  /** JSON {@link WidgetSnapshot}. Written by the app only. Absent means signed out. */
  snapshot: 'widget.snapshot.v1',
  /** JSON {@link DoneOp}[]. Written by the widget only. */
  ops: 'widget.ops.v1',
  /** JSON string[] of {@link opKey}s the app has applied. Written by the app only. */
  ack: 'widget.opsAck.v1',
} as const;

/** Device-KV keys that are only for the app side. */
export const APP_KEYS = {
  applied: 'widget.applied.v1',
  hidePrivate: 'widget.hidePrivate.v1',
} as const;

/** iOS WidgetKit `kind` (must match `CalendarWidget.swift`). */
export const IOS_WIDGET_KIND = 'CalendarWidget';

/** Android widget provider names (must match the plugin entries in app.config.ts). */
export const ANDROID_WIDGETS = ['CalendarSmall', 'CalendarMedium', 'CalendarLarge'] as const;
export type AndroidWidgetName = (typeof ANDROID_WIDGETS)[number];

/** Queued checks older than this are dropped without being applied. */
export const OP_MAX_AGE_MS = 7 * 86400000;

export type Clock = '12h' | '24h';
export type Visibility = 'private' | 'public';

export interface SnapshotEvent {
  id: string;
  /** title */
  t: string;
  /** category name (null when it has none) */
  cat: string | null;
  /** swatch hue of the category (a key of `tokens.swatch`) */
  hue: number;
  /** floating local start, `YYYY-MM-DDTHH:mm` */
  s: string;
  /** floating local end, `YYYY-MM-DDTHH:mm` */
  e: string;
  /** shows a check button (goal sessions only, and never on someone else's event) */
  check: boolean;
  done: boolean;
  vis: Visibility;
  /** two-letter initials of the owner for someone else's event, else null */
  owner: string | null;
  /** id of the goal this session counts toward, if any */
  goal: string | null;
}

export interface SnapshotGoal {
  id: string;
  title: string;
  /** swatch hue */
  hue: number;
  /** estimate, hours */
  hours: number;
  /** hours done so far */
  done: number;
  /** hours needed today / done today (core `goalToday`) */
  todayNeed: number;
  todayDone: number;
  /** `YYYY-MM-DD` */
  start: string;
  /** `YYYY-MM-DD`, inclusive */
  deadline: string;
}

export interface Palette {
  /** widget background */
  bg: string;
  /** all text and icons: white on dark, black on light */
  ink: string;
  /** opacities of `ink` */
  secondary: number;
  tertiary: number;
  hairline: number;
  track: number;
  checkRing: number;
  /** subtle fill (running-event card, banner) */
  subtle: number;
  /** button fill (Add a note, Retry) */
  button: number;
}

export interface WidgetTokens {
  light: Palette;
  dark: Palette;
  /** hue -> swatch colour (event bars and goal rings; never text) */
  swatch: Record<string, string>;
  /** the one amber mark: the cloud-off glyph on a stale widget */
  amber: string;
}

export interface DoneOp {
  op: 'done';
  /** event id */
  ev: string;
  /** ISO UTC time of the tap */
  at: string;
}

export interface WidgetSnapshot {
  v: typeof SNAPSHOT_VERSION;
  /** ISO UTC time the snapshot was written; the stale state counts from here */
  writtenAt: string;
  /** local date the `today*` goal numbers are for */
  day: string;
  session: { userId: string; name: string | null };
  prefs: { font: string; accent: string; clock: Clock; weekStart: number; hidePrivate: boolean };
  cats: Record<string, number>;
  events: SnapshotEvent[];
  goals: SnapshotGoal[];
  tokens: WidgetTokens;
  /**
   * Checks queued by the widget. The app never fills this (the widget keeps
   * its own queue under `KEYS.ops`); it is kept so the format matches WG 5, and
   * a widget applies queued ops on top of it when it draws.
   */
  ops: DoneOp[];
}

/** Storage the snapshot and the op queue live in. iOS: App Group. Android: MMKV. */
export interface WidgetStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  /** Ask the OS to redraw the widgets. */
  reload(): void | Promise<void>;
}
