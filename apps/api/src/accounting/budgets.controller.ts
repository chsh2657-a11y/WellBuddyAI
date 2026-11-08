import { Controller, Get, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type BudgetQuery,
  BudgetQuerySchema,
  type BudgetReportQuery,
  BudgetReportQuerySchema,
  type BudgetSaveInput,
  BudgetSaveSchema,
} from '@wellbuddy/shared';
import { RequirePermission } from '../auth/decorators.js';
import { ZodBody, ZodQuery, ZodResponse } from '../common/zod.js';
import { BudgetReportSchema, BudgetSchema, BudgetSuggestSchema } from './budget.schemas.js';
import { BudgetsService } from './budgets.service.js';

/** 예산 편성과 예산 대비 실적 */
@ApiTags('budgets')
@Controller()
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  @RequirePermission('accounting', 'read')
  @Get('budgets')
  @ZodResponse(BudgetSchema, { description: '회계연도·부서(비우면 부서 미지정)의 월별 예산' })
  get(@ZodQuery(BudgetQuerySchema) q: BudgetQuery) {
    return this.budgets.get(q.fiscalYearId, q.departmentId ?? null);
  }

  @RequirePermission('accounting', 'read')
  @Get('budgets/suggest')
  @ZodResponse(BudgetSuggestSchema, { description: '전년도 같은 달 실적(예산 편성 참고용)' })
  suggest(@ZodQuery(BudgetQuerySchema) q: BudgetQuery) {
    return this.budgets.suggest(q.fiscalYearId, q.departmentId ?? null);
  }

  @RequirePermission('accounting', 'write')
  @Put('budgets')
  @ZodResponse(BudgetSchema, { description: '예산 저장(그 회계연도·부서의 예산을 통째로 바꾼다)' })
  save(@ZodBody(BudgetSaveSchema) body: BudgetSaveInput) {
    return this.budgets.save(body);
  }

  @RequirePermission('accounting', 'read')
  @Get('reports/budget-vs-actual')
  @ZodResponse(BudgetReportSchema, {
    description: '예산 대비 실적(부서를 비우면 전사, throughPeriod 번째 달까지 누계)',
  })
  report(@ZodQuery(BudgetReportQuerySchema) q: BudgetReportQuery) {
    return this.budgets.report(q);
  }
}
