import { useNetworkState } from 'expo-network';

/**
 * Whether the device has an internet connection. Optimistic while unknown
 * (first render, or the platform can't tell), so a button is never disabled
 * on a guess.
 */
export function useOnline(): boolean {
  const state = useNetworkState();
  return state.isInternetReachable !== false && state.isConnected !== false;
}
