/**
 * Owns the one `DeviceBridge` of the app and ties it to the signed-in user.
 *
 * Components call `useDeviceBridgeHost()` (the calendar screen and the phone-calendar screens do, via
 * the hooks in `./index.ts`); the bridge starts for the current user when the first one mounts and
 * stops when the last one unmounts or the user changes. On web there are no phone calendars: no bridge
 * is created and every hook reads the empty state.
 *
 * This file builds the supabase-backed `DeviceRemote`; the bridge itself never sees supabase (see
 * `src/sync/deviceRemote.ts` for the privacy invariant).
 */
import { useEffect, useSyncExternalStore } from 'react';

import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { getStore } from '@/store';
import { useSyncContext } from '@/sync';
import { DeviceBridge } from '@/sync/device';
import { createDeviceApi } from '@/sync/deviceApi';
import { createDeviceRemote } from '@/sync/deviceRemote';
import { EMPTY_DEVICE_STATE, type DeviceState } from '@/sync/deviceTypes';
import { onForeground } from '@/sync/lifecycle';
import { createDeviceStore } from '@/sync/storage';

let bridge: DeviceBridge | null = null;
let bridgeUser: string | null = null;
let refs = 0;
let off: (() => void) | null = null;
let snapshot: DeviceState = EMPTY_DEVICE_STATE;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

const api = createDeviceApi();
/** Phone calendars exist on this platform at all (false on web). */
export const deviceSupported: boolean = api.supported;

function setBridge(next: DeviceBridge | null, user: string | null): void {
  off?.();
  off = null;
  const prev = bridge;
  bridge = next;
  bridgeUser = user;
  snapshot = next ? next.getState() : EMPTY_DEVICE_STATE;
  if (next) off = next.subscribe(() => {
    snapshot = next.getState();
    notify();
  });
  notify();
  if (prev) void prev.stop();
}

function startFor(userId: string): void {
  if (!api.supported || !isSupabaseConfigured) return;
  if (bridge && bridgeUser === userId) return;
  const b = new DeviceBridge({
    api,
    base: createDeviceStore(),
    userId,
    remote: createDeviceRemote(supabase),
    store: getStore(),
    onForeground,
  });
  // The store is the user's loaded data only once the sync layer says so (see useDeviceBridgeHost).
  b.setStoreReady(false);
  setBridge(b, userId);
  void b.start();
}

function stopBridge(): void {
  if (bridge) setBridge(null, null);
}

/** The running bridge, if any (never on web, never signed out). */
export const getDeviceBridge = (): DeviceBridge | null => bridge;

export const subscribeDeviceState = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
export const getDeviceState = (): DeviceState => snapshot;

/** Read the bridge's state (empty on web or signed out). */
export const useDeviceState = (): DeviceState => useSyncExternalStore(subscribeDeviceState, getDeviceState, getDeviceState);

/**
 * Keep the bridge running for the signed-in user while this component is mounted. It is also what
 * tells the bridge when the store holds the user's real data: until the sync layer has loaded it, the
 * bridge publishes and removes nothing.
 */
export function useDeviceBridgeHost(): void {
  const { userId, loading } = useSyncContext();
  useEffect(() => {
    if (!userId || !api.supported) return;
    refs++;
    startFor(userId);
    return () => {
      refs--;
      if (refs <= 0) {
        refs = 0;
        stopBridge();
      }
    };
  }, [userId]);
  useEffect(() => {
    if (bridge && bridgeUser === userId) bridge.setStoreReady(!loading && !!userId);
  }, [loading, userId]);
}
