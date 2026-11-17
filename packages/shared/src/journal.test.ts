import { describe, expect, it } from 'vitest';
import { ExchangeRateInputSchema } from './fx.js';
import { JournalLineInputSchema, OpeningBalanceLineSchema } from './journal.js';

const accountId = '5b4a3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d';

describe('외화 전표 줄', () => {
  it('통화·외화 금액·환율을 정규화한다', () => {
    const line = JournalLineInputSchema.parse({
      accountId,
      debit: 1_710_113,
      currency: 'USD',
      foreignAmount: '1,234.56',
      exchangeRate: '1,385.2',
    });
    expect(line).toMatchObject({ foreignAmount: '1234.56', exchangeRate: '1385.2000' });
  });

  it('통화를 고르면 외화 금액·환율이 모두 있어야 하고, 통화 없이 외화만 넣을 수 없다', () => {
    const base = { accountId, debit: 1 };
    expect(JournalLineInputSchema.safeParse({ ...base, currency: 'USD' }).success).toBe(false);
    expect(
      JournalLineInputSchema.safeParse({ ...base, currency: 'USD', foreignAmount: '1' }).success,
    ).toBe(false);
    expect(
      JournalLineInputSchema.safeParse({
        ...base,
        currency: 'USD',
        foreignAmount: '0',
        exchangeRate: '1',
      }).success,
    ).toBe(false);
    expect(JournalLineInputSchema.safeParse({ ...base, foreignAmount: '1' }).success).toBe(false);
    expect(JournalLineInputSchema.safeParse({ ...base, currency: 'XYZ' }).success).toBe(false);
    // 빈 칸은 원화 줄
    expect(
      JournalLineInputSchema.parse({ ...base, currency: '', foreignAmount: '', exchangeRate: '' }),
    ).toMatchObject({ currency: null, foreignAmount: null, exchangeRate: null });
  });

  it('기초잔액 외화 줄은 통화와 외화 금액을 함께 넣는다', () => {
    expect(
      OpeningBalanceLineSchema.safeParse({ accountId, debit: 1, currency: 'JPY' }).success,
    ).toBe(false);
    expect(
      OpeningBalanceLineSchema.parse({ accountId, debit: 1, currency: 'JPY', foreignAmount: 100 }),
    ).toMatchObject({ currency: 'JPY', foreignAmount: '100.00' });
  });

  it('환율은 0보다 크고 원화(KRW)는 등록하지 않는다', () => {
    const base = { rateDate: '2026-03-31' };
    expect(
      ExchangeRateInputSchema.parse({ ...base, currency: 'EUR', rate: '1500.1234' }).rate,
    ).toBe('1500.1234');
    expect(ExchangeRateInputSchema.safeParse({ ...base, currency: 'EUR', rate: 0 }).success).toBe(
      false,
    );
    expect(ExchangeRateInputSchema.safeParse({ ...base, currency: 'KRW', rate: 1 }).success).toBe(
      false,
    );
  });
});
