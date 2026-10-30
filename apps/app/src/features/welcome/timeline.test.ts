import {
  CHAR_STARTS,
  NOTE,
  TOTAL_MS,
  TYPE_END_MS,
  WELCOME_EVENTS,
  buttonAt,
  buttonStart,
  composerAt,
  dayCardAt,
  dotAt,
  eventAt,
  eventBox,
  idleCaretAt,
  isStacked,
  placeholderAt,
  sendAccentAt,
  sendScaleAt,
  taglineAt,
  thinkingBorderAt,
  thinkingPillAt,
  typedCount,
  typedTextAt,
  typingCaretAt,
} from './timeline';

const near = (a: number, b: number, d = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(d);

describe('welcome timeline', () => {
  it('types all 123 characters between 0.62 s and 4.33 s', () => {
    expect(NOTE.length).toBe(123);
    expect(CHAR_STARTS).toHaveLength(123);
    expect(CHAR_STARTS[0]).toBe(620);
    expect(CHAR_STARTS[122]).toBe(4286);
    expect(TYPE_END_MS).toBe(4331);
    for (let i = 1; i < CHAR_STARTS.length; i++) expect(CHAR_STARTS[i]).toBeGreaterThan(CHAR_STARTS[i - 1]);
  });

  it('character gaps are 20-27 ms, and a comma holds ~115 ms', () => {
    const gaps = CHAR_STARTS.map((s, i) => (i < CHAR_STARTS.length - 1 ? CHAR_STARTS[i + 1] - s : TYPE_END_MS - s));
    gaps.forEach((g, i) => {
      if (NOTE[i] === ',') expect(g).toBeGreaterThanOrEqual(110);
      else if (i < gaps.length - 1) {
        expect(g).toBeGreaterThanOrEqual(20);
        expect(g).toBeLessThanOrEqual(27);
      }
    });
    const plain = gaps.filter((_, i) => NOTE[i] !== ',' && i < gaps.length - 1);
    const mean = plain.reduce((a, b) => a + b, 0) / plain.length;
    expect(mean).toBeGreaterThan(22);
    expect(mean).toBeLessThan(25);
  });

  it('typedCount follows the clock', () => {
    expect(typedCount(0)).toBe(0);
    expect(typedCount(619)).toBe(0);
    expect(typedCount(620)).toBe(1);
    expect(typedCount(776)).toBe(8);
    expect(typedCount(TOTAL_MS)).toBe(123);
  });

  it('tagline fades in over 500 ms', () => {
    expect(taglineAt(0)).toEqual({ opacity: 0, translateY: 6 });
    near(taglineAt(250).opacity, 0.5);
    expect(taglineAt(900)).toEqual({ opacity: 1, translateY: 0 });
  });

  it('idle: placeholder and caret show, the send button is grey, the pill is hidden', () => {
    expect(placeholderAt(0)).toBe(1);
    expect(idleCaretAt(0)).toBe(1);
    expect(sendAccentAt(0)).toBe(0);
    expect(thinkingPillAt(0)).toBe(0);
    expect(composerAt(0).opacity).toBe(1);
  });

  it('typing: placeholder gone within 80 ms, send turns accent over 180 ms', () => {
    expect(placeholderAt(700)).toBe(0);
    expect(idleCaretAt(621)).toBe(0);
    near(sendAccentAt(620 + 90), 0.5);
    expect(sendAccentAt(1000)).toBe(1);
    expect(typingCaretAt(1000)).toBe(1);
    expect(typingCaretAt(100)).toBe(0);
  });

  it('send: button presses to 0.88 by 4.31 s and releases by 4.46 s', () => {
    expect(sendScaleAt(4200)).toBe(1);
    near(sendScaleAt(4311), 0.88);
    near(sendScaleAt(4331), 0.88);
    expect(sendScaleAt(4331 + 130)).toBe(1);
  });

  it('send: the composer pulses to 0.98 and back over 500 ms', () => {
    expect(composerAt(TYPE_END_MS).scale).toBe(1);
    near(composerAt(TYPE_END_MS + 125).scale, 0.98);
    near(composerAt(TYPE_END_MS + 500).scale, 1);
  });

  it('text clears 40 ms after the send with a 100 ms fade; the placeholder returns', () => {
    expect(typedTextAt(4371)).toBe(1);
    near(typedTextAt(4421), 0.5);
    expect(typedTextAt(4471)).toBe(0);
    expect(placeholderAt(4371 + 200)).toBe(1);
  });

  it('thinking pill fades in from 4.51 s (300 ms) and out from 5.65 s (250 ms)', () => {
    expect(thinkingPillAt(4511)).toBe(0);
    near(thinkingPillAt(4661), 0.5);
    expect(thinkingPillAt(5000)).toBe(1);
    near(thinkingPillAt(5651 + 125), 0.5);
    expect(thinkingPillAt(5901)).toBe(0);
    expect(thinkingBorderAt(5000)).toBe(1);
    expect(thinkingBorderAt(6000)).toBe(0);
  });

  it('day card rises 10 px over 400 ms from 5.75 s', () => {
    expect(dayCardAt(5751)).toEqual({ opacity: 0, translateY: 10 });
    near(dayCardAt(5951).opacity, 0.5);
    expect(dayCardAt(6151)).toEqual({ opacity: 1, translateY: 0 });
  });

  it('ten events, 220 ms apart from 6.05 s, last at 8.03 s', () => {
    expect(WELCOME_EVENTS).toHaveLength(10);
    expect(WELCOME_EVENTS.map((e) => e.at)).toEqual([6051, 6271, 6491, 6711, 6931, 7151, 7371, 7591, 7811, 8031]);
    expect(WELCOME_EVENTS.map((e) => e.title)).toEqual([
      'Gym', 'School run', 'Standup', 'Deep work', 'Lunch with Sam', 'Q4 plan', '1:1 with Maya', 'Dentist', 'Pick up kids', 'Family dinner',
    ]);
  });

  it('each event takes 500 ms: opacity, 10 px rise, scale .96 -> 1', () => {
    const start = eventAt(6051, 6051);
    expect(start).toEqual({ opacity: 0, translateY: 10, scale: 0.96 });
    const end = eventAt(6551, 6051);
    expect(end).toEqual({ opacity: 1, translateY: 0, scale: 1 });
    const mid = eventAt(6301, 6051);
    expect(mid.opacity).toBe(1);
    expect(mid.scale).toBeGreaterThan(0.96);
    expect(mid.scale).toBeLessThan(1);
    expect(eventAt(8031 + 500, 8031).opacity).toBe(1);
  });

  it('events sit on the 7am-7pm grid as percentages', () => {
    const gym = eventBox(WELCOME_EVENTS[0]);
    near(gym.topPct, 0);
    near(gym.heightPct, 8.3333, 1e-3);
    near(eventBox(WELCOME_EVENTS[1]).topPct, 10.4167, 1e-3);
    near(eventBox(WELCOME_EVENTS[9]).topPct + eventBox(WELCOME_EVENTS[9]).heightPct, 100, 1e-9);
    expect(isStacked(WELCOME_EVENTS[0])).toBe(true);
    expect(isStacked(WELCOME_EVENTS[1])).toBe(false);
    expect(isStacked(WELCOME_EVENTS[7])).toBe(true);
  });

  it('the input fades 8.60 -> 9.00 s and is gone just before the buttons', () => {
    expect(composerAt(8600).opacity).toBe(1);
    near(composerAt(8800).opacity, 0.5);
    expect(composerAt(9000).opacity).toBe(0);
    expect(composerAt(8899).visible).toBe(true);
    expect(composerAt(8900).visible).toBe(false);
  });

  it('buttons arrive 180 ms apart, 480 ms each, rising 16 px', () => {
    expect(buttonStart(0)).toBe(9000);
    expect(buttonStart(1)).toBe(9180);
    expect(buttonAt(8999, 9000).visible).toBe(false);
    expect(buttonAt(9000, 9000)).toEqual({ opacity: 0, translateY: 16, visible: true });
    expect(buttonAt(9480, 9000)).toEqual({ opacity: 1, translateY: 0, visible: true });
    expect(buttonAt(9180, 9180).opacity).toBe(0);
    expect(buttonAt(9660, 9180)).toEqual({ opacity: 1, translateY: 0, visible: true });
    expect(TOTAL_MS).toBe(9700);
  });

  it('end state at 9.7 s: everything settled', () => {
    expect(taglineAt(TOTAL_MS).opacity).toBe(1);
    expect(dayCardAt(TOTAL_MS).opacity).toBe(1);
    WELCOME_EVENTS.forEach((e) => expect(eventAt(TOTAL_MS, e.at).opacity).toBe(1));
    expect(composerAt(TOTAL_MS).opacity).toBe(0);
    expect(thinkingPillAt(TOTAL_MS)).toBe(0);
    expect(buttonAt(TOTAL_MS, buttonStart(1)).opacity).toBe(1);
  });

  it('dots bounce every 1.1 s, 160 ms apart', () => {
    expect(dotAt(0, 0)).toEqual({ opacity: 0.25, translateY: -0 });
    near(dotAt(440, 0).opacity, 1);
    near(dotAt(440, 0).translateY, -2);
    near(dotAt(440 + 160, 1).opacity, 1);
    near(dotAt(1100, 0).opacity, 0.25);
  });
});
