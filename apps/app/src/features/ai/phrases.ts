/** The thinking pill's wording (the prototype's `READ_PHRASES`, `THINK_PHRASES`, `THINK_THEMES`, `pickPhrase`). */

/** While a check-in reads the week. */
export const READ_PHRASES = [
  'Snooping on your week…', 'Judging your Tuesday…', 'Counting your coffees…',
  'Auditing your excuses…', 'Asking your goals how they feel…', 'Reading between the meetings…',
];

export const THINK_PHRASES = [
  'Plotting world domination…', 'Tetris-ing your day…', 'Bribing the clock…', 'Inventing a 25th hour…',
  'Bending spacetime slightly…', 'Consulting the calendar gods…', 'Reticulating calendars…',
  'Hiding from Mondays…', 'Doing time lord stuff…',
];

const THINK_THEMES: [RegExp, string[]][] = [
  [/\b(meet|meeting|standup|stand-up|call|sync|1:1|interview|review)\b/i, ['Pretending this could be an email…', 'Finding you on mute…', 'Rehearsing "sorry, you go"…']],
  [/\b(gym|run|workout|yoga|swim|walk|ride|train)\b/i, ['Stretching your schedule…', 'Skipping leg day…', 'Lacing up, reluctantly…']],
  [/\b(coffee|lunch|dinner|breakfast|brunch|drinks)\b/i, ['Negotiating with your stomach…', 'Squeezing in coffee #4…', 'Reserving a table for snacks…']],
  [/\b(goal|goals|achieve|by (?:the )?end|deadline|ship|launch)\b/i, ['Plotting world domination…', 'Doing suspicious maths…', 'Summoning motivation…']],
  [/\b(delete|remove|cancel|clear|drop)\b/i, ['Ghosting that event…', 'Committing tasteful arson…', 'Pretending it never happened…']],
  [/\b(move|reschedule|push|shift|swap|later|earlier)\b/i, ['Tetris-ing your day…', 'Negotiating with noon…', 'Kicking it down the road…']],
  [/\b(sleep|nap|rest|bed|relax|break)\b/i, ['Fluffing the pillows…', 'Defending your nap rights…', 'Hiding your phone…']],
  [/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|week)\b/i, ['Warning future you…', 'Peeking into tomorrow…', 'Bargaining with Friday…']],
];

/** A phrase that fits the note (by keywords), rotating with the send count. */
export function pickPhrase(query: string, seq: number): string {
  const hit = query ? THINK_THEMES.filter(([re]) => re.test(query)).flatMap(([, p]) => p) : [];
  const pool = hit.length ? hit : THINK_PHRASES;
  return pool[(seq || 0) % pool.length];
}

export const readPhrase = (seq: number): string => READ_PHRASES[(seq || 0) % READ_PHRASES.length];
