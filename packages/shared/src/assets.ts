import { DEPRECIATION_METHODS } from '@wellbuddy/accounting-core';
import { z } from 'zod';
import { IsoDateSchema, WonSchema } from './journal.js';

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

/** YYYY-MM */
export const MonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: '월은 YYYY-MM 형식입니다.' });

export const FixedAssetInputSchema = z
  .object({
    /** 비우면 자동 부여(FA0001…) */
    code: z.preprocess(
      emptyToNull,
      z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9-]{1,20}$/, { error: '자산코드는 영문·숫자 20자 이내입니다.' })
        .nullish(),
    ),
    name: z.string().trim().min(1, { error: '자산명을 입력해 주세요.' }).max(100),
    assetAccountId: z.uuid({ error: '자산 계정을 선택해 주세요.' }),
    accumulatedAccountId: z.uuid({ error: '상각누계액 계정을 선택해 주세요.' }),
    expenseAccountId: z.uuid({ error: '감가상각비 계정을 선택해 주세요.' }),
    departmentId: z.preprocess(emptyToNull, z.uuid().nullish()),
    acquisitionDate: IsoDateSchema,
    cost: WonSchema.min(1, { error: '취득가액을 입력해 주세요.' }),
    residualValue: WonSchema.default(0),
    usefulLifeYears: z
      .number()
      .int({ error: '내용연수는 정수입니다.' })
      .min(1, { error: '내용연수는 1~60년입니다.' })
      .max(60, { error: '내용연수는 1~60년입니다.' }),
    method: z.enum(DEPRECIATION_METHODS),
    /** 이 시스템을 쓰기 전에 이미 상각한 누계액(기초잔액에 들어 있는 금액) */
    priorAccumulated: WonSchema.default(0),
    memo: z.preprocess(emptyToNull, z.string().trim().max(200).nullish()),
  })
  .refine((v) => v.residualValue < v.cost, {
    error: '잔존가치는 취득가액보다 작아야 합니다.',
    path: ['residualValue'],
  })
  .refine((v) => v.priorAccumulated <= v.cost, {
    error: '이전 상각누계액은 취득가액을 넘을 수 없습니다.',
    path: ['priorAccumulated'],
  });
export type FixedAssetInput = z.infer<typeof FixedAssetInputSchema>;

/** 상각 전표가 생긴 뒤에는 이름·부서·메모만 바꿀 수 있다(API 가 검사) */
export const FixedAssetUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  departmentId: z.preprocess(emptyToNull, z.uuid().nullish()),
  memo: z.preprocess(emptyToNull, z.string().trim().max(200).nullish()),
  acquisitionDate: IsoDateSchema.optional(),
  cost: WonSchema.min(1).optional(),
  residualValue: WonSchema.optional(),
  usefulLifeYears: z.number().int().min(1).max(60).optional(),
  method: z.enum(DEPRECIATION_METHODS).optional(),
  priorAccumulated: WonSchema.optional(),
});
export type FixedAssetUpdateInput = z.infer<typeof FixedAssetUpdateSchema>;

export const DepreciationRunInputSchema = z.object({ month: MonthSchema });

export const AssetDisposeSchema = z.object({
  disposedOn: IsoDateSchema,
  /** 처분가액(폐기면 0) */
  proceeds: WonSchema.default(0),
  /** 처분 대금을 받는 계정(예: 103 보통예금, 120 미수금) */
  proceedsAccountId: z.preprocess(emptyToNull, z.uuid().nullish()),
  partnerId: z.preprocess(emptyToNull, z.uuid().nullish()),
});
export type AssetDisposeInput = z.infer<typeof AssetDisposeSchema>;
