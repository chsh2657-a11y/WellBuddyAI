import { z } from 'zod';
import { WonSchema } from './journal.js';

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

/** 예산 조회·저장 대상: 회계연도 + 부서(비우면 부서 미지정 = 전사 공통 예산) */
export const BudgetQuerySchema = z.object({
  fiscalYearId: z.uuid(),
  departmentId: z.preprocess(emptyToNull, z.uuid().nullish()),
});
export type BudgetQuery = z.infer<typeof BudgetQuerySchema>;

/** 예산 저장: 그 회계연도·부서의 예산을 통째로 바꾼다(손익 계정만, 월별 12칸) */
export const BudgetSaveSchema = z.object({
  fiscalYearId: z.uuid(),
  departmentId: z.preprocess(emptyToNull, z.uuid().nullish()),
  lines: z
    .array(
      z.object({
        accountId: z.uuid({ error: '계정과목을 선택해 주세요.' }),
        months: z.array(WonSchema).length(12, { error: '월별 금액은 12개입니다.' }),
      }),
    )
    .max(500),
});
export type BudgetSaveInput = z.infer<typeof BudgetSaveSchema>;

/** 예산 대비 실적: 부서를 비우면 전사(모든 부서 합계), throughPeriod 번째 달까지 누계 */
export const BudgetReportQuerySchema = z.object({
  fiscalYearId: z.uuid(),
  departmentId: z.preprocess(emptyToNull, z.uuid().nullish()),
  throughPeriod: z.coerce.number().int().min(1).max(12).optional(),
});
export type BudgetReportQuery = z.infer<typeof BudgetReportQuerySchema>;
