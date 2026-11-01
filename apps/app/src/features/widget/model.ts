/**
 * What a widget shows at one moment: the snapshot, the clock and a size turned
 * into rows, goals and header text. The Android layouts (`apps/app/widgets`)
 * render this directly; the Swift extension (`targets/widget`) mirrors the
 * same rules in `Model.swift`, so a change here belongs there too.
 *
 * Rules (Design Spec WG, "Both platforms" and WG 6):
 *  - iPhone Large (WG 1g to 1i): Yesterday, Today and Tomorrow as a vertical
 *    carousel of three pages. The page in view lists that day; the neighbours
 *    peek above and below. Goals sit in the header, two a page. A message field
 *    runs along the bottom. No check buttons, no "+", no counts.
 *  - iPhone Medium (WG 2i): today only, one goal at a time in a left rail, the
 *    same message field. No other days.
 *  - the lists are fitted by height (`Fit`): the finished session (dimmed), the
 *    now line and as many upcoming events as fit, then "+ n more today" only
 *    when some do not. A running event becomes a card in place of the now line.
 *  - Small, iPad ("xl") and Android keep their layouts: rows in Large/Medium
 *    (7 and 4 on Android 4x4 / 4x2), goals with deadline, a "+" in the header
 *    (hidden on an empty day, where the body shows "Add a note" instead).
 *  - no "n left" counts anywhere ("Now 11:48", "Today").
 *  - stale: 30 min to 24 h "Updated 3h ago"; over 24 h (or after midnight) the
 *    goal numbers dim and a strip says "Open Calendar to refresh" (on iPhone
 *    Large and Medium it takes the message field's placeholder).
 */
import { fmtDur } from '@calendar/core';

import { resolveCarousel, type CarouselState, type DayOffset } from './carousel';
import { composeUrl, dayUrl, eventUrl, goalUrl, signinUrl } from './links';
import {
  ageShort,
  dayKey,
  dayLabel,
  dayShort,
  deadlineLabel,
  doneOfLabel,
  doneToday,
  endsInLabel,
  fmtNow,
  fmtRange,
  fmtTime,
  goalSpanAt,
  inLabel,
  leftMinLabel,
  leftTodayLabel,
  monthName,
  nextWhenLabel,
  parseLocal,
  plannedLabel,
  ringLeftLabel,
  ringOf,
  staleLabel,
  staleLevel,
  totalLeftLabel,
  type StaleLevel,
} from './labels';
import { applyOps } from './snapshot';
import { WIDGET_ACCENT } from './tokens';
import type { Clock, DoneOp, SnapshotEvent, Visibility, WidgetSnapshot } from './types';

export type Layout = 'small' | 'medium' | 'large' | 'xl';
export type Platform = 'ios' | 'android';

/**
 * Heights (pt) an iPhone list is fitted into, from the frames. `avail` is the
 * room under a page's heading with no peeks; each peek takes `peek` off it.
 *  - Large (WG 1g, 354 tall): 354 - 28 padding - 40 header - 6 gap - 40 field = 240, less the 18 heading = 222.
 *    Today has two peeks (222 - 74 = 148), Yesterday and Tomorrow one (185).
 *  - Medium (WG 2i, 158 tall): 158 - 24 padding - 32 field = 102, less the 14 heading = 88. No peeks.
 */
export interface Fit {
  row: number;
  now: number;
  card: number;
  more: number;
  avail: number;
  peek: number;
}

export const LARGE_FIT: Fit = { row: 20, now: 14, card: 44, more: 14, avail: 222, peek: 37 };
export const MEDIUM_FIT: Fit = { row: 16, now: 11, card: 36, more: 12, avail: 88, peek: 0 };

export interface Limits {
  /** most event rows where the list is a fixed count (Android, iPad); on the iPhone pager, what fits a roomy page */
  rows: number;
  /** goals shown at once */
  goals: number;
  /** goals a page when the goals page through (iPhone Large 2, Medium 1); 0 where they do not */
  perPage: number;
  deadline: boolean;
  /** the iPhone Large and Medium list heights; null elsewhere */
  fit: Fit | null;
}

