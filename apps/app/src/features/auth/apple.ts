/**
 * Sign in with Apple.
 *
 *  - iOS: the native sheet (`expo-apple-authentication`), then
 *    `signInWithIdToken`. The sheet is given the SHA-256 of a random nonce and
 *    Supabase the raw nonce, so a stolen ID token can't be replayed.
 *  - Android and web: Supabase OAuth (oauth.ts). On Android that is the
 *    system browser session; on web a redirect.
 *
 * Apple only sends the user's name on the very first authorisation, so it is
 * saved straight away to `profiles.display_name` when that is still empty.
 */
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

import { OK, cancelled, failureFrom, signInWithOAuthProvider, type SignInResult } from './oauth';

/** Whether the native Apple sheet can be used on this device. */
export async function isNativeAppleAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

async function signInWithAppleNative(): Promise<SignInResult> {
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return cancelled();
    return failureFrom(e);
  }
  if (!credential.identityToken) return { ok: false, reason: 'failed', message: 'Apple returned no identity token' };

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce: rawNonce,
  });
  if (error) return failureFrom(error);

  const name = credential.fullName ? AppleAuthentication.formatFullName(credential.fullName).trim() : '';
  if (name && data.user) await saveNameIfEmpty(data.user.id, name);
  return OK;
}

async function saveNameIfEmpty(userId: string, name: string): Promise<void> {
  try {
    const { data } = await supabase.from('profiles').select('display_name').eq('id', userId).maybeSingle();
    if (data && !data.display_name) {
      await supabase.from('profiles').update({ display_name: name }).eq('id', userId);
    }
  } catch {
    // Best effort: setup asks for the name anyway.
  }
}

export async function signInWithApple(): Promise<SignInResult> {
  try {
    if (await isNativeAppleAvailable()) return await signInWithAppleNative();
    return await signInWithOAuthProvider('apple');
  } catch (e) {
    return failureFrom(e);
  }
}
