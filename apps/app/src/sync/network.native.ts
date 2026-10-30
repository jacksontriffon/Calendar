import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

import type { NetworkMonitor } from './types';

/** Connected, and not known to be without internet (`isInternetReachable` is null while unknown). */
const online = (s: NetInfoState): boolean => s.isConnected !== false && s.isInternetReachable !== false;

export function createNetworkMonitor(): NetworkMonitor {
  let current = true;
  const listeners = new Set<(online: boolean) => void>();
  const set = (next: boolean) => {
    if (next === current) return;
    current = next;
    listeners.forEach((l) => l(next));
  };
  let unsubscribe: (() => void) | null = null;
  const attach = () => {
    if (unsubscribe) return;
    unsubscribe = NetInfo.addEventListener((s) => set(online(s)));
    void NetInfo.fetch().then((s) => set(online(s)));
  };
  return {
    isOnline: () => {
      attach();
      return current;
    },
    subscribe(listener) {
      attach();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size && unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      };
    },
  };
}
