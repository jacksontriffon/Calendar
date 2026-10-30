/**
 * Google sign-in, default (web) implementation; google.native.ts overrides it on iOS and Android.
 * On web it is: a Supabase OAuth redirect (no native SDK; the
 * `@react-native-google-signin` package isn't bundled for web).
 */
import { signInWithOAuthProvider, type SignInResult } from './oauth';

export function signInWithGoogle(): Promise<SignInResult> {
  return signInWithOAuthProvider('google');
}

export async function signOutGoogle(): Promise<void> {}
