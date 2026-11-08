import { z } from 'zod';

const nullableString = z.string().nullable();
const int = z.number().int();

export const ExchangeRateSchema = z.object({
  id: z.uuid(),
  currency: z.string(),
  rateDate: z.string(),
  /** 고시 단위(unit)당 원화(엔화는 100엔당) */
  rate: z.string(),
  unit: int,
});

export const FxRevaluationPreviewSchema = z.object({
  date: z.string(),
  fiscalYear: z.string(),
  rows: z.array(
    z.object({
      accountId: z.uuid(),
      accountCode: z.string(),
      accountName: z.string(),
      partnerId: z.uuid().nullable(),
      partnerName: nullableString,
      currency: z.string(),
      side: z.enum(['asset', 'liability']),
      /** 정상잔액 방향의 외화 잔액·장부 원화 잔액 */
      foreignBalance: z.string(),
      bookKrw: int,
      rate: nullableString,
      rateDate: nullableString,
      targetKrw: int.nullable(),
      adjustment: int.nullable(),
      /** 평가이익(+)·평가손실(−) */
      profit: int.nullable(),
    }),
  ),
  gain: int,
  loss: int,
  /** 평가일 이전 환율이 없는 통화 */
  missingCurrencies: z.array(z.string()),
});

export const FxRevaluationSchema = z.object({
  id: z.uuid(),
  date: z.string(),
  gain: int,
  loss: int,
  entryId: z.uuid().nullable(),
  entryNumber: nullableString,
  rows: int,
  createdAt: z.string(),
});

export const FxRevaluationResultSchema = z.object({
  date: z.string(),
  gain: int,
  loss: int,
  rows: int,
  entryId: z.uuid().nullable(),
});
