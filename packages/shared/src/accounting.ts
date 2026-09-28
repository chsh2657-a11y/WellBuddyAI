import { STATEMENT_GROUP_KEYS, type StatementGroup } from '@wellbuddy/accounting-core';
import { z } from 'zod';
import { EmailSchema } from './auth.js';
import { BizRegNoSchema } from './company.js';

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
/** 빈 칸은 null 로 저장한다 */
const optionalText = (max: number) =>
  z.preprocess(emptyToNull, z.string().trim().max(max).nullish());

// ── 계정과목 ─────────────────────────────────────────────

export const AccountInputSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{3,5}$/, { error: '계정코드는 숫자 3~5자리입니다.' }),
  name: z.string().trim().min(1, { error: '계정명을 입력해 주세요.' }).max(50),
  group: z.enum(STATEMENT_GROUP_KEYS as [StatementGroup, ...StatementGroup[]], {
    error: '재무제표 구분을 선택해 주세요.',
  }),
  normalBalance: z.enum(['debit', 'credit']).optional(),
  requiresPartner: z.boolean().optional(),
  requiresDepartment: z.boolean().optional(),
  isActive: z.boolean().optional(),
  description: optionalText(200),
});
export type AccountInput = z.infer<typeof AccountInputSchema>;

/** 표준 계정은 코드·구분·정상잔액을 바꿀 수 없다(API 가 검사) */
export const AccountUpdateSchema = AccountInputSchema.partial();
export type AccountUpdateInput = z.infer<typeof AccountUpdateSchema>;

export const AccountMemoInputSchema = z.object({
  text: z.string().trim().min(1, { error: '적요를 입력해 주세요.' }).max(100),
});

// ── 거래처 ───────────────────────────────────────────────

export const PARTNER_KINDS = ['customer', 'supplier', 'both', 'other'] as const;
export type PartnerKind = (typeof PARTNER_KINDS)[number];
export const PARTNER_KIND_LABELS: Record<PartnerKind, string> = {
  customer: '매출처',
  supplier: '매입처',
  both: '매출·매입',
  other: '기타',
};

export const PartnerInputSchema = z.object({
  /** 비우면 자동 부여 */
  code: z.preprocess(
    emptyToNull,
    z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{1,20}$/, { error: '거래처 코드는 영문·숫자 20자 이내입니다.' })
      .nullish(),
  ),
  name: z.string().trim().min(1, { error: '거래처명을 입력해 주세요.' }).max(100),
  kind: z.enum(PARTNER_KINDS).default('both'),
  /** 개인·해외 거래처는 사업자등록번호가 없을 수 있다 */
  bizRegNo: z.preprocess(emptyToNull, BizRegNoSchema.nullish()),
  representative: optionalText(50),
  businessType: optionalText(50),
  businessItem: optionalText(100),
  address: optionalText(200),
  phone: optionalText(30),
  email: z.preprocess(emptyToNull, EmailSchema.nullish()),
  contactName: optionalText(50),
  bankName: optionalText(30),
  /** 입력하면 암호화해 저장하고, 응답에는 끝 4자리만 보여준다 */
  bankAccount: z.preprocess(
    emptyToNull,
    z
      .string()
      .trim()
      .regex(/^[0-9-]{6,30}$/, { error: '계좌번호는 숫자와 - 만 입력해 주세요.' })
      .nullish(),
  ),
  bankHolder: optionalText(50),
  memo: optionalText(500),
  isActive: z.boolean().optional(),
});
export type PartnerInput = z.infer<typeof PartnerInputSchema>;

export const PartnerUpdateSchema = PartnerInputSchema.partial();
export type PartnerUpdateInput = z.infer<typeof PartnerUpdateSchema>;

// ── 부서·프로젝트 ────────────────────────────────────────

export const DimensionInputSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{1,20}$/, { error: '코드는 영문·숫자 20자 이내입니다.' }),
  name: z.string().trim().min(1, { error: '이름을 입력해 주세요.' }).max(50),
  isActive: z.boolean().optional(),
});
export type DimensionInput = z.infer<typeof DimensionInputSchema>;

const IsoDate = z.iso.date({ error: '날짜 형식은 YYYY-MM-DD 입니다.' });

export const ProjectInputSchema = DimensionInputSchema.extend({
  startDate: z.preprocess(emptyToNull, IsoDate.nullish()),
  endDate: z.preprocess(emptyToNull, IsoDate.nullish()),
}).refine((v) => !v.startDate || !v.endDate || v.startDate <= v.endDate, {
  error: '종료일이 시작일보다 빠릅니다.',
  path: ['endDate'],
});
export type ProjectInput = z.infer<typeof ProjectInputSchema>;
