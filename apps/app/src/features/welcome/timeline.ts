/**
 * Welcome animation maths (Design Spec OA 1.6, prototype `.hv*` CSS).
 *
 * One clock drives everything: `t` runs 0 -> 9700 ms, linearly, once. Every
 * function below is a pure function of `t` (milliseconds), so the screen can
 * run them as Reanimated worklets and the tests can check them as plain code.
 * They are the prototype's CSS `calc(clamp(...))` expressions, term for term.
 */

export const TOTAL_MS = 9700;

export const NOTE =
  'Gym at 7, school run, standup 9, deep work till 12, lunch with Sam, Q4 plan, 1:1 Maya, dentist 3:30, kids 4:30, dinner at 6';

/** Time (ms) each of the 123 characters of `NOTE` starts typing. 20-27 ms each, a comma holds ~115 ms. */
export const CHAR_STARTS: readonly number[] = [
  620, 642, 663, 688, 709, 733, 755, 776, 799, 910, 933, 953, 974, 997, 1023, 1044, 1065, 1090,
  1117, 1141, 1164, 1281, 1301, 1327, 1349, 1370, 1391, 1413, 1439, 1461, 1485, 1509, 1622, 1646,
  1666, 1687, 1708, 1733, 1756, 1779, 1803, 1826, 1848, 1874, 1899, 1921, 1945, 1968, 1995, 2020,
  2042, 2159, 2180, 2203, 2228, 2249, 2273, 2293, 2318, 2343, 2368, 2394, 2416, 2441, 2465, 2489,
  2513, 2629, 2655, 2679, 2704, 2724, 2749, 2774, 2801, 2827, 2939, 2961, 2986, 3006, 3030, 3051,
  3072, 3092, 3118, 3139, 3251, 3273, 3300, 3320, 3343, 3367, 3394, 3420, 3446, 3468, 3491, 3513,
  3540, 3566, 3678, 3699, 3721, 3742, 3766, 3790, 3812, 3832, 3855, 3878, 3902, 4018, 4043, 4067,
  4091, 4116, 4137, 4163, 4189, 4215, 4241, 4263, 4286,
];

/** The last character finishes here; the send button presses at SEND_MS. */
export const TYPE_END_MS = 4331;
export const SEND_MS = 4201;

/** Named moments, in ms, from the spec's timing panel. */
export const T = {
  typeStart: 620,
  sendPress: 4201,
  sendRelease: 4331,
  textClear: 4371,
  thinkingIn: 4511,
  thinkingOut: 5651,
  dayIn: 5751,
  firstEvent: 6051,
  eventGap: 220,
  inputFadeStart: 8600,
  buttonsStart: 9000,
  buttonGap: 180,
} as const;

/** `clamp(0, v, 1)` */
export const clamp01 = (v: number): number => {
  'worklet';
  return v < 0 ? 0 : v > 1 ? 1 : v;
};

