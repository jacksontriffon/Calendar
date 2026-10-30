/**
 * "Did it happen?" confirmation, goal-session wins and the open-space check-in.
 * Pure versions of the prototype's check-in methods: every function takes the
 * data, the clock and the "last seen" stamp explicitly.
 */
import { addDays, cap, clamp, DOW, dnum, hm, hrs, key, snap } from './time.ts';
import type { CalendarData, ProtoEvent, ProtoGoal } from './model.ts';
import { behindGoals, freeSlot, goalById, goalOf } from './goals.ts';
import type { NowCtx } from './goals.ts';

/** Hours away before a check-in is offered. */
export const CI_GAP_H = 5;
/** Minute of day (18:00) after which one end-of-day check-in is offered when wins are waiting. */
export const EOD_MIN = 1080;

export type CheckInField = 'goal' | 'win' | 'log' | 'confirm';

export interface CheckInQuestion {
  field: CheckInField;
  /** goal id (goal), event id (win, confirm) */
  id?: string | null;
  q: string;
  chips: string[];
}

/** End of an event as epoch ms (all-day events end at the end of their first day, as in the prototype). */
export const evEndMs = (ev: Pick<ProtoEvent, 'day' | 'allDay' | 'end'>): number =>
  dnum(ev.day).getTime() + (ev.allDay ? 1440 : ev.end) * 60000;

/** Window start: the last session, but always at least the last 12 hours. */
export const sinceMs = (lastSeen: number | null | undefined, nowMs: number): number => {
  const floor = nowMs - 12 * 3600000;
  return Math.min(lastSeen || floor, floor);
};

/** Ended since the user last looked and still unconfirmed. Events logged after the fact are never pending. */
export const isPending = (ev: ProtoEvent | null | undefined, nowMs: number, lastSeen: number | null | undefined): boolean => {
  if (!ev || ev.done || ev.allDay) return false;
  const end = evEndMs(ev);
  if (ev.at && ev.at >= end) return false;
  return end <= nowMs && end > sinceMs(lastSeen, nowMs);
};

export const pendingEvents = (events: ReadonlyArray<ProtoEvent>, nowMs: number, lastSeen: number | null | undefined): ProtoEvent[] =>
  events.filter((e) => isPending(e, nowMs, lastSeen)).sort((a, b) => evEndMs(a) - evEndMs(b));

/**
 * Goal sessions from today or yesterday that ended in the last 30 hours and
 * still need a win (latest three). Note: the prototype currently short-circuits
 * this to an empty list; this is the logic it was written with.
 */
export const winCands = (
  events: ReadonlyArray<ProtoEvent>, goals: ReadonlyArray<ProtoGoal>, today: Date, nowMs: number,
): ProtoEvent[] => {
  const tk = key(today), yk = key(addDays(today, -1));
  return events
    .filter((e) => (e.day === tk || e.day === yk) && !e.allDay && !e.win && !e.winAsked
      && evEndMs(e) <= nowMs && evEndMs(e) > nowMs - 30 * 3600000 && goalOf(e, goals))
    .sort((a, b) => evEndMs(a) - evEndMs(b))
    .slice(-3);
};

/** "at 14:00" / "yesterday at 14:00" / "on Tue 3 at 14:00". */
export const winWhen = (e: ProtoEvent, today: Date): string => {
  const tk = key(today), yk = key(addDays(today, -1)), d = dnum(e.day);
  return (e.day === tk ? '' : e.day === yk ? 'yesterday ' : 'on ' + DOW[d.getDay()] + ' ' + d.getDate() + ' ') + 'at ' + hm(e.start);
};

/** The "What came out of …?" question for a session. */
export const winQ = (e: ProtoEvent, today: Date, pending: boolean): CheckInQuestion => ({
  field: 'win', id: e.id,
  q: 'What came out of ' + e.title + ' ' + winWhen(e, today) + '?',
  chips: pending ? ['Nothing notable', 'Didn’t happen'] : ['Nothing notable'],
});

/** Whether a check-in should open: after a gap of CI_GAP_H hours, or once each evening while wins wait. */
export const shouldCheckIn = (o: {
  enabled: boolean; eodOnly?: boolean; nowMs: number; nowMin: number; today: Date;
  /** epoch ms of the last check-in */
  lastCheckIn: number;
  /** day key a win check-in last ran, or '' */
  lastWinDay: string;
  winCount: number;
}): boolean => {
  if (!o.enabled) return false;
  const eod = o.nowMin >= EOD_MIN && o.lastWinDay !== key(o.today) && o.winCount > 0;
  if (!eod && (o.eodOnly || o.nowMs - o.lastCheckIn < CI_GAP_H * 3600000)) return false;
  return true;
};

/** The last seven days of events, one line per day, for the check-in prompt. */
export const ciHistory = (events: ReadonlyArray<ProtoEvent>, today: Date): string[] => {
  const out: string[] = [];
  for (let i = 7; i >= 1; i--) {
    const dk = key(addDays(today, -i));
    const evs = events.filter((e) => e.day === dk).sort((a, b) => a.start - b.start);
    if (evs.length) out.push('  ' + dk + ' | ' + evs.map((e) => (e.allDay ? 'all-day ' : hm(e.start) + ' ') + e.title + ' (' + e.cat + ')').join('; '));
  }
  return out;
};

