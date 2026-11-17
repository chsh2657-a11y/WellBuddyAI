import { DEPRECIATION_METHODS } from '@wellbuddy/accounting-core';
import { z } from 'zod';

const nullableString = z.string().nullable();

export const FixedAssetSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  assetAccountId: z.uuid(),
  assetAccountName: z.string(),
  accumulatedAccountId: z.uuid(),
  expenseAccountId: z.uuid(),
  departmentId: z.uuid().nullable(),
  departmentName: nullableString,
  acquisitionDate: z.string(),
  cost: z.number().int(),
  residualValue: z.number().int(),
  usefulLifeYears: z.number().int(),
  method: z.enum(DEPRECIATION_METHODS),
  priorAccumulated: z.number().int(),
  /** 이전 상각 + 이 시스템에서 반영한 상각 */
  accumulated: z.number().int(),
  bookValue: z.number().int(),
  /** 상각·처분 전표가 있어 취득 정보를 고칠 수 없음 */
  locked: z.boolean(),
  disposedOn: nullableString,
  disposalProceeds: z.number().int().nullable(),
  disposalEntryId: z.uuid().nullable(),
  memo: nullableString,
});

export const AssetScheduleSchema = z.array(
  z.object({
    month: z.string(),
    amount: z.number().int(),
    accumulated: z.number().int(),
    bookValue: z.number().int(),
    /** 실제로 전표에 반영한 금액(아직이면 null) */
    booked: z.number().int().nullable(),
  }),
);

export const DepreciationRunSchema = z.object({
  id: z.uuid(),
  month: z.string(),
  totalAmount: z.number().int(),
  entryId: z.uuid().nullable(),
  entryNumber: nullableString,
  createdAt: z.string(),
});

export const DepreciationRunResultSchema = z.object({
  month: z.string(),
  totalAmount: z.number().int(),
  /** 상각한 자산 수 */
  assets: z.number().int(),
  entryId: z.uuid().nullable(),
});
