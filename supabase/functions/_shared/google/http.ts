/**
 * Small HTTP helpers for the Google functions (CORS, JSON replies, bearer auth). Kept local to
 * `_shared/google/` on purpose; they overlap with the shared cors/auth helpers and are meant to be
 * folded into them.
 */

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...headers } });

export const preflight = (): Response => new Response(null, { status: 204, headers: CORS_HEADERS });

export const redirect = (location: string): Response => new Response(null, { status: 302, headers: { Location: location } });

export const bearerToken = (req: Request): string | null => {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') || '');
  return m ? m[1].trim() : null;
};

/** Constant-time string comparison (length differences are not hidden). */
export const timingSafeEqual = (a: string, b: string): boolean => {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
};

/** The request carries the service-role key as its bearer token (what the queue consumer sends). */
export const isServiceRole = (req: Request, serviceRoleKey: string | undefined): boolean => {
  const t = bearerToken(req);
  return !!t && !!serviceRoleKey && timingSafeEqual(t, serviceRoleKey);
};

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export const readJson = async (req: Request): Promise<Record<string, unknown>> => {
  try {
    const v = await req.json();
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch { /* fall through */ }
  throw new HttpError(400, 'expected a JSON object body', 'bad_request');
};

export const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length ? v : undefined);
