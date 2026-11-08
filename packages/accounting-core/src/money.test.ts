import { describe, expect, it } from 'vitest';
import { assertWon, formatWon, parseWon, sumWon } from './money.js';

describe('원화 금액', () => {
  it('원 단위 정수만 허용한다', () => {
    expect(assertWon(1000)).toBe(1000);
    expect(() => assertWon(10.5)).toThrow(/정수/);
    expect(() => assertWon(Number.MAX_SAFE_INTEGER + 1)).toThrow();
    expect(() => assertWon('1000')).toThrow();
  });

  it('합계를 정확히 구한다(0.1+0.2 같은 오차 없음)', () => {
    expect(sumWon([1_000_000_000, 2_500, 3])).toBe(1_000_002_503);
  });

  it('천 단위 구분 기호로 표시하고, 입력 문자열을 숫자로 바꾼다', () => {
    expect(formatWon(1234567)).toBe('1,234,567');
    expect(formatWon(-1234)).toBe('-1,234');
    expect(parseWon('1,234,567원')).toBe(1234567);
    expect(parseWon(' -5,000 ')).toBe(-5000);
    expect(parseWon('')).toBeNull();
    expect(parseWon('abc')).toBeNull();
  });
});
