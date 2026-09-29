import { describe, expect, it } from 'vitest';
import { journalTotals } from './journal.js';
import {
  addDays,
  addMonthsToMonthStart,
  carryForwardLines,
  fiscalYearOf,
  monthlyPeriods,
} from './periods.js';

describe('날짜 계산', () => {
  it('일수·월을 더한다(윤년 포함)', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
    expect(addMonthsToMonthStart('2026-11-15', 3)).toBe('2027-02-01');
    expect(addMonthsToMonthStart('2026-01-31', -1)).toBe('2025-12-01');
  });
});

describe('회계연도', () => {
  it('1월 시작이면 달력 연도와 같다', () => {
    expect(fiscalYearOf('2026-09-28', 1)).toEqual({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      label: '2026',
    });
  });

  it('4월 시작이면 3월까지가 전년도 회계연도다', () => {
    expect(fiscalYearOf('2027-03-31', 4)).toEqual({
      startDate: '2026-04-01',
      endDate: '2027-03-31',
      label: '2026-2027',
    });
    expect(fiscalYearOf('2027-04-01', 4).startDate).toBe('2027-04-01');
  });

  it('시작월이 잘못되면 오류', () => {
    expect(() => fiscalYearOf('2026-01-01', 13)).toThrow(RangeError);
  });

  it('월별 기간 12개가 빈틈없이 이어진다', () => {
    const periods = monthlyPeriods('2026-07-01');
    expect(periods).toHaveLength(12);
    expect(periods[0]).toEqual({ periodNo: 1, startDate: '2026-07-01', endDate: '2026-07-31' });
    expect(periods[7]).toEqual({ periodNo: 8, startDate: '2027-02-01', endDate: '2027-02-28' });
    expect(periods[11]!.endDate).toBe('2027-06-30');
    for (let i = 1; i < 12; i++) {
      expect(addDays(periods[i - 1]!.endDate, 1)).toBe(periods[i]!.startDate);
    }
  });
});

describe('전기이월', () => {
  it('재무상태표 잔액은 거래처별로 이월하고 당기순이익은 이익잉여금에 더한다', () => {
    const { lines, netIncome } = carryForwardLines(
      [
        // 현금: 자본금 100만 + 매출 수금 20만 - 비용 10만
        {
          accountId: 'cash',
          partnerId: null,
          group: 'quick_assets',
          debit: 1_200_000,
          credit: 100_000,
        },
        // 외상매출금: A 50만(20만 회수), B 10만
        { accountId: 'ar', partnerId: 'A', group: 'quick_assets', debit: 500_000, credit: 200_000 },
        { accountId: 'ar', partnerId: 'B', group: 'quick_assets', debit: 100_000, credit: 0 },
        { accountId: 'capital', partnerId: null, group: 'capital', debit: 0, credit: 1_000_000 },
        { accountId: 'sales', partnerId: null, group: 'revenue', debit: 0, credit: 600_000 },
        {
          accountId: 'fee',
          partnerId: null,
          group: 'sga',
          debit: 100_000,
          credit: 0,
        },
      ],
      'retained',
    );
    expect(netIncome).toBe(500_000);
    expect(lines).toEqual([
      { accountId: 'cash', partnerId: null, debit: 1_100_000, credit: 0 },
      { accountId: 'ar', partnerId: 'A', debit: 300_000, credit: 0 },
      { accountId: 'ar', partnerId: 'B', debit: 100_000, credit: 0 },
      { accountId: 'capital', partnerId: null, debit: 0, credit: 1_000_000 },
      { accountId: 'retained', partnerId: null, debit: 0, credit: 500_000 },
    ]);
    expect(journalTotals(lines).difference).toBe(0);
  });

  it('잔액이 0 인 계정은 빼고, 순손실은 이익잉여금 차변으로 간다', () => {
    const { lines, netIncome } = carryForwardLines(
      [
        {
          accountId: 'cash',
          partnerId: null,
          group: 'quick_assets',
          debit: 500_000,
          credit: 500_000,
        },
        { accountId: 'bank', partnerId: null, group: 'quick_assets', debit: 800_000, credit: 0 },
        { accountId: 'capital', partnerId: null, group: 'capital', debit: 0, credit: 1_000_000 },
        {
          accountId: 'fee',
          partnerId: null,
          group: 'sga',
          debit: 200_000,
          credit: 0,
        },
      ],
      'retained',
    );
    expect(netIncome).toBe(-200_000);
    expect(lines.map((l) => l.accountId)).toEqual(['bank', 'capital', 'retained']);
    expect(lines.at(-1)).toEqual({
      accountId: 'retained',
      partnerId: null,
      debit: 200_000,
      credit: 0,
    });
    expect(journalTotals(lines).difference).toBe(0);
  });
});
