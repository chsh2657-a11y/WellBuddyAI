import {
  BIZ_NO_STATUS_LABELS,
  type BizNoStatus,
  EVIDENCE_STATUS_LABELS,
  type EvidenceStatus,
  type UploadKind,
} from '@wellbuddy/shared';
import { formatWon } from '@wellbuddy/accounting-core';

export type CellType = 'text' | 'won' | 'bool' | 'direction' | 'invoiceKind' | 'usage';

export interface DisplayColumn {
  key: string;
  label: string;
  type?: CellType;
}

export const DIRECTION_LABELS: Record<'sales' | 'purchase', string> = {
  sales: '매출',
  purchase: '매입',
};
export const INVOICE_KIND_LABELS: Record<'tax' | 'zero' | 'exempt', string> = {
  tax: '과세',
  zero: '영세',
  exempt: '면세',
};
export const USAGE_LABELS: Record<'income_deduction' | 'expense_proof', string> = {
  income_deduction: '소득공제',
  expense_proof: '지출증빙',
};
export const KIND_SHORT_LABELS: Record<UploadKind, string> = {
  bank: '통장',
  card: '카드',
  tax_invoice: '세금계산서',
  cash_receipt: '현금영수증',
};

export const STATUS_VARIANTS: Record<
  EvidenceStatus,
  'default' | 'muted' | 'success' | 'warning' | 'danger'
> = {
  pending: 'muted',
  review: 'warning',
  posted: 'success',
  ignored: 'danger',
  matched: 'default',
};
export { BIZ_NO_STATUS_LABELS, EVIDENCE_STATUS_LABELS };

export const BIZ_NO_STATUS_VARIANTS: Record<BizNoStatus, 'success' | 'danger' | 'muted'> = {
  valid: 'success',
  active: 'success',
  suspended: 'danger',
  closed: 'danger',
  unregistered: 'danger',
  invalid: 'danger',
  unknown: 'muted',
};

/** 업로드 미리보기 표에 보여 줄 읽은 값 */
export const SAMPLE_COLUMNS: Record<UploadKind, DisplayColumn[]> = {
  bank: [
    { key: 'date', label: '거래일' },
    { key: 'time', label: '시각' },
    { key: 'description', label: '적요' },
    { key: 'counterparty', label: '받는분·보낸분' },
    { key: 'deposit', label: '입금', type: 'won' },
    { key: 'withdrawal', label: '출금', type: 'won' },
    { key: 'balance', label: '잔액', type: 'won' },
  ],
  card: [
    { key: 'date', label: '승인일' },
    { key: 'time', label: '시각' },
    { key: 'merchantName', label: '가맹점' },
    { key: 'merchantBizNo', label: '사업자번호' },
    { key: 'amount', label: '금액', type: 'won' },
    { key: 'approvalNo', label: '승인번호' },
    { key: 'installmentMonths', label: '할부' },
    { key: 'cancelled', label: '취소', type: 'bool' },
  ],
  tax_invoice: [
    { key: 'issueDate', label: '작성일' },
    { key: 'direction', label: '구분', type: 'direction' },
    { key: 'kind', label: '종류', type: 'invoiceKind' },
    { key: 'supplierName', label: '공급자' },
    { key: 'buyerName', label: '공급받는자' },
    { key: 'supplyAmount', label: '공급가액', type: 'won' },
    { key: 'vatAmount', label: '세액', type: 'won' },
    { key: 'totalAmount', label: '합계', type: 'won' },
  ],
  cash_receipt: [
    { key: 'date', label: '거래일' },
    { key: 'direction', label: '구분', type: 'direction' },
    { key: 'name', label: '가맹점' },
    { key: 'approvalNo', label: '승인번호' },
    { key: 'supplyAmount', label: '공급가액', type: 'won' },
    { key: 'vatAmount', label: '부가세', type: 'won' },
    { key: 'totalAmount', label: '합계', type: 'won' },
    { key: 'usage', label: '용도', type: 'usage' },
    { key: 'cancelled', label: '취소', type: 'bool' },
  ],
};

export function formatCell(value: unknown, type: CellType = 'text'): string {
  if (value === null || value === undefined || value === '') return '';
  switch (type) {
    case 'won':
      return typeof value === 'number' ? formatWon(value) : String(value);
    case 'bool':
      return value ? '예' : '';
    case 'direction':
      return DIRECTION_LABELS[value as 'sales'] ?? String(value);
    case 'invoiceKind':
      return INVOICE_KIND_LABELS[value as 'tax'] ?? String(value);
    case 'usage':
      return USAGE_LABELS[value as 'expense_proof'] ?? String(value);
    default:
      return String(value);
  }
}

/** 엑셀 열 이름: 0 → A, 25 → Z, 26 → AA */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** 머리글 줄 고르기 목록의 이름: "2행 · 거래일시 · 적요 · 출금액 …" */
export function rowLabel(cells: string[], index: number): string {
  const filled = cells.map((c) => c.trim()).filter(Boolean);
  const head = filled.slice(0, 4).join(' · ');
  return `${index + 1}행${head ? ` · ${head}` : ' (빈 줄)'}${filled.length > 4 ? ' …' : ''}`;
}

/** 열 고르기 목록: 파일에서 가장 넓은 줄만큼 열을 두고, 머리글 줄의 이름을 붙인다 */
export function columnChoices(
  topRows: string[][],
  headerRow: number,
): { index: number; label: string }[] {
  const width = Math.max(0, ...topRows.map((r) => r.length));
  const header = topRows[headerRow] ?? [];
  return Array.from({ length: width }, (_, index) => {
    const name = header[index]?.trim();
    return { index, label: `${columnLetter(index)}열 · ${name || '(빈 머리글)'}` };
  });
}

/** 금액 입력(12,000 · 12000원) → 원 단위 정수. 비우면 null, 읽을 수 없으면 NaN */
export function parseWonInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/[,\s원₩]/g, '');
  return /^\d+$/.test(digits) ? Number(digits) : Number.NaN;
}

/** 영수증 여러 장을 올린 결과 한 줄 요약 */
export function receiptUploadSummary(
  results: { duplicate: boolean; status: EvidenceStatus }[],
  failed: number,
): string {
  const added = results.filter((r) => !r.duplicate);
  const parts = [`영수증 ${added.length}장을 올렸습니다`];
  const details = [
    [added.filter((r) => r.status === 'review').length, '검토 필요'],
    [results.length - added.length, '이미 올린 영수증'],
    [failed, '실패'],
  ] as const;
  const extra = details.filter(([n]) => n > 0).map(([n, label]) => `${label} ${n}장`);
  return `${parts.join('')}${extra.length ? `(${extra.join(', ')})` : ''}.`;
}
