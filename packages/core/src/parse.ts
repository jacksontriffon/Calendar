/**
 * Offline note parser: the prototype's "Offline parser" model. Splits a note
 * into segments, pulls out day words, times, ranges and durations, guesses a
 * category and lays the events out one after another.
 */
import { addDays, cap, clamp, key, snap } from './time.ts';
import { STOP, WORDT, builtinHue, catHue, defaultDur, matchCat, normCat, spareHue } from './categories.ts';
import type { CatMap } from './categories.ts';
import type { CalendarData, ProtoEvent } from './model.ts';
import type { OpsCtx, Resolved } from './ops.ts';

/**
 * Parse a free-text note into events (a {@link Resolved} with only `events`,
 * `cats` and `fresh` filled, so it applies with `applyResolved(..., 'local')`).
 * Segments split on newlines, commas, semicolons, "then", "after that", …;
 * "tomorrow"/"yesterday" shift the day; an event without a time follows the
 * previous one (the first starts at the next quarter hour, not before 08:00).
 */
export const parseNote = (text: string, data: Pick<CalendarData, 'cats'>, ctx: OpsCtx): Resolved => {
  const cats: CatMap = Object.assign({}, data.cats);
  const known = Object.keys(cats);
  const raw = text.split(/\n+|[,;·]|\bthen\b|\bafter that\b|\bafterwards\b|\bfollowed by\b|\bnext up\b/i);
  const out: ProtoEvent[] = [];
  const fresh: string[] = [];
  let cursor: number | null = null;
  raw.forEach((seg0) => {
    let seg = seg0.trim().replace(/^(and|also|plus|i|i'll|ill|then|after|next)\b\s*/i, '').trim();
    if (seg.length < 2) return;
    let dayOff = 0;
    if (/\btomorrow\b/i.test(seg)) dayOff = 1;
    else if (/\byesterday\b/i.test(seg)) dayOff = -1;
    seg = seg.replace(/\b(tomorrow|yesterday|today)\b/gi, ' ').trim();

    let start: number | null = null, end: number | null = null;
    const strip: string[] = [];
    const prev = cursor;
    const res = (h0: string | number, m0: string | undefined | null, mer0: string | undefined, floor: number | null): number => {
      let h = +h0;
      const m = m0 ? +m0 : 0;
      if (mer0) {
        const mer = mer0.toLowerCase();
        if (mer[0] === 'p' && h < 12) h += 12;
        if (mer[0] === 'a' && h === 12) h = 0;
        return clamp(h * 60 + m, 0, 1439);
      }
      if (h > 12) return clamp(h * 60 + m, 0, 1439);
      if (h === 12) return 720;
      const a = (h % 12) * 60 + m, f = floor == null ? 300 : floor;
      return a >= f ? a : a + 720;
    };
    const rng = seg.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to|till|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    const endOnly = rng ? null : seg.match(/\b(?:until|till|to|by)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (rng) {
      start = res(rng[1], rng[2], rng[3] || rng[6], prev);
      end = res(rng[4], rng[5], rng[6] || rng[3], start + 1);
      if (end <= start) end += 1440;
      strip.push(rng[0]);
    } else if (endOnly) {
      end = res(endOnly[1], endOnly[2], endOnly[3], prev);
      strip.push(endOnly[0]);
    } else {
      const one = seg.match(/(?:\b(?:at|from|@)\s*)?\b(\d{1,2}):(\d{2})\s*(am|pm)?/i) || seg.match(/\b(?:at|from|@)\s*(\d{1,2})\s*(am|pm)?\b/i) || seg.match(/\b(\d{1,2})\s*(am|pm)\b/i);
      if (one) {
        const hasMin = /:/.test(one[0]);
        start = hasMin ? res(one[1], one[2], one[3], prev) : res(one[1], null, one[2], prev);
        strip.push(one[0]);
      } else {
        const wk = Object.keys(WORDT).find((w) => new RegExp('\\b' + w + '\\b', 'i').test(seg));
        if (wk) start = WORDT[wk];
      }
    }
    let dura: number | null = null;
    const dm = seg.match(/\bfor\s+(a|an|half an|\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/i);
    if (dm) {
      const q = /^(a|an)$/i.test(dm[1]) ? 1 : /half/i.test(dm[1]) ? 0.5 : parseFloat(dm[1]);
      dura = /^h/i.test(dm[2]) ? Math.round(q * 60) : Math.round(q);
      strip.push(dm[0]);
    }

    let title = seg;
    strip.forEach((s) => { title = title.split(s).join(' '); });
    title = title.replace(/\b(at|from|until|till|to|for|@|around|about)\b\s*$/i, '').replace(/^\s*(at|from|for|around|about)\b\s*/i, '').replace(/\s{2,}/g, ' ').replace(/^[\s\-–—:]+|[\s\-–—:,.]+$/g, '').trim();
    if (!title) title = 'Untitled';
    const low = (' ' + title + ' ').toLowerCase();

    const hit = matchCat(low, known);
    /* a category the user created themselves is never folded into an alias */
    let cat = (hit && known.indexOf(hit) >= 0 ? hit : normCat(hit)) as string | null;
    if (cat && !catHue(cats, cat) && known.length) {
      const c0 = cat;
      const ci = known.find((k) => k.toLowerCase() === c0.toLowerCase());
      if (ci) cat = ci;
    }
    if (!cat) {
      const w = title.toLowerCase().split(/[^a-z0-9']+/).filter((x) => x && x.length > 2 && STOP.indexOf(x) < 0);
      const guess = w.length ? cap(w[0]) : 'Other';
      const ci = known.find((k) => k.toLowerCase() === guess.toLowerCase());
      cat = ci || (normCat(guess) as string);
    }
    if (catHue(cats, cat) == null) {
      const sp = spareHue(cats), b = builtinHue(cat);
      const h = b != null ? b : (sp != null ? sp : Math.round(ctx.random() * 36) * 10);
      cats[cat] = h; known.push(cat); if (fresh.indexOf(cat) < 0) fresh.push(cat);
    }

    if (start == null) {
      const seq: number = cursor == null ? Math.max(480, snap(ctx.nowMin)) : cursor;
      start = (end != null && end - 15 < seq) ? Math.max(0, end - (dura || defaultDur(cat) || 45)) : seq;
    }
    if (endOnly && end != null && end > start) { /* keep explicit end */ }
    else if (end == null || end <= start) end = start + (dura || defaultDur(cat) || 45);
    end = clamp(end, start + 15, start + 1440);
    cursor = end % 1440;
    out.push({ id: ctx.nextId(), day: key(addDays(ctx.today, dayOff)), cat, title: cap(title), start, end, at: ctx.nowMs });
  });
  return { events: out, cats, fresh, updates: [], deletes: [], goals: [] };
};
