/**
 * Background refresh of the widget snapshot (`expo-background-task`: iOS
 * BGTaskScheduler, Android WorkManager).
 *
 * `defineTask` must run when the JS bundle loads, not inside a component, so
 * `apps/app/index.ts` imports this file. The task:
 *   1. applies checks tapped on the widget (queued while the app was closed),
 *   2. pulls the latest events and goals, pushing local writes in the same sync,
 *   3. writes a fresh snapshot, which also moves `writtenAt` so the widget does
 *      not read as stale just because the app was not opened.
 * The system decides when it runs (iOS usually overnight, 15 min minimum on
 * Android), so the timeline entries and the "Updated 3h ago" state in the
 * widgets cover the time in between.
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { refreshNow } from './runtime';
import { widgetsSupported } from './storage';

export const WIDGET_REFRESH_TASK = 'calendar-widget-refresh';

/** Minutes between runs; the system treats this as a minimum, and iOS often waits much longer. */
export const REFRESH_INTERVAL_MIN = 30;

if (widgetsSupported) {
  TaskManager.defineTask(WIDGET_REFRESH_TASK, async () => {
    try {
      await refreshNow();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch (e) {
      console.warn('[widget] background refresh failed', e);
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

/** Schedule the refresh. Safe to call on every launch. */
export async function registerWidgetRefresh(): Promise<void> {
  if (!widgetsSupported) return;
  try {
    if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) return;
    if (await TaskManager.isTaskRegisteredAsync(WIDGET_REFRESH_TASK)) return;
    await BackgroundTask.registerTaskAsync(WIDGET_REFRESH_TASK, { minimumInterval: REFRESH_INTERVAL_MIN });
  } catch (e) {
    console.warn('[widget] could not register the background refresh', e);
  }
}

/** Stop refreshing (sign-out). */
export async function unregisterWidgetRefresh(): Promise<void> {
  if (!widgetsSupported) return;
  try {
    if (await TaskManager.isTaskRegisteredAsync(WIDGET_REFRESH_TASK)) await BackgroundTask.unregisterTaskAsync(WIDGET_REFRESH_TASK);
  } catch {
    // not registered
  }
}
