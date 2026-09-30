import { describe, expect, it } from 'vitest';
import { discountCharge } from './notes.js';

describe('어음 할인료', () => {
  it('액면 × 연율 × 할인일수 ÷ 365, 원 미만 절사', () => {
    // 3/1 할인, 5/30 만기 → 90일, 10,000,000 × 6.5% × 90/365 = 160,273.97
    expect(
      discountCharge({
        faceAmount: 10_000_000,
        annualRatePercent: 6.5,
        discountDate: '2026-03-01',
        maturityDate: '2026-05-30',
      }),
    ).toEqual({ days: 90, charge: 160_273, proceeds: 9_839_727 });
  });

  it('만기일에 할인하면 할인료 0, 만기가 지나면 거부', () => {
    const base = { faceAmount: 5_000_000, annualRatePercent: 7.25 };
    expect(
      discountCharge({ ...base, discountDate: '2026-05-30', maturityDate: '2026-05-30' }).charge,
    ).toBe(0);
    expect(() =>
      discountCharge({ ...base, discountDate: '2026-06-01', maturityDate: '2026-05-30' }),
    ).toThrow();
    expect(() =>
      discountCharge({
        ...base,
        faceAmount: 0,
        discountDate: '2026-05-01',
        maturityDate: '2026-05-30',
      }),
    ).toThrow();
  });
});
