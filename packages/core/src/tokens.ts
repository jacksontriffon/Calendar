/**
 * Design tokens: category swatches, surfaces, text, accent and the goal-ring
 * geometry. Colours are plain values (hex / rgba) so React Native and the
 * widgets can use them; `paintCss` keeps the prototype's CSS `color-mix`
 * strings for the web build.
 */

/** Category hue -> swatch colour. `1000` is the neutral grey. */
export const SWATCH: Record<number, string> = {
  28: '#d97757', 60: '#d4a27f', 125: '#788c5d', 170: '#8fb3a6',
  240: '#6a9bcc', 290: '#9a8fbf', 350: '#c4758a', 1000: '#b0aea5',
};
/** Order of the colour picker. */
export const PICKER: readonly number[] = [28, 60, 125, 170, 240, 290, 350, 1000];

/**
 * Snap any hue (legacy 0..360 values, garbage, NaN) to the nearest picker
 * swatch. Exact swatch keys pass through; non-finite input is 60; the grey
 * `1000` is never chosen by distance.
 */
export const snapHue = (h: number): number => {
  h = Number(h);
  if (SWATCH[h]) return h;
  if (!isFinite(h)) return 60;
  h = ((h % 360) + 360) % 360;
  let best = 28;
  let bd = 999;
  for (const k of PICKER) {
    if (k === 1000) continue;
    const d = Math.min(Math.abs(k - h), 360 - Math.abs(k - h));
    if (d < bd) { bd = d; best = k; }
  }
  return best;
};

/* ---------- base surfaces / text ---------- */

export const SURFACE = {
  /** App background and the "ink" colours mix toward. */
  bg: '#171615',
  /** Sheets, popovers. */
  sheet: '#221f1d',
  /** Hour grid lines. */
  grid: '#2e2d2c',
  /** Toast background (rgba). */
  toast: 'rgba(40,37,35,0.96)',
  /** Dark text on accent buttons / today's date chip. */
  onAccent: '#171615',
} as const;

/** Primary text; everything else is this colour at an opacity. */
export const TEXT = '#f3efe8';
export const TEXT_RGB = [243, 239, 232] as const;

/** Opacities the prototype uses for text on dark surfaces. */
export const TEXT_ALPHA = {
  primary: 1, high: 0.85, body: 0.8, strong: 0.7, mid: 0.55, soft: 0.45, muted: 0.4, faint: 0.3,
} as const;

/** Hairlines and fills are white at low opacity. */
export const HAIRLINE_ALPHA = { grid: 0.055, divider: 0.06, subtle: 0.08, edge: 0.09, field: 0.1, strong: 0.16 } as const;

export const ACCENT = '#cf7b58';
/** Accent-tinted text (all-day goal pill). */
export const ACCENT_INK = '#f0d9c8';
export const DANGER = '#e8745f';
export const DANGER_SOFT = '#f0b3a4';
/** "Behind pace" sub-title colour. */
export const BEHIND_INK = '#e0a08c';

/** `#rrggbb` + alpha -> `rgba(r,g,b,a)`. */
export const withAlpha = (hex: string, a: number): string => {
  const [r, g, b] = hexToRgb(hex);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + +a.toFixed(3) + ')';
};
/** Primary text at an opacity, e.g. `text(0.55)`. */
export const text = (a: number): string => withAlpha(TEXT, a);
/** White at an opacity (hairlines, tracks, pressed states). */
export const white = (a: number): string => 'rgba(255,255,255,' + a + ')';

/* ---------- goal ring (also used by the widgets) ---------- */

export const RING = {
  /** SVG viewBox is 0 0 18 18, the ring starts at 12 o'clock and runs clockwise. */
  viewBox: 18,
  cx: 9,
  cy: 9,
  r: 7.5,
  stroke: 2.5,
  /** 2πr */
  circumference: 2 * Math.PI * 7.5,
  /** Degrees to rotate a circle drawn from 3 o'clock so it starts at the top. */
  rotation: -90,
  /** Track colour behind the arc. */
  track: 'rgba(255,255,255,.08)',
} as const;

