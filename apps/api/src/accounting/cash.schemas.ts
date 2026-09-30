import { CASH_DIRECTIONS } from '@wellbuddy/shared';
import { z } from 'zod';

const int = z.number().int();
const nullableString = z.string().nullable();
const direction = z.enum(CASH_DIRECTIONS);

export const CashPlanSchema = z.object({
  id: z.uuid(),
  planDate: z.string(),
  direction,
  amount: int,
  description: z.string(),
  partnerId: z.uuid().nullable(),
  partnerName: nullableString,
  done: z.boolean(),
});

const PlanItemSchema = z.object({
  source: z.enum(['plan', 'note']),
  id: z.uuid(),
  direction,
  amount: int,
  description: z.string(),
  partnerName: nullableString,
});

export const CashPlanReportSchema = z.object({
  from: z.string(),
  to: z.string(),
  /** from 전날까지 실제 현금·예금 잔액 */
  opening: int,
  days: z.array(
    z.object({
      date: z.string(),
      inflow: int,
      outflow: int,
      balance: int,
      items: z.array(PlanItemSchema.extend({ date: z.string() })),
    }),
  ),
  inflow: int,
  outflow: int,
  closing: int,
  minBalance: int,
  minDate: nullableString,
  shortageDate: nullableString,
});

export const DailyCashReportSchema = z.object({
  date: z.string(),
  previousDate: z.string(),
  accounts: z.array(
    z.object({
      accountId: z.uuid(),
      code: z.string(),
      name: z.string(),
      opening: int,
      receipts: int,
      payments: int,
      closing: int,
      rows: z.array(
        z.object({
          lineId: z.uuid(),
          entryId: z.uuid(),
          number: z.string(),
          description: nullableString,
          partnerName: nullableString,
          counterAccount: z.string(),
          receipt: int,
          payment: int,
          balance: int,
        }),
      ),
    }),
  ),
  totals: z.object({ opening: int, receipts: int, payments: int, closing: int }),
  scheduled: z.array(PlanItemSchema),
});
