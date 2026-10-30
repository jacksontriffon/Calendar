/**
 * Deploy-time script: uploads skills/* to your Anthropic workspace (POST /v1/skills) and prints the
 * `supabase secrets set` command that makes ai-schedule use the `skills` transport.
 *
 *   ANTHROPIC_API_KEY=sk-ant-... deno run --allow-read --allow-net --allow-env \
 *     supabase/functions/ai-schedule/upload-skills.ts [--skills-dir skills] [--dry-run]
 *
 * Run it again after editing skills/ (and after `supabase/functions/sync-core.sh` if you use the
 * inline transport). If a SKILL_ID_* variable for a skill is already set in your shell, the script
 * uploads a new *version* of that skill (POST /v1/skills/{id}/versions) instead of creating a new
 * one; ai-schedule references `version: latest`, so the secret doesn't change.
 *
 * Needs no Supabase access and never touches the database.
 */
import { SKILL_ENV, SKILL_NAMES } from './skill-names.ts';
import type { SkillName } from './skill-names.ts';

export interface SkillFile { path: string; content: string }

/** Every file of every skill under `dir`, keyed by skill name, paths like `references/time-rules.md`. */
export const collectSkills = async (dir: string): Promise<Record<string, SkillFile[]>> => {
  const out: Record<string, SkillFile[]> = {};
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isDirectory) continue;
    const files: SkillFile[] = [];
    const walk = async (rel: string) => {
      for await (const f of Deno.readDir(`${dir}/${entry.name}${rel ? '/' + rel : ''}`)) {
        const p = rel ? `${rel}/${f.name}` : f.name;
        if (f.isDirectory) await walk(p);
        else files.push({ path: p, content: await Deno.readTextFile(`${dir}/${entry.name}/${p}`) });
      }
    };
    await walk('');
    files.sort((a, b) => a.path.localeCompare(b.path));
    out[entry.name] = files;
  }
  return out;
};

export interface UploadOpts {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** existing skill id: upload a new version of it */
  existingId?: string;
}

/** Upload one skill; resolves to its id. Files are sent as `<skill>/<path>` parts, as the app does. */
export const uploadSkill = async (name: string, files: SkillFile[], o: UploadOpts): Promise<string> => {
  const fd = new FormData();
  for (const f of files) fd.append('files[]', new Blob([f.content], { type: 'text/markdown' }), `${name}/${f.path}`);
  if (!o.existingId) fd.append('display_name', name);
  const base = (o.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');
  const url = base + '/v1/skills' + (o.existingId ? `/${o.existingId}/versions` : '');
  const res = await (o.fetch ?? fetch)(url, {
    method: 'POST',
    // No content-type: fetch sets the multipart boundary.
    headers: { 'x-api-key': o.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'skills-2025-10-02' },
    body: fd,
  });
  if (!res.ok) {
    let detail = '';
    try { detail = ((await res.json()).error?.message as string) || ''; } catch { /* not JSON */ }
    throw new Error(`skills HTTP ${res.status} for ${name}${detail ? ': ' + detail : ''}`);
  }
  const j = await res.json();
  return String(o.existingId ?? j.id);
};

/** The command that stores the ids as function secrets. */
export const secretsCommand = (ids: Record<SkillName, string>): string =>
  'supabase secrets set ' + SKILL_NAMES.map((n) => `${SKILL_ENV[n]}=${ids[n]}`).join(' ');

const main = async () => {
  const args = Deno.args;
  const dryRun = args.includes('--dry-run');
  const di = args.indexOf('--skills-dir');
  const dir = di >= 0 ? args[di + 1] : new URL('../../../skills', import.meta.url).pathname;
  const skills = await collectSkills(dir);
  const missing = SKILL_NAMES.filter((n) => !skills[n]);
  if (missing.length) { console.error(`Missing skill folders in ${dir}: ${missing.join(', ')}`); Deno.exit(2); }

  if (dryRun) {
    for (const n of SKILL_NAMES) console.log(`${n}: ${skills[n].map((f) => f.path).join(', ')}`);
    console.log('(dry run: nothing uploaded)');
    return;
  }
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) { console.error('Set ANTHROPIC_API_KEY.'); Deno.exit(2); }
  const baseUrl = Deno.env.get('ANTHROPIC_BASE_URL') ?? undefined;

  const ids = {} as Record<SkillName, string>;
  for (const n of SKILL_NAMES) {
    const existingId = Deno.env.get(SKILL_ENV[n]) || undefined;
    ids[n] = await uploadSkill(n, skills[n], { apiKey, baseUrl, existingId });
    console.log(`${existingId ? 'new version of' : 'uploaded'} ${n} -> ${ids[n]}`);
  }
  console.log('\nSet the ids as secrets on your Supabase project:\n');
  console.log(secretsCommand(ids));
};

if (import.meta.main) await main();
