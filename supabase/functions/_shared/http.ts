import { MissingEnvError } from './env.ts';

/**
 * CORS + JSON helpers shared by every edge function.
 *
 * Error bodies are `{ error: '<code>', message?: string, ...extra }`: `error` is a stable machine
 * code the app switches on, `message` is for logs and developers.
 */

export const corsHeaders: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '86400',
};

/** A JSON response with CORS headers. */
export const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json', ...headers },
  });

/** Answer a CORS preflight, or return null for any other request. */
export const preflight = (req: Request): Response | null =>
  req.method === 'OPTIONS' ? new Response(null, { status: 204, headers: corsHeaders }) : null;

/** Throw from anywhere in a handler to produce `{ error: code, message, ...extra }` with this status. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
    public readonly extra: Record<string, unknown> = {},
    public readonly headers: Record<string, string> = {},
  ) {
    super(message ?? code);
    this.name = 'HttpError';
  }
}

/** Turn anything thrown by a handler into a response. Unknown errors are logged and become a 500. */
export const errorResponse = (e: unknown): Response => {
  if (e instanceof MissingEnvError) return json({ error: 'server_config', message: e.message }, 500);
  if (e instanceof HttpError) {
    return json({ error: e.code, message: e.message === e.code ? undefined : e.message, ...e.extra }, e.status, e.headers);
  }
  console.error('[unhandled]', e);
  return json({ error: 'internal', message: 'Something went wrong' }, 500);
};

/**
 * Parse a JSON request body with a size cap. 405 for non-POST, 413 when too large, 400 when the
 * body is not a JSON object.
 */
export const readJsonBody = async (req: Request, maxBytes: number): Promise<Record<string, unknown>> => {
  if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Use POST');
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new HttpError(413, 'too_large', `Request body over ${maxBytes} bytes`);
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'too_large', `Request body over ${maxBytes} bytes`);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'bad_json', 'Body is not valid JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'bad_json', 'Body must be a JSON object');
  return body as Record<string, unknown>;
};
