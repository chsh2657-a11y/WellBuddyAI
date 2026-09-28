import { BizRegNoSchema, CreateCompanySchema, EmailSchema, ROLES } from '@wellbuddy/shared';
import { z } from 'zod';

const optionalText = (max: number) => z.string().trim().max(max).nullish();

export const CompanySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  bizRegNo: z.string(),
  representative: z.string().nullable(),
  businessType: z.string().nullable(),
  businessItem: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  fiscalYearStartMonth: z.number().int(),
});

export const CreateCompanyResultSchema = z.object({
  company: CompanySchema,
  accessToken: z.string().optional(),
});

export const UpdateCompanySchema = CreateCompanySchema.partial().extend({
  representative: optionalText(50),
  businessType: optionalText(50),
  businessItem: optionalText(100),
  address: optionalText(200),
  phone: optionalText(30),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
});

export const BusinessPlaceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  bizRegNo: z.string(),
  representative: z.string().nullable(),
  businessType: z.string().nullable(),
  businessItem: z.string().nullable(),
  address: z.string().nullable(),
  isHeadquarters: z.boolean(),
});

export const BusinessPlaceInputSchema = z.object({
  name: z.string().trim().min(1, { error: '사업장명을 입력해 주세요.' }).max(100),
  bizRegNo: BizRegNoSchema,
  representative: optionalText(50),
  businessType: optionalText(50),
  businessItem: optionalText(100),
  address: optionalText(200),
});

export const InvitableRoles = ROLES.filter((r) => r !== 'owner') as [
  'admin',
  'accountant',
  'approver',
  'employee',
];

export const CreateInvitationSchema = z.object({
  email: EmailSchema,
  role: z.enum(InvitableRoles),
});

export const InvitationSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: z.enum(ROLES),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});

export const InvitationLookupSchema = z.object({
  companyName: z.string(),
  email: z.string(),
  role: z.enum(ROLES),
  status: z.enum(['pending', 'accepted', 'expired', 'revoked']),
});

export const TokenBodySchema = z.object({ token: z.string().min(10).max(200) });
export const IdParamSchema = z.object({ id: z.uuid() });
