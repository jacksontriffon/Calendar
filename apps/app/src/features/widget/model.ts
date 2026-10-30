/**
 * What a widget shows at one moment: the snapshot, the clock and a size turned
 * into rows, goals and header text. The Android layouts (`apps/app/widgets`)
 * render this directly; the Swift extension (`targets/widget`) mirrors the
 * same rules in `Model.swift`, so a change here belongs there too.
 *
 * Rules (Design Spec WG, "Both platforms" and WG 6):
 *  - rows: Large shows the last finished session (dimmed), the now line and the
 *    next 4 (6 on Android 4x4); Medium the next 3 (4 on Android 4x2); Small one.
 *    A running event becomes a card, which costs one row on Medium and two on Large.
 *  - goals: 3 on Large and iPad, 2 on Medium, none on Small, in the snapshot's
 *    order (furthest behind first). The deadline shows on Large and iPad only.
 *  - one add button: "+" in the header, hidden on an empty day, where the body
 *    shows "Add a note" instead.
 *  - stale: 30 min to 24 h "Updated 3h ago"; over 24 h (or after midnight) the
 *    goal numbers dim and a strip says "Open Calendar to refresh".
 */
import { fmtDur } from '@calendar/core';

import { composeUrl, dayUrl, eventUrl, goalUrl, signinUrl } from './links';
import {
  ageShort,
  dayKey,
  dayLabel,
  deadlineLabel,
  doneToday,
  endsInLabel,
  fmtNow,
  fmtRange,
  fmtTime,
  goalSpanAt,
  inLabel,
  leftMinLabel,
  leftTodayLabel,
  nextWhenLabel,
  parseLocal,
  ringOf,
  staleLabel,
  staleLevel,
  totalLeftLabel,
  type StaleLevel,
} from './labels';
import { applyOps } from './snapshot';
import type { Clock, DoneOp, SnapshotEvent, Visibility, WidgetSnapshot } from './types';

export type Layout = 'small' | 'medium' | 'large' | 'xl';
export type Platform = 'ios' | 'android';

export interface Limits {
  /** most event rows (a running card, or the dimmed last session, counts as one) */
  rows: number;
  goals: number;
  deadline: boolean;
}

export const limits = (layout: Layout, platform: Platform): Limits => {
  switch (layout) {
    case 'small':
      return { rows: 1, goals: 0, deadline: false };
    case 'medium':
      return { rows: platform === 'android' ? 4 : 3, goals: 2, deadline: false };
    case 'large':
      return { rows: platform === 'android' ? 7 : 5, goals: 3, deadline: true };
    case 'xl':
      return { rows: 5, goals: 3, deadline: true };
  }
};

export const PRIVATE_TITLE = 'Private event';

export interface RowModel {
  id: string;
  title: string;
  /** "12:30pm" */
  time: string;
  /** "12:30–1:15pm" */
  range: string;
  hue: number;
  done: boolean;
  /** shows the check button (unticked circle, or filled when done) */
  check: boolean;
  vis: Visibility;
  owner: string | null;
  url: string;
}

export type Item =
  | { kind: 'row'; row: RowModel }
  | { kind: 'now'; time: string }
  | { kind: 'card'; row: RowModel; progress: number; endsIn: string };

export interface GoalModel {
  id: string;
  title: string;
  hue: number;
  /** 0..1 */
  ring: number;
  /** "45m left today" / "Done today" ("" while the numbers are old) */
  today: string;
  isDone: boolean;
  /** "73h left" */
  total: string;
  /** "9 weeks left", only where it fits */
  deadline: string | null;
  url: string;
}

export type SmallModel =
  | { kind: 'next'; when: string; title: string; range: string; hue: number }
  | { kind: 'now'; minsLeft: string; progress: number; title: string; range: string; hue: number }
  | { kind: 'empty'; date: string };

export interface DayColumn {
  label: string;
  /** the now line goes above the first row (today only) */
  nowTime: string | null;
  rows: RowModel[];
  /** "4h 55m planned" (tomorrow) */
  planned: string | null;
}

