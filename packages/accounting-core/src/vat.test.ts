import { describe, expect, it } from 'vitest';
import { splitTotal, vatFromSupply } from './vat.js';

describe('부가세 계산', () => {
  it('공급가액의 10%, 원 미만 절사', () => {
    expect(vatFromSupply(100_000)).toEqual({ supply: 100_000, vat: 10_000, total: 110_000 });
    expect(vatFromSupply(9_999)).toEqual({ supply: 9_999, vat: 999, total: 10_998 });
  });

  it('합계금액에서 부가세 = 합계 × 10/110 (원 미만 절사)', () => {
    expect(splitTotal(10_000)).toEqual({ supply: 9_091, vat: 909, total: 10_000 });
    expect(splitTotal(110_000)).toEqual({ supply: 100_000, vat: 10_000, total: 110_000 });
    expect(splitTotal(1)).toEqual({ supply: 1, vat: 0, total: 1 });
    // 공급가액 + 부가세 = 합계가 항상 성립
    for (const total of [1, 11, 99, 12_345, 987_654_321]) {
      const s = splitTotal(total);
      expect(s.supply + s.vat).toBe(total);
    }
  });

  it('영세·면세는 부가세가 0', () => {
    expect(vatFromSupply(50_000, 'zero_rated').vat).toBe(0);
    expect(splitTotal(50_000, 'exempt')).toEqual({ supply: 50_000, vat: 0, total: 50_000 });
  });

  it('음수·소수 금액은 거부한다', () => {
    expect(() => vatFromSupply(-1)).toThrow();
    expect(() => splitTotal(10.5)).toThrow();
  });
});
