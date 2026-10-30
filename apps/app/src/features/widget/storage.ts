/**
 * Shared widget storage, web and fallback: widgets do not exist on the web
 * build, so this is a quiet in-memory stand-in and `reload` does nothing.
 * Metro picks `storage.ios.ts` (App Group) and `storage.android.ts` (MMKV).
 */
import { createMemoryWidgetStorage } from './memoryStorage';
import type { WidgetStorage } from './types';

export { createMemoryWidgetStorage };

/** The widget storage for this platform (none on the web). */
export const widgetStorage: WidgetStorage = createMemoryWidgetStorage();

/** True where a widget exists to feed (iOS and Android). */
export const widgetsSupported = false;
