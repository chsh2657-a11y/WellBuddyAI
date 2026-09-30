import {
  type EvidenceType,
  paymentLines,
  purchaseLines,
  receiptLines,
  salesLines,
  splitTotal,
  SYSTEM_ACCOUNTS,
  type TemplateLine,
  type VatType,
} from '@wellbuddy/accounting-core';
import type { EvidenceItem } from './items.js';

export interface Decision {
  accountCode: string;
  /** 매입세액 공제 여부(비우면 공제) */
  deductible: boolean | null;
}

export interface DraftLine {
  accountCode: string;
  debit: number;
  credit: number;
  /** 추천 계정 줄(부서·프로젝트·적요를 붙인다) */
  main: boolean;
  /** 거래처를 붙일 줄: 증빙 상대(counterparty) 또는 카드사(issuer) */
  partnerRole: 'counterparty' | 'issuer' | null;
}

export interface EntryDraft {
  type: 'receipt' | 'payment' | 'sales' | 'purchase';
  lines: DraftLine[];
  vat: {
    vatType: VatType;
    evidenceType: EvidenceType;
    supplyAmount: number;
    vatAmount: number;
    deductible: boolean;
  } | null;
}

/** 공급가액·부가세(모르면 합계에서 10/110 으로 나눈다) */
export function vatAmounts(item: EvidenceItem): { supply: number; vat: number } {
  const total = Math.abs(item.amount);
  if (item.vatType !== 'taxable') return { supply: total, vat: 0 };
  if (item.supply != null && item.vat != null) {
    return { supply: Math.abs(item.supply), vat: Math.abs(item.vat) };
  }
  if (item.vat != null) return { supply: total - Math.abs(item.vat), vat: Math.abs(item.vat) };
  const split = splitTotal(total, 'taxable');
  return { supply: split.supply, vat: split.vat };
}

const mark = (
  lines: TemplateLine[],
  mainCode: string,
  partnerRole: DraftLine['partnerRole'],
  mainIndex?: number,
): DraftLine[] =>
  lines.map((l, i) => ({
    accountCode: l.accountCode,
    debit: l.debit,
    credit: l.credit,
    main: mainIndex !== undefined ? i === mainIndex : l.accountCode === mainCode && !l.withPartner,
    partnerRole: l.withPartner ? partnerRole : null,
  }));

const swap = (lines: DraftLine[]): DraftLine[] =>
  lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));

const EVIDENCE_OF: Record<EvidenceItem['evidenceKind'], (vatType: VatType) => EvidenceType> = {
  bank: () => 'none',
  card: () => 'card',
  tax_invoice: (t) => (t === 'exempt' ? 'invoice' : 'tax_invoice'),
  cash_receipt: () => 'cash_receipt',
};

/**
 * 증빙과 분개 계정으로 전표 모양을 만든다.
 *  입금: (차) 보통예금 / (대) 계정           출금: (차) 계정 / (대) 보통예금
 *  카드: (차) 비용 + 부가세대급금 / (대) 미지급금(카드사)
 *  매입 세금계산서: (차) 비용·자산 + 부가세대급금 / (대) 외상매입금(거래처)
 *  매출 세금계산서: (차) 외상매출금(거래처) / (대) 매출 + 부가세예수금
 *  현금영수증: 매입은 (대) 현금, 매출은 (차) 현금
 * 취소·마이너스 증빙은 차대를 바꾸고 부가세 금액을 음수로 둔다.
 */
export function buildEntry(
  item: EvidenceItem,
  decision: Decision,
  ledgerCode: string | null,
): EntryDraft {
  const code = decision.accountCode;
  const amount = Math.abs(item.amount);
  if (item.kind === 'bank_in') {
    const lines = receiptLines(amount, code, ledgerCode ?? SYSTEM_ACCOUNTS.bankDeposit);
    return { type: 'receipt', lines: mark(lines, code, 'counterparty', 1), vat: null };
  }
  if (item.kind === 'bank_out') {
    const lines = paymentLines(amount, code, ledgerCode ?? SYSTEM_ACCOUNTS.bankDeposit);
    return { type: 'payment', lines: mark(lines, code, 'counterparty', 0), vat: null };
  }

  const { supply, vat } = vatAmounts(item);
  const evidenceType = EVIDENCE_OF[item.evidenceKind](item.vatType);
  const sign = item.reversal ? -1 : 1;
  let draft: EntryDraft;
  if (item.kind === 'tax_sales' || item.kind === 'cash_sales') {
    const lines = salesLines({
      supply,
      vat,
      vatType: item.vatType,
      revenueCode: code,
      receivableCode:
        item.kind === 'cash_sales' ? SYSTEM_ACCOUNTS.cash : SYSTEM_ACCOUNTS.accountsReceivable,
    });
    draft = {
      type: 'sales',
      lines: mark(lines, code, 'counterparty', 1),
      vat: {
        vatType: item.vatType,
        evidenceType,
        supplyAmount: sign * supply,
        vatAmount: sign * vat,
        deductible: true,
      },
    };
  } else {
    const deductible = decision.deductible ?? true;
    const isCard = item.kind === 'card' || item.kind === 'card_cancel';
    const lines = purchaseLines({
      supply,
      vat,
      vatType: item.vatType,
      expenseCode: code,
      payableCode: isCard
        ? (ledgerCode ?? SYSTEM_ACCOUNTS.otherPayable)
        : item.kind === 'cash_purchase'
          ? SYSTEM_ACCOUNTS.cash
          : SYSTEM_ACCOUNTS.accountsPayable,
      deductible,
    });
    draft = {
      type: 'purchase',
      lines: mark(lines, code, isCard ? 'issuer' : 'counterparty', 0),
      vat: {
        vatType: item.vatType,
        evidenceType,
        supplyAmount: sign * supply,
        vatAmount: sign * vat,
        deductible,
      },
    };
  }
  return item.reversal ? { ...draft, lines: swap(draft.lines) } : draft;
}
