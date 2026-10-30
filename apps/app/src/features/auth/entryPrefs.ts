/**
 * The flags the entry flow keeps in `profiles.prefs` (`onboarded`,
 * `legacyImport`), as pure helpers: no Supabase, no React.
 */
import type { Json } from '@calendar/db';

export type PrefsObject = { [key: string]: Json | undefined };

/** What the import screen left behind: `none` (no old blob), `imported` with counts, or `skipped` after an error. */
export interface LegacyImportRecord {
  status: 'none' | 'imported' | 'skipped';
  at: string;
  counts?: { events: number; goals: number; categories: number };
}

/** The flags this phase stores in `profiles.prefs`. */
export interface EntryPrefs {
  onboarded?: boolean;
  legacyImport?: LegacyImportRecord;
}

export const asPrefs = (v: Json | undefined | null): PrefsObject =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as PrefsObject) : {};

/** Read the flags out of a prefs object, ignoring anything of the wrong shape. */
export function readEntryPrefs(prefs: Json | undefined | null): EntryPrefs {
  const p = asPrefs(prefs);
  const out: EntryPrefs = {};
  if (p.onboarded === true) out.onboarded = true;
  const li = asPrefs(p.legacyImport as Json | undefined);
  if (li.status === 'none' || li.status === 'imported' || li.status === 'skipped') {
    out.legacyImport = {
      status: li.status,
      at: typeof li.at === 'string' ? li.at : '',
      counts: asCounts(li.counts as Json | undefined),
    };
  }
  return out;
}

function asCounts(v: Json | undefined): LegacyImportRecord['counts'] {
  const c = asPrefs(v);
  const n = (x: Json | undefined) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
  if (c.events === undefined && c.goals === undefined && c.categories === undefined) return undefined;
  return { events: n(c.events), goals: n(c.goals), categories: n(c.categories) };
}

