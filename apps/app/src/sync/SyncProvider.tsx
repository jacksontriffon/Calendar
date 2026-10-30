import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { SyncController, type AuthLike, type SyncControllerState } from './controller';
import { onForeground } from './lifecycle';
import { createNetworkMonitor } from './network';
import { createSupabaseRemote } from './remote';
import { createDeviceStore } from './storage';

export interface SyncContextValue extends SyncControllerState {
  /** A user is signed in and their store is installed. */
  signedIn: boolean;
}

const SyncContext = createContext<SyncContextValue>({ loading: true, userId: null, signedIn: false });

/** Loading and session state of the sync layer. `loading` is true until the first session check (and, on a first run, the first sync) is done. */
export const useSyncContext = (): SyncContextValue => useContext(SyncContext);
/** True while the store is not ready yet: gate the splash screen on this. */
export const useSyncLoading = (): boolean => useContext(SyncContext).loading;

/**
 * Starts and stops sync as the Supabase session changes. Mount it once, above
 * the screens (inside the root layout). It installs the local-first store with
 * `setStore`; until a user is signed in the app runs on an empty in-memory store.
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SyncControllerState>(
    isSupabaseConfigured ? { loading: true, userId: null } : { loading: false, userId: null },
  );

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const controller = new SyncController({
      auth: supabase.auth as unknown as AuthLike,
      device: createDeviceStore(),
      createRemote: (userId) => createSupabaseRemote(supabase, userId),
      createNet: createNetworkMonitor,
      onForeground,
    });
    const off = controller.subscribe(setState);
    const stop = controller.start();
    return () => {
      off();
      stop();
    };
  }, []);

  const value = useMemo<SyncContextValue>(() => ({ ...state, signedIn: !!state.userId }), [state]);
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
