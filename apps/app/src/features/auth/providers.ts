import { signInWithApple } from './apple';
import { signInWithGoogle } from './google';
import type { AuthProvider, SignInFailure, SignInResult } from './oauth';

export type { AuthProvider, SignInFailure, SignInResult };

/** Run the sign-in for `provider` (native ID-token flow, system browser, or web redirect, by platform). */
export function signInWithProvider(provider: AuthProvider): Promise<SignInResult> {
  return provider === 'apple' ? signInWithApple() : signInWithGoogle();
}

export const PROVIDER_LABEL: Record<AuthProvider, string> = { apple: 'Apple', google: 'Google' };

/**
 * User-facing copy for a failed sign-in (OA 1.4). Cancelling is not an error,
 * so it has no message.
 */
export function signInErrorMessage(provider: AuthProvider, failure: SignInFailure): string | null {
  const name = PROVIDER_LABEL[provider];
  switch (failure) {
    case 'cancelled':
      return null;
    case 'offline':
      return `You’re offline. Connect to the internet to sign in with ${name}.`;
    case 'unavailable':
      return `Sign in with ${name} isn’t set up on this build yet.`;
    case 'failed':
      return `Couldn’t sign in with ${name}. Try again.`;
  }
}

/** The platform's button order: Apple first on iOS and web, Google first on Android. */
export function providerOrder(platform: string): AuthProvider[] {
  return platform === 'android' ? ['google', 'apple'] : ['apple', 'google'];
}

/** For the re-sign-in sheet: the last-used provider first, the other after. */
export function orderWithLastUsed(last: AuthProvider | null, fallback: AuthProvider[]): AuthProvider[] {
  if (!last) return fallback;
  return [last, ...fallback.filter((p) => p !== last)];
}
