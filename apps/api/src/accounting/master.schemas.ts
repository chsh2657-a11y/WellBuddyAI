import { STATEMENT_GROUP_KEYS, type StatementGroup } from '@wellbuddy/accounting-core';
import { PARTNER_KINDS } from '@wellbuddy/shared';
import { z } from 'zod';

export const AccountSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  group: z.enum(STATEMENT_GROUP_KEYS as [StatementGroup, ...StatementGroup[]]),
  normalBalance: z.enum(['debit', 'credit']),
  requiresPartner: z.boolean(),
  requiresDepartment: z.boolean(),
  isActive: z.boolean(),
  isSystem: z.boolean(),
  description: z.string().nullable(),
});

export const AccountMemoSchema = z.object({ id: z.uuid(), text: z.string() });

export const PartnerSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  kind: z.enum(PARTNER_KINDS),
  bizRegNo: z.string().nullable(),
  representative: z.string().nullable(),
  businessType: z.string().nullable(),
  businessItem: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  contactName: z.string().nullable(),
  bankName: z.string().nullable(),
  /** 계좌번호는 끝 4자리만(예: ****1234) */
  bankAccountMasked: z.string().nullable(),
  bankHolder: z.string().nullable(),
  memo: z.string().nullable(),
  isActive: z.boolean(),
});

export const DimensionSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  isActive: z.boolean(),
});

export const ProjectSchema = DimensionSchema.extend({
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
});

export const ListQuerySchema = z.object({
  q: z.string().trim().max(50).optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