export interface WidgetModel {
  layout: Layout;
  state: 'signedOut' | 'content';
  /** where the whole widget goes when nothing else is tapped */
  url: string;
  header: {
    title: string;
    /** "Now 11:48 · 6 left", "Free day" or "Updated 3h ago" */
    sub: string;
    /** the sub line is the stale line (draw the cloud-off mark) */
    stale: boolean;
    /** the "+" (false on an empty day: "Add a note" does that job) */
    showPlus: boolean;
    /** a small neutral dot before "Now …" (not on a stale or free-day line) */
    dot: boolean;
  };
  level: StaleLevel;
  /** the goal numbers are old (over 24 h, or from before midnight): dim them */
  goalsDim: boolean;
  /** "Open Calendar to refresh" */
  strip: string | null;
  /** Android's offline banner: "Can't refresh. Showing 3h old data." (with a Retry button) */
  banner: string | null;
  /** an empty day: "Nothing scheduled", "Add a note", and the next event as text */
  empty: { next: string | null } | null;
  items: Item[];
  /** "+ 2 more today" */
  more: string | null;
  goals: GoalModel[];
  small: SmallModel | null;
  xl: { today: DayColumn; tomorrow: DayColumn } | null;
  clock: Clock;
}

const MIN = 60000;

interface Timed {
  e: SnapshotEvent;
  s: Date;
  en: Date;
}

const timed = (events: readonly SnapshotEvent[]): Timed[] =>
  events
    .map((e) => ({ e, s: parseLocal(e.s), en: parseLocal(e.e) }))
    .filter((x): x is Timed => !!x.s && !!x.en)
    .sort((a, b) => a.s.getTime() - b.s.getTime());

const rowOf = (x: Timed, clock: Clock, hide: boolean): RowModel => ({
  id: x.e.id,
  title: hide && x.e.vis === 'private' ? PRIVATE_TITLE : x.e.t,
  time: fmtTime(x.s, clock),
  range: fmtRange(x.s, x.en, clock),
  hue: x.e.hue,
  done: x.e.done,
  check: x.e.check && !x.e.owner,
  vis: x.e.vis,
  owner: x.e.owner,
  url: eventUrl(x.e.id),
});

const progressOf = (x: Timed, nowMs: number): number => {
  const d = x.en.getTime() - x.s.getTime();
  return d > 0 ? Math.max(0, Math.min(1, (nowMs - x.s.getTime()) / d)) : 0;
};

const minsUntil = (ms: number, nowMs: number): number => Math.max(1, Math.ceil((ms - nowMs) / MIN));

const signedOutModel = (layout: Layout): WidgetModel => ({
  layout,
  state: 'signedOut',
  url: signinUrl(),
  header: { title: '', sub: '', stale: false, showPlus: false, dot: false },
  level: 'fresh',
  goalsDim: false,
  strip: null,
  banner: null,
  empty: null,
  items: [],
  more: null,
  goals: [],
  small: null,
  xl: null,
  clock: '12h',
});

/**
 * Build the model for `layout` at `nowMs`. `snapshot` null means signed out.
 * `ops` are queued checks, drawn on top of the snapshot.
 */
