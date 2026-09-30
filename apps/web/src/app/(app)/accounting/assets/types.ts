import type { DepreciationMethod } from '@wellbuddy/accounting-core';

export interface FixedAsset {
  id: string;
  code: string;
  name: string;
  assetAccountId: string;
  assetAccountName: string;
  accumulatedAccountId: string;
  expenseAccountId: string;
  departmentId: string | null;
  departmentName: string | null;
  acquisitionDate: string;
  cost: number;
  residualValue: number;
  usefulLifeYears: number;
  method: DepreciationMethod;
  priorAccumulated: number;
  accumulated: number;
  bookValue: number;
  locked: boolean;
  disposedOn: string | null;
  disposalProceeds: number | null;
  disposalEntryId: string | null;
  memo: string | null;
}

export interface DepreciationRun {
  id: string;
  month: string;
  totalAmount: number;
  entryId: string | null;
  entryNumber: string | null;
  createdAt: string;
}

export interface ScheduleMonth {
  month: string;
  amount: number;
  accumulated: number;
  bookValue: number;
  booked: number | null;
}

export const ASSETS_KEY = ['fixed-assets'];
export const RUNS_KEY = ['depreciation-runs'];