export const limits = (layout: Layout, platform: Platform): Limits => {
  switch (layout) {
    case 'small':
      return { rows: 1, goals: 0, perPage: 0, deadline: false, fit: null };
    case 'medium':
      return platform === 'android'
        ? { rows: 4, goals: 2, perPage: 0, deadline: false, fit: null }
        : { rows: Math.floor(MEDIUM_FIT.avail / MEDIUM_FIT.row), goals: 1, perPage: 1, deadline: false, fit: MEDIUM_FIT };
    case 'large':
      return platform === 'android'
        ? { rows: 7, goals: 3, perPage: 0, deadline: true, fit: null }
        : { rows: Math.floor(LARGE_FIT.avail / LARGE_FIT.row), goals: 2, perPage: 2, deadline: false, fit: LARGE_FIT };
    case 'xl':
      return { rows: 5, goals: 3, perPage: 0, deadline: true, fit: null };
  }
};

export const PRIVATE_TITLE = 'Private event';
export const COMPOSE_PLACEHOLDER = 'Add or change an event…';

export interface RowModel {
  id: string;
  title: string;
  /** "12:30pm" */
  time: string;
  /** "12:30–1:15pm" */
  range: string;
  hue: number;
  /** struck through and dimmed */
  done: boolean;
  /** shows the check button (unticked circle, or filled when done). Never on the iPhone Large and Medium: there a done event is just struck through. */
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
  /** inside the ring: "45m" (the view adds "left" under it); "" once done or while the numbers are old */
  left: string;
  isDone: boolean;
  /** "73h left" (not drawn on the iPhone Large and Medium) */
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

/** A neighbouring day, dimmed above or below the page in view. Tapping it moves the carousel to that day. */
export interface PeekModel {
  offset: DayOffset;
  /** "Yesterday · Thu 29" */
  label: string;
  /** "2 of 3 done" (yesterday), "4h 55m planned" (tomorrow), none for today */
  summary: string | null;
  /** the day's first event (today: the next one) */
  row: RowModel | null;
  /** nothing on that day */
  empty: boolean;
}

/** The Large widget's day carousel (WG 1g to 1i). */
export interface PagerModel {
  /** the page in view */
  day: DayOffset;
  /** "Yesterday" / "Today" / "Tomorrow" */
  heading: string;
  /** "2 of 3 done" / "4h 55m planned" / none for today */
  summary: string | null;
  /** the peek above the page (none at Yesterday) */
  before: PeekModel | null;
  /** the peek below the page (none at Tomorrow) */
  after: PeekModel | null;
  /** where the dots on the right edge stand, as day offsets, top to bottom */
  dots: DayOffset[];
}

export interface WidgetModel {
  layout: Layout;
  state: 'signedOut' | 'content';
  /** where the whole widget goes when nothing else is tapped */
  url: string;
  header: {
    /** "Fri 30 Oct"; on the iPhone Large and Medium "Fri 30", following the day in view */
    title: string;
    /** "October" (iPhone Large and Medium) */
    month: string;
    /** "Now 11:48", "Free day" or "Updated 3h ago" (not drawn on the iPhone Large and Medium) */
    sub: string;
    /** the sub line is the stale line (draw the cloud-off mark) */
    stale: boolean;
    /** the "+" (false on an empty day: "Add a note" does that job; never on the iPhone Large and Medium: the message field does) */
    showPlus: boolean;
    /** a small neutral dot before "Now …" (not on a stale or free-day line) */
    dot: boolean;
  };
  level: StaleLevel;
  /** the goal numbers are old (over 24 h, or from before midnight): dim them */
  goalsDim: boolean;
  /** "Open Calendar to refresh" (iPhone Large and Medium put it in the message field instead) */
  strip: string | null;
  /** Android's offline banner: "Can't refresh. Showing 3h old data." (with a Retry button) */
  banner: string | null;
  /** an empty day (the one in view): "Nothing scheduled", "Add a note" (not on the iPhone), and today's next event as text */
  empty: { next: string | null } | null;
  /** the list of the day in view */
  items: Item[];
  /** "+ 2 more today" */
  more: string | null;
  /** the goals on show: one page on the iPhone Large and Medium, the first few elsewhere */
  goals: GoalModel[];
  /** which goal page that is, and how many there are (iPhone Large and Medium; null elsewhere or with no goals) */
  goalPages: { index: number; count: number } | null;
  small: SmallModel | null;
  xl: { today: DayColumn; tomorrow: DayColumn } | null;
  /** the day carousel (iPhone Large only) */
  pager: PagerModel | null;
  /** the message field along the bottom (iPhone Large and Medium): a tap anywhere on it opens the composer */
  compose: { placeholder: string; url: string } | null;
  /** accent (hex): the now line and the send button on the iPhone Large and Medium */
  accent: string;
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

const rowOf = (x: Timed, clock: Clock, hide: boolean, check: boolean): RowModel => ({
  id: x.e.id,
  title: hide && x.e.vis === 'private' ? PRIVATE_TITLE : x.e.t,
  time: fmtTime(x.s, clock),
  range: fmtRange(x.s, x.en, clock),
  hue: x.e.hue,
  done: x.e.done,
  check: check && x.e.check && !x.e.owner,
  vis: x.e.vis,
  owner: x.e.owner,
  url: eventUrl(x.e.id),
});

const progressOf = (x: Timed, nowMs: number): number => {
  const d = x.en.getTime() - x.s.getTime();
  return d > 0 ? Math.max(0, Math.min(1, (nowMs - x.s.getTime()) / d)) : 0;
};

const minsUntil = (ms: number, nowMs: number): number => Math.max(1, Math.ceil((ms - nowMs) / MIN));

/**
 * Fit rows under `lead` (already placed, `leadH` tall) into `avail` points.
 * When some rows do not fit the "+ n more" line needs room too, so rows are
 * given up until it does.
 */
export function fitRows(
  lead: Item[],
  leadH: number,
  rows: RowModel[],
  avail: number,
  fit: Fit,
  moreLabel: (n: number) => string,
): { items: Item[]; more: string | null } {
  const items = [...lead];
  let used = leadH;
  let shown = 0;
  while (shown < rows.length && used + fit.row <= avail) {
    items.push({ kind: 'row', row: rows[shown] });
    used += fit.row;
    shown++;
  }
  let more: string | null = null;
  if (shown < rows.length) {
    while (shown > 0 && used + fit.more > avail) {
      items.pop();
      used -= fit.row;
      shown--;
    }
    more = moreLabel(rows.length - shown);
  }
  return { items, more };
}

const signedOutModel = (layout: Layout): WidgetModel => ({
  layout,
  state: 'signedOut',
  url: signinUrl(),
  header: { title: '', month: '', sub: '', stale: false, showPlus: false, dot: false },
  level: 'fresh',
  goalsDim: false,
  strip: null,
  banner: null,
  empty: null,
  items: [],
  more: null,
  goals: [],
  goalPages: null,
  small: null,
  xl: null,
  pager: null,
  compose: null,
  accent: WIDGET_ACCENT,
  clock: '12h',
});

const DAY_NAMES = ['Yesterday', 'Today', 'Tomorrow'] as const;

/**
 * Build the model for `layout` at `nowMs`. `snapshot` null means signed out.
 * `ops` are queued checks, drawn on top of the snapshot. `carousel` is the
 * stored tap state of the iPhone Large and Medium pagers (expired taps read as home).
 */
export function buildModel(
  snapshot: WidgetSnapshot | null,
  nowMs: number,
  layout: Layout,
  opts: { platform?: Platform; ops?: readonly DoneOp[]; carousel?: CarouselState | null } = {},
): WidgetModel {
  if (!snapshot) return signedOutModel(layout);
  const now = new Date(nowMs);
  const lim = limits(layout, opts.platform ?? 'ios');
  const paged = lim.fit !== null;
  const snap = opts.ops?.length ? applyOps(snapshot, opts.ops) : snapshot;
  const clock = snap.prefs.clock;
  const hide = !!snap.prefs.hidePrivate;
  const car = resolveCarousel(opts.carousel, nowMs);
  // The pager only exists on Large; Medium is always today.
  const viewDay: DayOffset = layout === 'large' && paged ? car.day : 0;

  const dayAt = (n: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
  const today = dayAt(0);
  const tomorrow = dayAt(1);
  const dayAfter = dayAt(2);
  const todayKey = dayKey(today);
  const nowLabel = fmtNow(now.getHours() * 60 + now.getMinutes(), clock);
  const row = (x: Timed): RowModel => rowOf(x, clock, hide, !paged);

  const all = timed(snap.events);
  // A day's events: anything overlapping it (a session that started last night and runs on counts).
  const eventsOn = (d: Date): Timed[] => {
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    return all.filter((x) => x.s.getTime() < end && x.en.getTime() > d.getTime());
  };
  const todays = eventsOn(today);
  const left = todays.filter((x) => x.en.getTime() > nowMs);
  const running = left.find((x) => x.s.getTime() <= nowMs && !x.e.done);
  const upcoming = left.filter((x) => x !== running);
  const past = todays.filter((x) => x.en.getTime() <= nowMs);
  const lastPast = past.length ? past[past.length - 1] : null;
  const isEmpty = todays.length === 0;

  const age = Math.max(0, nowMs - Date.parse(snap.writtenAt));
  const level = staleLevel(age);
  const goalsDim = level === 'old' || snap.day !== todayKey;

  let sub = isEmpty ? 'Free day' : `Now ${nowLabel}`;
  if (level !== 'fresh') sub = staleLabel(age);

  // Rows.
  let items: Item[] = [];
  let more: string | null = null;
  let pager: PagerModel | null = null;
  let viewDate = today;
  let viewEmpty = isEmpty;

  if (paged && lim.fit) {
    // iPhone Large (the pager) and Medium (today only): fitted by height.
    const fit = lim.fit;

    const summaryOf = (offset: DayOffset, evs: Timed[]): string | null => {
      if (offset < 0) {
        // Goal sessions are the events that can be done (they had the check buttons).
        const sessions = evs.filter((x) => x.e.check);
        return sessions.length ? doneOfLabel(sessions.filter((x) => x.e.done).length, sessions.length) : null;
      }
      if (offset > 0) {
        const mins = evs.reduce((a, x) => a + (x.en.getTime() - x.s.getTime()) / MIN, 0);
        return evs.length ? plannedLabel(mins) : null;
      }
      return null;
    };
    const eventsAt = (offset: DayOffset): Timed[] => (offset === 0 ? todays : eventsOn(dayAt(offset)));

    // Today's list: the running card, or the finished session and the now line, then what is next.
    const todayList = (avail: number): { items: Item[]; more: string | null } => {
      const lead: Item[] = [];
      let leadH = 0;
      if (running) {
        lead.push({ kind: 'card', row: row(running), progress: progressOf(running, nowMs), endsIn: endsInLabel(minsUntil(running.en.getTime(), nowMs)) });
        leadH = fit.card;
      } else {
        if (lastPast) {
          lead.push({ kind: 'row', row: row(lastPast) });
          leadH += fit.row;
        }
        lead.push({ kind: 'now', time: nowLabel });
        leadH += fit.now;
      }
      return fitRows(lead, leadH, upcoming.map(row), avail, fit, (n) => `+ ${n} more today`);
    };

    if (layout === 'large') {
      const peekOf = (offset: DayOffset): PeekModel => {
        const evs = eventsAt(offset);
        const first = offset === 0 ? running ?? upcoming[0] : evs[0];
        return {
          offset,
          label: `${DAY_NAMES[offset + 1]} · ${dayShort(dayAt(offset))}`,
          summary: summaryOf(offset, evs),
          row: first ? row(first) : null,
          empty: evs.length === 0,
        };
      };
      const before: PeekModel | null = viewDay === 0 ? peekOf(-1) : viewDay === 1 ? peekOf(0) : null;
      const after: PeekModel | null = viewDay === 0 ? peekOf(1) : viewDay === -1 ? peekOf(0) : null;
      const avail = fit.avail - fit.peek * ((before ? 1 : 0) + (after ? 1 : 0));
      viewDate = dayAt(viewDay);
      const evs = eventsAt(viewDay);
      viewEmpty = evs.length === 0;
      if (viewDay === 0) {
        if (!isEmpty) ({ items, more } = todayList(avail));
      } else {
        ({ items, more } = fitRows([], 0, evs.map(row), avail, fit, (n) => `+ ${n} more`));
      }
      pager = {
        day: viewDay,
        heading: DAY_NAMES[viewDay + 1],
        summary: summaryOf(viewDay, evs),
        before,
        after,
        dots: [-1, 0, 1],
      };
    } else if (!isEmpty) {
      ({ items, more } = todayList(fit.avail));
    }
  } else if ((layout === 'medium' || layout === 'large') && !isEmpty) {
    // Android: a fixed number of rows.
    const cap = lim.rows;
    let used = 0;
    if (running) {
      items.push({ kind: 'card', row: row(running), progress: progressOf(running, nowMs), endsIn: endsInLabel(minsUntil(running.en.getTime(), nowMs)) });
      // The card is taller than a row: on Large it costs two rows (WG 1b shows the card and three more).
      used += layout === 'large' ? 2 : 1;
    } else if (layout === 'large') {
      if (lastPast) {
        items.push({ kind: 'row', row: row(lastPast) });
        used++;
      }
      items.push({ kind: 'now', time: nowLabel });
    }
    let shown = 0;
    for (const x of upcoming) {
      if (used >= cap) break;
      items.push({ kind: 'row', row: row(x) });
      used++;
      shown++;
    }
    if (layout === 'large' && upcoming.length > shown) more = `+ ${upcoming.length - shown} more today`;
  }

  // Goals still active today.
  const active = snap.goals.filter((g) => goalSpanAt(g, today).active);
  const goalOf = (g: (typeof active)[number]): GoalModel => ({
    id: g.id,
    title: g.title,
    hue: g.hue,
    ring: goalsDim ? 0 : ringOf(g.todayNeed, g.todayDone),
    today: goalsDim ? '' : leftTodayLabel(g.todayNeed, g.todayDone),
    left: goalsDim ? '' : ringLeftLabel(g.todayNeed, g.todayDone),
    isDone: !goalsDim && doneToday(g.todayNeed, g.todayDone),
    total: totalLeftLabel(g),
    deadline: lim.deadline ? deadlineLabel(g, today) : null,
    url: goalUrl(g.id),
  });
  let goals: GoalModel[];
  let goalPages: WidgetModel['goalPages'] = null;
  if (lim.perPage > 0) {
    // All active goals, in pages: Large two at a time, Medium one.
    const count = Math.max(1, Math.ceil(active.length / lim.perPage));
    const index = Math.min(layout === 'large' ? car.large : car.medium, count - 1);
    goals = active.slice(index * lim.perPage, (index + 1) * lim.perPage).map(goalOf);
    if (active.length) goalPages = { index, count };
  } else {
    goals = active.slice(0, lim.goals).map(goalOf);
  }

  // Empty day (the one in view): today's next event as a line of text.
  let empty: WidgetModel['empty'] = null;
  if (viewEmpty) {
    const next = viewDay === 0 ? all.find((x) => x.s.getTime() > nowMs && !x.e.done) : undefined;
    empty = { next: next ? `Next: ${nextWhenLabel(next.s, clock)} · ${row(next).title}` : null };
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
        title: row(running).title,
        range: fmtRange(running.s, running.en, clock),
        hue: running.e.hue,
      };
    } else if (next) {
      small = {
        kind: 'next',
        when: dayKey(next.s) === todayKey ? inLabel(minsUntil(next.s.getTime(), nowMs)) : nextWhenLabel(next.s, clock),
        title: row(next).title,
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
        label: 'Today',
        nowTime: running ? null : nowLabel,
        rows: todayRows.map(row),
        planned: null,
      },
      tomorrow: {
        label: `Tomorrow · ${dayLabel(tomorrow).split(' ').slice(0, 2).join(' ')}`,
        nowTime: null,
        rows: tom.slice(0, lim.rows).map(row),
        planned: tom.length ? `${fmtDur(Math.round(planned))} planned` : null,
      },
    };
  }

  return {
    layout,
    state: 'content',
    url: layout === 'small' && isEmpty ? composeUrl() : dayUrl(dayKey(viewDate)),
    header: {
      title: paged ? dayShort(viewDate) : dayLabel(today),
      month: monthName(viewDate),
      sub,
      stale: level !== 'fresh',
      showPlus: !paged && !isEmpty && layout !== 'small',
      dot: !isEmpty && level === 'fresh',
    },
    level,
    goalsDim,
    strip: level === 'old' && layout !== 'small' && !paged ? 'Open Calendar to refresh' : null,
    banner: level !== 'fresh' && layout !== 'small' && !paged ? `Can’t refresh. Showing ${ageShort(age)} old data.` : null,
    empty,
    items,
    more,
    goals,
    goalPages,
    small,
    xl,
    pager,
    compose: paged ? { placeholder: level === 'old' ? 'Open Calendar to refresh' : COMPOSE_PLACEHOLDER, url: composeUrl() } : null,
    accent: snap.prefs.accent || WIDGET_ACCENT,
    clock,
  };
}
