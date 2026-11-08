import { describe, expect, it } from 'vitest';
import { createProviderRegistry } from '../mock/index.js';
import type { ClassifyContext } from '../providers.js';
import { ProviderError } from '../registry.js';
import { AI_MAX_CONFIDENCE, ClaudeClassifier, DEFAULT_CLAUDE_MODEL } from './claude.js';
import { claudeFetch, type SeenRequest } from './fake-anthropic.fixture.js';

const context: ClassifyContext = {
  accounts: [
    { code: '811', name: '복리후생비', category: 'expense' },
    { code: '812', name: '여비교통비', category: 'expense' },
    { code: '108', name: '외상매출금', category: 'asset' },
  ],
  examples: [{ description: '스타벅스', counterparty: null, accountCode: '811' }],
};

const one = [
  { kind: 'card' as const, date: '2026-03-10', description: 'x', counterparty: null, amount: -1 },
];

describe('Claude AI 분류', () => {
  it('계정 목록·예시·거래를 구조화 출력으로 묻고 결과를 입력 순서대로 돌려준다', async () => {
    const seen: SeenRequest[] = [];
    const ai = new ClaudeClassifier({
      apiKey: 'sk-test',
      fetch: claudeFetch(
        {
          output: {
            results: [
              {
                index: 1,
                accountCode: '812',
                vatType: 'non_deductible',
                confidence: 0.8,
                reason: '택시비',
              },
              { index: 0, accountCode: '811', vatType: 'taxable', confidence: 1.2, reason: '커피' },
              {
                index: 0,
                accountCode: '812',
                vatType: 'none',
                confidence: 0.9,
                reason: '중복 번호',
              },
              { index: 7, accountCode: '811', vatType: 'taxable', confidence: 0.9, reason: '없음' },
              {
                index: 1.5,
                accountCode: '811',
                vatType: 'taxable',
                confidence: 0.9,
                reason: '소수',
              },
            ],
          },
        },
        seen,
      ),
    });
    const results = await ai.classifyMany(
      [
        {
          kind: 'card',
          date: '2026-03-10',
          description: '스타벅스 역삼점',
          counterparty: null,
          amount: -11_000,
        },
        {
          kind: 'card',
          date: '2026-03-11',
          description: '카카오T 택시',
          counterparty: null,
          amount: -15_000,
        },
        {
          kind: 'bank',
          date: '2026-03-12',
          description: '타행입금',
          counterparty: '한빛',
          amount: 50_000,
        },
      ],
      context,
    );
    expect(results).toEqual([
      { accountCode: '811', vatType: 'taxable', confidence: AI_MAX_CONFIDENCE, reason: '커피' },
      { accountCode: '812', vatType: 'non_deductible', confidence: 0.8, reason: '택시비' },
      null,
    ]);

    const req = seen[0]!;
    expect(req.url).toBe('https://api.anthropic.com/v1/messages?beta=true');
    expect(req.headers.get('x-api-key')).toBe('sk-test');
    expect(req.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    const body = req.body!;
    expect(body.model).toBe(DEFAULT_CLAUDE_MODEL);
    expect(DEFAULT_CLAUDE_MODEL).toBe('claude-opus-5-5');
    expect(body.fallbacks).toBe('default');
    expect(body.max_tokens).toBe(16_000);
    // 도구 호출 강제(tool_choice)는 쓰지 않는다: 최신 모델에서 400
    expect(body.tool_choice).toBeUndefined();
    expect(body.tools).toBeUndefined();
    interface SchemaNode {
      enum?: string[];
      required?: string[];
      additionalProperties?: boolean;
      properties: Record<string, SchemaNode>;
      items: SchemaNode;
    }
    const config = body.output_config as {
      effort: string;
      format: { type: string; schema: SchemaNode };
    };
    expect(config.effort).toBe('medium');
    expect(config.format.type).toBe('json_schema');
    expect(config.format.schema).not.toHaveProperty('$schema');
    const item = config.format.schema.properties.results!.items;
    expect([...item.properties.accountCode!.enum!].sort()).toEqual(['108', '811', '812']);
    expect(item.properties.vatType!.enum).toContain('non_deductible');
    expect(item.required).toEqual(['index', 'accountCode', 'vatType', 'confidence', 'reason']);
    expect(item.additionalProperties).toBe(false);
    const prompt = (body.messages as { content: string }[])[0]!.content;
    expect(prompt).toContain('811 복리후생비 (expense)');
    expect(prompt).toContain('- 스타벅스 → 811');
    expect(prompt).toContain('1. [법인카드 승인] 2026-03-11 -15000원');
    expect(prompt).toContain('2. [통장 거래] 2026-03-12 +50000원 한빛 타행입금');
  });

  it('API 키 오류·연결 실패·거절·잘림은 공급자 오류로 알려 준다', async () => {
    const denied = new ClaudeClassifier({
      apiKey: 'sk-bad',
      maxRetries: 0,
      fetch: claudeFetch({ status: 401, error: 'invalid x-api-key' }),
    });
    await expect(denied.classifyMany(one, context)).rejects.toThrow(
      'Anthropic API Key 가 올바르지 않습니다.',
    );
    expect(await denied.testConnection()).toEqual({
      ok: false,
      message: 'Anthropic API Key 가 올바르지 않습니다.',
    });

    const offline = new ClaudeClassifier({
      apiKey: 'sk',
      maxRetries: 0,
      fetch: (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch,
    });
    const error = await offline.classify({ ...one[0]!, kind: 'bank' }, context).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.message).toMatch(/^Claude 에 연결하지 못했습니다/);

    const refused = new ClaudeClassifier({
      apiKey: 'sk',
      fetch: claudeFetch({ stopReason: 'refusal', category: 'cyber' }),
    });
    await expect(refused.classifyMany(one, context)).rejects.toThrow(
      'Claude 가 이 요청을 처리하지 않았습니다(cyber).',
    );

    const truncated = new ClaudeClassifier({
      apiKey: 'sk',
      fetch: claudeFetch({ stopReason: 'max_tokens', text: '{"results": [' }),
    });
    await expect(truncated.classifyMany(one, context)).rejects.toThrow(/잘렸습니다/);

    // 스키마에 맞지 않는 응답
    const broken = new ClaudeClassifier({
      apiKey: 'sk',
      fetch: claudeFetch({ output: { results: [{ index: 0, accountCode: '999' }] } }),
    });
    await expect(broken.classifyMany(one, context)).rejects.toBeInstanceOf(ProviderError);
  });

  it('연결 테스트는 모델 조회로 한다(메시지를 보내지 않는다), 빈 입력은 호출하지 않는다', async () => {
    const seen: SeenRequest[] = [];
    const ai = new ClaudeClassifier({
      apiKey: 'sk',
      fetch: claudeFetch({ output: { results: [] } }, seen),
    });
    expect(await ai.testConnection()).toEqual({
      ok: true,
      message: 'Claude(claude-opus-5-5)에 연결했습니다.',
    });
    expect(seen.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      'GET /v1/models/claude-opus-5-5',
    ]);
    expect(await ai.classifyMany([], context)).toEqual([]);
    expect(seen).toHaveLength(1);
    await expect(ai.classifyMany(one, { accounts: [], examples: [] })).rejects.toThrow(
      '계정 목록이 비어',
    );
  });

  it('레지스트리: AI 채널에서 Claude 를 고르면 API 키로 만든다, 키가 없으면 오류', () => {
    const registry = createProviderRegistry();
    const ctx = { companyId: 'c', companyName: '회사', bizNo: null };
    expect(
      registry.resolve(
        'ai',
        { provider: 'claude', enabled: true, credentials: { apiKey: 'sk' } },
        ctx,
      ),
    ).toBeInstanceOf(ClaudeClassifier);
    expect(() =>
      registry.resolve('ai', { provider: 'claude', enabled: true, credentials: {} }, ctx),
    ).toThrow(ProviderError);
  });
});
