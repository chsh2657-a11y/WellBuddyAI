import type { EvidenceType, VatType } from '@wellbuddy/accounting-core';
import type { JournalStatus, JournalType } from '@wellbuddy/shared';

/** GET /journals/:id 응답 */
export interface JournalEntry {
  id: string;
  fiscalYearId: string;
  entryDate: string;
  entryNo: number;
  number: string;
  type: JournalType;
  status: JournalStatus;
  description: string | null;
  source: string;
  sourceRef: string | null;
  vat: {
    vatType: VatType;
    evidenceType: EvidenceType;
    supplyAmount: number;
    vatAmount: number;
    deductible: boolean;
    partnerId: string | null;
    partnerName: string | null;
  } | null;
  totalAmount: number;
  reversalOfId: string | null;
  reversedById: string | null;
  createdByName: string | null;
  submittedAt: string | null;
  submittedByName: string | null;
  rejectionReason: string | null;
  postedAt: string | null;
  postedByName: string | null;
  createdAt: string;
  updatedAt: string;
  lines: {
    id: string;
    lineNo: number;
    accountId: string;
    accountCode: string;
    accountName: string;
    debit: number;
    credit: number;
    partnerId: string | null;
    partnerName: string | null;
    departmentId: string | null;
    departmentName: string | null;
    projectId: string | null;
    projectName: string | null;
    memo: string | null;
  }[];
  attachments: AttachedFile[];
}

export interface AttachedFile {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

/** 입력 그리드의 한 줄 */
export interface GridLine {
  key: number;
  accountId: string | null;
  partnerId: string | null;
  departmentId: string | null;
  projectId: string | null;
  debit: number;
  credit: number;
  memo: string;
}

let nextKey = 1;

export function newGridLine(patch: Partial<Omit<GridLine, 'key'>> = {}): GridLine {
  return {
    key: nextKey++,
    accountId: null,
    partnerId: null,
    departmentId: null,
    projectId: null,
    debit: 0,
    credit: 0,
    memo: '',
    ...patch,
  };
}

/** 금액이 있거나 계정을 고른 줄만 저장한다 */
export function filledLines(lines: readonly GridLine[]): GridLine[] {
  return lines.filter((l) => l.accountId || l.debit > 0 || l.credit > 0);
}

export function toLineInput(l: GridLine) {
  return {
    accountId: l.accountId ?? '',
    debit: l.debit,
    credit: l.credit,
    partnerId: l.partnerId,
    departmentId: l.departmentId,
    projectId: l.projectId,
    memo: l.memo || null,
  };
}
