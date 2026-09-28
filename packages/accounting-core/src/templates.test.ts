import { describe, expect, it } from 'vitest';
import { validateJournal } from './journal.js';
import { paymentLines, purchaseLines, receiptLines, salesLines } from './templates.js';

describe('매입매출·입출금 분개 템플릿', () => {
  it('과세 매출: 외상매출금 / 상품매출 + 부가세예수금', () => {
    const lines = salesLines({ supply: 100_000, vatType: 'taxable' });
    expect(lines).toEqual([
      { accountCode: '108', debit: 110_000, credit: 0, withPartner: true },
      { accountCode: '401', debit: 0, credit: 100_000 },
      { accountCode: '255', debit: 0, credit: 10_000 },
    ]);
    expect(validateJournal(lines)).toEqual([]);
  });

  it('면세 매출은 부가세 줄이 없다', () => {
    const lines = salesLines({ supply: 50_000, vatType: 'exempt', revenueCode: '404' });
    expect(lines.map((l) => l.accountCode)).toEqual(['108', '404']);
  });

  it('공제 매입: 비용 + 부가세대급금 / 외상매입금', () => {
    const lines = purchaseLines({ supply: 20_000, vatType: 'taxable', expenseCode: '830' });
    expect(lines).toEqual([
      { accountCode: '830', debit: 20_000, credit: 0 },
      { accountCode: '135', debit: 2_000, credit: 0 },
      { accountCode: '251', debit: 0, credit: 22_000, withPartner: true },
    ]);
    expect(validateJournal(lines)).toEqual([]);
  });

  it('불공제 매입(기업업무추진비)은 부가세를 비용에 포함한다', () => {
    const lines = purchaseLines({
      supply: 100_000,
      vatType: 'taxable',
      expenseCode: '813',
      payableCode: '253',
      deductible: false,
    });
    expect(lines).toEqual([
      { accountCode: '813', debit: 110_000, credit: 0 },
      { accountCode: '253', debit: 0, credit: 110_000, withPartner: true },
    ]);
  });

  it('부가세를 직접 입력할 수 있지만 면세 거래에 부가세가 있으면 거부한다', () => {
    const lines = salesLines({ supply: 9_091, vat: 909, vatType: 'taxable' });
    expect(lines[0]!.debit).toBe(10_000);
    expect(() => salesLines({ supply: 1000, vat: 100, vatType: 'exempt' })).toThrow(/면세/);
  });

  it('입금·출금', () => {
    expect(receiptLines(5_000, '108')).toEqual([
      { accountCode: '101', debit: 5_000, credit: 0 },
      { accountCode: '108', debit: 0, credit: 5_000, withPartner: true },
    ]);
    expect(paymentLines(3_000, '812', '103')).toEqual([
      { accountCode: '812', debit: 3_000, credit: 0, withPartner: true },
      { accountCode: '103', debit: 0, credit: 3_000 },
    ]);
    expect(() => receiptLines(0, '108')).toThrow();
  });
});
