/**
 * Connectivity. This is the fallback (always online); Metro picks
 * `network.native.ts` (NetInfo) on iOS and Android and `network.web.ts`
 * (`navigator.onLine`) on web.
 */
import type { NetworkMonitor } from './types';

export function createNetworkMonitor(): NetworkMonitor {
  return { isOnline: () => true, subscribe: () => () => undefined };
}
