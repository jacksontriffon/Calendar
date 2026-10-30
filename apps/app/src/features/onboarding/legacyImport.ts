/**
 * The `legacy-import` edge function (plan §5): a one-time, idempotent copy of
 * the old web app's JSON blob into categories, goals, series and events.
 *
 *   supabase.functions.invoke('legacy-import')
 *     -> { status: 'none' }                                  no old calendar: skip silently
 *     -> { status: 'ok' | 'imported' | 'done', counts: { events, goals, categories } }
 *     -> { status: 'error', ref?, stage? } or a non-2xx     failed: retry or skip
 *
 * The function isn't deployed yet, so `parseLegacyImport` accepts the counts
 * either nested under `counts` or at the top level and reads anything that is
 * not `none` / `error` as success.
 */

export interface ImportCounts {
  events: number;
  goals: number;
  categories: number;
}

export type ImportOutcome =
  | { kind: 'none' }
  | { kind: 'imported'; counts: ImportCounts; lastSaved?: string }
  | { kind: 'error'; ref?: string; stage?: string };

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Turn the function's response body into an outcome. Anything unreadable is an error. */
export function parseLegacyImport(data: unknown): ImportOutcome {
  if (!isRecord(data)) return { kind: 'error' };
  const status = typeof data.status === 'string' ? data.status.toLowerCase() : '';
  if (status === 'none') return { kind: 'none' };
  if (status === 'error' || status === 'failed' || data.error) {
    return {
      kind: 'error',
      ref: typeof data.ref === 'string' ? data.ref : undefined,
      stage: typeof data.stage === 'string' ? data.stage : undefined,
    };
  }
  const src = isRecord(data.counts) ? data.counts : data;
  return {
    kind: 'imported',
    counts: { events: num(src.events), goals: num(src.goals), categories: num(src.categories) },
    lastSaved: typeof data.lastSaved === 'string' ? data.lastSaved : undefined,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "142 events, 6 goals, 9 categories came over from the web app." */
export function summarizeCounts(c: ImportCounts): string {
  return `${plural(c.events, 'event', 'events')}, ${plural(c.goals, 'goal', 'goals')}, ${plural(c.categories, 'category', 'categories')} came over from the web app.`;
}

/** "It stopped while copying goals." when the server says where, else a generic line. */
export function failureDetail(stage?: string): string {
  const where: Record<string, string> = { events: 'events', goals: 'goals', categories: 'categories', settings: 'your settings' };
  const w = stage ? where[stage.toLowerCase()] : undefined;
  return `${w ? `It stopped while copying ${w}. ` : ''}Nothing was lost, and your web calendar is untouched.`;
}
