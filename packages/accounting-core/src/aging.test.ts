import { describe, expect, it } from 'vitest';
import { agingBuckets } from './aging.js';
import { daysBetween } from './periods.js';

describe('채권 연령분석', () => {
  it('경과일을 센다', () => {
    expect(daysBetween('2026-01-31', '2026-03-01')).toBe(29);
    expect(daysBetween('2026-03-01', '2026-03-01')).toBe(0);
  });

  it('남은 잔액은 최근 발생분부터 채운다(회수는 오래된 것부터)', () => {
    const items = [
      { date: '2026-01-10', amount: 500_000 }, // 170일 전
      { date: '2026-05-01', amount: 300_000 }, // 59일 전
      { date: '2026-06-20', amount: 200_000 }, // 9일 전
    ];
    // 합계 100만 중 40만 회수 → 잔액 60만 = 20만(9일) + 30만(59일) + 10만(170일)
    expect(agingBuckets(items, 600_000, '2026-06-29')).toEqual([200_000, 300_000, 0, 100_000, 0]);
  });

  it('발생 내역보다 잔액이 크면 나머지는 가장 오래된 구간, 음수 잔액은 첫 구간', () => {
    expect(agingBuckets([{ date: '2026-06-01', amount: 100 }], 150, '2026-06-02')).toEqual([
      100, 0, 0, 0, 50,
    ]);
    expect(agingBuckets([], -30_000, '2026-06-02')).toEqual([-30_000, 0, 0, 0, 0]);
  });
});
