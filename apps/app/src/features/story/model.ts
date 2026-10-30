/**
 * Weekly recap ("wins") view model, ported from the prototype's `winVals`:
 * the week's logged wins, which of them are "core" (the longest session per
 * goal unless starred), per-goal groups, and the story slides.
 */
import {
  DOW, DOWL, MON, addDays, clamp, dnum, dur, goalHours, goalOf, goalRate, key, weekKey, workedMins,
  type CalendarData, type ProtoEvent, type ProtoGoal,
} from '@calendar/core';

export interface WinItem {
  e: ProtoEvent;
  g: ProtoGoal | null;
  d: Date;
  text: string;
  /** worked hours */
  h: number;
  /** index of the day in the week (0 = Monday) */
  di: number;
  core: boolean;
  hue: number | null;
}

export interface WinGroup { name: string; hue: number | null; hours: number; pace: number; wins: WinItem[] }

export interface Recap {
  weekLabel: string;
  range: string;
  list: WinItem[];
  core: WinItem[];
  groups: WinGroup[];
  goalHours: number;
  totals: string;
}

export const nWins = (n: number): string => n + (n === 1 ? ' win' : ' wins');

/** The recap for the week `wk` weeks from this one (0 = this week, -1 = last week). */
export function buildRecap(data: CalendarData, today: Date, wk: number): Recap {
  const ws = addDays(dnum(weekKey(today)), wk * 7);
  const we = addDays(ws, 7);
  const we1 = addDays(ws, 6);
  const dks = Array.from({ length: 7 }, (_, i) => key(addDays(ws, i)));
  const list: WinItem[] = data.events
    .filter((e) => !e.allDay && e.win && String(e.win.text || '').trim() && dks.indexOf(e.day) > -1)
    .map((e) => {
      const g = goalOf(e, data.goals);
      return {
        e, g, d: dnum(e.day), text: String(e.win!.text).trim(), h: workedMins(e) / 60, di: dks.indexOf(e.day),
        core: false, hue: g ? g.hue : data.cats[e.cat ?? ''] ?? null,
      };
    })
    .sort((a, b) => a.di - b.di || a.e.start - b.e.start);
  /* core by default: the longest session's win for each goal; a star overrides */
  const top: Record<string, WinItem> = {};
  list.forEach((w) => {
    if (!w.g) return;
    const t = top[w.g.id];
    if (!t || w.h > t.h + 0.01 || (Math.abs(w.h - t.h) <= 0.01 && w.di >= t.di)) top[w.g.id] = w;
  });
  list.forEach((w) => {
    const c = (w.e.win as { core?: boolean | string }).core;
    w.core = c === true || (c !== false && !!w.g && top[w.g.id] === w);
  });
  const core = list.filter((w) => w.core).sort((a, b) => b.h - a.h);
  const gl = data.goals
    .map((g) => ({
      g, h: goalHours(g, ws, we, data.events, true), pace: goalRate(g, today).perWeek, wins: list.filter((w) => w.g && w.g.id === g.id),
    }))
    .filter((x) => x.wins.length || x.h > 0)
    .sort((a, b) => b.h - a.h);
  const goalH = gl.reduce((a, x) => a + x.h, 0);
  const groups: WinGroup[] = gl.map((x) => ({ name: x.g.title, hue: x.g.hue, hours: x.h, pace: x.pace, wins: x.wins }));
  const other = list.filter((w) => !w.g);
  if (other.length) groups.push({ name: 'Other', hue: null, hours: 0, pace: 0, wins: other });
  const weekLabel = wk === 0 ? 'This week' : wk === -1 ? 'Last week' : 'Week of ' + ws.getDate() + ' ' + MON[ws.getMonth()];
  const range = ws.getDate() + (ws.getMonth() !== we1.getMonth() ? ' ' + MON[ws.getMonth()] : '') + '–' + we1.getDate() + ' ' + MON[we1.getMonth()];
  return {
    weekLabel, range, list, core, groups, goalHours: goalH,
    totals: list.length ? nWins(list.length) + (goalH > 0 ? ' · ' + dur(goalH) + ' on goals' : '') : '',
  };
}

export type Slide =
  | { k: 'empty' }
  | { k: 'cover' }
  | { k: 'win'; w: WinItem; i: number; of: number }
  | { k: 'end' };

/** Story slides: a cover, one per core win (or the five longest), then the week in numbers. */
export function storySlides(r: Recap): Slide[] {
  if (!r.list.length) return [{ k: 'empty' }];
  const picks = r.core.length ? r.core : r.list.slice().sort((a, b) => b.h - a.h).slice(0, 5);
  return [{ k: 'cover' } as Slide].concat(picks.map((w, i) => ({ k: 'win', w, i, of: picks.length }) as Slide), [{ k: 'end' }]);
}

export interface SlideText { kicker: string; big: string; meta: string; hint: string }

export function slideText(r: Recap, s: Slide, wk: number): SlideText {
  const kick = r.weekLabel + ' · ' + r.range;
  if (s.k === 'cover') {
    return {
      kicker: kick, big: nWins(r.list.length), hint: 'Tap to go through them',
      meta: [r.core.length ? r.core.length + ' core' : '', r.goalHours > 0 ? dur(r.goalHours) + ' on goals' : ''].filter(Boolean).join(' · '),
    };
  }
  if (s.k === 'win') {
    const w = s.w;
    return {
      kicker: (r.core.length ? 'Core win ' : 'Win ') + (s.i + 1) + ' of ' + s.of + ' · ' + (w.g ? w.g.title : w.e.title),
      big: w.text, hint: '',
      meta: DOWL[w.d.getDay()] + ' · ' + dur(w.h) + (w.g && w.e.title !== w.g.title ? ' · ' + w.e.title : ''),
    };
  }
  if (s.k === 'end') return { kicker: 'The week', big: r.goalHours > 0 ? dur(r.goalHours) + ' on goals' : nWins(r.list.length), meta: '', hint: '' };
  return { kicker: kick, big: 'No wins yet', hint: '', meta: wk === 0 ? 'Wins you log in the evening check-in show up here.' : 'Nothing was logged that week.' };
}

/** Story headline size by length, as in the prototype. */
export const storyFontSize = (len: number): number => (len <= 22 ? 42 : len <= 48 ? 34 : len <= 90 ? 28 : 23);

export const dayLetter = (d: Date): string => DOW[d.getDay()].charAt(0);
export const clampIdx = (i: number, n: number): number => clamp(i, 0, Math.max(0, n - 1));
