export const SKILL_NAMES = ['calendar-scheduler', 'calendar-goal-adjust', 'calendar-checkin', 'calendar-verifier'] as const;
export type SkillName = (typeof SKILL_NAMES)[number];

/** Secrets that hold the uploaded skill ids (printed by upload-skills.ts). */
export const SKILL_ENV: Record<SkillName, string> = {
  'calendar-scheduler': 'SKILL_ID_CALENDAR_SCHEDULER',
  'calendar-goal-adjust': 'SKILL_ID_CALENDAR_GOAL_ADJUST',
  'calendar-checkin': 'SKILL_ID_CALENDAR_CHECKIN',
  'calendar-verifier': 'SKILL_ID_CALENDAR_VERIFIER',
};
