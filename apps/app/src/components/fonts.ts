/**
 * Typeface mapping for the Serif / Sans / Mono preference (`prefs.font`).
 *
 * The prototype uses Spectral (serif), Geist (sans) and Geist Mono. Until the
 * font files are loaded with expo-font in the root layout, each key maps to a
 * system family. When they are, call `setFontFamilies({ serif: 'Spectral', ... })`
 * once after `useFonts` resolves and every `AppText` follows.
 */
import { Platform } from 'react-native';

export type FontKey = 'serif' | 'sans' | 'mono';

export const FONT_LABELS: Record<FontKey, string> = { serif: 'Spectral', sans: 'Geist', mono: 'Geist Mono' };

const system: Record<FontKey, string | undefined> = {
  serif: Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia, "Times New Roman", serif' }),
  sans: Platform.select({
    ios: undefined,
    android: undefined,
    default: '-apple-system, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif',
  }),
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, SFMono-Regular, Menlo, monospace' }),
};

let overrides: Partial<Record<FontKey, string>> = {};

/** Register the loaded font family names (call after expo-font has loaded them). */
export function setFontFamilies(map: Partial<Record<FontKey, string>>): void {
  overrides = { ...overrides, ...map };
}

export const asFontKey = (f: string | null | undefined): FontKey => (f === 'sans' || f === 'mono' ? f : 'serif');

/** `fontFamily` for a preference value (unknown values fall back to serif). */
export function fontFamilyFor(f: string | null | undefined): string | undefined {
  const k = asFontKey(f);
  return overrides[k] ?? system[k];
}
