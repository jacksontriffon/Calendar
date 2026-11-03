/**
 * Builds the widget snapshot (Design Spec WG 5) from the store's data. Pure:
 * everything it needs, including "now", comes in as arguments, so it runs the
 * same in the app, in a background task and in tests.
 *
 * Window: yesterday to 7 days ahead, at most 60 events and 6 goals (about 25 KB).
 * That is wider than the next ~24 h on purpose: the iPhone Large carousel shows
 * Yesterday, Today and Tomorrow, the iPad widget shows today and tomorrow, and the
 * empty-day line says "Next: Mon 9am · ..." which can be days away. Goals are
 * written up to MAX_GOALS, in pages of two (Large) or one (Medium) on the iPhone.
 */
import {
  addDays,
  isDone,
  withAutoDone,
  goalOf,
  goalStats,
  goalsToday,
  key,
  minutesOfDay,
  snapHue,
  type CalendarData,
  type NowCtx,
  type Prefs,
  type ProtoEvent,
  type ProtoGoal,
} from '@calendar/core';

import { initials } from '@/features/auth/initials';

import { dayKey, parseLocal, toLocal } from './labels';
import { widgetTokens, WIDGET_ACCENT } from './tokens';
import {
  SNAPSHOT_VERSION,
  type Clock,
  type SnapshotEvent,
  type SnapshotGoal,
  type WidgetSnapshot,
} from './types';

export const MAX_EVENTS = 60;
export const MAX_GOALS = 6;
/** Days before today and after today the snapshot covers. */
export const WINDOW_BACK = 1;
export const WINDOW_AHEAD = 7;

export interface BuildInput {
  data: CalendarData;
  prefs: Prefs;
  /** The signed-in user, or null when signed out (no snapshot is built). */
  user: { id: string; name: string | null } | null;
  now: Date;
  clock: Clock;
  /** The widget setting "Hide private titles". */
  hidePrivate?: boolean;
  /** Initials for someone else's event. The default reads `ownerName` / `organizer` / `creator` if the event carries one. */
  ownerOf?: (e: ProtoEvent) => string | null;
  /**
   * The phone's own calendars ("On this phone"). Those events live in the device bridge's memory and
   * never enter the store, so the caller passes them here. They only add rows: they never count toward
   * a goal. The snapshot is written to on-device storage, so this does not
   * break the rule that phone events are never uploaded.
   */
  phone?: PhoneEvents | null;
}

/** Phone-calendar events in the calendar view's shape, with the hue of each phone calendar. */
export interface PhoneEvents {
  events: readonly ProtoEvent[];
  cats: Readonly<Record<string, number>>;
}

/** Someone else's event: imported from Google, or flagged `isMine === false`. */
export const isOthers = (e: Pick<ProtoEvent, 'source' | 'isMine'>): boolean => e.isMine === false || e.source === 'google';

/**
 * Whether an event is a goal session the widget counts: only goal sessions, and
 * never someone else's event. No widget draws a check button any more (a done
 * event is struck through), so this only feeds the Large "2 of 3 done" summary.
 */
export const showsCheck = (e: ProtoEvent, goal: ProtoGoal | null): boolean => !!goal && !isOthers(e) && !e.allDay;

const defaultOwner = (e: ProtoEvent): string | null => {
  const x = e as ProtoEvent & { ownerName?: string; organizer?: string; creator?: string };
  return initials(x.ownerName ?? x.organizer ?? x.creator ?? null);
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Local Date for a day key plus minutes (minutes may exceed 1440). */
const at = (day: string, min: number): Date => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], 0, min) : new Date(NaN);
};

