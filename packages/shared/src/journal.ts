import {
  CURRENCY_CODES,
  EVIDENCE_TYPES,
  parseForeign,
  parseRate,
  VAT_TYPES,
} from '@wellbuddy/accounting-core';
import { z } from 'zod';

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

// ── 전표 종류·상태 ───────────────────────────────────────

export const JOURNAL_TYPES = [
  'general',
  'sales',
  'purchase',
  'receipt',
  'payment',
  'opening',
  'closing',
] as const;
export type JournalType = (typeof JOURNAL_TYPES)[number];

export const JOURNAL_TYPE_LABELS: Record<JournalType, string> = {
  general: '대체',
  sales: '매출',
  purchase: '매입',
  receipt: '입금',
  payment: '출금',
  opening: '기초',
  closing: '결산',
};

/** 사용자가 직접 입력할 수 있는 전표 종류(기초·결산 전표는 시스템이 만든다) */
export const INPUT_JOURNAL_TYPES = ['general', 'sales', 'purchase', 'receipt', 'payment'] as const;
export type InputJournalType = (typeof INPUT_JOURNAL_TYPES)[number];

export const JOURNAL_STATUSES = ['draft', 'pending', 'posted', 'reversed'] as const;
export type JournalStatus = (typeof JOURNAL_STATUSES)[number];

export const JOURNAL_STATUS_LABELS: Record<JournalStatus, string> = {
  draft: '작성중',
  pending: '승인요청',
  posted: '전기',
  reversed: '역분개됨',
};

/** 장부·보고서에 반영되는 상태 */
export const LEDGER_STATUSES = ['posted', 'reversed'] as const satisfies readonly JournalStatus[];

/** 전표번호 표시: 2026-09-28-3 (기초잔액 전표는 "기초") */
export function formatJournalNo(entryDate: string, entryNo: number): string {
  return entryNo === 0 ? `${entryDate} 기초` : `${entryDate}-${entryNo}`;
}

// ── 입력 스키마 ──────────────────────────────────────────

export const IsoDateSchema = z.iso
  .date({ error: '날짜 형식은 YYYY-MM-DD 입니다.' })
  .refine((d) => d >= '2000-01-01' && d <= '2099-12-31', {
    error: '2000년~2099년 날짜만 입력할 수 있습니다.',
  });

/** 원 단위 금액(0 이상 정수) */
export const WonSchema = z
  .number({ error: '금액을 숫자로 입력해 주세요.' })
  .int({ error: '금액은 원 단위 정수입니다.' })
  .min(0, { error: '금액은 0 이상입니다.' })
  .max(Number.MAX_SAFE_INTEGER);

/** 부호가 있는 원 단위 금액(반품·마이너스 세금계산서) */
export const SignedWonSchema = z
  .number({ error: '금액을 숫자로 입력해 주세요.' })
  .int({ error: '금액은 원 단위 정수입니다.' })
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);

const optionalUuid = z.preprocess(emptyToNull, z.uuid().nullish());

/** 외화 금액: "1,234.5" 또는 1234.5 → "1234.50"(소수 둘째 자리) */
export const ForeignAmountSchema = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const parsed = parseForeign(String(v));
  if (parsed === null) {
    ctx.addIssue({ code: 'custom', message: '외화 금액은 소수 둘째 자리까지 입력합니다.' });
    return z.NEVER;
  }
  return parsed;
});

/** 환율: 소수 넷째 자리까지, 0보다 크다(엔화는 100엔당 원) */
export const RateSchema = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const parsed = parseRate(v);
  if (parsed === null) {
    ctx.addIssue({ code: 'custom', message: '환율은 0보다 크고 소수 넷째 자리까지입니다.' });
    return z.NEVER;
  }
  return parsed;
});

export const CurrencySchema = z.enum(CURRENCY_CODES, { error: '지원하지 않는 통화입니다.' });

const optionalCurrency = z.preprocess(emptyToNull, CurrencySchema.nullish());

