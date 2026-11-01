import { dnum, goalStats, type ProtoGoal } from '@calendar/core';

import { newGoalIn, applyGoalDraft, draftOf, draftPatch, goalLines, parseDeadline, splitDeadline } from './model';

const today = dnum('2026-10-30');
const goal: ProtoGoal = {
  id: 'g1', title: 'Deep work', cat: 'Deep work', outcome: 'Ship it', hours: 20, start: '2026-10-20', deadline: '2026-11-19', hue: 240,
};

describe('goal draft', () => {
  it('only reports what changed', () => {
    expect(draftPatch(goal, draftOf(goal))).toEqual({});
    const d = { ...draftOf(goal), title: 'Focus', hours: '25', hue: 125 };
    expect(draftPatch(goal, d)).toEqual({ title: 'Focus', hours: 25, hue: 125 });
    expect(draftPatch(goal, { ...draftOf(goal), hours: '' })).toEqual({});
    expect(draftPatch(goal, { ...draftOf(goal), title: '  ' })).toEqual({});
  });

  it('renaming a goal renames its category', () => {
    const data = { events: [], cats: { 'Deep work': 240 }, goals: [goal] };
    const out = applyGoalDraft(data, goal, { ...draftOf(goal), title: 'Focus' });
    expect(out.goals[0]).toMatchObject({ title: 'Focus', cat: 'Focus' });
    expect(out.cats).toEqual({ Focus: 240 });
    expect(applyGoalDraft(data, goal, draftOf(goal))).toBe(data);
  });
});

describe('deadline fields', () => {
  it('accepts real dates after today only', () => {
    expect(parseDeadline('06', '12', '2026', today)).toBe('2026-12-06');
    expect(parseDeadline('31', '02', '2027', today)).toBeNull();
    expect(parseDeadline('30', '10', '2026', today)).toBeNull();
    expect(parseDeadline('1', '1', '99', today)).toBeNull();
    expect(splitDeadline('2026-12-06')).toEqual({ y: '2026', m: '12', d: '06' });
  });
});

describe('goal lines and creation', () => {
  it('summarises what is done and where the pace stands', () => {
    const s = goalStats(goal, [], { today, nowMin: 600 });
    const L = goalLines(goal, s, today);
    expect(L.done).toBe('0h');
    expect(L.expected).toMatch(/h expected by now/);
    const ended = goalStats({ ...goal, deadline: '2026-10-25' }, [], { today, nowMin: 600 });
    expect(goalLines({ ...goal, deadline: '2026-10-25' }, ended, today).expected).toBe('Ended 25th Oct');
    expect(goalLines({ ...goal, hours: 0 }, goalStats({ ...goal, hours: 0 }, [], { today, nowMin: 600 }), today).expected).toBe('');
  });

  it('creates a goal with a unique title and its category', () => {
    const data = { events: [], cats: {}, goals: [] };
    const a = newGoalIn(data, 1, today);
    expect(a.data.goals[0].title).toBe('New goal');
    expect(a.data.cats['New goal']).toBeDefined();
    const b = newGoalIn(a.data, 2, today);
    expect(b.data.goals[1].title).toBe('New goal 2');
  });
});
