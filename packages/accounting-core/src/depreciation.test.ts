import { describe, expect, it } from 'vitest';
import {
  accumulatedDepreciation,
  decliningBalanceRate,
  type DepreciationInput,
  depreciationSchedule,
  disposalProfit,
} from './depreciation.js';

const sumByYear = (schedule: { month: string; amount: number }[]) => {
  const years = new Map<string, number>();
  for (const m of schedule)
    years.set(m.month.slice(0, 4), (years.get(m.month.slice(0, 4)) ?? 0) + m.amount);
  return [...years.values()];
};

describe('정률법 상각률', () => {
  it('법인세법 상각률표와 같다', () => {
    expect([2, 3, 4, 5, 6, 7, 8, 10, 20].map(decliningBalanceRate)).toEqual([
      0.777, 0.632, 0.528, 0.451, 0.394, 0.349, 0.313, 0.259, 0.14,
    ]);
  });
});

describe('정액법', () => {
  const input: DepreciationInput = {
    method: 'straight_line',
    cost: 12_000_000,
    usefulLifeYears: 5,
    acquisitionDate: '2026-03-15',
  };

  it('취득한 달부터 월할 상각하고, 마지막 달에 비망가액 1,000원만 남긴다', () => {
    const s = depreciationSchedule(input);
    expect(s).toHaveLength(60);
    expect(s[0]).toEqual({
      month: '2026-03',
      amount: 199_983,
      accumulated: 199_983,
      bookValue: 11_800_017,
    });
    expect(s.at(-1)).toMatchObject({ month: '2031-02', accumulated: 11_999_000, bookValue: 1_000 });
    expect(s.reduce((t, m) => t + m.amount, 0)).toBe(11_999_000);
    // 월 상각액은 반올림 오차 없이 199,983 또는 199,984
    expect(new Set(s.map((m) => m.amount))).toEqual(new Set([199_983, 199_984]));
  });

  it('잔존가치가 비망가액보다 크면 잔존가치까지만 상각한다', () => {
    const s = depreciationSchedule({ ...input, residualValue: 1_200_000 });
    expect(s.at(-1)!.bookValue).toBe(1_200_000);
    expect(s.reduce((t, m) => t + m.amount, 0)).toBe(10_800_000);
  });

  it('잘못된 입력은 거부한다', () => {
    expect(() => depreciationSchedule({ ...input, cost: 0 })).toThrow();
    expect(() => depreciationSchedule({ ...input, residualValue: 12_000_000 })).toThrow();
    expect(() => depreciationSchedule({ ...input, usefulLifeYears: 0 })).toThrow();
    expect(() => depreciationSchedule({ ...input, cost: 1000.5 })).toThrow();
  });
});

describe('정률법', () => {
  const input: DepreciationInput = {
    method: 'declining_balance',
    cost: 10_000_000,
    usefulLifeYears: 5,
    acquisitionDate: '2026-01-01',
  };

  it('해마다 기초 장부가 × 상각률, 마지막 해에 비망가액까지 모두 상각', () => {
    const s = depreciationSchedule(input);
    expect(sumByYear(s)).toEqual([4_510_000, 2_475_990, 1_359_318, 746_266, 907_426]);
    expect(s.at(-1)!.bookValue).toBe(1_000);
  });

  it('연중 취득이면 첫해는 월할(7월 취득 → 6개월분)', () => {
    const s = depreciationSchedule({ ...input, acquisitionDate: '2026-07-10' });
    expect(s[0]!.month).toBe('2026-07');
    // 첫해: 10,000,000 × 0.451 × 6/12
    expect(sumByYear(s)[0]).toBe(2_255_000);
    expect(s).toHaveLength(60);
    expect(s.at(-1)).toMatchObject({ month: '2031-06', bookValue: 1_000 });
  });

  it('회계연도가 4월에 시작하면 연 단위 계산도 4월 기준', () => {
    const s = depreciationSchedule({ ...input, fiscalYearStartMonth: 4 });
    // 2026-01~03 은 2025 회계연도의 마지막 3개월
    const firstYear = s.filter((m) => m.month < '2026-04').reduce((t, m) => t + m.amount, 0);
    expect(firstYear).toBe(Math.floor((4_510_000 * 3) / 12));
  });

  it('누계는 줄지 않고 장부가는 하한 아래로 내려가지 않는다', () => {
    for (const life of [1, 2, 3, 7, 10, 20]) {
      const s = depreciationSchedule({
        ...input,
        usefulLifeYears: life,
        acquisitionDate: '2026-05-20',
      });
      let previous = 0;
      for (const m of s) {
        expect(m.amount).toBeGreaterThanOrEqual(0);
        expect(m.accumulated).toBeGreaterThanOrEqual(previous);
        expect(m.bookValue).toBeGreaterThanOrEqual(1_000);
        previous = m.accumulated;
      }
      expect(s.at(-1)!.bookValue).toBe(1_000);
    }
  });
});

describe('누계액·처분손익', () => {
  const input: DepreciationInput = {
    method: 'straight_line',
    cost: 6_001_000,
    usefulLifeYears: 5,
    acquisitionDate: '2026-01-01',
  };

  it('기준월까지의 누계액(취득 전 0, 내용연수 뒤에는 최종 누계)', () => {
    expect(accumulatedDepreciation(input, '2025-12')).toBe(0);
    expect(accumulatedDepreciation(input, '2026-12')).toBe(1_200_000);
    expect(accumulatedDepreciation(input, '2040-01')).toBe(6_000_000);
  });

  it('처분가액 − 장부가 = 처분손익', () => {
    // 2년 상각 후(누계 2,400,000) 장부가 3,601,000 을 4,000,000 에 팔면 이익 399,000
    expect(disposalProfit(6_001_000, 2_400_000, 4_000_000)).toBe(399_000);
    expect(disposalProfit(6_001_000, 2_400_000, 3_000_000)).toBe(-601_000);
  });
});