export const JournalLineInputSchema = z
  .object({
    accountId: z.uuid({ error: '계정과목을 선택해 주세요.' }),
    debit: WonSchema.default(0),
    credit: WonSchema.default(0),
    partnerId: optionalUuid,
    departmentId: optionalUuid,
    projectId: optionalUuid,
    memo: z.preprocess(emptyToNull, z.string().trim().max(200).nullish()),
    /** 외화 줄: 통화·외화 금액·환율을 함께 넣고, 원화 금액 = 외화 × 환율(원 미만 반올림) */
    currency: optionalCurrency,
    foreignAmount: z.preprocess(emptyToNull, ForeignAmountSchema.nullish()),
    exchangeRate: z.preprocess(emptyToNull, RateSchema.nullish()),
  })
  .superRefine((l, ctx) => {
    if (!l.currency) {
      if (l.foreignAmount || l.exchangeRate) {
        ctx.addIssue({
          code: 'custom',
          message: '외화 금액에는 통화를 선택해 주세요.',
          path: ['currency'],
        });
      }
      return;
    }
    if (!l.foreignAmount || Number(l.foreignAmount) <= 0) {
      ctx.addIssue({
        code: 'custom',
        message: '외화 금액을 입력해 주세요.',
        path: ['foreignAmount'],
      });
    }
    if (!l.exchangeRate) {
      ctx.addIssue({ code: 'custom', message: '환율을 입력해 주세요.', path: ['exchangeRate'] });
    }
  });
export type JournalLineInput = z.infer<typeof JournalLineInputSchema>;

/** 매입매출전표의 부가세 정보 */
export const JournalVatInputSchema = z.object({
  vatType: z.enum(VAT_TYPES),
  evidenceType: z.enum(EVIDENCE_TYPES),
  supplyAmount: SignedWonSchema,
  vatAmount: SignedWonSchema,
  /** 매입세액 공제 여부(매입만, 불공제면 부가세를 비용·자산에 포함) */
  deductible: z.boolean().default(true),
  partnerId: optionalUuid,
});
export type JournalVatInput = z.infer<typeof JournalVatInputSchema>;

export const JournalEntryInputSchema = z
  .object({
    entryDate: IsoDateSchema,
    type: z.enum(INPUT_JOURNAL_TYPES).default('general'),
    description: z.preprocess(emptyToNull, z.string().trim().max(200).nullish()),
    lines: z
      .array(JournalLineInputSchema)
      .min(2, { error: '분개는 2줄 이상이어야 합니다.' })
      .max(300, { error: '한 전표는 300줄까지 입력할 수 있습니다.' }),
    vat: JournalVatInputSchema.nullish(),
    /** 첨부할 파일(파일 업로드 API 로 먼저 올린 파일 ID) */
    attachmentIds: z.array(z.uuid()).max(20).optional(),
  })
  .refine((v) => (v.type === 'sales' || v.type === 'purchase') === !!v.vat, {
    error: '매출·매입 전표에만 부가세 정보를 입력합니다.',
    path: ['vat'],
  });
export type JournalEntryInput = z.infer<typeof JournalEntryInputSchema>;

/** 저장하면서 바로 옮길 상태(기본: 작성중) */
export const JournalCreateSchema = z.object({
  entry: JournalEntryInputSchema,
  status: z.enum(['draft', 'pending', 'posted']).default('draft'),
});
export type JournalCreateInput = z.infer<typeof JournalCreateSchema>;

export const JournalReverseSchema = z.object({
  /** 역분개 전표 날짜(기본: 오늘) */
  entryDate: IsoDateSchema.optional(),
  description: z.preprocess(emptyToNull, z.string().trim().max(200).nullish()),
});
export type JournalReverseInput = z.infer<typeof JournalReverseSchema>;

export const JournalRejectSchema = z.object({
  reason: z.string().trim().min(1, { error: '반려 사유를 입력해 주세요.' }).max(200),
});

export const OpeningBalanceLineSchema = z
  .object({
    accountId: z.uuid({ error: '계정과목을 선택해 주세요.' }),
    partnerId: optionalUuid,
    debit: WonSchema.default(0),
    credit: WonSchema.default(0),
    /** 외화 잔액(외화예금·외화채권·채무): 통화와 외화 금액, 원화는 장부 금액 */
    currency: optionalCurrency,
    foreignAmount: z.preprocess(emptyToNull, ForeignAmountSchema.nullish()),
  })
  .refine((l) => !l.currency === !l.foreignAmount, {
    error: '외화 잔액은 통화와 외화 금액을 함께 입력합니다.',
    path: ['foreignAmount'],
  });

export const OpeningBalancesInputSchema = z.object({
  lines: z.array(OpeningBalanceLineSchema).max(2000),
});
export type OpeningBalancesInput = z.infer<typeof OpeningBalancesInputSchema>;

export const FiscalYearCreateSchema = z.object({
  /** 이 날짜가 속한 회계연도를 만든다 */
  date: IsoDateSchema,
});
