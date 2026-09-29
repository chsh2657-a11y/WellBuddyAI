import type { StatementGroup } from '@wellbuddy/accounting-core';

/** 보고서 API 응답(apps/api/src/accounting/report.schemas.ts 와 같은 모양) */
export interface AccountRef {
  id: string;
  code: string;
  name: string;
}

export interface DailySummary {
  from: string;
  to: string;
  rows: {
    accountId: string;
    code: string;
    name: string;
    group: StatementGroup;
    groupLabel: string;
    debitCash: number;
    debitTransfer: number;
    creditCash: number;
    creditTransfer: number;
  }[];
  totals: { debitCash: number; debitTransfer: number; creditCash: number; creditTransfer: number };
  cash: { opening: number; receipts: number; payments: number; closing: number };
}

export interface AccountLedger {
  account: AccountRef;
  normalBalance: 'debit' | 'credit';
  partner: { id: string; name: string } | null;
  from: string;
  to: string;
  opening: number;
  rows: {
    lineId: string;
    entryId: string;
    entryDate: string;
    number: string;
    description: string | null;
    memo: string | null;
    partnerName: string | null;
    counterAccount: string;
    debit: number;
    credit: number;
    balance: number;
  }[];
  totals: { debit: number; credit: number };
  closing: number;
}

export interface GeneralLedger {
  account: AccountRef;
  normalBalance: 'debit' | 'credit';
  fiscalYear: { startDate: string; endDate: string; label: string };
  opening: number;
  months: { month: string; debit: number; credit: number; balance: number }[];
  totals: { debit: number; credit: number };
  closing: number;
}

export interface PartnerBalances {
  account: AccountRef;
  normalBalance: 'debit' | 'credit';
  from: string;
  to: string;
  rows: {
    partnerId: string | null;
    partnerCode: string | null;
    partnerName: string;
    opening: number;
    debit: number;
    credit: number;
    closing: number;
  }[];
  totals: { opening: number; debit: number; credit: number; closing: number };
}

export interface TrialBalance {
  date: string;
  fiscalYear: { startDate: string; endDate: string; label: string };
  rows: {
    accountId: string;
    code: string;
    name: string;
    group: StatementGroup;
    groupLabel: string;
    debit: number;
    credit: number;
    debitBalance: number;
    creditBalance: number;
  }[];
  totals: { debitBalance: number; debit: number; credit: number; creditBalance: number };
  balanced: boolean;
}

export interface StatementSection {
  group: StatementGroup;
  label: string;
  lines: { accountId: string; code: string; name: string; amount: number }[];
  total: number;
}

export interface IncomeStatement {
  from: string;
  to: string;
  sections: StatementSection[];
  revenue: number;
  costOfSales: number;
  grossProfit: number;
  sga: number;
  operatingIncome: number;
  nonOperatingIncome: number;
  nonOperatingExpense: number;
  incomeBeforeTax: number;
  incomeTax: number;
  netIncome: number;
}

export interface BalanceSheet {
  date: string;
  assets: StatementSection[];
  liabilities: StatementSection[];
  equity: StatementSection[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  balanced: boolean;
}

export interface Aging {
  kind: 'receivable' | 'payable';
  date: string;
  accounts: AccountRef[];
  bucketLabels: string[];
  rows: { partnerId: string | null; partnerName: string; balance: number; buckets: number[] }[];
  totals: { balance: number; buckets: number[] };
}
