import { supabase } from '@/lib/supabase';

import {
  DEFAULT_LIMIT, getUsageState, nextReset, recordUsage, setUsageLoading, type Usage,
} from './usage';

/** `YYYY-MM-01` of the current UTC month: the `ai_usage` key. */
export const usageMonth = (now = new Date()): string => now.toISOString().slice(0, 7) + '-01';

/**
 * Read this month's count from `ai_usage` (RLS: own rows) so Settings can show the usage without
 * sending a note. The limit is server config, so the last known one is kept, falling back to the
 * spec's placeholder allowance until the first answer arrives. Failures (offline, signed out)
 * leave whatever is stored.
 */
export async function refreshUsage(now = new Date()): Promise<Usage | null> {
  setUsageLoading(true);
  try {
    const month = usageMonth(now);
    const { data, error } = await supabase.from('ai_usage').select('notes').eq('month', month).maybeSingle();
    if (error) throw error;
    const known = getUsageState().usage;
    const usage: Usage = { used: data?.notes ?? 0, limit: known?.limit ?? DEFAULT_LIMIT, resetsOn: nextReset(month) };
    recordUsage(usage);
    return usage;
  } catch {
    return null;
  } finally {
    setUsageLoading(false);
  }
}
