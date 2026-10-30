/**
 * Prompt context blocks the app (and the `ai-schedule` edge function) send to
 * the skills: `<calendar>`, `<goal>` and `<checkin>`. The text is part of the
 * contract with skills/*, so it is reproduced exactly.
 */
import { addDays, DOWL, hm, hrs, key, MONL } from './time.ts';
import type { CalendarData, ProtoEvent } from './model.ts';
import { goalPace, goalStats, weeklyLoad } from './goals.ts';
import type { NowCtx } from './goals.ts';
import { ciHistory, pendingEvents, winCands } from './checkin.ts';
import { goalOf } from './goals.ts';
import { NOASK } from './ops.ts';

/** How the goal-adjust skill is invoked: the button tapped. */
export type AdjustMode = 'reduce' | 'stretch' | 'scope';

/** `<calendar>` block: today, the time, categories, nearby events (day -7..+21, max 90) and goals. */
export const calBlock = (data: CalendarData, ctx: NowCtx): string => {
  const d = ctx.today;
  const today = DOWL[d.getDay()] + ', ' + MONL[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  const lo = key(addDays(d, -7)), hi = key(addDays(d, 21));
  const rows = data.events
    .filter((e) => e.day >= lo && e.day <= hi)
    .sort((a, b) => (a.day === b.day ? a.start - b.start : a.day < b.day ? -1 : 1))
    .slice(0, 90)
    .map((e) => '  ' + e.id + ' | ' + e.day + ' | ' + (e.allDay ? 'all-day, ' + (e.days || 1) + ((e.days || 0) > 1 ? ' days' : ' day') : hm(e.start) + '-' + hm(e.end)) + ' | ' + e.cat + ' | ' + e.title);
  const gRows = (data.goals || []).map((g) => {
    const gs = goalStats(g, data.events, ctx), R = gs.rate;
    return '  ' + g.id + ' | ' + g.title + ' | outcome: ' + (g.outcome || '(not set)') + ' | deadline ' + (g.deadline || '?') + ' (' + gs.daysLeft + ' days left) | ' + hrs(R.target) + 'h estimate = ' + R.label
      + ' | done ' + hrs(gs.done) + 'h, booked (not yet marked done) ' + hrs(gs.booked) + 'h | ' + goalPace(g, gs) + ' | category "' + g.cat + '"';
  }).concat(['  total pace across active goals: ' + hrs(weeklyLoad(data.goals, data.events, ctx)) + 'h a week']);
  return [
    '<calendar>',
    'Today is ' + today + '. The current time is ' + hm(ctx.nowMin) + ' (' + ctx.nowMin + ' minutes past midnight).',
    'Existing categories: ' + Object.keys(data.cats).join(', '),
    'Events already on the calendar:',
    rows.length ? rows.join('\n') : '  (none)',
    'Goals already set:',
    gRows.length ? gRows.join('\n') : '  (none)',
    '</calendar>',
  ].join('\n');
};

/** `<goal mode="…">` block for the goal-adjust skill. */
export const goalBlock = (goalId: string, mode: AdjustMode | undefined, data: CalendarData, ctx: NowCtx): string | null => {
  const g = data.goals.find((x) => x.id === goalId);
  if (!g) return null;
  const s = goalStats(g, data.events, ctx), R = s.rate;
  return '<goal mode="' + (mode || 'scope') + '">\n' + [
    'id ' + g.id + ' | ' + g.title + ' | outcome: ' + (g.outcome || '(not set)'),
    'deadline ' + (g.deadline || '?') + ' (' + s.daysLeft + ' of ' + s.total + ' days left)',
    'total ' + hrs(R.target) + 'h | fixed pace ' + R.label,
    'done ' + hrs(s.done) + 'h | booked ahead, not yet done ' + hrs(s.booked) + 'h | still to do ' + hrs(s.remain) + 'h',
    'expected by now ' + hrs(s.expected) + 'h | ' + (s.delta >= 0 ? hrs(s.delta) + 'h ahead' : hrs(-s.delta) + 'h behind'),
  ].join('\n') + '\n</goal>';
};

/** The user text the app sends when the Reduce scope / Add stretch goal button is tapped. */
export const adjustNote = (title: string, mode: 'reduce' | 'stretch'): string =>
  mode === 'reduce'
    ? 'I’m behind on ' + title + '. Help me reduce the scope. Ask me what should give way.'
    : 'I’m on track with ' + title + '. Help me add a stretch. Ask me what to push.';

/** Which button a goal offers: reduce when behind, otherwise stretch; none without hours or outside its span. */
export const adjustModeFor = (delta: number, target: number, active: boolean): 'reduce' | 'stretch' | null =>
  !target || !active ? null : delta < -0.1 ? 'reduce' : 'stretch';

/**
 * The full user message for the scheduler (or goal-adjust when `goalId` is
 * given): `<calendar>`, optional `<goal>`, then `<note>`.
 */
export const schedulerInput = (
  data: CalendarData, ctx: NowCtx, note: string, o: { noAsk?: boolean; goalId?: string | null; mode?: AdjustMode } = {},
): string => {
  const gb = o.goalId ? goalBlock(o.goalId, o.mode, data, ctx) : null;
  return calBlock(data, ctx) + (gb ? '\n\n' + gb : '') + '\n\n<note>\n' + note + (o.noAsk ? NOASK : '') + '\n</note>';
};

/** `<checkin>` block for the check-in skill. */
export const ciPrompt = (data: CalendarData, ctx: NowCtx & { nowMs: number }, lastSeen: number | null | undefined): string => {
  const d = ctx.today, tk = key(d);
  const today = data.events.filter((e) => e.day === tk).sort((a, b) => a.start - b.start)
    .map((e) => '  ' + (e.allDay ? 'all-day' : hm(e.start) + '-' + hm(e.end)) + ' | ' + e.title + ' (' + e.cat + ')');
  const hist = ciHistory(data.events, d);
  const wc = winCands(data.events, data.goals, d, ctx.nowMs), wIds = wc.map((e) => e.id);
  const pend = pendingEvents(data.events, ctx.nowMs, lastSeen).filter((e) => wIds.indexOf(e.id) < 0).map((e) => '  ' + hm(e.start) + ' | ' + e.title);
  const wl = wc.map((e: ProtoEvent) => {
    const g = goalOf(e, data.goals)!;
    return '  ' + e.id + ' | ' + (e.day === tk ? 'today' : e.day) + ' ' + hm(e.start) + '-' + hm(e.end) + ' | ' + e.title + ' | goal: ' + g.title + (g.outcome ? ' (' + g.outcome + ')' : '');
  });
  return [
    '<checkin>',
    'Today is ' + DOWL[d.getDay()] + ', ' + MONL[d.getMonth()] + ' ' + d.getDate() + '. The time is now ' + hm(ctx.nowMin) + '.',
    'Goals and where they stand:',
    (data.goals || []).length
      ? (data.goals || []).map((g) => {
        const s = goalStats(g, data.events, ctx);
        return '  ' + g.id + ' | ' + g.title + ' | ' + hrs(s.done) + ' of ' + hrs(s.target) + 'h by ' + (g.deadline || '?') + ' (needs ' + s.rate.label + ') | ' + goalPace(g, s) + ' | ' + s.daysLeft + ' days left';
      }).join('\n')
      : '  (none)',
    '',
    'Already on today:',
    today.length ? today.join('\n') : '  (nothing yet)',
    '',
    'The last seven days:',
    hist.length ? hist.join('\n') : '  (no history)',
    '',
    'Goal sessions that ended with no win logged (id | when | title | goal) — one win question each:',
    wl.length ? wl.join('\n') : '  (none)',
    '',
    'Already being confirmed separately (scheduled, now passed, awaiting a yes/no) — never ask about these:',
    pend.length ? pend.join('\n') : '  (none)',
    '',
    '</checkin>',
  ].join('\n');
};

