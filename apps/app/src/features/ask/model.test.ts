import type { Ask } from '@calendar/core';

import {
  answerLines, back, followUpNote, keyIntent, moveHighlight, openAsk, pickAnswer, setHighlight, settle, skip,
} from './model';

const qs: Ask[] = [
  { q: 'Which day?', options: [{ label: 'Today', note: '' }, { label: 'Tomorrow', note: 'Fri 31' }, { label: 'Monday', note: '' }] },
  { q: 'How long?', options: [{ label: '30 min', note: '' }, { label: '1 hour', note: '' }] },
];
const open = () => openAsk({ qs, note: 'gym', goalId: null });

describe('ask flow reducer', () => {
  it('opens on the first question', () => {
    expect(open()).toMatchObject({ idx: 0, ans: [], pick: null, hi: 0, dir: 1, closing: false, note: 'gym', goalId: null });
    expect(openAsk({ qs, note: 'n', goalId: 'g1' }).goalId).toBe('g1');
  });

  it('picks, then moves to the next question', () => {
    let s = pickAnswer(open(), 'Tomorrow');
    expect(s).toMatchObject({ pick: 'Tomorrow', ans: ['Tomorrow'], idx: 0 });
    const r = settle(s);
    expect(r.done).toBe(false);
    s = r.state;
    expect(s).toMatchObject({ idx: 1, pick: null, hi: 0, dir: 1 });
  });

  it('is done after the last answer and starts closing', () => {
    let s = settle(pickAnswer(open(), 'Today')).state;
    s = pickAnswer(s, '1 hour');
    const r = settle(s);
    expect(r.done).toBe(true);
    expect(r.state).toMatchObject({ closing: true, pick: null, ans: ['Today', '1 hour'] });
  });

  it('ignores a second pick while one is running, or while closing', () => {
    const s = pickAnswer(open(), 'Today');
    expect(pickAnswer(s, 'Monday')).toBe(s);
    expect(pickAnswer({ ...open(), closing: true }, 'Today').ans).toEqual([]);
  });

  it('accepts a typed answer that is not an option', () => {
    const s = pickAnswer(open(), 'the 3rd');
    expect(s.ans[0]).toBe('the 3rd');
  });

  it('goes back (keeping answers) but not past the start or mid-pick', () => {
    const s1 = settle(pickAnswer(open(), 'Today')).state;
    const b = back(s1);
    expect(b).toMatchObject({ idx: 0, dir: -1, ans: ['Today'] });
    expect(back(b)).toBe(b);
    expect(back(pickAnswer(s1, '1 hour'))).toMatchObject({ idx: 1 });
  });

  it('skip resolves with what has been answered so far', () => {
    const s1 = settle(pickAnswer(open(), 'Monday')).state;
    const r = skip(s1);
    expect(r.done).toBe(true);
    expect(r.state.closing).toBe(true);
    expect(skip(r.state).done).toBe(false);
  });

  it('writes the answer lines and the follow-up note, "you decide" for the unanswered', () => {
    const s = settle(pickAnswer(open(), 'Monday')).state;
    expect(answerLines(s)).toEqual(['- Which day? → Monday', '- How long? → you decide']);
    expect(followUpNote(s)).toBe('gym\n\nAnswers to your questions:\n- Which day? → Monday\n- How long? → you decide');
  });

  it('moves the highlight with wrap-around and ignores hover while picking', () => {
    let s = open();
    s = moveHighlight(s, -1);
    expect(s.hi).toBe(2);
    s = moveHighlight(s, 1);
    expect(s.hi).toBe(0);
    expect(setHighlight(s, 1).hi).toBe(1);
    const picking = pickAnswer(s, 'Today');
    expect(setHighlight(picking, 2)).toBe(picking);
    expect(moveHighlight(picking, 1)).toBe(picking);
  });

  it('maps keys: arrows move, Enter picks the highlight, digits pick that option, Escape closes', () => {
    const s = { ...open(), hi: 1 };
    expect(keyIntent(s, 'ArrowDown')).toEqual({ type: 'move', d: 1 });
    expect(keyIntent(s, 'ArrowUp')).toEqual({ type: 'move', d: -1 });
    expect(keyIntent(s, 'Enter')).toEqual({ type: 'pick', label: 'Tomorrow' });
    expect(keyIntent(s, '3')).toEqual({ type: 'pick', label: 'Monday' });
    expect(keyIntent(s, '4')).toBeNull();
    expect(keyIntent(s, '0')).toBeNull();
    expect(keyIntent(s, 'Escape')).toEqual({ type: 'close' });
    expect(keyIntent(s, 'a')).toBeNull();
  });
});
