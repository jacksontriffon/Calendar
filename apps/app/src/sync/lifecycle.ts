import { AppState } from 'react-native';

/** Calls `cb` whenever the app comes back to the foreground (react-native-web maps this to tab visibility). */
export function onForeground(cb: () => void): () => void {
  const sub = AppState.addEventListener('change', (s) => {
    if (s === 'active') cb();
  });
  return () => sub.remove();
}
