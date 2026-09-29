import { z } from 'zod';
import type {
  AiClassifier,
  ClassifyContext,
  ClassifyInput,
  ClassifySuggestion,
} from '../providers.js';
import { ProviderError } from '../registry.js';
import { askJson, type Claude, type ClaudeOptions, createClaude, testClaude } from './anthropic.js';

export { DEFAULT_CLAUDE_MODEL } from './anthropic.js';

/** AI 추천의 신뢰도 상한(회사 규칙 100% 와 구분하고, 기준 100% 면 AI 는 자동 전기하지 않게) */
export const AI_MAX_CONFIDENCE = 0.95;
const VAT_TYPES = ['taxable', 'zero_rated', 'exempt', 'non_deductible', 'none'] as const;

export type ClaudeClassifierOptions = ClaudeOptions;

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
  '- confidence 는 0~1 사이 값입니다. 확실하지 않으면 낮게(0.5 이하) 줍니다.',
  '- reason 은 고른 이유를 한국어 한 문장으로 적습니다.',
  '- 비슷한 과거 분개 예시가 있으면 그것을 우선합니다.',
  '- 거래마다 결과를 하나씩, 거래 번호(index)를 붙여 돌려줍니다.',
].join('\n');

/** 계정 코드는 회사마다 달라 호출할 때 목록으로 제한한다 */
function resultSchema(codes: [string, ...string[]]) {
  return z.object({
    results: z.array(
      z.object({
        index: z.number().describe('거래 번호'),
        accountCode: z.enum(codes),
        vatType: z.enum(VAT_TYPES),
        confidence: z.number().describe('0~1'),
        reason: z.string().describe('한국어 한 문장'),
      }),
    ),
  });
}

/**
 * Claude 로 거래를 분류한다(P2-22). 구조화 출력(JSON 스키마)으로 계정 코드·부가세·신뢰도·사유를 받는다.
 * 범위 밖 번호나 중복 번호는 버리고, 신뢰도는 AI 상한으로 자른다.
 */
export class ClaudeClassifier implements AiClassifier {
  private readonly claude: Claude;

  constructor(options: ClaudeClassifierOptions) {
    this.claude = createClaude(options);
  }

  get model() {
    return this.claude.model;
  }

  testConnection() {
    return testClaude(this.claude);
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
    const [first, ...rest] = codes;
    if (first === undefined) {
      throw new ProviderError('PROVIDER_FAILED', '분류에 쓸 계정 목록이 비어 있습니다.');
    }
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
    const { results } = await askJson(this.claude, {
      system: SYSTEM,
      effort: 'medium',
      schema: resultSchema([first, ...rest]),
      content: [
        `계정 목록:\n${accountList}`,
        examples ? `과거 분개 예시:\n${examples}` : '',
        `분류할 거래(번호. [종류] 날짜 금액 거래처 내용):\n${transactions}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    });

    const out: (ClassifySuggestion | null)[] = inputs.map(() => null);
    const valid = new Set(codes);
    for (const r of results) {
      if (!Number.isInteger(r.index) || r.index < 0 || r.index >= inputs.length) continue;
      if (out[r.index] || !valid.has(r.accountCode)) continue;
      const confidence = Math.max(0, Math.min(AI_MAX_CONFIDENCE, r.confidence || 0));
      out[r.index] = {
        accountCode: r.accountCode,
        vatType: r.vatType,
        confidence: Math.round(confidence * 100) / 100,
        reason: r.reason.slice(0, 200),
      };
    }
    return out;
  }
}
