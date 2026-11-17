import { describe, expect, it } from 'vitest';
import { applyForeign, foreignKrw, trimRate } from './foreign-calc';
import { newGridLine } from './types';

describe('외화 줄 원화 계산', () => {
  it('외화 × 환율(엔화는 100엔당)을 원 미만 반올림', () => {
    expect(foreignKrw({ currency: 'USD', foreignAmount: '1,234.56', exchangeRate: '1385.2' })).toBe(
      1_710_113,
    );
    expect(foreignKrw({ currency: 'JPY', foreignAmount: '10000', exchangeRate: '912.35' })).toBe(
      91_235,
    );
    expect(foreignKrw({ currency: 'USD', foreignAmount: '', exchangeRate: '1300' })).toBeNull();
    expect(foreignKrw({ currency: 'USD', foreignAmount: '10', exchangeRate: '0' })).toBeNull();
    expect(foreignKrw({ currency: null, foreignAmount: '10', exchangeRate: '1' })).toBeNull();
  });

  it('금액이 있는 쪽(없으면 차변)에 원화를 채운다', () => {
    const base = { currency: 'USD', foreignAmount: '100', exchangeRate: '1300' };
    expect(applyForeign(newGridLine(base))).toMatchObject({ debit: 130_000, credit: 0 });
    expect(applyForeign(newGridLine({ ...base, credit: 1 }))).toMatchObject({
      debit: 0,
      credit: 130_000,
    });
    const partial = newGridLine({ ...base, exchangeRate: '', debit: 5 });
    expect(applyForeign(partial)).toBe(partial);
  });

  it('환율 표시는 뒤쪽 0 을 뗀다', () => {
    expect(trimRate('1385.2000')).toBe('1385.2');
    expect(trimRate('1350.0000')).toBe('1350');
    expect(trimRate('910')).toBe('910');
  });
});
