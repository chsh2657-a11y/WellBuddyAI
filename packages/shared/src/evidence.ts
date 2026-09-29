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

export const UPLOAD_KINDS = ['bank', 'card', 'tax_invoice', 'cash_receipt'] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];
export const UPLOAD_KIND_LABELS: Record<UploadKind, string> = {
  bank: '통장 거래내역',
  card: '카드 승인내역',
  tax_invoice: '세금계산서·계산서',
  cash_receipt: '현금영수증',
};

/** 파일 업로드 옵션(multipart 의 options 필드에 JSON 으로 보낸다) */
export const UploadOptionsSchema = z
  .object({
    kind: z.enum(UPLOAD_KINDS),
    /** 통장은 계좌 ID, 카드는 카드 ID */
    sourceId: z.uuid().optional(),
    /** 세금계산서·현금영수증 매출/매입(세금계산서는 비우면 사업자번호로 판단) */
    direction: z.enum(['sales', 'purchase']).optional(),
    /** 계산서(면세) 파일 */
    exempt: z.boolean().optional(),
    /** 사용자가 지정한 머리글 줄(0부터)과 열 매핑(필드 → 열 번호) */
    headerRow: z.number().int().min(0).optional(),
    mapping: z.record(z.string(), z.number().int().min(0)).optional(),
    /** 이 매핑을 저장해 같은 양식에 다시 쓴다 */
    saveMapping: z.boolean().optional(),
    mappingName: z.string().trim().max(50).optional(),
  })
  .refine((v) => (v.kind !== 'bank' && v.kind !== 'card') || !!v.sourceId, {
    error: '계좌 또는 카드를 선택해 주세요.',
    path: ['sourceId'],
  })
  .refine((v) => v.kind !== 'cash_receipt' || !!v.direction, {
    error: '현금영수증은 매출·매입을 골라 주세요.',
    path: ['direction'],
  })
  .refine((v) => (v.mapping === undefined) === (v.headerRow === undefined), {
    error: '열을 지정할 때는 머리글 줄도 함께 보냅니다.',
    path: ['mapping'],
  });
export type UploadOptions = z.infer<typeof UploadOptionsSchema>;

export const EvidenceListQuerySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  status: z.enum(EVIDENCE_STATUSES).optional(),
  /** 통장 계좌·카드·방향(sales/purchase) 필터 */
  sourceId: z.uuid().optional(),
  direction: z.enum(['sales', 'purchase']).optional(),
});
export type EvidenceListQuery = z.infer<typeof EvidenceListQuerySchema>;

/** 제외 처리(개인 사용분 등) 또는 되살리기 */
export const EvidenceStatusUpdateSchema = z.object({ status: z.enum(['pending', 'ignored']) });

/** 자동 수집(모의·실연동) 채널 */
export const COLLECT_CHANNELS = ['bank', 'card', 'hometax'] as const;
export type CollectChannel = (typeof COLLECT_CHANNELS)[number];
export const COLLECT_CHANNEL_LABELS: Record<CollectChannel, string> = {
  bank: '통장',
  card: '법인카드',
  hometax: '홈택스',
};
/** 한 번에 수집하는 최대 기간(일) */
export const MAX_COLLECT_DAYS = 92;
export const DEFAULT_COLLECT_DAYS = 30;

/** 수집 기간. 비우면 최근 30일, 끝나는 날은 오늘을 넘지 않는다 */
export const CollectRequestSchema = z
  .object({ from: z.iso.date().optional(), to: z.iso.date().optional() })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    error: '시작일이 종료일보다 늦습니다.',
    path: ['from'],
  });
export type CollectRequest = z.infer<typeof CollectRequestSchema>;

/** 증빙센터 조회(P2-28): 기간·종류·상태·검색어 */
export const EvidenceCenterQuerySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  kind: z.enum(UPLOAD_KINDS).optional(),
  status: z.enum(EVIDENCE_STATUSES).optional(),
  q: z.string().trim().min(1).max(50).optional(),
});
export type EvidenceCenterQuery = z.infer<typeof EvidenceCenterQuerySchema>;

/** 통장 잔액 대사 기준일(비우면 오늘) */
export const ReconcileQuerySchema = z.object({ date: z.iso.date().optional() });
