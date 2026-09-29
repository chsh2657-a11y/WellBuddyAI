import { describe, expect, it } from 'vitest';
import { createProviderRegistry } from '../mock/index.js';
import type { ClassifyContext } from '../providers.js';
import { ProviderError } from '../registry.js';
import { AI_MAX_CONFIDENCE, ClaudeClassifier, DEFAULT_CLAUDE_MODEL } from './claude.js';

const context: ClassifyContext = {
  accounts: [
    { code: '811', name: '복리후생비', category: 'expense' },
    { code: '812', name: '여비교통비', category: 'expense' },
    { code: '108', name: '외상매출금', category: 'asset' },
  ],
  examples: [{ description: '스타벅스', counterparty: null, accountCode: '811' }],
};

function fakeFetch(
  status: number,
  body: unknown,
  seen: { url?: string; init?: RequestInit }[] = [],
) {
  return (async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

const toolUse = (results: unknown[]) => ({
  content: [{ type: 'tool_use', name: 'record_classifications', input: { results } }],
});

describe('Claude AI 분류', () => {
  it('계정 목록·예시·거래를 보내고 도구 호출 결과를 입력 순서대로 돌려준다', async () => {
    const seen: { url?: string; init?: RequestInit }[] = [];
    const ai = new ClaudeClassifier({
      apiKey: 'sk-test',
      fetch: fakeFetch(
        200,
        toolUse([
          {
            index: 1,
            accountCode: '812',
            vatType: 'non_deductible',
            confidence: 0.8,
            reason: '택시비',
          },
          { index: 0, accountCode: '811', vatType: 'taxable', confidence: 1.2, reason: '커피' },
          {
            index: 2,
            accountCode: '999',
            vatType: 'taxable',
            confidence: 0.9,
            reason: '없는 계정',
          },
          {
            index: 7,
            accountCode: '811',
            vatType: 'taxable',
            confidence: 0.9,
            reason: '없는 번호',
          },
        ]),
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
    expect(req.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = req.init!.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(req.init!.body as string);
    expect(body.model).toBe(DEFAULT_CLAUDE_MODEL);
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'record_classifications' });
    expect(body.tools[0].input_schema.properties.results.items.properties.accountCode.enum).toEqual(
      ['811', '812', '108'],
    );
    const prompt = body.messages[0].content as string;
    expect(prompt).toContain('811 복리후생비 (expense)');
    expect(prompt).toContain('- 스타벅스 → 811');
    expect(prompt).toContain('1. [법인카드 승인] 2026-03-11 -15000원');
    expect(prompt).toContain('2. [통장 거래] 2026-03-12 +50000원 한빛 타행입금');
  });

  it('API 오류·연결 실패는 공급자 오류로, 연결 테스트는 결과로 알려 준다', async () => {
    const denied = new ClaudeClassifier({
      apiKey: 'sk-bad',
      fetch: fakeFetch(401, { error: { message: 'invalid x-api-key' } }),
    });
    await expect(
      denied.classifyMany(
        [{ kind: 'card', date: '2026-03-10', description: 'x', counterparty: null, amount: -1 }],
        context,
      ),
    ).rejects.toThrow(/401.*invalid x-api-key/);
    expect(await denied.testConnection()).toMatchObject({ ok: false });

    const offline = new ClaudeClassifier({
      apiKey: 'sk',
      fetch: (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch,
    });
    await expect(
      offline.classify(
        { kind: 'bank', date: '2026-03-10', description: 'x', counterparty: null, amount: 1 },
        context,
      ),
    ).rejects.toBeInstanceOf(ProviderError);

    const ok = new ClaudeClassifier({ apiKey: 'sk', fetch: fakeFetch(200, { content: [] }) });
    expect(await ok.testConnection()).toMatchObject({ ok: true });
    expect(await ok.classifyMany([], context)).toEqual([]);
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
