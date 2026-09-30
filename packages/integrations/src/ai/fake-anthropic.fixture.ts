/** 테스트용 가짜 Anthropic API(fetch 자리에 끼운다). 빌드에서 뺀다. */

export interface SeenRequest {
  method: string;
  url: string;
  headers: Headers;
  body: Record<string, unknown> | null;
}

export interface FakeClaudeReply {
  /** 구조화 출력으로 돌려줄 값(JSON 으로 바꿔 text 블록에 담는다) */
  output?: unknown;
  /** output 대신 그대로 돌려줄 text */
  text?: string;
  stopReason?: 'end_turn' | 'refusal' | 'max_tokens';
  /** 거절 사유 */
  category?: string;
  /** 오류 응답(4xx·5xx) */
  status?: number;
  error?: string;
}

const ERROR_TYPES: Record<number, string> = {
  400: 'invalid_request_error',
  401: 'authentication_error',
  403: 'permission_error',
  429: 'rate_limit_error',
  500: 'api_error',
};

export function claudeFetch(reply: FakeClaudeReply, seen: SeenRequest[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    seen.push({ method: init?.method ?? 'GET', url, headers: new Headers(init?.headers), body });
    const json = (status: number, data: unknown) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json', 'request-id': 'req_test' },
      });
    if (reply.status && reply.status >= 400) {
      return json(reply.status, {
        type: 'error',
        error: { type: ERROR_TYPES[reply.status] ?? 'api_error', message: reply.error ?? '오류' },
      });
    }
    const path = new URL(url).pathname;
    if (path.startsWith('/v1/models/')) {
      const id = decodeURIComponent(path.slice('/v1/models/'.length));
      return json(200, { type: 'model', id, display_name: id, created_at: '2026-01-01T00:00:00Z' });
    }
    const stopReason = reply.stopReason ?? 'end_turn';
    return json(200, {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: (body?.model as string | undefined) ?? 'claude-opus-5-5',
      content:
        stopReason === 'refusal'
          ? []
          : [{ type: 'text', text: reply.text ?? JSON.stringify(reply.output ?? {}) }],
      stop_reason: stopReason,
      stop_sequence: null,
      stop_details:
        stopReason === 'refusal'
          ? { type: 'refusal', category: reply.category ?? null, explanation: null }
          : null,
      usage: { input_tokens: 10, output_tokens: 10 },
    });
  }) as typeof fetch;
}
