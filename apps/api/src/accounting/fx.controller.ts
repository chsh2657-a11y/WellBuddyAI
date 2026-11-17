import { Controller, Delete, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type ExchangeRateInput,
  ExchangeRateInputSchema,
  ExchangeRateLookupSchema,
  ExchangeRateQuerySchema,
  FxRevaluationInputSchema,
  IsoDateSchema,
} from '@wellbuddy/shared';
import { z } from 'zod';
import { RequirePermission } from '../auth/decorators.js';
import { UuidParam, ZodBody, ZodParam, ZodQuery, ZodResponse } from '../common/zod.js';
import {
  ExchangeRateSchema,
  FxRevaluationPreviewSchema,
  FxRevaluationResultSchema,
  FxRevaluationSchema,
} from './fx.schemas.js';
import { FxService } from './fx.service.js';

/** 환율 관리와 기말 외화평가 */
@ApiTags('fx')
@Controller()
export class FxController {
  constructor(private readonly fx: FxService) {}

  @RequirePermission('accounting', 'read')
  @Get('exchange-rates')
  @ZodResponse(z.array(ExchangeRateSchema), { description: '환율(최근 날짜부터, 최대 1,000건)' })
  listRates(@ZodQuery(ExchangeRateQuerySchema) q: z.infer<typeof ExchangeRateQuerySchema>) {
    return this.fx.listRates(q);
  }

  @RequirePermission('accounting', 'read')
  @Get('exchange-rates/lookup')
  @ZodResponse(z.object({ exchangeRate: ExchangeRateSchema.nullable() }), {
    description: '그 날짜(없으면 이전 가장 가까운 날)의 환율. 없으면 null',
  })
  lookup(@ZodQuery(ExchangeRateLookupSchema) q: z.infer<typeof ExchangeRateLookupSchema>) {
    return this.fx.lookupRate(q.currency, q.date);
  }

  @RequirePermission('accounting', 'write')
  @Put('exchange-rates')
  @ZodResponse(ExchangeRateSchema, { description: '환율 등록(같은 통화·날짜면 덮어쓴다)' })
  upsert(@ZodBody(ExchangeRateInputSchema) body: ExchangeRateInput) {
    return this.fx.upsertRate(body);
  }

  @RequirePermission('accounting', 'write')
  @Delete('exchange-rates/:id')
  @HttpCode(204)
  removeRate(@UuidParam('id') id: string) {
    return this.fx.removeRate(id);
  }

  @RequirePermission('accounting', 'read')
  @Get('fx-revaluations/preview')
  @ZodResponse(FxRevaluationPreviewSchema, {
    description: '평가일 현재 외화 자산·부채 잔액과 평가손익 미리보기(전표는 만들지 않음)',
  })
  preview(@ZodQuery(FxRevaluationInputSchema) q: z.infer<typeof FxRevaluationInputSchema>) {
    return this.fx.preview(q.date);
  }

  @RequirePermission('accounting', 'read')
  @Get('fx-revaluations')
  @ZodResponse(z.array(FxRevaluationSchema), { description: '외화평가 실행 이력(최근부터)' })
  list() {
    return this.fx.listRevaluations();
  }

  @RequirePermission('accounting', 'write')
  @Post('fx-revaluations')
  @ZodResponse(FxRevaluationResultSchema, {
    status: 201,
    description: '외화평가 전표 전기(평가일마다 한 번, 날짜 순서대로)',
  })
  revalue(@ZodBody(FxRevaluationInputSchema) body: z.infer<typeof FxRevaluationInputSchema>) {
    return this.fx.revalue(body.date);
  }

  @RequirePermission('accounting', 'write')
  @Delete('fx-revaluations/:date')
  @HttpCode(204)
  cancel(@ZodParam('date', IsoDateSchema) date: string) {
    return this.fx.cancel(date);
  }
}
