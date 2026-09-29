import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { ProviderError } from '../registry.js';

/** AI 분류·영수증 인식에 쓰는 기본 모델 */
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';

export interface ClaudeOptions {
  apiKey: string;
  model?: string;
  /** 테스트에서 바꿔 끼운다 */
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface Claude {
  client: Anthropic;
  model: string;
}

export function createClaude(options: ClaudeOptions): Claude {
  if (!options.apiKey) {
    throw new ProviderError('PROVIDER_FAILED', 'Anthropic API Key 가 없습니다.');
  }
  return {
    client: new Anthropic({
      apiKey: options.apiKey,
      fetch: options.fetch,
      timeout: options.timeoutMs ?? 120_000,
      maxRetries: options.maxRetries ?? 2,
    }),
    model: options.model || DEFAULT_CLAUDE_MODEL,
  };
}

/** SDK 오류를 사용자에게 보여 줄 공급자 오류로 바꾼다(구체적인 것부터) */
export function toProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof Anthropic.AuthenticationError) {
    return new ProviderError('PROVIDER_FAILED', 'Anthropic API Key 가 올바르지 않습니다.');
  }
  if (e instanceof Anthropic.PermissionDeniedError) {
    return new ProviderError('PROVIDER_FAILED', '이 API Key 로는 쓸 수 없는 모델·기능입니다.');
  }
  if (e instanceof Anthropic.RateLimitError) {
    return new ProviderError(
      'PROVIDER_FAILED',
      'Claude 요청이 많습니다. 잠시 뒤에 다시 시도해 주세요.',
    );
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return new ProviderError('PROVIDER_FAILED', `Claude 에 연결하지 못했습니다: ${e.message}`);
  }
  if (e instanceof Anthropic.APIError) {
    return new ProviderError(
      'PROVIDER_FAILED',
      `Claude 요청이 실패했습니다(${e.status ?? '연결'}): ${e.message}`,
    );
  }
  return new ProviderError('PROVIDER_FAILED', e instanceof Error ? e.message : String(e));
}

/** 연결 테스트: API Key 로 이 모델을 쓸 수 있는지(메시지를 보내지 않아 비용이 없다) */
export async function testClaude(claude: Claude) {
  try {
    await claude.client.models.retrieve(claude.model);
    return { ok: true, message: `Claude(${claude.model})에 연결했습니다.` };
  } catch (e) {
    return { ok: false, message: toProviderError(e).message };
  }
}

/** 구조화 출력이 받지 않는 제약(숫자·문자열 범위). 값 검증은 zod 가 응답을 받은 뒤 한다. */
const UNSUPPORTED_KEYS = new Set([
  '$schema',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
]);

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (!node || typeof node !== 'object') return node;
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => !UNSUPPORTED_KEYS.has(key))
      .map(([key, value]) => [key, strip(value)]),
  );
}

/**
 * zod 스키마 → 구조화 출력용 JSON 스키마. zod 는 객체마다 additionalProperties:false 와 필수 목록을 붙이고
 * enum 을 그대로 둔다(SDK 의 betaZodOutputFormat 은 enum 을 설명으로 옮겨 제약이 풀리므로 쓰지 않는다).
 */
export function outputSchema(schema: z.ZodType): Record<string, unknown> {
  return strip(z.toJSONSchema(schema, { unrepresentable: 'throw' })) as Record<string, unknown>;
}

/**
 * 구조화 출력(JSON 스키마)으로 한 번 묻고 zod 로 검증한 값을 돌려준다.
 * 안전 분류기가 거절하면 서버가 권장 모델로 다시 돌린다(fallbacks: "default").
 * 그래도 거절하거나 응답이 잘리면 공급자 오류로 알린다.
 */
export async function askJson<S extends z.ZodType>(
  claude: Claude,
  params: {
    system: string;
    content: string | Anthropic.Beta.BetaContentBlockParam[];
    schema: S;
    effort: 'low' | 'medium' | 'high';
  },
): Promise<z.infer<S>> {
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await claude.client.beta.messages.create({
      model: claude.model,
      max_tokens: 16_000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: params.system,
      output_config: {
        effort: params.effort,
        format: { type: 'json_schema', schema: outputSchema(params.schema) },
      },
      messages: [{ role: 'user', content: params.content }],
    });
  } catch (e) {
    throw toProviderError(e);
  }
  if (response.stop_reason === 'refusal') {
    throw new ProviderError(
      'PROVIDER_FAILED',
      `Claude 가 이 요청을 처리하지 않았습니다(${response.stop_details?.category ?? '사유 없음'}).`,
    );
  }
  if (response.stop_reason === 'max_tokens') {
    throw new ProviderError(
      'PROVIDER_FAILED',
      'Claude 응답이 너무 길어 잘렸습니다. 한 번에 보내는 양을 줄여 주세요.',
    );
  }
  const text = response.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ProviderError('PROVIDER_FAILED', 'Claude 응답을 읽지 못했습니다.');
  }
  const parsed = params.schema.safeParse(json);
  if (!parsed.success) {
    throw new ProviderError(
      'PROVIDER_FAILED',
      `Claude 응답 형식이 맞지 않습니다: ${parsed.error.issues[0]?.message ?? ''}`.trimEnd(),
    );
  }
  return parsed.data;
}
