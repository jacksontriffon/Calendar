/**
 * Calls to the Anthropic Messages API for ai-schedule: the prototype's `callModel` /
 * `postMessages` / `inlineSkills` / `textOf`, ported to the server.
 *
 * Two transports, as in the prototype:
 *  - `skills`: the four skills uploaded once per deploy (upload-skills.ts), referenced by id in
 *    `container.skills`, with the code-execution tool so Claude can open the reference files.
 *  - `inline`: the skill files are put in the system prompt. Used when no skill ids are configured.
 */
import type { Env } from '../_shared/env.ts';
import { MissingEnvError } from '../_shared/env.ts';
import { SKILL_FILES } from '../_shared/skills.generated.ts';
import { SKILL_ENV, SKILL_NAMES } from './skill-names.ts';
import type { SkillName } from './skill-names.ts';

export { SKILL_ENV, SKILL_NAMES } from './skill-names.ts';
export type { SkillName } from './skill-names.ts';

/** The prototype's default (`AI_MODEL` in logic.js). */
export const DEFAULT_MODEL = 'claude-haiku-4-5';
export const ANTHROPIC_VERSION = '2023-06-01';
/** Code execution + skills betas, for the `skills` transport. */
export const DEFAULT_BETAS = 'code-execution-2025-08-25,skills-2025-10-02';

export class AnthropicError extends Error {
  constructor(public readonly status: number, public readonly detail: string) {
    super(status ? `HTTP ${status}${detail ? ': ' + detail : ''}` : detail);
    this.name = 'AnthropicError';
  }
}

/** Skill files as the prototype's `inlineSkills` lays them out in the system prompt. */
export const inlineSkills = (names: readonly string[], files: Record<string, Record<string, string>> = SKILL_FILES): string =>
  'You have these skills. Follow the one the user message names; its reference files are included.\n\n' +
  names.map((n) =>
    Object.keys(files[n] ?? {}).map((p) => '<file path="/skills/' + n + '/' + p + '">\n' + files[n][p] + '\n</file>').join('\n'),
  ).join('\n\n');

interface ContentBlock { type: string; text?: string }
export interface MessagesResponse {
  content?: ContentBlock[];
  stop_reason?: string;
  container?: { id?: string };
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Final answer = the text blocks after the last tool call (the prototype's `textOf`). */
export const textOf = (j: MessagesResponse | null | undefined): string => {
  const c = (j && j.content) || [];
  let last = -1;
  c.forEach((b, i) => { if (b.type !== 'text') last = i; });
  const t = c.slice(last + 1).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  return t.trim() ? t : c.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
};

/** One model call: which skills the prompt names, the user message, the output cap. Resolves to the reply text. */
export interface ModelTransport {
  readonly kind: 'skills' | 'inline';
  readonly model: string;
  call(names: readonly SkillName[], user: string, maxTokens: number): Promise<string>;
}

export const createTransport = (env: Env, fetchFn: typeof fetch): ModelTransport => {
  const key = env.req('ANTHROPIC_API_KEY');
  const model = env.opt('AI_MODEL') ?? DEFAULT_MODEL;
  const base = (env.opt('ANTHROPIC_BASE_URL') ?? 'https://api.anthropic.com').replace(/\/$/, '');
  const timeoutMs = env.int('AI_TIMEOUT_MS', 60_000);

  const ids = SKILL_NAMES.map((n) => env.opt(SKILL_ENV[n]));
  const want = env.opt('AI_TRANSPORT');
  if (want && want !== 'skills' && want !== 'inline') throw new Error('AI_TRANSPORT must be "skills" or "inline"');
  let kind: 'skills' | 'inline';
  if (want === 'inline') kind = 'inline';
  else if (want === 'skills') {
    const missing = SKILL_NAMES.filter((_, i) => !ids[i]).map((n) => SKILL_ENV[n]);
    if (missing.length) throw new MissingEnvError(missing);
    kind = 'skills';
  } else if (ids.every(Boolean)) kind = 'skills';
  else {
    if (ids.some(Boolean)) console.warn('[ai-schedule] only some SKILL_ID_* secrets are set; using the inline transport');
    kind = 'inline';
  }

  const post = async (body: Record<string, unknown>, betas?: string): Promise<MessagesResponse> => {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_VERSION,
    };
    if (betas) headers['anthropic-beta'] = betas;
    let res: Response;
    try {
      res = await fetchFn(base + '/v1/messages', { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      const timedOut = e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError');
      throw new AnthropicError(0, timedOut ? 'timeout' : 'network: ' + String((e as Error)?.message ?? e));
    }
    if (!res.ok) {
      let detail = '';
      try { const j = await res.json(); detail = (j?.error?.message as string) || ''; } catch { /* not JSON */ }
      console.error('[ai-schedule] Anthropic HTTP ' + res.status, detail);
      throw new AnthropicError(res.status, detail);
    }
    return await res.json() as MessagesResponse;
  };

  const inline = async (names: readonly SkillName[], user: string, maxTokens: number) =>
    textOf(await post({ model, max_tokens: maxTokens, system: inlineSkills(names), messages: [{ role: 'user', content: user }] }));

  const viaSkills = async (user: string, maxTokens: number): Promise<string> => {
    const skills = ids.map((id) => ({ type: 'custom', skill_id: id, version: 'latest' }));
    const messages: Array<{ role: string; content: unknown }> = [{ role: 'user', content: user }];
    const betas = env.opt('ANTHROPIC_BETA') ?? DEFAULT_BETAS;
    let j: MessagesResponse = {};
    let containerId: string | undefined;
    for (let i = 0; i < 5; i++) {
      const container: Record<string, unknown> = { skills };
      if (containerId) container.id = containerId;
      j = await post({
        model, max_tokens: maxTokens, container,
        tools: [{ type: 'code_execution_20250825', name: 'code_execution' }], messages,
      }, betas);
      if (j.container?.id) containerId = j.container.id;
      if (j.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: j.content });
    }
    return textOf(j);
  };

  return {
    kind, model,
    async call(names, user, maxTokens) {
      if (kind === 'inline') return await inline(names, user, maxTokens);
      try {
        return await viaSkills(user, maxTokens);
      } catch (e) {
        // A skill id that no longer exists (deleted, other workspace) is a deploy problem, not the
        // user's: answer from the inline files rather than failing, and say so in the logs.
        if (e instanceof AnthropicError && (e.status === 400 || e.status === 404)) {
          console.warn('[ai-schedule] skills transport rejected (' + e.message + '); falling back to inline');
          return await inline(names, user, maxTokens);
        }
        throw e;
      }
    },
  };
};
