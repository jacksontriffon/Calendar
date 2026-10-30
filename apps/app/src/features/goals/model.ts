/** Pure helpers for goal detail: the editable draft, date field validation and the stats lines. */
import {
  addDays, createGoal, goalPace, goalRate, hrs, key, niceDate, patchGoal, toGoLabel,
  type CalendarData, type GoalStats, type ProtoGoal,
} from '@calendar/core';

export interface GoalDraft {
  title: string;
  outcome: string;
  /** typed hours (kept as text while editing) */
  hours: string;
  deadline: string;
  hue: number;
}

export const draftOf = (g: ProtoGoal): GoalDraft => ({
  title: g.title, outcome: g.outcome || '', hours: String(g.hours || 0), deadline: g.deadline || '', hue: g.hue,
});

/** `d`, `m`, `y` text fields to a `YYYY-MM-DD` deadline, only when it's a real date after `today`. */
export function parseDeadline(d: string, m: string, y: string, today: Date): string | null {
  const dd = +d, mm = +m, yy = +y;
  if (!(yy > 1999) || !(mm >= 1 && mm <= 12) || !(dd >= 1 && dd <= 31)) return null;
  const dt = new Date(yy, mm - 1, dd);
  if (dt.getFullYear() !== yy || dt.getMonth() !== mm - 1 || dt.getDate() !== dd) return null;
  return dt.getTime() > today.getTime() ? key(dt) : null;
}

export const splitDeadline = (k: string): { d: string; m: string; y: string } => {
  const p = (k || key(addDays(new Date(), 7))).split('-');
  return { y: p[0], m: p[1], d: p[2] };
};

/** What changed between the stored goal and the draft, as a goal patch (empty when nothing did). */
export function draftPatch(g: ProtoGoal, d: GoalDraft): Partial<Pick<ProtoGoal, 'title' | 'outcome' | 'hours' | 'deadline' | 'hue'>> {
  const out: Partial<Pick<ProtoGoal, 'title' | 'outcome' | 'hours' | 'deadline' | 'hue'>> = {};
  if (d.title.trim() && d.title !== g.title) out.title = d.title;
  if (d.outcome !== (g.outcome || '')) out.outcome = d.outcome;
  const h = d.hours === '' ? NaN : +d.hours;
  if (isFinite(h) && h !== g.hours) out.hours = Math.max(0, h);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d.deadline) && d.deadline !== g.deadline) out.deadline = d.deadline;
  if (d.hue !== g.hue) out.hue = d.hue;
  return out;
}

export function applyGoalDraft(data: CalendarData, g: ProtoGoal, d: GoalDraft): CalendarData {
  const p = draftPatch(g, d);
  return Object.keys(p).length ? patchGoal(data, g.id, p) : data;
}

export interface GoalLines {
  rate: string;
  daysLeft: string;
  done: string;
  donePct: string;
  pace: string;
  expected: string;
  plan: string;
  left: string;
  due: string;
}

/** The detail screen's text lines (the prototype's `gd` object). */
export function goalLines(g: ProtoGoal, s: GoalStats, today: Date): GoalLines {
  const R = goalRate(g, today);
  const ended = !s.active && today.getTime() >= s.s1.getTime();
  return {
    rate: R.target ? R.label : 'No hours set',
    daysLeft: ended ? 'Ended' : s.daysLeft + (s.daysLeft === 1 ? ' day left' : ' days left'),
    done: hrs(s.done) + 'h',
    donePct: R.target ? Math.round(s.pct * 100) + '% of target' : '—',
    pace: goalPace(g, s),
    expected: R.target
      ? s.active
        ? s.done - s.expected > Math.max(0.5, s.expected * 0.1) ? 'Ahead of goal pace'
          : s.done - s.expected >= -1 / 60 ? 'Keeping goal pace' : hrs(s.expected) + 'h expected by now'
        : 'Ended ' + niceDate(g.deadline)
      : '',
    plan: R.target ? R.label : 'Set target hours',
    left: toGoLabel(s),
    due: g.deadline ? 'by ' + niceDate(g.deadline) : 'Set a date',
  };
}

/** Create a goal in the store (title "New goal", a sensible deadline) and return its id. */
export function newGoalIn(data: CalendarData, nowMs: number, today: Date): { data: CalendarData; id: string } {
  const r = createGoal(data, { title: uniqueTitle(data, 'New goal'), hours: 10 }, {
    today, cats: data.cats, goalCount: data.goals.length, nowMs, random: Math.random,
  });
  return { data: r.data, id: r.goal.id };
}

const uniqueTitle = (d: CalendarData, base: string): string => {
  let t = base;
  let n = 2;
  while (d.goals.some((g) => g.title === t) || d.cats[t] != null) t = base + ' ' + n++;
  return t;
};

