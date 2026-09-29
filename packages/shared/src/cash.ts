import { z } from 'zod';
import { IsoDateSchema, WonSchema } from './journal.js';

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

export const CASH_DIRECTIONS = ['in', 'out'] as const;

/** 자금계획 항목(예정 입금·출금) */
export const CashPlanInputSchema = z.object({
  planDate: IsoDateSchema,
  direction: z.enum(CASH_DIRECTIONS),
  amount: WonSchema.min(1, { error: '금액을 입력해 주세요.' }),
  description: z
    .string()
    .trim()
    .min(1, { error: '내용을 입력해 주세요.' })
    .max(100, { error: '내용은 100자 이내입니다.' }),
  partnerId: z.preprocess(emptyToNull, z.uuid().nullish()),
});
export type CashPlanInput = z.infer<typeof CashPlanInputSchema>;

export const CashPlanUpdateSchema = CashPlanInputSchema.partial().extend({
  done: z.boolean().optional(),
});
export type CashPlanUpdateInput = z.infer<typeof CashPlanUpdateSchema>;

export const CashPlanQuerySchema = z
  .object({ from: IsoDateSchema, to: IsoDateSchema })
  .refine((v) => v.from <= v.to, { error: '시작일이 종료일보다 늦습니다.', path: ['to'] });

export const DailyCashQuerySchema = z.object({ date: IsoDateSchema });
