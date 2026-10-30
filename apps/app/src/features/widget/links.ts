/**
 * Deep links a widget opens (Design Spec WG 5, "Where each link lands").
 * Built here for the Android widget; the Swift extension builds the same
 * strings (`Links` in `targets/widget/Snapshot.swift`), and the tests check that
 * every one parses with the app's own `parseDeepLink`.
 */
import { APP_SCHEME } from '@/lib/deepLinks';

const enc = (s: string) => encodeURIComponent(s);

export const eventUrl = (id: string): string => `${APP_SCHEME}://event/${enc(id)}`;
export const goalUrl = (id: string): string => `${APP_SCHEME}://goal/${enc(id)}`;
/** `date` is `YYYY-MM-DD`. */
export const dayUrl = (date: string): string => `${APP_SCHEME}://day/${date}`;
export const composeUrl = (): string => `${APP_SCHEME}://compose`;
export const signinUrl = (): string => `${APP_SCHEME}://signin`;
