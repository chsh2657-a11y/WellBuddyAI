import { z } from 'zod';
import { CurrencySchema, IsoDateSchema, RateSchema } from './journal.js';

/** 환율 등록(같은 통화·날짜면 덮어쓴다) */
export const ExchangeRateInputSchema = z.object({
  currency: CurrencySchema,
  rateDate: IsoDateSchema,
  rate: RateSchema,
});
export type ExchangeRateInput = z.infer<typeof ExchangeRateInputSchema>;

export const ExchangeRateQuerySchema = z.object({
  currency: CurrencySchema.optional(),
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
});

/** 그 날짜(이전 가장 가까운 날)의 환율 조회 */
export const ExchangeRateLookupSchema = z.object({
  currency: CurrencySchema,
  date: IsoDateSchema,
});

/** 기말 외화평가: 평가일(보통 회계연도 말·분기 말)의 환율로 외화 자산·부채를 다시 환산 */
export const FxRevaluationInputSchema = z.object({ date: IsoDateSchema });
