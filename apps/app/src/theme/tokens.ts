/**
 * Placeholder design tokens taken from the prototype's dark surfaces.
 * TODO(phase 0/core): replace with `packages/core/tokens.ts`, generated from
 * the Design Spec reference sheet (surfaces, text opacities, accent, danger,
 * category hue formulas, avatar sizes, glyphs). Add the light scheme then.
 */
export const colors = {
  background: '#171615',
  text: '#f3efe8',
  accent: '#cf7b58',
  // Muted text and hairlines are the text colour at reduced opacity.
  textMuted: 'rgba(243, 239, 232, 0.6)',
  textFaint: 'rgba(243, 239, 232, 0.38)',
  hairline: 'rgba(243, 239, 232, 0.12)',
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
