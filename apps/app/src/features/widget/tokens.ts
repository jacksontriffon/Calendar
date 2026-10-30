/**
 * Widget colours (Design Spec WG, "Colour"): text is white on dark and black on
 * light, never coloured. Category and goal hues appear only on event bars and
 * goal rings. Values come from the frames in WG 1; hues are the core swatches.
 */
import { ACCENT, PACE, SWATCH } from '@calendar/core';

import type { Palette, WidgetTokens } from './types';

export const DARK: Palette = {
  bg: '#1b1a18',
  ink: '#ffffff',
  secondary: 0.62,
  tertiary: 0.42,
  hairline: 0.12,
  track: 0.1,
  checkRing: 0.5,
  subtle: 0.07,
  button: 0.14,
};

export const LIGHT: Palette = {
  bg: '#f6f3ee',
  ink: '#000000',
  secondary: 0.62,
  tertiary: 0.46,
  hairline: 0.12,
  track: 0.09,
  checkRing: 0.45,
  subtle: 0.05,
  button: 0.1,
};

/** The accent is in the snapshot's prefs for completeness; the widget keeps it off the "+" and the now line (open question 7). */
export const WIDGET_ACCENT = ACCENT;

export function widgetTokens(): WidgetTokens {
  const swatch: Record<string, string> = {};
  for (const [hue, hex] of Object.entries(SWATCH)) swatch[hue] = hex;
  return { light: { ...LIGHT }, dark: { ...DARK }, swatch, amber: PACE.warn.hex };
}

/** `#rrggbb` + alpha -> `rgba(r, g, b, a)` (with the spaces react-native-android-widget parses). */
export function ink(p: Palette, alpha: number): `rgba(${number}, ${number}, ${number}, ${number})` {
  const h = p.ink.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${+alpha.toFixed(3)})`;
}
