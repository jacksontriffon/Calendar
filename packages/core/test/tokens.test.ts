import { describe, expect, it } from 'vitest';
import {
  ACCENT, DANGER, hexToRgb, mixOklab, oklchToHex, paint, paintCss, PACE, PICKER, RING, ringDash, snapHue, SURFACE, SWATCH, TEXT, text,
  withAlpha,
} from '../src/index.ts';

/* An independent OKLab implementation following CSS Color 4 (via XYZ D65) to check ours. */
type M3 = [[number, number, number], [number, number, number], [number, number, number]];
const mul = (m: M3, v: number[]) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const inv = (m: M3): M3 => {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
};
const SRGB2XYZ: M3 = [[0.41239079926595934, 0.357584339383878, 0.1804807884018343], [0.21263900587151027, 0.715168678767756, 0.07219231536073371], [0.01933081871559182, 0.11919477979462598, 0.9505321522496607]];
const XYZ2LMS: M3 = [[0.819022437996703, 0.3619062600528904, -0.1288737815209879], [0.0329836539323885, 0.9292868615863434, 0.0361446663506424], [0.0481771893596242, 0.2642395317527308, 0.6335478284694309]];
const LMS2LAB: M3 = [[0.210454268309314, 0.7936177747023054, -0.0040720430116193], [1.9779985324311684, -2.42859224204858, 0.450593709617411], [0.0259040424655478, 0.7827717124575296, -0.8086757549230774]];
const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const gam = (v: number) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
const toLab = (hex: string) => mul(LMS2LAB, mul(XYZ2LMS, mul(SRGB2XYZ, hexToRgb(hex).map(lin))).map(Math.cbrt));
const fromLab = (lab: number[]) => mul(inv(SRGB2XYZ), mul(inv(XYZ2LMS), mul(inv(LMS2LAB), lab).map((x) => x ** 3))).map((x) => Math.max(0, Math.min(255, gam(x))));
const refMix = (a: string, pct: number, b: string) => { const A = toLab(a), B = toLab(b); return fromLab(A.map((x, i) => (x * pct) / 100 + B[i] * (1 - pct / 100))); };
const near = (hex: string, ref: number[]) => hexToRgb(hex).forEach((c, i) => expect(Math.abs(c - ref[i])).toBeLessThanOrEqual(1));

describe('swatches and snapHue', () => {
  it('exact swatch hues pass through', () => PICKER.forEach((h) => expect(snapHue(h)).toBe(h)));
  it('legacy hues snap to the nearest swatch, circularly', () => {
    expect(snapHue(255)).toBe(240);
    expect(snapHue(72)).toBe(60);
    expect(snapHue(132)).toBe(125);
    expect(snapHue(166)).toBe(170);
    expect(snapHue(12)).toBe(28);
    expect(snapHue(0)).toBe(350); // 10 away from 350 across the wrap, 28 from 28
    expect(snapHue(359)).toBe(350);
    expect(snapHue(-10)).toBe(350);
    expect(snapHue(375)).toBe(28);
  });
  it('garbage becomes 60, and grey is never picked by distance', () => {
    expect(snapHue(NaN)).toBe(60);
    expect(snapHue(Infinity)).toBe(60);
    expect(snapHue('x' as unknown as number)).toBe(60);
    expect(snapHue(1000)).toBe(1000);
    expect(snapHue(999)).not.toBe(1000);
  });
});

