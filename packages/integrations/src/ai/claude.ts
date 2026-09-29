import type {
  AiClassifier,
  ClassifyContext,
  ClassifyInput,
  ClassifySuggestion,
} from '../providers.js';
import { ProviderError } from '../registry.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
/** 분류는 정확도가 중요해 Sonnet 을 기본으로 쓴다 */
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5-5';
/** AI 추천의 신뢰도 상한(회사 규칙 100% 와 구분하고, 기준 100% 면 AI 는 자동 전기하지 않게) */
export const AI_MAX_CONFIDENCE = 0.95;
const VAT_TYPES = ['taxable', 'zero_rated', 'exempt', 'non_deductible', 'none'] as const;

export interface ClaudeClassifierOptions {
  apiKey: string;
  model?: string;
  /** 테스트에서 바꿔 끼운다 */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const KIND_LABELS: Record<ClassifyInput['kind'], string> = {
  bank: '통장 거래',
  card: '법인카드 승인',
  tax_invoice: '세금계산서',
  cash_receipt: '현금영수증',
  receipt: '영수증',
};

const SYSTEM = [
  '당신은 한국 중소기업 경리 담당자를 돕는 회계 전문가입니다.',
  '일반기업회계기준과 부가가치세법에 따라 거래마다 분개할 계정과목 하나와 부가세 처리를 고릅니다.',
  '- 계정은 반드시 주어진 계정 목록의 코드 중에서만 고릅니다.',
  '- 금액이 +면 돈이 들어온 거래(입금·매출), -면 나간 거래(출금·매입·카드 사용)입니다.',
  '- 입금·출금 거래는 현금·예금 반대쪽 계정(예: 외상매출금 회수, 임차료 지급)을 고릅니다.',
  '- 기업업무추진비(접대비), 여객운송(택시·철도·항공), 비영업용 소형승용차 관련 매입은 non_deductible 입니다.',
  '- 확실하지 않으면 confidence 를 낮게(0.5 이하) 주고, 이유를 한국어 한 문장으로 적습니다.',
  '- 비슷한 과거 분개 예시가 있으면 그것을 우선합니다.',
].join('\n');

interface ToolResult {
  results?: {
    index?: number;
    accountCode?: string;
    vatType?: string;
    confidence?: number;
    reason?: string;
  }[];
}

/**
 * Claude 로 거래를 분류한다(P2-22). 도구 호출(tool use)을 강제해 계정 코드·부가세·신뢰도·사유를
 * 구조화된 JSON 으로 받는다. 계정 목록 밖의 코드나 잘못된 값은 버린다.
 */
export class ClaudeClassifier implements AiClassifier {
  private readonly model: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: ClaudeClassifierOptions) {
    if (!options.apiKey)
      throw new ProviderError('PROVIDER_FAILED', 'Anthropic API Key 가 없습니다.');
    this.model = options.model || DEFAULT_CLAUDE_MODEL;
    this.fetchFn = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  private async call(body: Record<string, unknown>) {
    let res: Response;
    try {
      res = await this.fetchFn(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.options.apiKey,
          'anthropic-version': API_VERSION,
        },
        body: JSON.stringify({ model: this.model, ...body }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new ProviderError(
        'PROVIDER_FAILED',
        `Claude 에 연결하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const json = (await res.json().catch(() => null)) as {
      content?: { type: string; name?: string; input?: unknown }[];
      error?: { message?: string };
    } | null;
    if (!res.ok) {
      throw new ProviderError(
        'PROVIDER_FAILED',
        `Claude 요청이 실패했습니다(${res.status}): ${json?.error?.message ?? '알 수 없는 오류'}`,
      );
    }
    return json ?? {};
  }

  async testConnection() {
    try {
      await this.call({ max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] });
      return { ok: true, message: `Claude(${this.model})에 연결했습니다.` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  async classify(input: ClassifyInput, context: ClassifyContext): Promise<ClassifySuggestion> {
    const [result] = await this.classifyMany([input], context);
    if (!result) {
      throw new ProviderError('PROVIDER_FAILED', 'Claude 가 분류 결과를 돌려주지 않았습니다.');
    }
    return result;
  }

  /** 여러 거래를 한 번에 분류한다. 결과는 입력 순서대로, 못 고른 거래는 null */
  async classifyMany(
    inputs: ClassifyInput[],
    context: ClassifyContext,
  ): Promise<(ClassifySuggestion | null)[]> {
    if (inputs.length === 0) return [];
    const codes = context.accounts.map((a) => a.code);
    const accountList = context.accounts
      .map((a) => `${a.code} ${a.name} (${a.category})`)
      .join('\n');
    const examples = context.examples
      .slice(0, 30)
      .map(
        (e) =>
          `- ${[e.counterparty, e.description].filter(Boolean).join(' / ')} → ${e.accountCode}`,
      )
      .join('\n');
    const transactions = inputs
      .map(
        (t, i) =>
          `${i}. [${KIND_LABELS[t.kind]}] ${t.date} ${t.amount >= 0 ? '+' : ''}${t.amount}원` +
          `${t.vatAmount ? ` (부가세 ${t.vatAmount}원)` : ''} ${t.counterparty ?? ''} ${t.description}`.trimEnd(),
      )
      .join('\n');
    const json = await this.call({
      max_tokens: Math.min(8_000, 200 + inputs.length * 150),
      system: SYSTEM,
      tools: [
        {
          name: 'record_classifications',
          description: '거래마다 분개 계정·부가세 처리·신뢰도·사유를 기록한다',
          input_schema: {
            type: 'object',
            properties: {
              results: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    index: { type: 'integer', description: '거래 번호' },
                    accountCode: { type: 'string', enum: codes },
                    vatType: { type: 'string', enum: VAT_TYPES },
                    confidence: { type: 'number', minimum: 0, maximum: 1 },
                    reason: { type: 'string', description: '한국어 한 문장' },
                  },
                  required: ['index', 'accountCode', 'vatType', 'confidence', 'reason'],
                },
              },
            },
            required: ['results'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'record_classifications' },
      messages: [
        {
          role: 'user',
          content: [
            `계정 목록:\n${accountList}`,
            examples ? `과거 분개 예시:\n${examples}` : '',
            `분류할 거래(번호. [종류] 날짜 금액 거래처 내용):\n${transactions}`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    });
    const tool = json.content?.find((c) => c.type === 'tool_use');
    const results = (tool?.input as ToolResult | undefined)?.results ?? [];
    const out: (ClassifySuggestion | null)[] = inputs.map(() => null);
    const valid = new Set(codes);
    for (const r of results) {
      if (typeof r.index !== 'number' || r.index < 0 || r.index >= inputs.length) continue;
      if (!r.accountCode || !valid.has(r.accountCode)) continue;
      const vatType = (VAT_TYPES as readonly string[]).includes(r.vatType ?? '')
        ? (r.vatType as ClassifySuggestion['vatType'])
        : 'none';
      const confidence = Math.max(0, Math.min(AI_MAX_CONFIDENCE, Number(r.confidence) || 0));
      out[r.index] = {
        accountCode: r.accountCode,
        vatType,
        confidence: Math.round(confidence * 100) / 100,
        reason: (r.reason ?? '').slice(0, 200),
      };
    }
    return out;
  }
}