export function buildEvents(input: BuildInput, today: Date): SnapshotEvent[] {
  const { data, now } = input;
  const from = key(addDays(today, -WINDOW_BACK));
  const to = key(addDays(today, WINDOW_AHEAD));
  const ownerOf = input.ownerOf ?? defaultOwner;
  const phone = input.phone?.events.length ? input.phone : null;
  const cats = phone ? { ...(data.cats ?? {}), ...phone.cats } : data.cats ?? {};
  const events = phone ? data.events.concat(phone.events) : data.events;

  const rows = events
    .filter((e) => !e.allDay && e.day >= from && e.day <= to)
    .map((e) => {
      const s = at(e.day, e.start);
      const en = at(e.day, e.end);
      // A phone event is never a goal session, even if its title happens to match a goal.
      const goal = e.source === 'device' ? null : goalOf(e, data.goals);
      const others = isOthers(e);
      const row: SnapshotEvent = {
        id: e.id,
        t: e.title,
        cat: e.cat,
        hue: snapHue(e.cat != null && cats[e.cat] != null ? cats[e.cat] : 1000),
        s: toLocal(s),
        e: toLocal(en),
        check: showsCheck(e, goal),
        done: isDone(e, now.getTime()),
        vis: e.visibility === 'public' ? 'public' : 'private',
        owner: others ? ownerOf(e) ?? '?' : null,
        goal: goal ? goal.id : null,
      };
      return { row, ms: s.getTime(), endMs: en.getTime() };
    })
    .filter((x) => !Number.isNaN(x.ms));

  rows.sort((a, b) => a.ms - b.ms || (a.row.id < b.row.id ? -1 : 1));
  if (rows.length <= MAX_EVENTS) return rows.map((x) => x.row);

  // Over the cap: keep what has not ended yet, then fill with the most recent finished ones.
  const nowMs = now.getTime();
  const ahead = rows.filter((x) => x.endMs > nowMs).slice(0, MAX_EVENTS);
  const past = rows.filter((x) => x.endMs <= nowMs).slice(-(MAX_EVENTS - ahead.length));
  return [...past, ...ahead].sort((a, b) => a.ms - b.ms).map((x) => x.row);
}

/**
 * Today's goals, furthest behind pace first, then nearest deadline (WG:
 * "Both platforms, Goals"). Only goals whose span contains today.
 */
export function buildGoals(input: BuildInput, ctx: NowCtx): SnapshotGoal[] {
  const data = withAutoDone(input.data, ctx.nowMs ?? Date.now()); // an event that has ended counts as done
  const today = goalsToday(data.goals, data.events, ctx);
  const byId = new Map(today.map((g) => [g.id, g]));
  return data.goals
    .map((g) => ({ g, st: goalStats(g, data.events, ctx) }))
    .filter((x) => x.st.active)
    .sort((a, b) => a.st.delta - b.st.delta || (a.g.deadline < b.g.deadline ? -1 : a.g.deadline > b.g.deadline ? 1 : 0))
    .slice(0, MAX_GOALS)
    .map(({ g, st }) => {
      const t = byId.get(g.id)!;
      return {
        id: g.id,
        title: g.title,
        hue: snapHue(g.hue),
        hours: r3(Math.max(0, Number(g.hours) || 0)),
        done: r3(st.done),
        todayNeed: r3(t.todayNeed),
        todayDone: r3(t.todayDone),
        start: g.start,
        deadline: g.deadline,
      };
    });
}

/** The snapshot for a signed-in user. Returns null when signed out (the widget then shows the sign-in card). */
export function buildSnapshot(input: BuildInput): WidgetSnapshot | null {
  if (!input.user) return null;
  const { now, prefs } = input;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ctx: NowCtx = { today, nowMin: minutesOfDay(now), nowMs: now.getTime() };
  return {
    v: SNAPSHOT_VERSION,
    writtenAt: now.toISOString(),
    day: dayKey(today),
    session: { userId: input.user.id, name: input.user.name },
    prefs: { font: prefs.font, accent: WIDGET_ACCENT, clock: input.clock, weekStart: 1, hidePrivate: !!input.hidePrivate },
    cats: { ...(input.data.cats ?? {}) },
    events: buildEvents(input, today),
    goals: buildGoals(input, ctx),
    tokens: widgetTokens(),
  };
}

/** The snapshot as written, without the write time: equal fingerprints mean nothing the widget shows has changed. */
export const fingerprint = (s: WidgetSnapshot): string => JSON.stringify({ ...s, writtenAt: '' });
