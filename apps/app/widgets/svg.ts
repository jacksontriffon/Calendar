/**
 * SVG strings for the Android widget (SvgWidget draws them natively). Shapes
 * copy the app's: the goal ring is the 18-unit viewBox, r 7.5, stroke 2.5,
 * starting at 12 o'clock and running clockwise (core `RING`).
 */
import { RING, ringDash } from '@calendar/core';

const hex = (c: string) => c.replace('#', '');

/** A goal ring filled to `fraction`. With 0 only the track is drawn (the empty-day frames). */
export function ringSvg(color: string, trackColor: string, trackAlpha: number, fraction: number): string {
  const { cx, cy, r, stroke, viewBox, rotation } = RING;
  const { dasharray, dashoffset } = ringDash(fraction);
  const arc =
    fraction > 0
      ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#${hex(color)}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${dasharray.toFixed(2)}" stroke-dashoffset="${dashoffset.toFixed(2)}"/>`
      : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${viewBox}" height="${viewBox}" viewBox="0 0 ${viewBox} ${viewBox}">` +
    `<g transform="rotate(${rotation} ${cx} ${cy})">` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#${hex(trackColor)}" stroke-opacity="${trackAlpha}" stroke-width="${stroke}"/>` +
    arc +
    `</g></svg>`
  );
}

const wrap = (size: number, vb: number, body: string, stroke: string, sw: number, opacity = 1) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${vb} ${vb}" fill="none" stroke="#${hex(stroke)}" stroke-opacity="${opacity}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const plusSvg = (color: string, size = 13, opacity = 1): string => wrap(size, 14, '<path d="M7 2v10M2 7h10"/>', color, 2, opacity);

export const checkSvg = (color: string, size = 11): string => wrap(size, 24, '<path d="M5 12.5l4.5 4.5L19 7.5"/>', color, 3);

export const lockSvg = (color: string, size = 11, opacity = 1): string =>
  wrap(size, 24, '<rect x="5" y="11" width="14" height="9.5" rx="2.4"/><path d="M8 11V8.2a4 4 0 0 1 8 0V11"/>', color, 2.4, opacity);

export const globeSvg = (color: string, size = 11, opacity = 1): string =>
  wrap(size, 24, '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.4 3.8 5.5 3.8 9S14.5 18.6 12 21c-2.5-2.4-3.8-5.5-3.8-9S9.5 5.4 12 3z"/>', color, 2.4, opacity);

export const cloudOffSvg = (color: string, size = 11): string =>
  wrap(size, 24, '<path d="M9 5.6A6 6 0 0 1 18 10a4.5 4.5 0 0 1 3 7.4M6 18.5a4.5 4.5 0 0 1-.9-8.9"/><path d="M5.6 18.5H17"/><path d="m3 3 18 18"/>', color, 2);

export const calendarSvg = (color: string, size = 20, opacity = 1): string =>
  wrap(size, 14, '<rect x="1.8" y="2.6" width="10.4" height="9.6" rx="2"/><path d="M1.8 6h10.4M4.6 1.2v2.4M9.4 1.2v2.4"/>', color, 1.2, opacity);