/** Offline fallback questions: read the same signals locally (behind goal, habits, lunch, morning). */
export const ciLocalQs = (data: CalendarData, ctx: NowCtx): CheckInQuestion[] => {
  const { today, nowMin: now } = ctx;
  const tk = key(today);
  const todays = data.events.filter((e) => e.day === tk);
  const done = todays.map((e) => String(e.title).trim().toLowerCase());
  const qs: CheckInQuestion[] = [];
  const behind = behindGoals(data.goals, data.events, ctx)[0];
  if (behind) {
    const need = Math.max(0.5, Math.round(behind.s.perDay * 2) / 2);
    qs.push({
      field: 'goal', id: behind.g.id,
      q: behind.g.title + ' is ' + hrs(-behind.s.delta) + 'h behind — how much can you put in today?',
      chips: [hrs(need) + 'h', hrs(need + 1) + 'h', 'Not today'],
    });
  }
  const hist: Record<string, { n: number; t: number; title: string }> = Object.create(null);
  for (let i = 1; i <= 7; i++) {
    const dk = key(addDays(today, -i));
    data.events.filter((e) => e.day === dk && !e.allDay).forEach((e) => {
      const k2 = String(e.title).trim().toLowerCase();
      if (!hist[k2]) hist[k2] = { n: 0, t: 0, title: e.title };
      hist[k2].n++; hist[k2].t += e.start;
    });
  }
  Object.keys(hist).map((k2) => hist[k2]).filter((h) => h.n >= 3 && done.indexOf(String(h.title).trim().toLowerCase()) < 0)
    .sort((a, b) => b.n - a.n).forEach((h) => {
      const avg = snap(Math.round(h.t / h.n));
      if (avg > now) return;
      qs.push({ field: 'log', q: h.title + ' — did that happen today?', chips: [hm(avg), 'Not today'] });
    });
  if (now >= 810 && !todays.some((e) => e.cat === 'Food' || /lunch|eat/i.test(e.title))) qs.push({ field: 'log', q: 'What did you have for lunch, and when?', chips: ['Skipped it'] });
  if (now >= 660 && !todays.some((e) => !e.allDay && e.start < 720)) qs.push({ field: 'log', q: 'What did the morning go to?', chips: [] });
  return qs.slice(0, 4);
};

/** Yes/no confirmation questions for the (up to two) most recent pending events. */
export const ciConfirmQs = (pending: ReadonlyArray<ProtoEvent>): CheckInQuestion[] =>
  pending.slice(0, 2).map((e) => ({
    field: 'confirm' as const, id: e.id,
    q: e.title + (e.allDay ? '' : ' at ' + hm(e.start)) + ' — did that happen?',
    chips: ['Yes', 'It did, but later', 'Didn’t happen'],
  }));

/** Normalise the model's check-in array: field names, ids, chips (max 3), at most five questions. Empty `q` dropped. */
export const normCheckIn = (arr: ReadonlyArray<Record<string, unknown>>): CheckInQuestion[] =>
  arr.map((r) => ({
    field: (/win/i.test(String(r.field || '')) && r.id ? 'win' : /goal|intent/i.test(String(r.field || '')) && r.id ? 'goal' : 'log') as CheckInField,
    id: r.id ? String(r.id) : null,
    q: String(r.q || r.question || '').trim(),
    chips: ((r.chips || r.options || []) as unknown[])
      .map((c) => String((c && (c as { label?: unknown }).label) || c || '').trim()).filter(Boolean).slice(0, 3),
  })).filter((q) => q.q).slice(0, 5);

/**
 * Merge model (or local) questions with the code-driven ones, in order: goal,
 * win (one per candidate, model wording and guesses where given), confirm, log.
 * Capped at five when there are win questions, else four.
 */
export const assembleCheckIn = (
  qs: ReadonlyArray<CheckInQuestion>, o: { events: ReadonlyArray<ProtoEvent>; goals: ReadonlyArray<ProtoGoal>; today: Date; nowMs: number; lastSeen: number | null | undefined },
): CheckInQuestion[] => {
  const wc = winCands(o.events, o.goals, o.today, o.nowMs), wIds = wc.map((e) => e.id);
  const wq = wc.map((e) => {
    const ai = qs.find((q) => q.field === 'win' && q.id === e.id), base = winQ(e, o.today, isPending(e, o.nowMs, o.lastSeen));
    if (!ai) return base;
    return Object.assign({}, base, { q: ai.q || base.q, chips: ai.chips.filter((c) => !/nothing|didn.t happen/i.test(c)).slice(0, 2).concat(base.chips) });
  });
  const conf = ciConfirmQs(pendingEvents(o.events, o.nowMs, o.lastSeen)).filter((q) => wIds.indexOf(q.id as string) < 0);
  return qs.filter((q) => q.field === 'goal')
    .concat(wq, conf, qs.filter((q) => q.field === 'log'))
    .slice(0, wq.length ? 5 : 4);
};

