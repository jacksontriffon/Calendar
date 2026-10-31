/**
 * Supabase OAuth for the platforms that don't use a native ID-token flow:
 *
 *  - web: a plain `signInWithOAuth` redirect; the page leaves and comes back
 *    with `?code=` in the URL, which supabase-js (`detectSessionInUrl`)
 *    exchanges on load.
 *  - Android Apple (and iOS Apple when the native sheet is unavailable):
 *    `signInWithOAuth` with `skipBrowserRedirect`, opened in the system
 *    browser session (`expo-web-browser`), returning to
 *    `aicalendar://auth/callback?code=...`, which is exchanged here.
 *
 * The redirect URLs must be on Supabase's Auth > URL configuration allow-list:
 * `aicalendar://auth/callback` and the web origin.
 */
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { NATIVE_AUTH_REDIRECT } from '@/lib/env';
import { parseAuthCallback } from '@/lib/deepLinks';
import { supabase } from '@/lib/supabase';

export type AuthProvider = 'apple' | 'google';

export type SignInFailure = 'cancelled' | 'offline' | 'unavailable' | 'failed';

export type SignInResult =
  | { ok: true; /** Web: the page is navigating away; the session arrives on return. */ redirecting?: boolean }
  | { ok: false; reason: SignInFailure; message?: string };

export const OK: SignInResult = { ok: true };
export const cancelled = (): SignInResult => ({ ok: false, reason: 'cancelled' });

/** Map a thrown / returned error to a failure. Retryable fetch errors mean no connection. */
export function failureFrom(error: unknown): SignInResult {
  console.warn('[auth] sign-in failed:', error);
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;
  if (isAuthRetryableFetchError(error) || (message && /network request failed|failed to fetch|offline/i.test(message))) {
    return { ok: false, reason: 'offline', message };
  }
  return { ok: false, reason: 'failed', message };
}

// A code is single-use. Android can deliver the redirect to both the browser
// promise and the Linking listener, so concurrent callers share one exchange.
const inFlight = new Map<string, Promise<SignInResult>>();

/** Finish a sign-in from the URL Supabase redirected to (`?code=` PKCE, or `#access_token=`). */
export function completeAuthFromUrl(url: string): Promise<SignInResult> {
  const cb = parseAuthCallback(url);
  if (cb.kind === 'none') return Promise.resolve({ ok: false, reason: 'failed', message: 'No sign-in code in the redirect' });
  if (cb.kind === 'error') return Promise.resolve({ ok: false, reason: 'failed', message: cb.message });

  const key = cb.kind === 'code' ? cb.code : cb.accessToken;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const run = (async (): Promise<SignInResult> => {
    try {
      const { error } =
        cb.kind === 'code'
          ? await supabase.auth.exchangeCodeForSession(cb.code)
          : await supabase.auth.setSession({ access_token: cb.accessToken, refresh_token: cb.refreshToken });
      return error ? failureFrom(error) : OK;
    } catch (e) {
      return failureFrom(e);
    }
  })();
  inFlight.set(key, run);
  void run.finally(() => setTimeout(() => inFlight.delete(key), 30_000));
  return run;
}

export async function signInWithOAuthProvider(provider: AuthProvider): Promise<SignInResult> {
  try {
    if (Platform.OS === 'web') {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: window.location.origin,
          queryParams: provider === 'google' ? { prompt: 'select_account' } : undefined,
        },
      });
      return error ? failureFrom(error) : { ok: true, redirecting: true };
    }

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: NATIVE_AUTH_REDIRECT, skipBrowserRedirect: true },
    });
    if (error || !data.url) return failureFrom(error ?? new Error('No sign-in URL'));

    const result = await WebBrowser.openAuthSessionAsync(data.url, NATIVE_AUTH_REDIRECT);
    if (result.type === 'success') return completeAuthFromUrl(result.url);
    return cancelled();
  } catch (e) {
    return failureFrom(e);
  }
}
