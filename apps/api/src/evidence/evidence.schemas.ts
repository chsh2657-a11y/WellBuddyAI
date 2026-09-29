import { EVIDENCE_STATUSES, UPLOAD_KINDS } from '@wellbuddy/shared';
import { z } from 'zod';

const int = z.number().int();
const nullableString = z.string().nullable();
const status = z.enum(EVIDENCE_STATUSES);
const source = z.string();

export const UploadPreviewSchema = z.object({
  kind: z.enum(UPLOAD_KINDS),
  /** 머리글 줄(0부터, 못 찾으면 -1) */
  headerRow: int,
  headers: z.array(z.string()),
  /** 파일 앞부분 30줄(머리글 줄을 직접 고를 때) */
  topRows: z.array(z.array(z.string())),
  /** 필드 → 열 번호 */
  mapping: z.record(z.string(), int),
  fields: z.array(z.object({ key: z.string(), label: z.string(), required: z.boolean() })),
  /** 저장한 매핑을 썼으면 그 이름 */
  savedMappingName: nullableString,
  total: int,
  /** 이미 등록되어 건너뛸 건수 */
  duplicates: int,
  issues: z.array(z.object({ row: int, message: z.string() })),
  issueCount: int,
  sample: z.array(z.record(z.string(), z.unknown())),
});

export const UploadCommitSchema = z.object({
  runId: z.uuid(),
  fetched: int,
  inserted: int,
  duplicates: int,
  issueCount: int,
  message: z.string(),
});

export const ImportMappingSchema = z.object({
  id: z.uuid(),
  kind: z.enum(UPLOAD_KINDS),
  name: z.string(),
  headerRow: int,
  mapping: z.record(z.string(), int),
  updatedAt: z.string(),
});

const linked = {
  source,
  status,
  entryId: z.uuid().nullable(),
  entryNumber: nullableString,
};

export const BankTransactionSchema = z.object({
  id: z.uuid(),
  bankAccountId: z.uuid(),
  accountAlias: z.string(),
  txDate: z.string(),
  txTime: nullableString,
  description: z.string(),
  counterparty: nullableString,
  deposit: int,
  withdrawal: int,
  balance: int.nullable(),
  memo: nullableString,
  ...linked,
});

export const CardTransactionSchema = z.object({
  id: z.uuid(),
  cardId: z.uuid(),
  cardAlias: z.string(),
  approvedDate: z.string(),
  approvedTime: nullableString,
  merchantName: z.string(),
  merchantBizNo: nullableString,
  amount: int,
  vatAmount: int.nullable(),
  approvalNo: z.string(),
  installmentMonths: int.nullable(),
  cancelled: z.boolean(),
  category: nullableString,
  ...linked,
});

export const TaxInvoiceSchema = z.object({
  id: z.uuid(),
  direction: z.enum(['sales', 'purchase']),
  kind: z.enum(['tax', 'zero', 'exempt']),
  approvalNo: z.string(),
  issueDate: z.string(),
  supplierBizNo: z.string(),
  supplierName: z.string(),
  buyerBizNo: z.string(),
  buyerName: z.string(),
  supplyAmount: int,
  vatAmount: int,
  totalAmount: int,
  itemSummary: nullableString,
  partnerId: z.uuid().nullable(),
  partnerName: nullableString,
  ...linked,
});

export const CashReceiptSchema = z.object({
  id: z.uuid(),
  direction: z.enum(['sales', 'purchase']),
  txDate: z.string(),
  approvalNo: z.string(),
  bizNo: nullableString,
  name: z.string(),
  supplyAmount: int,
  vatAmount: int,
  totalAmount: int,
  usage: z.enum(['income_deduction', 'expense_proof']),
  cancelled: z.boolean(),
  partnerId: z.uuid().nullable(),
  partnerName: nullableString,
  ...linked,
});

export const CollectionRunSchema = z.object({
  id: z.uuid(),
  channel: z.string(),
  provider: z.string(),
  trigger: z.enum(['manual', 'schedule', 'file']),
  status: z.enum(['running', 'success', 'error']),
  fetched: int,
  inserted: int,
  duplicates: int,
  message: nullableString,
  startedAt: z.string(),
  finishedAt: nullableString,
});
