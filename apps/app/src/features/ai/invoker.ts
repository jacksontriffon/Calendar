import { supabase } from '@/lib/supabase';

import type { AiInvoker } from './client';

/** The real transport: `supabase.functions.invoke` (adds the user's JWT). */
export const supabaseInvoker: AiInvoker = (name, { body, signal }) => supabase.functions.invoke(name, { body, signal });