export interface CheckInResult {
  /** data after the confirmed/removed/won events and the goal blocks are applied */
  data: CalendarData;
  /** whether `data` differs from the input (a history entry should be logged) */
  changed: boolean;
  /** "Check-in · 1h on Deep work · 2 wins logged" for the toast/history, or null */
  label: string | null;
  /** ids of the new goal-time blocks */
  newIds: string[];
  /** free-text answers as "- question → answer" lines to feed back to the scheduler */
  lines: string[];
  /** the answers alone (the offline parser takes these) */
  plain: string[];
  /** what to send the scheduler when `lines` is not empty */
  followUp: string | null;
}

export const CI_FOLLOWUP = 'These things already happened today. Add them to today at the times given, estimating sensibly where a time is vague:\n';

/**
 * Apply the answers to a check-in. Per question type: `win` confirms the
 * session and logs the answer as its win ("nothing notable" confirms with no
 * win; "didn't happen" removes the event); `confirm` marks done or removes;
 * `goal` books that many hours (15 min to 10 h) in today's first free slot in
 * the goal's category; `log` answers that are not a "no" are returned in
 * `lines`/`plain` for the scheduler or offline parser to turn into events.
 */
export const applyCheckIn = (
  data: CalendarData, qs: ReadonlyArray<CheckInQuestion>, ans: ReadonlyArray<string | undefined>,
  ctx: NowCtx & { nowMs: number; nextId: () => string },
): CheckInResult => {
  const goals: Array<{ id: string; mins: number }> = [], lines: string[] = [], plain: string[] = [];
  const confirms: string[] = [], drops: string[] = [], asked: string[] = [];
  const wins: Record<string, string> = Object.create(null);
  qs.forEach((q, i) => {
    if (q.field === 'win') asked.push(q.id as string);
    const a = String(ans[i] || '').trim();
    if (!a) return;
    if (q.field === 'win') {
      if (/^(didn.t happen|did not happen|it didn.t happen|cancell?ed)$/i.test(a)) drops.push(q.id as string);
      else {
        confirms.push(q.id as string);
        if (!/^(nothing( notable| much)?|not much|no|nope|none|skip|skipped)$/i.test(a)) wins[q.id as string] = a;
      }
    } else if (q.field === 'confirm') {
      if (/^(no|nope|didn.t happen|did not happen|not today|skipped|skipped it|cancell?ed)$/i.test(a)) drops.push(q.id as string);
      else {
        confirms.push(q.id as string);
        if (!/^(yes|yep|yeah|yup|done|did it|happened|confirmed)$/i.test(a)) lines.push('- ' + q.q + ' → ' + a);
      }
    } else if (q.field === 'goal') {
      const h = parseFloat(String(a).replace(/[^\d.]/g, ''));
      if (h > 0 && goalById(data.goals, q.id)) goals.push({ id: q.id as string, mins: clamp(Math.round(h * 60), 15, 600) });
    } else if (!/^(no|nope|not today|skipped it|skip|nothing)$/i.test(a)) {
      lines.push('- ' + q.q + ' → ' + a); plain.push(a);
    }
  });
  const nWins = Object.keys(wins).length, nConf = confirms.filter((id) => asked.indexOf(id) < 0).length;
  let out = data, label: string | null = null;
  const newIds: string[] = [];
  if (goals.length || confirms.length || drops.length || asked.length) {
    const dk = key(ctx.today);
    const blocks: ProtoEvent[] = goals.map((g) => {
      const gl = goalById(data.goals, g.id) as ProtoGoal;
      const start = freeSlot(data.events, dk, g.mins, ctx);
      return { id: ctx.nextId(), day: dk, cat: gl.cat, title: gl.title, start, end: start + g.mins, at: ctx.nowMs };
    });
    const evs = data.events.filter((e) => drops.indexOf(e.id) < 0).map((e) => {
      let n = confirms.indexOf(e.id) > -1 ? Object.assign({}, e, { done: true }) : e;
      if (asked.indexOf(e.id) > -1) n = Object.assign({}, n, { winAsked: true });
      if (wins[e.id]) n = Object.assign({}, n, { win: { text: cap(wins[e.id]), at: ctx.nowMs } });
      return n;
    });
    out = { events: evs.concat(blocks), cats: data.cats, goals: data.goals };
    blocks.forEach((b) => newIds.push(b.id));
    const bits: string[] = [];
    if (blocks.length) bits.push(blocks.map((b) => hrs((b.end - b.start) / 60) + 'h on ' + b.title).join(' · '));
    if (nWins) bits.push(nWins === 1 ? '1 win logged' : nWins + ' wins logged');
    if (nConf) bits.push(nConf + ' confirmed');
    if (drops.length) bits.push(drops.length + ' removed');
    if (bits.length) label = 'Check-in · ' + bits.join(' · ');
  }
  return { data: out, changed: out !== data, label, newIds, lines, plain, followUp: lines.length ? CI_FOLLOWUP + lines.join('\n') : null };
};