/** How many characters of the note are on screen at time `t`. */
export function typedCount(t: number): number {
  'worklet';
  let lo = 0;
  let hi = CHAR_STARTS.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (CHAR_STARTS[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Tagline: fades in over 500 ms with a 6 px rise. */
export function taglineAt(t: number): { opacity: number; translateY: number } {
  'worklet';
  const p = clamp01(t / 500);
  return { opacity: p, translateY: (1 - p) * 6 };
}

/** The composer pill: fades out 8.60 -> 9.00 s, pulses to 0.98 and back over 500 ms from the send. */
export function composerAt(t: number): { opacity: number; scale: number; visible: boolean } {
  'worklet';
  const x = clamp01((t - TYPE_END_MS) / 500);
  return {
    opacity: 1 - clamp01((t - T.inputFadeStart) / 400),
    scale: 1 - 0.02 * (clamp01(x / 0.25) - clamp01((x - 0.25) / 0.75)),
    // `hvGone` flips visibility at 8900 ms, just before the fade ends.
    visible: t < 8900,
  };
}

/** Border of the composer while "thinking": accent at 45% in over 300 ms, out with the pill. */
export const thinkingBorderAt = (t: number): number => {
  'worklet';
  return clamp01((t - TYPE_END_MS) / 300) * (1 - clamp01((t - T.thinkingOut) / 300));
};

/** Placeholder "Summarise your day…": there until the first character, back after the send. */
export const placeholderAt = (t: number): number => {
  'worklet';
  return clamp01(1 - clamp01((t - 620) / 80) + clamp01((t - 4371) / 200));
};

/** Idle caret, before the first character (the typing caret takes over at 620 ms). */
export const idleCaretAt = (t: number): number => {
  'worklet';
  return 1 - clamp01((t - 620) * 1000);
};

/** The typed text: fully visible while typing, fades 100 ms from 40 ms after the send. */
export const typedTextAt = (t: number): number => {
  'worklet';
  return 1 - clamp01((t - T.textClear) / 100);
};

/** Typing caret after the last typed character: shown until the final character lands. */
export const typingCaretAt = (t: number): number => {
  'worklet';
  return clamp01((t - T.typeStart) * 1000) * (1 - clamp01((t - TYPE_END_MS) * 1000)) * typedTextAt(t);
};

/** Send button press: 0.88 over 110 ms from 4.20 s, releases over 130 ms from 4.33 s. */
export const sendScaleAt = (t: number): number => {
  'worklet';
  return 1 - 0.12 * (clamp01((t - 4201) / 110) - clamp01((t - 4331) / 130));
};

/** Accent fill of the send button: fades in over 180 ms at the first character, out 140 ms after the send. */
export const sendAccentAt = (t: number): number => {
  'worklet';
  return clamp01((t - 620) / 180) * (1 - clamp01((t - 4331) / 140));
};

/** The thinking pill: in over 300 ms from 4.51 s, out over 250 ms from 5.65 s. */
export const thinkingPillAt = (t: number): number => {
  'worklet';
  return clamp01((t - T.thinkingIn) / 300) * (1 - clamp01((t - T.thinkingOut) / 250));
};

/** The day card: fades in and rises 10 px over 400 ms from 5.75 s. */
export function dayCardAt(t: number): { opacity: number; translateY: number } {
  'worklet';
  const p = clamp01((t - T.dayIn) / 400);
  return { opacity: p, translateY: (1 - p) * 10 };
}

/** One event block: 500 ms, opacity 0 -> 1, rise 10 px, scale .96 -> 1 (quartic ease-out, as the CSS). */
export function eventAt(t: number, startMs: number): { opacity: number; translateY: number; scale: number } {
  'worklet';
  const x = clamp01((t - startMs) / 500);
  const e = 1 - (1 - x) * (1 - x) * (1 - x) * (1 - x);
  return { opacity: clamp01(x * 3), translateY: (1 - e) * 10, scale: 0.96 + 0.04 * e };
}

/** A sign-in button: fades in and rises 16 px over 480 ms (ease-out cubic), starting at `startMs`. */
export function buttonAt(t: number, startMs: number): { opacity: number; translateY: number; visible: boolean } {
  'worklet';
  const e = clamp01((t - startMs) / 480);
  const p = 1 - (1 - e) * (1 - e) * (1 - e);
  return { opacity: e, translateY: (1 - p) * 16, visible: t >= T.buttonsStart };
}

/** Start time of the n-th button (0 = first in the platform's order). */
export const buttonStart = (index: number): number => T.buttonsStart + index * T.buttonGap;

/** Bouncing dots in the thinking pill: 1.1 s loop, 160 ms apart (CSS `oaDot`). */
export function dotAt(t: number, index: number): { opacity: number; translateY: number } {
  'worklet';
  const period = 1100;
  const local = (((t - index * 160) % period) + period) % period;
  const f = local / period;
  // keyframes: 0% .25/0, 40% 1/-2px, 80% .25/0, 100% .25/0
  let k: number;
  if (f < 0.4) k = f / 0.4;
  else if (f < 0.8) k = 1 - (f - 0.4) / 0.4;
  else k = 0;
  return { opacity: 0.25 + 0.75 * k, translateY: -2 * k };
}

/* ---------- the day card ---------- */

export interface WelcomeEvent {
  title: string;
  /** Label under / beside the title. */
  time: string;
  /** Swatch colour (a category colour). */
  color: string;
  /** Minutes past midnight. */
  start: number;
  end: number;
  /** Starts at this many ms. */
  at: number;
}

const ev = (i: number, title: string, time: string, color: string, start: number, end: number): WelcomeEvent => ({
  title,
  time,
  color,
  start,
  end,
  at: T.firstEvent + i * T.eventGap,
});

/** The ten events, in note order. Each starts 220 ms after the previous, from 6.05 s. */
export const WELCOME_EVENTS: readonly WelcomeEvent[] = [
  ev(0, 'Gym', '7–8am', '#788c5d', 420, 480),
  ev(1, 'School run', '8:15–8:45am', '#d97757', 495, 525),
  ev(2, 'Standup', '9–9:30am', '#6a9bcc', 540, 570),
  ev(3, 'Deep work', '9:30am–12', '#9a8fbf', 570, 720),
  ev(4, 'Lunch with Sam', '12–1pm', '#d4a27f', 720, 780),
  ev(5, 'Q4 plan', '1–2:30pm', '#6a9bcc', 780, 870),
  ev(6, '1:1 with Maya', '2:30–3pm', '#6a9bcc', 870, 900),
  ev(7, 'Dentist', '3:30–4:15pm', '#788c5d', 930, 975),
  ev(8, 'Pick up kids', '4:30–5pm', '#d97757', 990, 1020),
  ev(9, 'Family dinner', '6–7pm', '#d97757', 1080, 1140),
];

export const DAY_START_MIN = 7 * 60;
export const DAY_END_MIN = 19 * 60;
export const HOUR_LABELS = ['7am', '8am', '9am', '10am', '11am', 'noon', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm'] as const;

/** Position of an event within the 7am-7pm card, as percentages of its height. */
export function eventBox(e: Pick<WelcomeEvent, 'start' | 'end'>): { topPct: number; heightPct: number } {
  const span = DAY_END_MIN - DAY_START_MIN;
  return { topPct: ((e.start - DAY_START_MIN) / span) * 100, heightPct: ((e.end - e.start) / span) * 100 };
}

/** Events of 45 minutes or more stack their title over the time; shorter ones sit on one line. */
export const isStacked = (e: Pick<WelcomeEvent, 'start' | 'end'>): boolean => e.end - e.start >= 45;
