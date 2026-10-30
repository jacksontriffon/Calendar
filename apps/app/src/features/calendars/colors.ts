/**
 * Colours for imported Google events (open question 4, chosen default: imported events have no
 * category and are painted in their Google calendar's colour), and the 4px calendar bar / "on another
 * calendar" dot. `paintFromHex` derives the same five colours core's `paint(hue)` gives a category, from
 * an arbitrary hex.
 */
import { SURFACE, TEXT, mixOklab, type Paint } from '@calendar/core';

/** Used when Google gave no colour, or one we can't read: the neutral grey swatch. */
export const FALLBACK_CALENDAR_COLOR = '#b0aea5';

const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;

/** `#rrggbb` from `#rgb`, `rrggbb`, `#RRGGBB`; the fallback grey for anything else. */
export function normalizeHex(c: string | null | undefined): string {
  const m = HEX.exec((c ?? '').trim());
  if (!m) return FALLBACK_CALENDAR_COLOR;
  let h = m[1].toLowerCase();
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  return '#' + h;
}

/** The block colours for an arbitrary calendar colour (same formulas as `paint`). */
export function paintFromHex(color: string | null | undefined): Paint {
  const b = normalizeHex(color);
  return {
    edge: b,
    fill: mixOklab(b, 28, SURFACE.bg),
    line: mixOklab(b, 58, SURFACE.bg),
    ink: mixOklab(b, 32, TEXT),
    mid: mixOklab(mixOklab(b, 55, TEXT), 62, SURFACE.bg),
  };
}
