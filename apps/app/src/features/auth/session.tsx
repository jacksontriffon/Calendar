/**
 * The session provider: one subscription to `supabase.auth.onAuthStateChange`,
 * the signed-in user's `profiles` row, and the sign-in / sign-out actions.
 *
 * Status:
 *   loading    reading the stored session
 *   signedOut  no session; only the (auth) routes are reachable
 *   signedIn   a live session
 *   expired    this run had a session and it ended without the user asking
 *              (refresh token rejected / revoked). The app stays mounted
 *              behind the re-sign-in sheet (OA 5.5) so local edits keep
 *              queuing; signing in again returns to `signedIn`.
 */
import type { Session, User } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Linking, Platform } from 'react-native';

import { FLAGS, getFlag, setFlag } from '@/lib/localFlags';
import { parseDeepLink } from '@/lib/deepLinks';
import { supabase } from '@/lib/supabase';

import { signOutGoogle } from './google';
import { completeAuthFromUrl } from './oauth';
import {
  ensureProfile,
  mergeProfilePrefs,
  updateProfileFields,
  type PrefsObject,
  type ProfileRow,
} from './profile';
import { signInWithProvider, type AuthProvider, type SignInResult } from './providers';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn' | 'expired';
export type ProfileState = 'idle' | 'loading' | 'ready' | 'error';

export interface SessionValue {
  status: AuthStatus;
  session: Session | null;
  /** The current user; while `expired`, the last signed-in user. */
  user: User | null;
  email: string | null;
  /** How the current user signs in. */
  provider: AuthProvider | null;
  /** Provider of the last successful sign-in on this install (for the re-sign-in sheet). */
  lastProvider: AuthProvider | null;
  profile: ProfileRow | null;
  profileState: ProfileState;
  /** `profiles.display_name`, else the provider's name, else null. */
  displayName: string | null;
  /** The provider whose sign-in is in progress; the other button locks meanwhile. */
  signingIn: AuthProvider | null;
  signIn: (provider: AuthProvider) => Promise<SignInResult>;
  /** Sign out of this device (the session is cleared locally; other devices stay signed in). */
  signOut: () => Promise<void>;
  /**
   * For other layers (sync, API calls): the server rejected our credentials.
   * Shows the re-sign-in sheet over whatever the user is doing.
   */
  reportSessionExpired: () => void;
  reloadProfile: () => Promise<void>;
  saveProfile: (patch: { display_name?: string | null; tz?: string }) => Promise<ProfileRow>;
  /** Merge flags into `profiles.prefs` (`onboarded`, `legacyImport`). */
  saveEntryPrefs: (patch: PrefsObject) => Promise<ProfileRow>;
}

const SessionContext = createContext<SessionValue | null>(null);

const asProvider = (v: unknown): AuthProvider | null => (v === 'apple' || v === 'google' ? v : null);

export function providerOf(user: User | null): AuthProvider | null {
  if (!user) return null;
  return asProvider(user.app_metadata?.provider) ?? asProvider(user.identities?.[0]?.provider);
}

/** Apple's hidden-email relay addresses (shown as-is, with a note, on Account). */
export const isRelayEmail = (email: string | null | undefined): boolean =>
  !!email && /@privaterelay\.appleid\.com$/i.test(email);

interface AuthState {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading', session: null, user: null });
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [profileState, setProfileState] = useState<ProfileState>('idle');
  const [signingIn, setSigningIn] = useState<AuthProvider | null>(null);
  const [lastProvider, setLastProvider] = useState<AuthProvider | null>(null);

  // Set while *we* are signing out, so the resulting SIGNED_OUT isn't read as an expiry.
  const intentionalSignOut = useRef(false);
  const lastUser = useRef<User | null>(null);

  const apply = useCallback((event: string, session: Session | null) => {
    if (session) {
      if (lastUser.current?.id !== session.user.id) setProfileState('loading');
      lastUser.current = session.user;
      intentionalSignOut.current = false;
      setAuth((prev) =>
        prev.status === 'signedIn' && prev.session?.access_token === session.access_token
          ? prev
          : { status: 'signedIn', session, user: session.user },
      );
      return;
    }
    const expired = event === 'SIGNED_OUT' && !intentionalSignOut.current && lastUser.current !== null;
    setAuth((prev) => {
      if (expired) return { status: 'expired', session: null, user: lastUser.current };
      return prev.status === 'signedOut' ? prev : { status: 'signedOut', session: null, user: null };
    });
    if (!expired) {
      lastUser.current = null;
      setProfile(null);
      setProfileState('idle');
    }
    intentionalSignOut.current = false;
  }, []);

