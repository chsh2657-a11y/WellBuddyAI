import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type CashPlanInput,
  CashPlanInputSchema,
  CashPlanQuerySchema,
  type CashPlanUpdateInput,
  CashPlanUpdateSchema,
  DailyCashQuerySchema,
} from '@wellbuddy/shared';
import { z } from 'zod';
import { RequirePermission } from '../auth/decorators.js';
import { UuidParam, ZodBody, ZodQuery, ZodResponse } from '../common/zod.js';
import { CashPlanReportSchema, CashPlanSchema, DailyCashReportSchema } from './cash.schemas.js';
import { CashService } from './cash.service.js';

type Range = z.infer<typeof CashPlanQuerySchema>;

/** 자금계획(예정 입출금)과 일일자금일보 */
@ApiTags('cash')
@Controller()
export class CashController {
  constructor(private readonly cash: CashService) {}

  @RequirePermission('accounting', 'read')
  @Get('cash-plans')
  @ZodResponse(z.array(CashPlanSchema), { description: '기간 안의 예정 입출금' })
  list(@ZodQuery(CashPlanQuerySchema) q: Range) {
    return this.cash.listPlans(q.from, q.to);
  }

  @RequirePermission('accounting', 'write')
  @Post('cash-plans')
  @ZodResponse(CashPlanSchema, { status: 201 })
  create(@ZodBody(CashPlanInputSchema) body: CashPlanInput) {
    return this.cash.createPlan(body);
  }

  @RequirePermission('accounting', 'write')
  @Patch('cash-plans/:id')
  @ZodResponse(CashPlanSchema, { description: '수정·처리 완료 표시' })
  update(@UuidParam('id') id: string, @ZodBody(CashPlanUpdateSchema) body: CashPlanUpdateInput) {
    return this.cash.updatePlan(id, body);
  }

  @RequirePermission('accounting', 'write')
  @Delete('cash-plans/:id')
  @HttpCode(204)
  remove(@UuidParam('id') id: string) {
    return this.cash.removePlan(id);
  }

  @RequirePermission('accounting', 'read')
  @Get('reports/cash-plan')
  @ZodResponse(CashPlanReportSchema, {
    description: '자금계획: 현재 잔액 + 예정 입출금·어음 만기로 일자별 예상 잔액',
  })
  planReport(@ZodQuery(CashPlanQuerySchema) q: Range) {
    return this.cash.planReport(q.from, q.to);
  }

  @RequirePermission('accounting', 'read')
  @Get('reports/daily-cash')
  @ZodResponse(DailyCashReportSchema, {
    description: '일일자금일보: 현금·예금 계정별 전일 잔액·입금·출금·금일 잔액과 내역',
  })
  daily(@ZodQuery(DailyCashQuerySchema) q: z.infer<typeof DailyCashQuerySchema>) {
    return this.cash.dailyReport(q.date);
  }
}