export function buildModel(
  snapshot: WidgetSnapshot | null,
  nowMs: number,
  layout: Layout,
  opts: { platform?: Platform; ops?: readonly DoneOp[] } = {},
): WidgetModel {
  if (!snapshot) return signedOutModel(layout);
  const now = new Date(nowMs);
  const lim = limits(layout, opts.platform ?? 'ios');
  const snap = opts.ops?.length ? applyOps(snapshot, opts.ops) : snapshot;
  const clock = snap.prefs.clock;
  const hide = !!snap.prefs.hidePrivate;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const dayAfter = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2);
  const todayKey = dayKey(today);
  const nowLabel = fmtNow(now.getHours() * 60 + now.getMinutes(), clock);

  const all = timed(snap.events);
  // Today's events: anything overlapping today (a session that started last night and runs on counts).
  const todays = all.filter((x) => x.s.getTime() < tomorrow.getTime() && x.en.getTime() > today.getTime());
  const left = todays.filter((x) => x.en.getTime() > nowMs);
  const leftOpen = left.filter((x) => !x.e.done);
  const running = left.find((x) => x.s.getTime() <= nowMs && !x.e.done);
  const upcoming = left.filter((x) => x !== running);
  const past = todays.filter((x) => x.en.getTime() <= nowMs);
  const lastPast = past.length ? past[past.length - 1] : null;
  const isEmpty = todays.length === 0;

  const age = Math.max(0, nowMs - Date.parse(snap.writtenAt));
  const level = staleLevel(age);
  const goalsDim = level === 'old' || snap.day !== todayKey;

  let sub = isEmpty ? 'Free day' : `Now ${nowLabel} · ${leftOpen.length} left`;
  if (level !== 'fresh') sub = staleLabel(age);

  // Rows (Medium and Large).
  const items: Item[] = [];
  let more: string | null = null;
  if ((layout === 'medium' || layout === 'large') && !isEmpty) {
    const cap = lim.rows;
    let used = 0;
    if (running) {
      items.push({ kind: 'card', row: rowOf(running, clock, hide), progress: progressOf(running, nowMs), endsIn: endsInLabel(minsUntil(running.en.getTime(), nowMs)) });
      // The card is taller than a row: on Large it costs two rows (WG 1b shows the card and three more).
      used += layout === 'large' ? 2 : 1;
    } else if (layout === 'large') {
      if (lastPast) {
        items.push({ kind: 'row', row: rowOf(lastPast, clock, hide) });
        used++;
      }
      items.push({ kind: 'now', time: nowLabel });
    }
    let shown = 0;
    for (const x of upcoming) {
      if (used >= cap) break;
      items.push({ kind: 'row', row: rowOf(x, clock, hide) });
      used++;
      shown++;
    }
    if (layout === 'large' && upcoming.length > shown) more = `+ ${upcoming.length - shown} more today`;
  }

  // Goals still active today, as many as the layout holds.
  const goals: GoalModel[] = snap.goals
    .filter((g) => goalSpanAt(g, today).active)
    .slice(0, lim.goals)
    .map((g) => ({
      id: g.id,
      title: g.title,
      hue: g.hue,
      ring: goalsDim ? 0 : ringOf(g.todayNeed, g.todayDone),
      today: goalsDim ? '' : leftTodayLabel(g.todayNeed, g.todayDone),
      isDone: !goalsDim && doneToday(g.todayNeed, g.todayDone),
      total: totalLeftLabel(g),
      deadline: lim.deadline ? deadlineLabel(g, today) : null,
      url: goalUrl(g.id),
    }));

  // Empty day: the next event as a line of text.
  let empty: WidgetModel['empty'] = null;
  if (isEmpty) {
    const next = all.find((x) => x.s.getTime() > nowMs && !x.e.done);
    empty = { next: next ? `Next: ${nextWhenLabel(next.s, clock)} · ${rowOf(next, clock, hide).title}` : null };
  }

  // Small: what is next, and when.
  let small: SmallModel | null = null;
  if (layout === 'small') {
    const next = all.find((x) => x.s.getTime() > nowMs && !x.e.done);
    if (isEmpty || (!running && !next)) {
      small = { kind: 'empty', date: dayLabel(today) };
    } else if (running) {
      small = {
        kind: 'now',
        minsLeft: leftMinLabel(minsUntil(running.en.getTime(), nowMs)),
        progress: progressOf(running, nowMs),
        title: rowOf(running, clock, hide).title,
        range: fmtRange(running.s, running.en, clock),
        hue: running.e.hue,
      };
    } else if (next) {
      small = {
        kind: 'next',
        when: dayKey(next.s) === todayKey ? inLabel(minsUntil(next.s.getTime(), nowMs)) : nextWhenLabel(next.s, clock),
        title: rowOf(next, clock, hide).title,
        range: fmtRange(next.s, next.en, clock),
        hue: next.e.hue,
      };
    }
  }

  // iPad: today and tomorrow side by side.
  let xl: WidgetModel['xl'] = null;
  if (layout === 'xl') {
    const todayRows = [...(running ? [running] : []), ...upcoming].slice(0, lim.rows);
    const tom = all.filter((x) => x.s.getTime() >= tomorrow.getTime() && x.s.getTime() < dayAfter.getTime());
    const planned = tom.reduce((a, x) => a + (x.en.getTime() - x.s.getTime()) / MIN, 0);
    xl = {
      today: {
        label: `Today · ${leftOpen.length} left`,
        nowTime: running ? null : nowLabel,
        rows: todayRows.map((x) => rowOf(x, clock, hide)),
        planned: null,
      },
      tomorrow: {
        label: `Tomorrow · ${dayLabel(tomorrow).split(' ').slice(0, 2).join(' ')}`,
        nowTime: null,
        rows: tom.slice(0, lim.rows).map((x) => rowOf(x, clock, hide)),
        planned: tom.length ? `${fmtDur(Math.round(planned))} planned` : null,
      },
    };
  }

  return {
    layout,
    state: 'content',
    url: layout === 'small' && isEmpty ? composeUrl() : dayUrl(todayKey),
    header: { title: dayLabel(today), sub, stale: level !== 'fresh', showPlus: !isEmpty && layout !== 'small', dot: !isEmpty && level === 'fresh' },
    level,
    goalsDim,
    strip: level === 'old' && layout !== 'small' ? 'Open Calendar to refresh' : null,
    banner: level !== 'fresh' && layout !== 'small' ? `Can’t refresh. Showing ${ageShort(age)} old data.` : null,
    empty,
    items,
    more,
    goals,
    small,
    xl,
    clock,
  };
}