describe('oklab mixing', () => {
  it('endpoints', () => {
    expect(mixOklab('#d97757', 100, '#171615')).toBe('#d97757');
    expect(mixOklab('#d97757', 0, '#171615')).toBe('#171615');
  });
  it('white/black 50% is the CSS value rgb(99,99,99)', () => expect(mixOklab('#ffffff', 50, '#000000')).toBe('#636363'));
  it('agrees with an independent CSS-Color-4 implementation within 1/255', () => {
    PICKER.forEach((h) => {
      const b = SWATCH[h];
      [[28, SURFACE.bg], [58, SURFACE.bg], [32, TEXT]].forEach(([pct, other]) => near(mixOklab(b, pct as number, other as string), refMix(b, pct as number, other as string)));
    });
  });
  it('oklch pace colours are in the expected ballpark', () => {
    expect(PACE.good.hex).toMatch(/^#[0-9a-f]{6}$/);
    const [r, g, b] = hexToRgb(PACE.good.hex);
    expect(g).toBeGreaterThan(r); // green-ish
    expect(g).toBeGreaterThan(b - 40);
    const [r2, g2] = hexToRgb(PACE.bad.hex);
    expect(r2).toBeGreaterThan(g2); // red-ish
    expect(oklchToHex(0.5, 0, 0)).toBe('#636363'); // neutral L=.5
  });
});

describe('paint', () => {
  it('returns plain hex values, not css', () => {
    PICKER.forEach((h) => {
      const p = paint(h);
      Object.values(p).forEach((v) => expect(v).toMatch(/^#[0-9a-f]{6}$/));
      expect(p.edge).toBe(SWATCH[h]);
    });
  });
  it('matches the independent mix for every channel', () => {
    const b = SWATCH[28];
    const p = paint(28);
    near(p.fill, refMix(b, 28, '#171615'));
    near(p.line, refMix(b, 58, '#171615'));
    near(p.ink, refMix(b, 32, '#f3efe8'));
    const inner = refMix(b, 55, '#f3efe8');
    const innerHex = '#' + inner.map((x) => x.toString(16).padStart(2, '0')).join('');
    near(p.mid, refMix(innerHex, 62, '#171615'));
  });
  it('is darker for fill than line than edge', () => {
    const lum = (hex: string) => hexToRgb(hex).reduce((a, c) => a + c, 0);
    const p = paint(240);
    expect(lum(p.fill)).toBeLessThan(lum(p.line));
    expect(lum(p.line)).toBeLessThan(lum(p.edge));
  });
  it('snaps odd hues first', () => expect(paint(255).edge).toBe(SWATCH[240]));
  it('paintCss keeps the prototype color-mix strings', () => {
    expect(paintCss(28)).toEqual({
      edge: '#d97757',
      fill: 'color-mix(in oklab, #d97757 28%, #171615)',
      line: 'color-mix(in oklab, #d97757 58%, #171615)',
      ink: 'color-mix(in oklab, #d97757 32%, #f3efe8)',
      mid: 'color-mix(in oklab, color-mix(in oklab, #d97757 55%, #f3efe8) 62%, #171615)',
    });
  });
});

describe('surfaces, text, ring', () => {
  it('prototype constants', () => {
    expect(SURFACE.bg).toBe('#171615');
    expect(TEXT).toBe('#f3efe8');
    expect(ACCENT).toBe('#cf7b58');
    expect(DANGER).toBe('#e8745f');
    expect(text(0.55)).toBe('rgba(243,239,232,0.55)');
    expect(withAlpha('#ffffff', 0.5)).toBe('rgba(255,255,255,0.5)');
  });
  it('ring geometry: 18-unit viewBox, r 7.5, stroke 2.5, starts at top', () => {
    expect(RING.viewBox).toBe(18);
    expect(RING.r).toBe(7.5);
    expect(RING.stroke).toBe(2.5);
    expect(RING.cx).toBe(9);
    expect(RING.rotation).toBe(-90);
    expect(RING.circumference).toBeCloseTo(2 * Math.PI * 7.5, 10);
  });
  it('ringDash', () => {
    expect(ringDash(0).dashoffset).toBeCloseTo(RING.circumference, 10);
    expect(ringDash(1).dashoffset).toBe(0);
    expect(ringDash(0.5).dashoffset).toBeCloseTo(RING.circumference / 2, 10);
    expect(ringDash(7).dashoffset).toBe(0);
    expect(ringDash(-1).dashoffset).toBeCloseTo(RING.circumference, 10);
    expect(ringDash(NaN).dashoffset).toBeCloseTo(RING.circumference, 10);
    expect(ringDash(0.3).dasharray).toBe(RING.circumference);
  });
});
