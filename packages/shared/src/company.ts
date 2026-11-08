import { z } from 'zod';
import { EmailSchema } from './auth.js';
import { isValidBizRegNo, normalizeBizRegNo } from './biz-reg-no.js';
import { ROLES } from './roles.js';

export const BizRegNoSchema = z
  .string()
  .trim()
  .transform(normalizeBizRegNo)
  .refine(isValidBizRegNo, { error: '올바른 사업자등록번호가 아닙니다.' });

export const CreateCompanySchema = z.object({
  name: z.string().trim().min(1, { error: '회사명을 입력해 주세요.' }).max(100),
  bizRegNo: BizRegNoSchema,
  representative: z.string().trim().max(50).optional(),
  businessType: z.string().trim().max(50).optional(),
  businessItem: z.string().trim().max(100).optional(),
  address: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(30).optional(),
});
export type CreateCompanyInput = z.infer<typeof CreateCompanySchema>;

const optionalText = (max: number) => z.string().trim().max(max).nullish();

/** 회사정보 수정(모든 항목 선택) */
export const UpdateCompanySchema = CreateCompanySchema.partial().extend({
  representative: optionalText(50),
  businessType: optionalText(50),
  businessItem: optionalText(100),
  address: optionalText(200),
  phone: optionalText(30),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  /** 전표를 전기하려면 관리자 승인이 필요한지 */
  journalApprovalRequired: z.boolean().optional(),
});
export type UpdateCompanyInput = z.infer<typeof UpdateCompanySchema>;

export const BusinessPlaceInputSchema = z.object({
  name: z.string().trim().min(1, { error: '사업장명을 입력해 주세요.' }).max(100),
  bizRegNo: BizRegNoSchema,
  representative: optionalText(50),
  businessType: optionalText(50),
  businessItem: optionalText(100),
  address: optionalText(200),
});
export type BusinessPlaceInput = z.infer<typeof BusinessPlaceInputSchema>;

/** 초대할 수 있는 역할(대표 관리자는 초대로 지정할 수 없다) */
export const INVITABLE_ROLES = ROLES.filter((r) => r !== 'owner') as [
  'admin',
  'accountant',
  'approver',
  'employee',
];

export const CreateInvitationSchema = z.object({
  email: EmailSchema,
  role: z.enum(INVITABLE_ROLES, { error: '역할을 선택해 주세요.' }),
});
export type CreateInvitationInput = z.infer<typeof CreateInvitationSchema>;
