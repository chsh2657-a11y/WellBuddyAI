import { EVIDENCE_TYPES, VAT_TYPES } from '@wellbuddy/accounting-core';
import { IsoDateSchema, JOURNAL_STATUSES, JOURNAL_TYPES } from '@wellbuddy/shared';
import { z } from 'zod';

const nullableString = z.string().nullable();

export const JournalLineSchema = z.object({
  id: z.uuid(),
  lineNo: z.number().int(),
  accountId: z.uuid(),
  accountCode: z.string(),
  accountName: z.string(),
  debit: z.number().int(),
  credit: z.number().int(),
  partnerId: z.uuid().nullable(),
  partnerName: nullableString,
  departmentId: z.uuid().nullable(),
  departmentName: nullableString,
  projectId: z.uuid().nullable(),
  projectName: nullableString,
  memo: nullableString,
  /** 외화 줄이면 통화·외화 금액(원화와 같은 쪽 기준)·환율 */
  currency: nullableString,
  foreignAmount: nullableString,
  exchangeRate: nullableString,
});

export const JournalAttachmentSchema = z.object({
  id: z.uuid(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
});

export const JournalEntrySchema = z.object({
  id: z.uuid(),
  fiscalYearId: z.uuid(),
  entryDate: z.string(),
  entryNo: z.number().int(),
  /** 표시용 전표번호(2026-09-28-3) */
  number: z.string(),
  type: z.enum(JOURNAL_TYPES),
  status: z.enum(JOURNAL_STATUSES),
  description: nullableString,
  source: z.string(),
  sourceRef: nullableString,
  vat: z
    .object({
      vatType: z.enum(VAT_TYPES),
      evidenceType: z.enum(EVIDENCE_TYPES),
      supplyAmount: z.number().int(),
      vatAmount: z.number().int(),
      deductible: z.boolean(),
      partnerId: z.uuid().nullable(),
      partnerName: nullableString,
    })
    .nullable(),
  totalAmount: z.number().int(),
  reversalOfId: z.uuid().nullable(),
  reversedById: z.uuid().nullable(),
  createdByName: nullableString,
  submittedAt: nullableString,
  submittedByName: nullableString,
  rejectionReason: nullableString,
  postedAt: nullableString,
  postedByName: nullableString,
  createdAt: z.string(),
  updatedAt: z.string(),
  lines: z.array(JournalLineSchema),
  attachments: z.array(JournalAttachmentSchema),
});

export const JournalListSchema = z.object({
  items: z.array(JournalEntrySchema),
  total: z.number().int(),
});

export const JournalListQuerySchema = z.object({
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  status: z.enum(JOURNAL_STATUSES).optional(),
  type: z.enum(JOURNAL_TYPES).optional(),
  q: z.string().trim().max(50).optional(),
  accountId: z.uuid().optional(),
  partnerId: z.uuid().optional(),
  order: z.enum(['asc', 'desc']).default('asc'),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const AttachInputSchema = z.object({
  fileIds: z.array(z.uuid()).min(1).max(20),
});

export const PeriodSchema = z.object({
  id: z.uuid(),
  periodNo: z.number().int(),
  startDate: z.string(),
  endDate: z.string(),
  isLocked: z.boolean(),
  lockedAt: nullableString,
  lockedByName: nullableString,
  /** 기간 안의 전표 수(전기에는 역분개된 전표 포함) */
  counts: z.object({
    draft: z.number().int(),
    pending: z.number().int(),
    posted: z.number().int(),
  }),
});

export const FiscalYearSchema = z.object({
  id: z.uuid(),
  label: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  carriedForwardAt: nullableString,
  opening: z.object({ entryId: z.uuid(), totalAmount: z.number().int() }).nullable(),
  periods: z.array(PeriodSchema),
});

export const OpeningBalancesSchema = z.object({
  fiscalYearId: z.uuid(),
  entryId: z.uuid().nullable(),
  /** manual(직접 입력) · carry_forward(전기이월) */
  source: nullableString,
  /** 첫 달이 마감되어 고칠 수 없음 */
  locked: z.boolean(),
  lines: z.array(
    z.object({
      accountId: z.uuid(),
      accountCode: z.string(),
      accountName: z.string(),
      partnerId: z.uuid().nullable(),
      partnerName: nullableString,
      debit: z.number().int(),
      credit: z.number().int(),
      currency: nullableString,
      foreignAmount: nullableString,
    }),
  ),
});
