import { STATEMENT_GROUP_KEYS, type StatementGroup } from '@wellbuddy/accounting-core';
import { z } from 'zod';

const int = z.number().int();
const group = z.enum(STATEMENT_GROUP_KEYS as [StatementGroup, ...StatementGroup[]]);

const BudgetLineSchema = z.object({
  accountId: z.uuid(),
  code: z.string(),
  name: z.string(),
  group,
  /** 1~12번째 달 */
  months: z.array(int),
  total: int,
});

export const BudgetSchema = z.object({
  fiscalYearId: z.uuid(),
  fiscalYear: z.string(),
  departmentId: z.uuid().nullable(),
  periods: z.array(z.object({ periodNo: int, month: z.string() })),
  lines: z.array(BudgetLineSchema),
});

export const BudgetSuggestSchema = z.object({
  /** 참고한 전년도(없으면 null) */
  fiscalYear: z.string().nullable(),
  lines: z.array(BudgetLineSchema),
});

const amounts = z.object({ budget: int, budgetToDate: int, actualToDate: int });

export const BudgetReportSchema = z.object({
  fiscalYear: z.string(),
  departmentId: z.uuid().nullable(),
  throughPeriod: int,
  throughMonth: z.string(),
  lines: z.array(
    amounts.extend({
      accountId: z.uuid(),
      code: z.string(),
      name: z.string(),
      group,
      category: z.enum(['revenue', 'expense']),
      variance: int,
      rate: z.number().nullable(),
      exceeded: z.boolean(),
    }),
  ),
  revenue: amounts,
  expense: amounts,
  profit: amounts,
});
