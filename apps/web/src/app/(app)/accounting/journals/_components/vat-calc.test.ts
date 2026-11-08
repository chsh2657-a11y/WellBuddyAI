import { describe, expect, it } from 'vitest';
import { type VatState, vatAmounts } from './vat-calc';

const base: VatState = {
  kind: 'sales',
  vatType: 'taxable',
  evidenceType: 'tax_invoice',
  partnerId: null,
  inputMode: 'supply',
  amount: 0,
  vat: 0,
  vatEdited: false,
  deductible: true,
  mainAccountId: null,
  settlementCode: '108',
  memo: '',
};

describe('매입매출 금액 계산', () => {
  it('공급가액으로 넣으면 부가세 10%(원 미만 절사)', () => {
    expect(vatAmounts({ ...base, amount: 12_345 })).toEqual({ supply: 12_345, vat: 1_234 });
  });

  it('합계금액으로 넣으면 공급가액·부가세로 나눈다', () => {
    expect(vatAmounts({ ...base, inputMode: 'total', amount: 10_000 })).toEqual({
      supply: 9_091,
      vat: 909,
    });
  });

  it('고친 부가세를 그대로 쓰고, 면세는 부가세가 없다', () => {
    expect(vatAmounts({ ...base, amount: 1_000, vat: 99, vatEdited: true })).toEqual({
      supply: 1_000,
      vat: 99,
    });
    expect(
      vatAmounts({ ...base, inputMode: 'total', amount: 11_000, vat: 1_001, vatEdited: true }),
    ).toEqual({ supply: 9_999, vat: 1_001 });
    expect(vatAmounts({ ...base, vatType: 'exempt', amount: 5_000 })).toEqual({
      supply: 5_000,
      vat: 0,
    });
  });
});
