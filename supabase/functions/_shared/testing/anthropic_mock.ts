/** A scripted stand-in for `fetch` against the Anthropic Messages API, for Deno tests. */

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  // deno-lint-ignore no-explicit-any
  body: any;
}

export type Scripted =
  | string                                   // a text reply (end_turn)
  | { status: number; body?: unknown }       // an HTTP error
  | { content: unknown[]; stop_reason?: string; container?: { id: string } } // a full response
  | { throws: Error }                        // a network error
  | ((req: RecordedRequest) => Scripted);

export interface AnthropicMock {
  fetch: typeof fetch;
  requests: RecordedRequest[];
  /** Replies not yet consumed. */
  remaining(): number;
}

export const textResponse = (text: string, extra: Record<string, unknown> = {}) => ({
  id: 'msg_test', type: 'message', role: 'assistant', model: 'test',
  content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 }, ...extra,
});

export const anthropicMock = (script: Scripted[]): AnthropicMock => {
  const queue = [...script];
  const requests: RecordedRequest[] = [];
  const mock = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => { headers[k] = v; });
    const rec: RecordedRequest = {
      url: String(input), method: init?.method ?? 'GET', headers,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    };
    requests.push(rec);
    let next = queue.shift();
    if (next === undefined) return Promise.reject(new Error('anthropicMock: no scripted reply left for request #' + requests.length));
    if (typeof next === 'function') next = next(rec);
    if (typeof next === 'string') return Promise.resolve(Response.json(textResponse(next)));
    if ('throws' in next) return Promise.reject(next.throws);
    if ('status' in next) return Promise.resolve(Response.json(next.body ?? { type: 'error', error: { type: 'api_error', message: 'scripted error' } }, { status: next.status }));
    return Promise.resolve(Response.json({ ...textResponse(''), ...next }));
  };
  return { fetch: mock as typeof fetch, requests, remaining: () => queue.length };
};
