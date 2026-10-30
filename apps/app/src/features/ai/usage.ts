/**
 * The monthly AI allowance ("Notes this month: 38 of 200 · resets Nov 1", Design Spec OA 06).
 *
 * `ai-schedule` returns `usage: { used, limit, resetsOn }` with every answer (and with the
 * `limit` / `rate_limit` errors). The app keeps the latest value in a small device-local store so
 * Settings can show it without sending a note; when nothing is known yet it reads `ai_usage`
 * (see `refreshUsage`).
 */
import { useSyncExternalStore } from 'react';
import { MODELS } from '@calendar/core';

import { deviceGet, deviceSet } from '../checkin/state';

export interface Usage {
  used: number;
  limit: number;
  /** `YYYY-MM-DD`, first day of next month (UTC) */
  resetsOn: string;
}

/** The spec's stand-in allowance, shown until the server has told us the real one. */
export const DEFAULT_LIMIT = 200;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Read a `{ used, limit, resetsOn }` object (a response's `usage`, or an error body that carries the same keys). */
export function parseUsage(v: unknown): Usage | null {
  if (!isObj(v)) return null;
  const used = Number(v.used), limit = Number(v.limit);
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0 || typeof v.resetsOn !== 'string' || !DAY.test(v.resetsOn)) return null;
  return { used: Math.max(0, Math.round(used)), limit: Math.round(limit), resetsOn: v.resetsOn };
}

/** First day of the month after `day` (`YYYY-MM-DD`), the allowance reset (UTC, as the server computes it). */
export function nextReset(day: string): string {
  const [y, m] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-11-01` -> `Nov 1`. */
export function formatResetDate(resetsOn: string): string {
  if (!DAY.test(resetsOn)) return resetsOn;
  const [, m, d] = resetsOn.split('-').map(Number);
  return MONTHS[m - 1] + ' ' + d;
}

/** The right-hand text of the usage card: `of 200 · resets Nov 1`. */
export const formatUsage = (u: Usage): string => 'of ' + u.limit + ' · resets ' + formatResetDate(u.resetsOn);

/** `19` for 38 of 200; clamped to 0..100 (drives the bar width). */
export const usagePercent = (u: Usage): number => Math.max(0, Math.min(100, Math.round((u.used / u.limit) * 100)));

export const isLimitReached = (u: Usage | null | undefined): boolean => !!u && u.used >= u.limit;

/**
 * A stored usage that belongs to a month that has already reset counts as 0 now (the server will
 * say so on the next call). `today` is `YYYY-MM-DD`.
 */
export function currentUsage(u: Usage | null, today: string): Usage | null {
  if (!u) return null;
  return u.resetsOn <= today ? { used: 0, limit: u.limit, resetsOn: nextReset(today) } : u;
}

/** `claude-haiku-4-5` (or with a date suffix) -> `Haiku 4.5`. Unknown ids are tidied up. */
export function modelLabel(id: string | null | undefined): string {
  if (!id) return MODELS[0].short;
  const hit = MODELS.find((m) => m.id && id.startsWith(m.id));
  if (hit) return hit.short;
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/i.exec(id);
  if (m) return m[1][0].toUpperCase() + m[1].slice(1) + ' ' + m[2] + (m[3] ? '.' + m[3] : '');
  return id;
}

export type AiStatus = 'ok' | 'off' | 'offline' | 'limit';

export interface UsageView {
  status: AiStatus;
  /** the line under the "Claude parsing" header */
  headline: string;
  /** left of the usage card: the count, or an em dash when it can't be shown */
  count: string;
  /** right of the usage card */
  detail: string;
  /** small print under the card */
  note: string;
  /** 0..100, null hides the bar */
  percent: number | null;
}

/** Everything the Claude parsing settings show about connection and usage, as plain strings. */
export function describeUsage(o: { on: boolean; online: boolean; usage: Usage | null; model: string | null }): UsageView {
  const model = modelLabel(o.model);
  const u = o.usage;
  const reset = u ? formatResetDate(u.resetsOn) : '';
  if (!o.on) {
    return {
      status: 'off',
      headline: 'Off — the built-in offline parser handles everything.',
      count: u ? String(u.used) : '—',
      detail: u ? formatUsage(u) : '',
      note: 'Not counting while Claude parsing is off.',
      percent: u ? usagePercent(u) : null,
    };
  }
  if (!o.online) {
    return {
      status: 'offline',
      headline: 'Offline · using the on-device parser. ' + model + ' takes over when you’re back online.',
      count: '—',
      detail: 'Updates when you’re online',
      note: 'Notes you write offline use the on-device parser and don’t count.',
      percent: null,
    };
  }
  if (u && isLimitReached(u)) {
    return {
      status: 'limit',
      headline: 'Monthly notes used · using the on-device parser until ' + reset + '.',
      count: String(u.used),
      detail: formatUsage(u),
      note: 'You’ve used this month’s notes. The on-device parser takes over until ' + reset + '.',
      percent: 100,
    };
  }
  return {
    status: 'ok',
    headline: 'Connected · ' + model + '. Included with your account.',
    count: u ? String(u.used) : '—',
    detail: u ? formatUsage(u) : '',
    note: 'Each note you send counts once. Parsing runs on our servers.',
    percent: u ? usagePercent(u) : null,
  };
}

/* ---------- the latest value, device-local ---------- */

const KEY = 'aical.aiusage';

function load(): { usage: Usage | null; model: string | null } {
  try {
    const raw = JSON.parse(deviceGet(KEY) || 'null') as unknown;
    if (isObj(raw)) return { usage: parseUsage(raw.usage), model: typeof raw.model === 'string' ? raw.model : null };
  } catch {
    /* unreadable: start empty */
  }
  return { usage: null, model: null };
}

export interface UsageState {
  usage: Usage | null;
  /** model id the server last reported */
  model: string | null;
  /** the usage has not been read from the server or storage yet */
  loading: boolean;
}

let state: UsageState = { ...load(), loading: false };
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());

export const getUsageState = (): UsageState => state;
export const subscribeUsage = (l: () => void): (() => void) => {
  subs.add(l);
  return () => {
    subs.delete(l);
  };
};
export const useUsageState = (): UsageState => useSyncExternalStore(subscribeUsage, getUsageState, getUsageState);

/** Remember the usage (and model) from a response or error and persist it. Either may be omitted. */
export function recordUsage(usage: Usage | null | undefined, model?: string | null): void {
  if (!usage && !model) return;
  state = { usage: usage ?? state.usage, model: model ?? state.model, loading: false };
  try {
    deviceSet(KEY, JSON.stringify({ usage: state.usage, model: state.model }));
  } catch {
    /* storage unavailable: keep it in memory */
  }
  emit();
}

export function setUsageLoading(loading: boolean): void {
  if (state.loading === loading) return;
  state = { ...state, loading };
  emit();
}

/** Test helper: forget everything. */
export function resetUsage(): void {
  state = { usage: null, model: null, loading: false };
  try {
    deviceSet(KEY, '');
  } catch {
    /* ignore */
  }
  emit();
}
