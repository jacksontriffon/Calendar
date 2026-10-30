/**
 * Notification priming (OA 2.9-2.12). The system prompt is only shown after
 * the priming screen: a refusal at the iOS dialog is permanent, so we ask
 * once, when the user has said yes.
 */
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

/** Android channel ids; the reminder / check-in schedulers (later phases) post to these. */
export const CHANNELS = {
  reminders: 'reminders',
  checkins: 'checkins',
} as const;

/** Create the reminder and check-in channels (Android only; needed before the permission prompt on 13+). */
export async function ensureNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNELS.reminders, {
      name: 'Event reminders',
      description: 'A nudge when an event is about to start.',
      importance: AndroidImportance.HIGH,
    });
    await Notifications.setNotificationChannelAsync(CHANNELS.checkins, {
      name: 'Check-ins',
      description: 'A short check-in when you come back after a while.',
      importance: AndroidImportance.DEFAULT,
    });
  } catch {
    // Channels are re-created by whoever schedules the first notification.
  }
}

export type NotificationPermission = 'granted' | 'denied';

/** Show the system prompt (a no-op returning the current state if already decided). */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  try {
    await ensureNotificationChannels();
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return 'granted';
    if (!current.canAskAgain && current.status === 'denied') return 'denied';
    const next = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    return next.granted ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}
