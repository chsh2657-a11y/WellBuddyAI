import { assertWon, MoneyError } from './money.js';

/**
 * 부가가치세 과세유형
 *  taxable    과세(10%)          — 세금계산서·신용카드·현금영수증
 *  zero_rated 영세율(0%)         — 수출 등, 영세율 세금계산서
 *  exempt     면세               — 계산서, 부가세 없음
 */
export const VAT_TYPES = ['taxable', 'zero_rated', 'exempt'] as const;
export type VatType = (typeof VAT_TYPES)[number];

export const VAT_TYPE_LABELS: Record<VatType, string> = {
  taxable: '과세',
  zero_rated: '영세',
  exempt: '면세',
};

/** 증빙 종류(부가세 신고서·합계표 집계 기준) */
export const EVIDENCE_TYPES = [
  'tax_invoice',
  'invoice',
  'card',
  'cash_receipt',
  'simple_receipt',
  'none',
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const EVIDENCE_TYPE_LABELS: Record<EvidenceType, string> = {
  tax_invoice: '세금계산서',
  invoice: '계산서',
  card: '신용카드',
  cash_receipt: '현금영수증',
  simple_receipt: '간이영수증',
  none: '증빙 없음',
};

export const VAT_RATE_PERCENT = 10;

export interface VatSplit {
  supply: number;
  vat: number;
  total: number;
}

/** 공급가액 → 부가세(원 미만 절사) */
export function vatFromSupply(supply: number, type: VatType = 'taxable'): VatSplit {
  assertWon(supply, '공급가액');
  if (supply < 0) throw new MoneyError('공급가액은 0 이상이어야 합니다.');
  const vat = type === 'taxable' ? Math.floor(supply / 10) : 0;
  return { supply, vat, total: supply + vat };
}

/**
 * 합계금액(공급대가) → 공급가액·부가세.
 * 부가세 = 합계 × 10/110, 원 미만 절사(신용카드·현금영수증 표기 방식과 동일).
 * 예: 10,000원 → 공급가액 9,091원 + 부가세 909원
 */
export function splitTotal(total: number, type: VatType = 'taxable'): VatSplit {
  assertWon(total, '합계금액');
  if (total < 0) throw new MoneyError('합계금액은 0 이상이어야 합니다.');
  const vat = type === 'taxable' ? Math.floor(total / 11) : 0;
  return { supply: total - vat, vat, total };
}

/** 과세유형에 맞는 증빙인지(예: 면세는 계산서, 과세는 세금계산서·카드·현금영수증) */
export function defaultEvidenceFor(type: VatType): EvidenceType {
  return type === 'exempt' ? 'invoice' : 'tax_invoice';
}
