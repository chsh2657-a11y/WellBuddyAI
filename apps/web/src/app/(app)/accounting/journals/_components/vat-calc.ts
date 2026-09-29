import {
  type EvidenceType,
  purchaseLines,
  salesLines,
  SYSTEM_ACCOUNTS,
  splitTotal,
  type VatType,
  vatFromSupply,
} from '@wellbuddy/accounting-core';
import { type GridLine, newGridLine } from './types';
import type { MasterData } from './use-master-data';

export type VatKind = 'sales' | 'purchase';

export interface VatState {
  kind: VatKind;
  vatType: VatType;
  evidenceType: EvidenceType;
  partnerId: string | null;
  /** 공급가액으로 입력할지, 부가세 포함 합계로 입력할지 */
  inputMode: 'supply' | 'total';
  amount: number;
  /** 부가세(자동 계산값을 고쳐 쓸 수 있다) */
  vat: number;
  vatEdited: boolean;
  deductible: boolean;
  /** 매출 계정 또는 매입(비용·자산) 계정 */
  mainAccountId: string | null;
  /** 결제 계정 코드(외상·현금·예금·카드) */
  settlementCode: string;
  memo: string;
}

export const SETTLEMENTS: Record<VatKind, { code: string; label: string }[]> = {
  sales: [
    { code: SYSTEM_ACCOUNTS.accountsReceivable, label: '외상(외상매출금)' },
    { code: SYSTEM_ACCOUNTS.cash, label: '현금' },
    { code: SYSTEM_ACCOUNTS.bankDeposit, label: '보통예금' },
  ],
  purchase: [
    { code: SYSTEM_ACCOUNTS.accountsPayable, label: '외상(외상매입금)' },
    { code: SYSTEM_ACCOUNTS.cash, label: '현금' },
    { code: SYSTEM_ACCOUNTS.bankDeposit, label: '보통예금' },
    { code: SYSTEM_ACCOUNTS.otherPayable, label: '카드·미지급(미지급금)' },
  ],
};

export const DEFAULT_EVIDENCE: Record<VatType, EvidenceType> = {
  taxable: 'tax_invoice',
  zero_rated: 'tax_invoice',
  exempt: 'invoice',
};

export function initialVatState(kind: VatKind, data: MasterData): VatState {
  const main = data.accountByCode.get(kind === 'sales' ? SYSTEM_ACCOUNTS.merchandiseSales : '146');
  return {
    kind,
    vatType: 'taxable',
    evidenceType: 'tax_invoice',
    partnerId: null,
    inputMode: 'supply',
    amount: 0,
    vat: 0,
    vatEdited: false,
    deductible: true,
    mainAccountId: main?.id ?? null,
    settlementCode: SETTLEMENTS[kind][0]!.code,
    memo: '',
  };
}

/** 공급가액·부가세 */
export function vatAmounts(s: VatState): { supply: number; vat: number } {
  if (s.amount <= 0) return { supply: 0, vat: 0 };
  if (s.inputMode === 'supply') {
    const auto = vatFromSupply(s.amount, s.vatType).vat;
    return { supply: s.amount, vat: s.vatType === 'taxable' && s.vatEdited ? s.vat : auto };
  }
  const split = splitTotal(s.amount, s.vatType);
  if (s.vatType === 'taxable' && s.vatEdited) return { supply: s.amount - s.vat, vat: s.vat };
  return { supply: split.supply, vat: split.vat };
}

/** 부가세 정보로 분개 줄을 만든다(계정이 없으면 빈 줄) */
export function vatLines(s: VatState, data: MasterData): GridLine[] {
  const { supply, vat } = vatAmounts(s);
  const main = s.mainAccountId ? data.accountById.get(s.mainAccountId) : undefined;
  if (supply <= 0 || !main) return [newGridLine({ memo: s.memo }), newGridLine({ memo: s.memo })];
  const template =
    s.kind === 'sales'
      ? salesLines({
          supply,
          vat,
          vatType: s.vatType,
          revenueCode: main.code,
          receivableCode: s.settlementCode,
        })
      : purchaseLines({
          supply,
          vat,
          vatType: s.vatType,
          expenseCode: main.code,
          payableCode: s.settlementCode,
          deductible: s.deductible,
        });
  return template.map((t) =>
    newGridLine({
      accountId: data.accountByCode.get(t.accountCode)?.id ?? null,
      partnerId: t.withPartner ? s.partnerId : null,
      debit: t.debit,
      credit: t.credit,
      memo: s.memo,
    }),
  );
}

export function vatPayload(s: VatState) {
  const { supply, vat } = vatAmounts(s);
  return {
    vatType: s.vatType,
    evidenceType: s.evidenceType,
    supplyAmount: supply,
    vatAmount: vat,
    deductible: s.kind === 'purchase' ? s.deductible : true,
    partnerId: s.partnerId,
  };
}
