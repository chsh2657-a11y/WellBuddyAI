import { ROLES } from '@wellbuddy/shared';
import { z } from 'zod';

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
  journalApprovalRequired: z.boolean(),
});

export const CreateCompanyResultSchema = z.object({
  company: CompanySchema,
  accessToken: z.string().optional(),
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
