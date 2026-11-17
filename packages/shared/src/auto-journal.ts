import { z } from 'zod';
import { UPLOAD_KINDS } from './evidence.js';
import { WonSchema } from './journal.js';

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const optionalUuid = z.preprocess(emptyToNull, z.uuid().nullish());

/** 자동분개가 다루는 거래 종류 */
export const AUTO_JOURNAL_KINDS = [
  'bank_in',
  'bank_out',
  'card',
  'card_cancel',
  'tax_sales',
  'tax_purchase',
  'cash_sales',
  'cash_purchase',
] as const;
export type AutoJournalKind = (typeof AUTO_JOURNAL_KINDS)[number];

export const AUTO_JOURNAL_KIND_LABELS: Record<AutoJournalKind, string> = {
  bank_in: '통장 입금',
  bank_out: '통장 출금',
  card: '카드 승인',
  card_cancel: '카드 취소',
  tax_sales: '매출 세금계산서',
  tax_purchase: '매입 세금계산서',
  cash_sales: '현금영수증 매출',
  cash_purchase: '현금영수증 매입',
};

/** 매입세액 공제 여부를 고르는 종류 */
export const PURCHASE_KINDS: readonly AutoJournalKind[] = [
  'card',
  'card_cancel',
  'tax_purchase',
  'cash_purchase',
];

export const SUGGESTION_METHODS = [
  'rule',
  'settlement',
  'history',
  'ai',
  'default',
  'manual',
  'none',
] as const;
export type SuggestionMethod = (typeof SUGGESTION_METHODS)[number];
export const SUGGESTION_METHOD_LABELS: Record<SuggestionMethod, string> = {
  rule: '회사 규칙',
  settlement: '외상 반제',
  history: '과거 이력',
  ai: 'AI 추천',
  default: '기본 추천',
  manual: '직접 지정',
  none: '추천 없음',
};

/** 분개 규칙 입력 */
export const AutoJournalRuleInputSchema = z
  .object({
    name: z.string().trim().min(1, { error: '규칙 이름을 입력해 주세요.' }).max(50),
    priority: z.number().int().min(1).max(999).default(100),
    isActive: z.boolean().default(true),
    kinds: z.array(z.enum(AUTO_JOURNAL_KINDS)).max(AUTO_JOURNAL_KINDS.length).default([]),
    keywords: z.preprocess(emptyToNull, z.string().trim().max(200).nullish()),
    partnerId: optionalUuid,
    minAmount: z.preprocess(emptyToNull, WonSchema.nullish()),
    maxAmount: z.preprocess(emptyToNull, WonSchema.nullish()),
    accountId: z.uuid({ error: '분개할 계정을 선택해 주세요.' }),
    assignPartnerId: optionalUuid,
    deductible: z.boolean().nullish(),
    departmentId: optionalUuid,
    projectId: optionalUuid,
    memo: z.preprocess(emptyToNull, z.string().trim().max(100).nullish()),
  })
  .refine((v) => !!v.keywords || !!v.partnerId || v.minAmount != null || v.maxAmount != null, {
    error: '키워드·거래처·금액 중 하나 이상의 조건을 넣어 주세요.',
    path: ['keywords'],
  })
  .refine((v) => v.minAmount == null || v.maxAmount == null || v.minAmount <= v.maxAmount, {
    error: '최소 금액이 최대 금액보다 큽니다.',
    path: ['maxAmount'],
  });
export type AutoJournalRuleInput = z.infer<typeof AutoJournalRuleInputSchema>;

/** 규칙 켜고 끄기·우선순위 바꾸기 */
export const AutoJournalRuleToggleSchema = z.object({
  isActive: z.boolean().optional(),
  priority: z.number().int().min(1).max(999).optional(),
});

/** 검토함에서 추천을 고친다 */
export const SuggestionUpdateSchema = z.object({
  accountId: optionalUuid,
  deductible: z.boolean().nullish(),
  partnerId: optionalUuid,
  departmentId: optionalUuid,
  projectId: optionalUuid,
  memo: z.preprocess(emptyToNull, z.string().trim().max(100).nullish()),
});
export type SuggestionUpdateInput = z.infer<typeof SuggestionUpdateSchema>;

export const EvidenceRefSchema = z.object({
  evidenceKind: z.enum(UPLOAD_KINDS),
  evidenceId: z.uuid(),
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

/** 검토함에서 골라 전표로 만든다 */
export const ApproveSuggestionsSchema = z.object({
  items: z.array(EvidenceRefSchema).min(1, { error: '승인할 거래를 골라 주세요.' }).max(200),
});

/** 자동 전기 설정 */
export const AutoJournalSettingsSchema = z.object({
  autoPost: z.boolean(),
  /** 이 신뢰도 이상이면 검토 없이 전표를 만든다(0.5~1) */
  threshold: z.number().min(0.5).max(1),
});
export type AutoJournalSettings = z.infer<typeof AutoJournalSettingsSchema>;

/** 규칙 제안을 규칙으로 만들거나 무시한다(제안 목록의 종류·열쇠) */
export const RuleSuggestionRefSchema = z.object({
  kind: z.enum(AUTO_JOURNAL_KINDS),
  keys: z.array(z.string().min(1).max(300)).min(1).max(10),
});
export type RuleSuggestionRef = z.infer<typeof RuleSuggestionRefSchema>;
