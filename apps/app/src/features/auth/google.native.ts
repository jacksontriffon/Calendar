/**
 * Google sign-in on iOS and Android: `@react-native-google-signin/google-signin`
 * for the account chooser, then `supabase.auth.signInWithIdToken`.
 *
 * Needs (see apps/app/.env.example and the README):
 *  - EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: the *web* OAuth client, the same one
 *    Supabase's Google provider uses. The ID token's audience is this client.
 *  - EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID and GOOGLE_IOS_URL_SCHEME (its reversed
 *    id, read by app.config.ts for the Info.plist URL scheme).
 *  - Android: an Android OAuth client for the package name + SHA-1 of each
 *    signing key, in the same Google Cloud project.
 *  - Supabase > Auth > Providers > Google: list the iOS and web client ids
 *    under "Authorized Client IDs" and enable "Skip nonce checks" (this
 *    library can't pass a custom nonce).
 */
import { GoogleSignin, isErrorWithCode, statusCodes } from '@react-native-google-signin/google-signin';
import { Platform } from 'react-native';

import { env } from '@/lib/env';
import { supabase } from '@/lib/supabase';

import { OK, cancelled, failureFrom, type SignInResult } from './oauth';

let configured = false;

function configure(): boolean {
  if (configured) return true;
  if (!env.googleWebClientId) return false;
  GoogleSignin.configure({
    webClientId: env.googleWebClientId,
    iosClientId: env.googleIosClientId || undefined,
    scopes: ['email', 'profile'],
  });
  configured = true;
  return true;
}

export async function signInWithGoogle(): Promise<SignInResult> {
  if (!configure()) {
    return { ok: false, reason: 'unavailable', message: 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set' };
  }
  try {
    if (Platform.OS === 'android') await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (response.type !== 'success') return cancelled();
    const idToken = response.data.idToken;
    if (!idToken) return { ok: false, reason: 'failed', message: 'Google returned no ID token' };

    const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
    return error ? failureFrom(error) : OK;
  } catch (e) {
    if (isErrorWithCode(e) && e.code === statusCodes.SIGN_IN_CANCELLED) return cancelled();
    return failureFrom(e);
  }
}

/** Forget the chosen Google account so the next sign-in shows the chooser. */
export async function signOutGoogle(): Promise<void> {
  try {
    if (configure()) await GoogleSignin.signOut();
  } catch {
    // Not signed in with the native SDK: nothing to do.
  }
}
