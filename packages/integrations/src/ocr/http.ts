import { ProviderError } from '../registry.js';

/** 1×1 흰색 PNG. 실제 OCR 을 돌리지 않고 인증만 확인할 때 보낸다 */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export interface HttpOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** JSON 요청 한 번. 연결 실패·시간 초과는 공급자 오류로, HTTP 오류는 호출한 쪽이 상태 코드로 판단한다 */
export async function requestJson(
  label: string,
  url: string,
  init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: unknown },
  options: HttpOptions,
): Promise<{ status: number; json: unknown }> {
  let res: Response;
  try {
    res = await (options.fetch ?? fetch)(url, {
      method: init.method,
      headers: { 'content-type': 'application/json', ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
    });
  } catch (e) {
    throw new ProviderError(
      'PROVIDER_FAILED',
      `${label}에 연결하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const json: unknown = await res.json().catch(() => null);
  return { status: res.status, json };
}

/** 오류 응답에서 사람이 읽을 메시지를 찾는다 */
export function errorMessage(json: unknown): string {
  if (!json || typeof json !== 'object') return '알 수 없는 오류';
  const j = json as Record<string, unknown>;
  const nested = j.error && typeof j.error === 'object' ? (j.error as Record<string, unknown>) : {};
  const message = nested.message ?? j.message ?? j.msg ?? j.error;
  return typeof message === 'string' ? message : '알 수 없는 오류';
}