/** strokeDasharray / strokeDashoffset for a ring filled to `fraction` (clamped to 0..1). */
export const ringDash = (fraction: number): { dasharray: number; dashoffset: number } => {
  const f = Math.max(0, Math.min(1, Number(fraction) || 0));
  return { dasharray: RING.circumference, dashoffset: RING.circumference * (1 - f) };
};

/* ---------- colour maths (sRGB <-> OKLab) ---------- */

export const hexToRgb = (hex: string): [number, number, number] => {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const toLin = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const fromLin = (v: number): number => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
};
const hex2 = (n: number): string => (n < 16 ? '0' : '') + n.toString(16);
export const rgbToHex = (r: number, g: number, b: number): string => '#' + hex2(r) + hex2(g) + hex2(b);

export type Lab = [number, number, number];

export const hexToOklab = (hex: string): Lab => {
  const [R, G, B] = hexToRgb(hex).map(toLin);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};

/** OKLab -> `#rrggbb`, clipping out-of-gamut channels. */
export const oklabToHex = (L: number, a: number, b: number): string => {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return rgbToHex(
    fromLin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLin(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  );
};

/** `oklch(L C h)` -> `#rrggbb` (h in degrees). */
export const oklchToHex = (L: number, C: number, h: number): string => {
  const r = (h * Math.PI) / 180;
  return oklabToHex(L, C * Math.cos(r), C * Math.sin(r));
};

/**
 * Numeric equivalent of CSS `color-mix(in oklab, a pct%, b)`: `pct` percent of
 * `a` and the rest of `b`, interpolated linearly in OKLab. Returns `#rrggbb`.
 */
export const mixOklab = (a: string, pct: number, b: string): string => {
  const t = pct / 100;
  const A = hexToOklab(a);
  const B = hexToOklab(b);
  return oklabToHex(A[0] * t + B[0] * (1 - t), A[1] * t + B[1] * (1 - t), A[2] * t + B[2] * (1 - t));
};

/* ---------- paint ---------- */

export interface Paint {
  /** Swatch colour itself: block edge, dots, bars. */
  edge: string;
  /** Block background. */
  fill: string;
  /** Block strokes / progress fill. */
  line: string;
  /** Block text. */
  ink: string;
  /** Secondary block text. */
  mid: string;
}

/** The five colours derived from a category hue, as plain hex values. */
export const paint = (h: number): Paint => {
  const b = SWATCH[snapHue(h)];
  return {
    edge: b,
    fill: mixOklab(b, 28, SURFACE.bg),
    line: mixOklab(b, 58, SURFACE.bg),
    ink: mixOklab(b, 32, TEXT),
    mid: mixOklab(mixOklab(b, 55, TEXT), 62, SURFACE.bg),
  };
};

/** The prototype's original CSS strings (`color-mix(in oklab, …)`) for the web build. */
export const paintCss = (h: number): Paint => {
  const b = SWATCH[snapHue(h)];
  return {
    edge: b,
    fill: 'color-mix(in oklab, ' + b + ' 28%, ' + SURFACE.bg + ')',
    line: 'color-mix(in oklab, ' + b + ' 58%, ' + SURFACE.bg + ')',
    ink: 'color-mix(in oklab, ' + b + ' 32%, ' + TEXT + ')',
    mid: 'color-mix(in oklab, color-mix(in oklab, ' + b + ' 55%, ' + TEXT + ') 62%, ' + SURFACE.bg + ')',
  };
};

/** Pace colours (ahead / slightly behind / far behind), as oklch for web and hex for native. */
export const PACE = {
  good: { css: 'oklch(0.76 0.13 150)', hex: oklchToHex(0.76, 0.13, 150) },
  warn: { css: 'oklch(0.8 0.13 80)', hex: oklchToHex(0.8, 0.13, 80) },
  bad: { css: 'oklch(0.7 0.15 30)', hex: oklchToHex(0.7, 0.15, 30) },
} as const;
