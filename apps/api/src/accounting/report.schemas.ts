import { STATEMENT_GROUP_KEYS, type StatementGroup } from '@wellbuddy/accounting-core';
import { IsoDateSchema } from '@wellbuddy/shared';
import { z } from 'zod';

const int = z.number().int();
const group = z.enum(STATEMENT_GROUP_KEYS as [StatementGroup, ...StatementGroup[]]);
const normalBalance = z.enum(['debit', 'credit']);
const accountRef = z.object({ id: z.uuid(), code: z.string(), name: z.string() });
const fiscalYear = z.object({ startDate: z.string(), endDate: z.string(), label: z.string() });

export const RangeQuerySchema = z.object({ from: IsoDateSchema, to: IsoDateSchema });
export const DateQuerySchema = z.object({ date: IsoDateSchema });
export const LedgerQuerySchema = RangeQuerySchema.extend({
  accountId: z.uuid(),
  partnerId: z.uuid().optional(),
});
export const GeneralLedgerQuerySchema = DateQuerySchema.extend({ accountId: z.uuid() });
export const PartnerBalancesQuerySchema = RangeQuerySchema.extend({ accountId: z.uuid() });
export const OptionalDateQuerySchema = z.object({ date: IsoDateSchema.optional() });
export const AgingQuerySchema = DateQuerySchema.extend({
  kind: z.enum(['receivable', 'payable']),
});

export const DailySummarySchema = z.object({
  from: z.string(),
  to: z.string(),
  rows: z.array(
    z.object({
      accountId: z.uuid(),
      code: z.string(),
      name: z.string(),
      group,
      groupLabel: z.string(),
      debitCash: int,
      debitTransfer: int,
      creditCash: int,
      creditTransfer: int,
    }),
  ),
  totals: z.object({
    debitCash: int,
    debitTransfer: int,
    creditCash: int,
    creditTransfer: int,
  }),
  /** 현금 시재: 전일(기간 전) 잔액, 입금, 출금, 잔액 */
  cash: z.object({ opening: int, receipts: int, payments: int, closing: int }),
});

export const AccountLedgerSchema = z.object({
  account: accountRef,
  normalBalance,
  partner: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  from: z.string(),
  to: z.string(),
  /** 기간 전 잔액(정상잔액 방향) */
  opening: int,
  rows: z.array(
    z.object({
      lineId: z.uuid(),
      entryId: z.uuid(),
      entryDate: z.string(),
      entryNo: int,
      number: z.string(),
      description: z.string().nullable(),
      memo: z.string().nullable(),
      partnerName: z.string().nullable(),
      counterAccount: z.string(),
      debit: int,
      credit: int,
      balance: int,
    }),
  ),
  totals: z.object({ debit: int, credit: int }),
  closing: int,
});

export const GeneralLedgerSchema = z.object({
  account: accountRef,
  normalBalance,
  fiscalYear,
  opening: int,
  months: z.array(z.object({ month: z.string(), debit: int, credit: int, balance: int })),
  totals: z.object({ debit: int, credit: int }),
  closing: int,
});

export const PartnerBalancesSchema = z.object({
  account: accountRef,
  normalBalance,
  from: z.string(),
  to: z.string(),
  rows: z.array(
    z.object({
      partnerId: z.uuid().nullable(),
      partnerCode: z.string().nullable(),
      partnerName: z.string(),
      opening: int,
      debit: int,
      credit: int,
      closing: int,
    }),
  ),
  totals: z.object({ opening: int, debit: int, credit: int, closing: int }),
});

export const TrialBalanceSchema = z.object({
  date: z.string(),
  fiscalYear,
  rows: z.array(
    z.object({
      accountId: z.uuid(),
      code: z.string(),
      name: z.string(),
      group,
      groupLabel: z.string(),
      normalBalance,
      debit: int,
      credit: int,
      debitBalance: int,
      creditBalance: int,
    }),
  ),
  totals: z.object({ debitBalance: int, debit: int, credit: int, creditBalance: int }),
  balanced: z.boolean(),
});

const StatementSectionSchema = z.object({
  group,
  label: z.string(),
  lines: z.array(
    z.object({ accountId: z.string(), code: z.string(), name: z.string(), amount: int }),
  ),
  total: int,
});

export const IncomeStatementSchema = z.object({
  from: z.string(),
  to: z.string(),
  fiscalYear,
  sections: z.array(StatementSectionSchema),
  revenue: int,
  costOfSales: int,
  grossProfit: int,
  sga: int,
  operatingIncome: int,
  nonOperatingIncome: int,
  nonOperatingExpense: int,
  incomeBeforeTax: int,
  incomeTax: int,
  netIncome: int,
});

export const BalanceSheetSchema = z.object({
  date: z.string(),
  fiscalYear,
  assets: z.array(StatementSectionSchema),
  liabilities: z.array(StatementSectionSchema),
  equity: z.array(StatementSectionSchema),
  totalAssets: int,
  totalLiabilities: int,
  totalEquity: int,
  undistributedIncome: z.object({ priorPeriods: int, currentPeriod: int }),
  balanced: z.boolean(),
});

export const AgingSchema = z.object({
  kind: z.enum(['receivable', 'payable']),
  date: z.string(),
  accounts: z.array(accountRef),
  bucketLabels: z.array(z.string()),
  rows: z.array(
    z.object({
      partnerId: z.uuid().nullable(),
      partnerName: z.string(),
      balance: int,
      buckets: z.array(int),
    }),
  ),
  totals: z.object({ balance: int, buckets: z.array(int) }),
});

export const DashboardSchema = z.object({
  date: z.string(),
  fiscalYear,
  cash: int,
  deposits: int,
  receivables: int,
  payables: int,
  revenue: int,
  expense: int,
  netIncome: int,
  months: z.array(z.object({ month: z.string(), revenue: int, expense: int })),
  drafts: int,
  pending: int,
});

export const ReportExportSchema = z.object({
  title: z.string().trim().min(1).max(60),
  subtitle: z.string().max(200).nullish(),
  columns: z
    .array(
      z.object({
        header: z.string().max(40),
        type: z.enum(['text', 'won']).optional(),
        width: z.number().int().min(4).max(80).optional(),
      }),
    )
    .min(1)
    .max(30),
  rows: z.array(z.array(z.union([z.string().max(500), z.number(), z.null()])).max(30)).max(20_000),
  boldRows: z.array(z.number().int().min(0)).max(20_000).optional(),
});
