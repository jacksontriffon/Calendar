/**
 * Home-screen widgets (docs/expo-plan.md phase 7, Design Spec WG).
 *
 * App side:      WidgetSync (mount once), snapshot, writer, queue, background.
 * iOS:           apps/app/targets/widget (SwiftUI, @bacons/apple-targets).
 * Android:       apps/app/widgets (react-native-android-widget).
 * Entry point:   apps/app/index.ts registers the Android task handler and the
 *                background task at bundle load.
 */
export { WidgetSync } from './WidgetSync';
export { setHidePrivateTitles, hidePrivateTitles, refreshNow } from './runtime';
export { buildSnapshot } from './snapshot';
export type { WidgetSnapshot } from './types';
