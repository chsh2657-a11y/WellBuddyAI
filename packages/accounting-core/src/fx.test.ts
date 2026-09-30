import { describe, expect, it } from 'vitest';
import {
  currencyUnit,
  formatForeign,
  negateForeign,
  parseForeign,
  parseRate,
  revaluation,
  revaluationLines,
  settlementLines,
  settlementProfit,
  sumForeign,
  toKrw,
} from './fx.js';
import { validateJournal } from './journal.js';

describe('외화 금액', () => {
  it('입력을 소수 둘째 자리 문자열로 바꾸고 형식이 틀리면 null', () => {
    expect(parseForeign('1,234.5')).toBe('1234.50');
    expect(parseForeign('-20')).toBe('-20.00');
    expect(parseForeign('1.234')).toBeNull();
    expect(parseForeign('abc')).toBeNull();
    expect(sumForeign(['1.10', '2.20', '-0.30'])).toBe('3.00');
  });

  it('환율은 소수 넷째 자리까지, 표시는 천 단위 쉼표', () => {
    expect(parseRate('1,385.2')).toBe('1385.2000');
    expect(parseRate(912.3456)).toBe('912.3456');
    expect(parseRate('0')).toBeNull();
    expect(parseRate('-1')).toBeNull();
    expect(parseRate('1.23456')).toBeNull();
    expect(formatForeign('1234567.5')).toBe('1,234,567.50');
    expect(formatForeign('-0.3')).toBe('-0.30');
    expect(negateForeign('12.30')).toBe('-12.30');
    expect([currencyUnit('JPY'), currencyUnit('USD'), currencyUnit('XXX')]).toEqual([100, 1, 1]);
  });

  it('원화 환산은 원 미만 반올림, 엔화는 100엔 단위 환율', () => {
    expect(toKrw('1234.56', '1385.20')).toBe(1_710_113); // 1,710,112.512
    expect(toKrw('0.5', '1')).toBe(1);
    expect(toKrw('0.49', '1')).toBe(0);
    expect(toKrw('10000', '912.35', 100)).toBe(91_235);
    // float 로 계산하면 틀리는 값도 정확히
    expect(toKrw('0.1', '3')).toBe(0);
    expect(toKrw('1.15', '100')).toBe(115);
  });
});

describe('기말 외화평가', () => {
  it('외화자산은 환율이 오르면 이익', () => {
    const r = revaluation({
      foreignBalance: '1000.00',
      bookKrw: 1_300_000,
      closingRate: '1350',
      side: 'asset',
    });
    expect(r).toEqual({ targetKrw: 1_350_000, adjustment: 50_000, profit: 50_000 });
    expect(revaluationLines('103', 'asset', r.adjustment)).toEqual([
      { accountCode: '103', debit: 50_000, credit: 0, withPartner: true },
      { accountCode: '910', debit: 0, credit: 50_000 },
    ]);
  });

  it('외화부채는 환율이 오르면 손실, 내리면 이익', () => {
    const up = revaluation({
      foreignBalance: '1000',
      bookKrw: 1_300_000,
      closingRate: '1350',
      side: 'liability',
    });
    expect(up.profit).toBe(-50_000);
    expect(revaluationLines('251', 'liability', up.adjustment)).toEqual([
      { accountCode: '251', debit: 0, credit: 50_000, withPartner: true },
      { accountCode: '955', debit: 50_000, credit: 0 },
    ]);
    const down = revaluation({
      foreignBalance: '1000',
      bookKrw: 1_300_000,
      closingRate: '1250',
      side: 'liability',
    });
    expect(down.profit).toBe(50_000);
    const lines = revaluationLines('251', 'liability', down.adjustment);
    expect(lines).toEqual([
      { accountCode: '251', debit: 50_000, credit: 0, withPartner: true },
      { accountCode: '910', debit: 0, credit: 50_000 },
    ]);
    expect(validateJournal(lines)).toEqual([]);
    expect(revaluationLines('251', 'liability', 0)).toEqual([]);
  });
});

describe('결제 시 외환차손익', () => {
  it('채권을 더 받으면 외환차익, 채무를 더 갚으면 외환차손', () => {
    expect(settlementProfit(1_300_000, 1_320_000, 'asset')).toBe(20_000);
    expect(settlementProfit(1_300_000, 1_320_000, 'liability')).toBe(-20_000);
    const receive = settlementLines({
      side: 'asset',
      accountCode: '108',
      bookKrw: 1_300_000,
      settledKrw: 1_320_000,
    });
    expect(receive).toEqual([
      { accountCode: '103', debit: 1_320_000, credit: 0 },
      { accountCode: '108', debit: 0, credit: 1_300_000, withPartner: true },
      { accountCode: '907', debit: 0, credit: 20_000 },
    ]);
    const pay = settlementLines({
      side: 'liability',
      accountCode: '251',
      bookKrw: 1_300_000,
      settledKrw: 1_320_000,
    });
    expect(pay.at(-1)).toEqual({ accountCode: '952', debit: 20_000, credit: 0 });
    expect(validateJournal(receive)).toEqual([]);
    expect(validateJournal(pay)).toEqual([]);
  });
});
