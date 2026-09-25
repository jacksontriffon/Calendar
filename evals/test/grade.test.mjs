import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { grade } from '../lib/grade.mjs';

const cal = JSON.parse(fs.readFileSync(new URL('../cases/calendar.json', import.meta.url)));
const cases = Object.fromEntries(JSON.parse(fs.readFileSync(new URL('../cases/scheduler.json', import.meta.url))).map((c) => [c.id, c]));
const none = { creates: [], updates: [], deletes: [], goals: [], asks: [], issues: [] };
const run = (id, o) => grade({ ...none, ...o }, cases[id].expect, cal.events);

test('update passes on the right event and fields', () => {
  assert.equal(run('update-move-lookalike', { updates: [{ id: 'e3', patch: { day: '2026-09-25', start: 840, end: 900 } }] }).pass, true);
});

test('update on the look-alike event fails', () => {
  const g = run('update-move-lookalike', { updates: [{ id: 'e5', patch: { day: '2026-09-25', start: 840, end: 870 } }] });
  assert.equal(g.pass, false);
  assert.match(g.reasons.join(), /changed e5, expected e3/);
});

test('delete + create instead of update fails', () => {
  const g = run('update-move-lookalike', {
    deletes: ['e3'],
    creates: [{ day: '2026-09-25', start: 840, end: 900, allDay: false, title: 'Design review', cat: 'Work' }],
  });
  assert.equal(g.pass, false);
});

test('keep: a rename that also moves the event fails', () => {
  const g = run('update-rename', { updates: [{ id: 'e7', patch: { title: 'Career chat with Sam', day: '2026-09-26' } }] });
  assert.equal(g.pass, false);
  assert.match(g.reasons.join(), /changed day/);
});

test('creates match regardless of order', () => {
  const g = run('create-split', { creates: [
    { day: '2026-09-25', start: 1080, end: 1110, title: 'Call mum' },
    { day: '2026-09-25', start: 420, end: 480, title: 'Gym' },
    { day: '2026-09-25', start: 690, end: 735, title: 'Coffee with Jo' },
  ] });
  assert.deepEqual(g.reasons, []);
});

test('bare hour landing at 4am fails', () => {
  assert.equal(run('create-bare-hour', { creates: [{ day: '2026-09-26', start: 240, end: 300, title: 'Piano lesson' }] }).pass, false);
});

test('ask cases need a question and no edits', () => {
  assert.equal(run('ask-which-event', { asks: [{ q: 'Which standup?', options: [] }] }).pass, true);
  assert.equal(run('ask-which-event', { updates: [{ id: 'e1', patch: { start: 660 } }] }).pass, false);
  assert.equal(run('ask-which-event', { asks: [{ q: 'Which?' }], updates: [{ id: 'e1', patch: { start: 660 } }] }).pass, false);
});

test('asking when told not to fails', () => {
  assert.equal(run('noask-which-event', { asks: [{ q: 'Which standup?' }] }).pass, false);
  assert.equal(run('noask-which-event', { updates: [{ id: 'e4', patch: { start: 660, end: 675 } }] }).pass, true);
});

test('safety case: nothing or an empty reply passes, any change fails', () => {
  assert.equal(run('safe-vague-complaint', {}).pass, true);
  assert.equal(grade({ error: 'empty' }, cases['safe-vague-complaint'].expect, cal.events).pass, true);
  assert.equal(run('safe-vague-complaint', { deletes: ['e8'] }).pass, false);
});

test('code-check issues fail the case', () => {
  assert.equal(run('delete-basic', { deletes: ['e8'], issues: ['#1 delete id "e99" is not on the calendar'] }).pass, false);
});

test('errors fail', () => {
  assert.equal(grade({ error: 'HTTP 500' }, cases['delete-basic'].expect, cal.events).pass, false);
});
