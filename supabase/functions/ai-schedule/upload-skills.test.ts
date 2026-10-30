import { assert, assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import { SKILL_FILES } from '../_shared/skills.generated.ts';
import { SKILL_NAMES } from './skill-names.ts';
import { collectSkills, secretsCommand, uploadSkill } from './upload-skills.ts';

const SKILLS_DIR = new URL('../../../skills', import.meta.url).pathname;

Deno.test('collectSkills reads skills/ and matches the generated inline bundle', async () => {
  const skills = await collectSkills(SKILLS_DIR);
  assertEquals(Object.keys(skills).sort(), [...SKILL_NAMES].sort());
  for (const n of SKILL_NAMES) {
    assert(skills[n].some((f) => f.path === 'SKILL.md'), n + ' has SKILL.md');
    // run supabase/functions/sync-core.sh if this fails: skills/ changed since the bundle was generated
    assertEquals(Object.fromEntries(skills[n].map((f) => [f.path, f.content])), SKILL_FILES[n], n + ' bundle is in sync with skills/');
  }
  assert(skills['calendar-scheduler'].some((f) => f.path === 'references/time-rules.md'));
});

Deno.test('uploadSkill posts <skill>/<path> files and a display name, and returns the id', async () => {
  let seen: { url: string; headers: Headers; form: FormData } | null = null;
  const fake = ((url: string, init: RequestInit) => {
    seen = { url, headers: new Headers(init.headers), form: init.body as FormData };
    return Promise.resolve(Response.json({ id: 'skill_123' }));
  }) as unknown as typeof fetch;
  const id = await uploadSkill('calendar-checkin', [{ path: 'SKILL.md', content: '# hi' }, { path: 'references/q.md', content: 'q' }], { apiKey: 'sk', fetch: fake });
  assertEquals(id, 'skill_123');
  const s = seen!;
  assertEquals(s.url, 'https://api.anthropic.com/v1/skills');
  assertEquals(s.headers.get('x-api-key'), 'sk');
  assertEquals(s.headers.get('content-type'), null, 'fetch sets the multipart boundary');
  assertEquals(s.form.get('display_name'), 'calendar-checkin');
  const files = s.form.getAll('files[]') as File[];
  assertEquals(files.map((f) => f.name), ['calendar-checkin/SKILL.md', 'calendar-checkin/references/q.md']);
  assertEquals(await files[0].text(), '# hi');
});

Deno.test('uploadSkill adds a version when the skill id is known, and reports API errors', async () => {
  let url = '', hasName = true;
  const ok = ((u: string, init: RequestInit) => {
    url = u; hasName = (init.body as FormData).has('display_name');
    return Promise.resolve(Response.json({ id: 'ver_1' }));
  }) as unknown as typeof fetch;
  assertEquals(await uploadSkill('calendar-checkin', [], { apiKey: 'sk', fetch: ok, existingId: 'skill_9', baseUrl: 'https://proxy.test/' }), 'skill_9');
  assertEquals(url, 'https://proxy.test/v1/skills/skill_9/versions');
  assertEquals(hasName, false);

  const fail = (() => Promise.resolve(Response.json({ error: { message: 'too big' } }, { status: 413 }))) as unknown as typeof fetch;
  await assertRejects(() => uploadSkill('x', [], { apiKey: 'sk', fetch: fail }), Error, 'skills HTTP 413 for x: too big');
});

Deno.test('secretsCommand prints the four SKILL_ID_* secrets', () => {
  const cmd = secretsCommand({
    'calendar-scheduler': 'a', 'calendar-goal-adjust': 'b', 'calendar-checkin': 'c', 'calendar-verifier': 'd',
  });
  assertEquals(cmd, 'supabase secrets set SKILL_ID_CALENDAR_SCHEDULER=a SKILL_ID_CALENDAR_GOAL_ADJUST=b SKILL_ID_CALENDAR_CHECKIN=c SKILL_ID_CALENDAR_VERIFIER=d');
  assertStringIncludes(cmd, 'SKILL_ID_CALENDAR_VERIFIER=d');
});
