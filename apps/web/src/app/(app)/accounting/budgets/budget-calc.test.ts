import { describe, expect, it } from 'vitest';
import { spreadAnnual } from './budget-calc';

describe('연간 예산 월 배분', () => {
  it('12개월에 나누고 나머지는 마지막 달에 넣는다', () => {
    expect(spreadAnnual(1_200_000)).toEqual(Array.from({ length: 12 }, () => 100_000));
    const odd = spreadAnnual(1_000_000);
    expect(odd.slice(0, 11)).toEqual(Array.from({ length: 11 }, () => 83_333));
    expect(odd[11]).toBe(83_337);
    expect(odd.reduce((s, v) => s + v, 0)).toBe(1_000_000);
    expect(spreadAnnual(0)).toEqual(Array.from({ length: 12 }, () => 0));
  });
});
