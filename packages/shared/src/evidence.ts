import { z } from 'zod';

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

/** 은행(CODEF 기관 코드) */
export const BANKS = [
  { code: '0004', name: 'KB국민은행' },
  { code: '0088', name: '신한은행' },
  { code: '0020', name: '우리은행' },
  { code: '0081', name: '하나은행' },
  { code: '0003', name: 'IBK기업은행' },
  { code: '0011', name: 'NH농협은행' },
  { code: '0023', name: 'SC제일은행' },
  { code: '0027', name: '한국씨티은행' },
  { code: '0031', name: 'iM뱅크(대구)' },
  { code: '0032', name: '부산은행' },
  { code: '0034', name: '광주은행' },
  { code: '0035', name: '제주은행' },
  { code: '0037', name: '전북은행' },
  { code: '0039', name: '경남은행' },
  { code: '0045', name: '새마을금고' },
  { code: '0048', name: '신협' },
  { code: '0071', name: '우체국' },
  { code: '0089', name: '케이뱅크' },
  { code: '0090', name: '카카오뱅크' },
  { code: '0092', name: '토스뱅크' },
] as const;
export type BankCode = (typeof BANKS)[number]['code'];
export const BANK_CODES = BANKS.map((b) => b.code) as [BankCode, ...BankCode[]];
export const bankName = (code: string) => BANKS.find((b) => b.code === code)?.name ?? code;

/** 카드사(CODEF 기관 코드) */
export const CARD_COMPANIES = [
  { code: '0301', name: 'KB국민카드' },
  { code: '0302', name: '현대카드' },
  { code: '0303', name: '삼성카드' },
  { code: '0304', name: 'NH농협카드' },
  { code: '0305', name: 'BC카드' },
  { code: '0306', name: '신한카드' },
  { code: '0307', name: '씨티카드' },
  { code: '0309', name: '우리카드' },
  { code: '0311', name: '롯데카드' },
  { code: '0313', name: '하나카드' },
] as const;
export type CardCompanyCode = (typeof CARD_COMPANIES)[number]['code'];
export const CARD_COMPANY_CODES = CARD_COMPANIES.map((c) => c.code) as [
  CardCompanyCode,
  ...CardCompanyCode[],
];
export const cardCompanyName = (code: string) =>
  CARD_COMPANIES.find((c) => c.code === code)?.name ?? code;

export const EVIDENCE_STATUSES = ['pending', 'review', 'posted', 'ignored', 'matched'] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];
export const EVIDENCE_STATUS_LABELS: Record<EvidenceStatus, string> = {
  pending: '미처리',
  review: '검토 필요',
  posted: '전표 연결',
  ignored: '제외',
  matched: '매칭됨',
};

const digits = (min: number, max: number, label: string) =>
  z
    .string()
    .transform((v) => v.replace(/[\s-]/g, ''))
    .refine((v) => /^\d+$/.test(v) && v.length >= min && v.length <= max, {
      error: `${label}는 숫자 ${min}~${max}자리입니다.`,
    });

export const BankAccountInputSchema = z.object({
  bankCode: z.enum(BANK_CODES, { error: '은행을 선택해 주세요.' }),
  alias: z.string().trim().min(1, { error: '계좌 별칭을 입력해 주세요.' }).max(50),
  accountNo: digits(10, 16, '계좌번호'),
  /** 장부 계정(예: 103 보통예금) */
  ledgerAccountId: z.uuid({ error: '장부 계정을 선택해 주세요.' }),
});
export type BankAccountInput = z.infer<typeof BankAccountInputSchema>;

export const BankAccountUpdateSchema = z.object({
  alias: z.string().trim().min(1).max(50).optional(),
  ledgerAccountId: z.uuid().optional(),
  isActive: z.boolean().optional(),
});
export type BankAccountUpdateInput = z.infer<typeof BankAccountUpdateSchema>;

export const CorporateCardInputSchema = z.object({
  cardCompany: z.enum(CARD_COMPANY_CODES, { error: '카드사를 선택해 주세요.' }),
  alias: z.string().trim().min(1, { error: '카드 별칭을 입력해 주세요.' }).max(50),
  cardNo: digits(14, 16, '카드번호'),
  holderName: z.preprocess(emptyToNull, z.string().trim().max(50).nullish()),
  /** 카드대금 계정(예: 253 미지급금) */
  ledgerAccountId: z.uuid({ error: '카드대금 계정을 선택해 주세요.' }),
});
export type CorporateCardInput = z.infer<typeof CorporateCardInputSchema>;

export const CorporateCardUpdateSchema = z.object({
  alias: z.string().trim().min(1).max(50).optional(),
  holderName: z.preprocess(emptyToNull, z.string().trim().max(50).nullish()),
  ledgerAccountId: z.uuid().optional(),
  isActive: z.boolean().optional(),
});
export type CorporateCardUpdateInput = z.infer<typeof CorporateCardUpdateSchema>;
