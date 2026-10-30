import type { Database } from '@calendar/db';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { secureStorage } from './secureStorage';

// Must be referenced as literal `process.env.EXPO_PUBLIC_*` so Metro inlines them.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured) {
  // Don't throw at import time: typecheck, lint and `expo export` must work
  // without credentials. Calls will fail until .env.local is filled in.
  console.warn(
    '[supabase] EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY are not set. See apps/app/.env.example.',
  );
}

const isWeb = Platform.OS === 'web';
// Static web export / SSR has no `window`; fall back to no persistence there.
const hasWindow = typeof window !== 'undefined';

export const supabase = createClient<Database>(url || 'http://127.0.0.1:54321', anonKey || 'missing-anon-key', {
  auth: {
    // Native: encrypted-at-rest SecureStore. Web: supabase-js defaults to localStorage.
    storage: isWeb ? undefined : secureStorage,
    persistSession: isWeb ? hasWindow : true,
    autoRefreshToken: true,
    // PKCE for every OAuth flow: the redirect carries a one-time `code` that
    // exchangeCodeForSession() trades for the session, never the tokens
    // themselves (see features/auth/oauth.ts).
    flowType: 'pkce',
    // Web OAuth redirects return with the session in the URL; native uses
    // deep links handled by the auth screens instead.
    detectSessionInUrl: isWeb && hasWindow,
  },
});

// Native has no tab-visibility events, so tie token refresh to app foreground
// state, as in Supabase's Expo guide.
if (!isWeb) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
