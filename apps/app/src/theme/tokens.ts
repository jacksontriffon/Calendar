/**
 * App design tokens. Colours come from `@calendar/core` (shared with the
 * widget snapshot and the edge functions); this file adds the RN-only bits.
 * TODO: light scheme once the Design Spec's light tokens land in core.
 */
import { ACCENT, DANGER, SURFACE, TEXT, text } from '@calendar/core';

export const colors = {
  background: SURFACE.bg,
  text: TEXT,
  accent: ACCENT,
  danger: DANGER,
  textMuted: text(0.6),
  textFaint: text(0.38),
  hairline: text(0.12),
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
