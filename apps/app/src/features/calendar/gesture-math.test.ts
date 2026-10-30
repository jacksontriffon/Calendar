import { stepFor } from '@calendar/core';

import {
  anchoredScroll, dragChanged, dragLabel, dragOutcome, pinchStep, stepZoom, swipeDir, swipeOffset, zoomLabel,
} from './gesture-math';

const o = { start: 540, end: 600, dayIdx: 1 };

describe('dragOutcome', () => {
  it('moves in 15 minute steps at the default zoom', () => {
    // 58px an hour: 29px is half an hour
    const r = dragOutcome('move', o, 29, 0, 58, 100, 3, stepFor(1));
    expect(r).toEqual({ start: 570, end: 630, dayIdx: 1 });
  });

  it('snaps to 5 minutes at the highest zoom and 10 one level below', () => {
    expect(stepFor(5.2)).toBe(5);
    expect(stepFor(3)).toBe(10);
    const r = dragOutcome('move', o, 7, 0, 60, 100, 3, 5);
    expect(r.start).toBe(545);
    const r2 = dragOutcome('top', o, 12, 0, 60, 100, 3, 10);
    expect(r2.start).toBe(550);
  });

  it('keeps the length and clamps the day when moving', () => {
    const r = dragOutcome('move', o, 0, 260, 58, 100, 3, 15);
    expect(r.dayIdx).toBe(2);
    expect(r.end - r.start).toBe(60);
    expect(dragOutcome('move', o, 0, -400, 58, 100, 3, 15).dayIdx).toBe(0);
  });

  it('never moves before midnight or past the last step of the day', () => {
    expect(dragOutcome('move', o, -2000, 0, 58, 100, 3, 15).start).toBe(0);
    expect(dragOutcome('move', o, 5000, 0, 58, 100, 3, 15).start).toBe(1425);
  });

  it('resizes the top edge but never below one step of length', () => {
    expect(dragOutcome('top', o, -29, 0, 58, 100, 3, 15)).toMatchObject({ start: 510, end: 600 });
    expect(dragOutcome('top', o, 900, 0, 58, 100, 3, 15)).toMatchObject({ start: 585, end: 600 });
  });

  it('resizes the bottom edge, at most 24h long', () => {
    expect(dragOutcome('bottom', o, 58, 0, 58, 100, 3, 15)).toMatchObject({ start: 540, end: 660 });
    expect(dragOutcome('bottom', o, -900, 0, 58, 100, 3, 15)).toMatchObject({ end: 555 });
    expect(dragOutcome('bottom', o, 90000, 0, 58, 100, 3, 15).end).toBe(540 + 1440);
  });

  it('labels and change detection', () => {
    expect(dragLabel('move', 'Standup')).toBe('Moved · Standup');
    expect(dragLabel('top', 'Standup')).toBe('Retimed · Standup');
    expect(dragLabel('bottom', '')).toBe('Retimed · event');
    expect(dragChanged(o, { ...o })).toBe(false);
    expect(dragChanged(o, { ...o, end: 615 })).toBe(true);
  });
});

describe('zoom and swipe', () => {
  it('pinch steps at a 1.45x change', () => {
    expect(pinchStep(1.2)).toBe(0);
    expect(pinchStep(1.5)).toBe(1);
    expect(pinchStep(0.6)).toBe(-1);
  });

  it('steps through the zoom levels and clamps at the ends', () => {
    expect(stepZoom(1, 1)).toBe(1.7);
    expect(stepZoom(1, -1)).toBe(0.6);
    expect(stepZoom(0.4, -1)).toBe(0.4);
    expect(stepZoom(5.2, 1)).toBe(5.2);
    expect(stepZoom(1.6, 0)).toBe(1.7);
  });

  it('labels zoom levels', () => {
    expect(zoomLabel(1)).toBe('Default');
    expect(zoomLabel(1.7)).toBe('+70%');
    expect(zoomLabel(0.4)).toBe('−60%');
  });

  it('swipe rubber-bands to 98px and navigates past 48px', () => {
    expect(swipeOffset(-100)).toBeCloseTo(-62);
    expect(swipeOffset(500)).toBe(98);
    expect(swipeDir(-60)).toBe(1);
    expect(swipeDir(60)).toBe(-1);
    expect(swipeDir(30)).toBe(0);
  });

  it('anchors the hour under the pinch focus', () => {
    // 9.5h at 58px/h focused 100px from the top, zooming to 100px/h
    expect(anchoredScroll(9.5, 100, 100)).toBe(850);
    expect(anchoredScroll(0.1, 100, 50)).toBe(0);
  });
});