  useEffect(() => {
    let live = true;
    void getFlag(FLAGS.lastProvider).then((v) => live && setLastProvider(asProvider(v)));
    void supabase.auth
      .getSession()
      .then(({ data }) => live && apply('INITIAL_SESSION', data.session))
      .catch(() => live && apply('INITIAL_SESSION', null));
    // The callback must not await supabase calls (it runs inside the auth lock).
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (live) apply(event, session);
    });
    return () => {
      live = false;
      data.subscription.unsubscribe();
    };
  }, [apply]);

  // Return from the system browser on native: `aicalendar://auth/callback?code=`.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const handle = (url: string | null | undefined) => {
      if (url && parseDeepLink(url).kind === 'auth-callback') void completeAuthFromUrl(url);
    };
    void Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', (e) => handle(e.url));
    return () => sub.remove();
  }, []);

  // The profile row follows the user (and is re-read when `reloadProfile` bumps the key).
  const userId = auth.user?.id ?? null;
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    if (!userId) return;
    let live = true;
    ensureProfile(userId)
      .then((row) => {
        if (!live) return;
        setProfile(row);
        setProfileState('ready');
      })
      .catch((e) => {
        console.warn('[auth] profile load failed:', e);
        if (live) setProfileState('error');
      });
    return () => {
      live = false;
    };
  }, [userId, reloadKey]);

  const signIn = useCallback(async (provider: AuthProvider): Promise<SignInResult> => {
    setSigningIn(provider);
    try {
      const result = await signInWithProvider(provider);
      if (result.ok) {
        setLastProvider(provider);
        void setFlag(FLAGS.lastProvider, provider);
      }
      return result;
    } finally {
      setSigningIn(null);
    }
  }, []);

  const signOut = useCallback(async () => {
    intentionalSignOut.current = true;
    await signOutGoogle();
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // Local scope clears storage first; a network error can't leave us signed in.
    }
    lastUser.current = null;
    setProfile(null);
    setProfileState('idle');
    setAuth({ status: 'signedOut', session: null, user: null });
  }, []);

  const reportSessionExpired = useCallback(() => {
    setAuth((prev) => (prev.status === 'signedIn' ? { status: 'expired', session: null, user: prev.user } : prev));
  }, []);

  const reloadProfile = useCallback(async () => {
    setProfileState('loading');
    setReloadKey((k) => k + 1);
  }, []);

  const saveProfile = useCallback(
    async (patch: { display_name?: string | null; tz?: string }) => {
      if (!userId) throw new Error('Not signed in');
      const row = await updateProfileFields(userId, patch);
      setProfile(row);
      return row;
    },
    [userId],
  );

  const saveEntryPrefs = useCallback(
    async (patch: PrefsObject) => {
      if (!userId) throw new Error('Not signed in');
      const row = await mergeProfilePrefs(userId, patch);
      setProfile(row);
      return row;
    },
    [userId],
  );

  const value = useMemo<SessionValue>(() => {
    const meta = auth.user?.user_metadata as { full_name?: string; name?: string } | undefined;
    const providerName = (meta?.full_name || meta?.name || '').trim();
    // Never show another account's row while the new one loads.
    const ownProfile = profile && profile.id === auth.user?.id ? profile : null;
    return {
      status: auth.status,
      session: auth.session,
      user: auth.user,
      email: auth.user?.email ?? null,
      provider: providerOf(auth.user),
      lastProvider,
      profile: ownProfile,
      profileState,
      displayName: ownProfile?.display_name?.trim() || providerName || null,
      signingIn,
      signIn,
      signOut,
      reportSessionExpired,
      reloadProfile,
      saveProfile,
      saveEntryPrefs,
    };
  }, [auth, lastProvider, profile, profileState, signingIn, signIn, signOut, reportSessionExpired, reloadProfile, saveProfile, saveEntryPrefs]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}

/**
 * The re-sign-in sheet (OA 5.5), for other screens to trigger:
 *
 *   const { expired, report } = useSessionExpired();
 *   // on a 401 from the API / a failed token refresh:
 *   report();
 *
 * `<SessionExpiredSheet />` (mounted once in the root layout) shows whenever
 * `expired` is true and hides itself after a successful sign-in.
 */
export function useSessionExpired(): { expired: boolean; report: () => void } {
  const { status, reportSessionExpired } = useSession();
  return { expired: status === 'expired', report: reportSessionExpired };
}
