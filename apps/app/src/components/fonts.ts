/**
 * Typeface mapping for the Serif / Sans / Mono preference (`prefs.font`), on
 * top of the families loaded by `@/lib/fonts` (Spectral, Geist, Geist Mono;
 * Newsreader for the serif display face). React Native picks a weight by
 * family name there, so a requested `fontWeight` is snapped to a loaded file
 * and `fontWeight` itself is reset to normal.
 */
import type { TextStyle } from 'react-native';

import { asFontKind, displayFamily, fontFamily, type FontKind } from '@/lib/fonts';

export type FontKey = FontKind;

export const FONT_LABELS: Record<FontKey, string> = { serif: 'Spectral', sans: 'Geist', mono: 'Geist Mono' };

export const asFontKey = asFontKind;

/** CSS-style weight from a style's `fontWeight` ('600', 'bold', 650...). */
export function weightOf(w: TextStyle['fontWeight']): number {
  if (w == null || w === 'normal') return 400;
  if (w === 'bold') return 600;
  const n = Number(w);
  return Number.isFinite(n) ? n : 400;
}

/** `fontFamily` for a preference value at a weight. */
export function fontFamilyFor(f: string | null | undefined, weight = 400): string {
  return fontFamily(asFontKind(f), weight);
}

/** The display face (calendar title): Newsreader with serif, else the chosen face. */
export function displayFamilyFor(f: string | null | undefined, weight = 400): string {
  return displayFamily(asFontKind(f), weight);
}

/** Style overrides that put a text style into the app's typeface: family by weight, `fontWeight` normal. */
export function typeface(f: string | null | undefined, flat: TextStyle | undefined, display = false): TextStyle {
  const w = weightOf(flat?.fontWeight);
  return { fontFamily: display ? displayFamilyFor(f, w) : fontFamilyFor(f, w), fontWeight: 'normal' };
}
