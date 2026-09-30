import {
  BIZ_NO_STATUSES,
  COLLECT_CHANNELS,
  EVIDENCE_STATUSES,
  ISSUE_STATUSES,
  TAX_INVOICE_KINDS,
  UPLOAD_KINDS,
} from '@wellbuddy/shared';
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
  /** 외상 대금을 주고받아 반제한 때(P2-27) */
  settledAt: nullableString,
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

/** 영수증(사진 → OCR 또는 직접 입력, P2-18) */
export const ReceiptSchema = z.object({
  id: z.uuid(),
  fileId: z.uuid().nullable(),
  filename: nullableString,
  mimeType: nullableString,
  txDate: nullableString,
  merchantName: nullableString,
  bizNo: nullableString,
  bizNoStatus: z.enum(BIZ_NO_STATUSES).nullable(),
  totalAmount: int.nullable(),
  vatAmount: int.nullable(),
  /** 읽은 OCR 공급자(직접 입력이면 null) */
  ocrProvider: nullableString,
  /** 읽지 못했을 때의 오류 */
  ocrError: nullableString,
  /** 인식 신뢰도 0~1 */
  confidence: z.number().nullable(),
  /** 짝지은 카드 승인 */
  card: z
    .object({
      id: z.uuid(),
      merchantName: z.string(),
      approvalNo: z.string(),
      approvedDate: z.string(),
      amount: int,
    })
    .nullable(),
  ...linked,
  createdAt: z.string(),
});

/** 등록·수정 결과(안내 메시지 포함) */
export const ReceiptResultSchema = ReceiptSchema.extend({ message: nullableString });
export const ReceiptUploadSchema = ReceiptResultSchema.extend({
  /** 같은 파일을 이미 올렸으면 true(기존 영수증을 돌려준다) */
  duplicate: z.boolean(),
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

export const CollectStatusSchema = z.object({
  channel: z.enum(COLLECT_CHANNELS),
  label: z.string(),
  provider: z.string(),
  providerLabel: z.string(),
  enabled: z.boolean(),
  /** 켜져 있고 자동 수집 공급자(모의·실연동)인지 */
  collectable: z.boolean(),
  schedule: z.enum(['manual', 'hourly', 'daily']),
  lastStatus: z.enum(['success', 'error']).nullable(),
  lastMessage: nullableString,
  lastRunAt: nullableString,
  /** 다음 예약 수집 시각(수동이거나 수집할 수 없으면 null, P2-16) */
  nextRunAt: nullableString,
});
export const CollectResultSchema = z.object({
  runId: z.uuid(),
  status: z.enum(['success', 'error']),
  from: z.string(),
  to: z.string(),
  fetched: int,
  inserted: int,
  duplicates: int,
  message: z.string(),
});

export const EvidenceCenterSchema = z.object({
  total: int,
  /** 상태별 건수(상태 조건만 빼고 같은 조건) */
  counts: z.object(
    Object.fromEntries(EVIDENCE_STATUSES.map((s) => [s, int])) as Record<
      (typeof EVIDENCE_STATUSES)[number],
      typeof int
    >,
  ),
  items: z.array(
    z.object({
      evidenceKind: z.enum(UPLOAD_KINDS),
      id: z.uuid(),
      date: z.string(),
      kindLabel: z.string(),
      description: z.string(),
      counterparty: nullableString,
      sourceLabel: nullableString,
      flow: z.enum(['in', 'out']),
      amount: int,
      status: z.enum(EVIDENCE_STATUSES),
      account: nullableString,
      entryId: z.uuid().nullable(),
      entryNumber: nullableString,
    }),
  ),
  /** 1,000건을 넘어 잘랐는지 */
  truncated: z.boolean(),
});

export const ReconciliationSchema = z.object({
  date: z.string(),
  groups: z.array(
    z.object({
      ledgerAccountId: z.uuid(),
      ledgerAccount: z.string(),
      /** 연결된 계좌들의 기준일 통장 잔액 합계(잔액을 모르는 계좌가 있으면 null) */
      bankBalance: int.nullable(),
      ledgerBalance: int,
      /** 장부에 아직 반영되지 않은 통장 거래의 순액(입금 +, 출금 −) */
      unreflected: int,
      unreflectedCount: int,
      /** 통장 − 장부 − 미반영 */
      difference: int.nullable(),
      status: z.enum(['matched', 'mismatch', 'unknown']),
      accounts: z.array(
        z.object({
          id: z.uuid(),
          alias: z.string(),
          bankName: z.string(),
          accountNoMasked: z.string(),
          isActive: z.boolean(),
          balance: int.nullable(),
          balanceDate: nullableString,
          unreflected: int,
          unreflectedCount: int,
        }),
      ),
    }),
  ),
});

/** 전자세금계산서 발행 기록(P2-14) */
export const TaxInvoiceIssueSchema = z.object({
  id: z.uuid(),
  mgtKey: z.string(),
  provider: z.string(),
  status: z.enum(ISSUE_STATUSES),
  kind: z.enum(TAX_INVOICE_KINDS),
  issueDate: z.string(),
  buyerBizNo: z.string(),
  buyerName: z.string(),
  buyerCeoName: nullableString,
  buyerEmail: nullableString,
  itemName: z.string(),
  supplyAmount: int,
  vatAmount: int,
  totalAmount: int,
  /** 국세청 승인번호 */
  approvalNo: nullableString,
  message: nullableString,
  /** 등록한 매출 세금계산서(증빙)와 그 처리 상태 */
  taxInvoiceId: z.uuid().nullable(),
  evidenceStatus: status.nullable(),
  createdAt: z.string(),
});

export const TaxInvoiceCancelResultSchema = TaxInvoiceIssueSchema.extend({
  /** 이미 전표가 있으면 역분개 안내 */
  notice: nullableString,
});
