import type { NetworkMonitor } from './types';

export function createNetworkMonitor(): NetworkMonitor {
  const hasWindow = typeof window !== 'undefined' && typeof navigator !== 'undefined';
  return {
    isOnline: () => (hasWindow ? navigator.onLine !== false : true),
    subscribe(listener) {
      if (!hasWindow) return () => undefined;
      const on = () => listener(true);
      const off = () => listener(false);
      window.addEventListener('online', on);
      window.addEventListener('offline', off);
      return () => {
        window.removeEventListener('online', on);
        window.removeEventListener('offline', off);
      };
    },
  };
}
