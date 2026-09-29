import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  FiscalYearCreateSchema,
  type OpeningBalancesInput,
  OpeningBalancesInputSchema,
} from '@wellbuddy/shared';
import { z } from 'zod';
import { RequirePermission } from '../auth/decorators.js';
import { UuidParam, ZodBody, ZodResponse } from '../common/zod.js';
import { FiscalYearsService } from './fiscal-years.service.js';
import { FiscalYearSchema, OpeningBalancesSchema } from './journal.schemas.js';

/** 회계연도·월별 기간 마감, 기초잔액·전기이월 */
@ApiTags('fiscal-years')
@Controller()
export class FiscalYearsController {
  constructor(private readonly fiscal: FiscalYearsService) {}

  @RequirePermission('accounting', 'read')
  @Get('fiscal-years')
  @ZodResponse(z.array(FiscalYearSchema), {
    description: '회계연도(최근부터)와 월별 기간. 없으면 올해를 만든다',
  })
  list() {
    return this.fiscal.list();
  }

  @RequirePermission('accounting', 'write')
  @Post('fiscal-years')
  @ZodResponse(
    z.object({ id: z.uuid(), label: z.string(), startDate: z.string(), endDate: z.string() }),
    { status: 201, description: '날짜가 속한 회계연도 생성' },
  )
  create(@ZodBody(FiscalYearCreateSchema) body: z.infer<typeof FiscalYearCreateSchema>) {
    return this.fiscal.create(body.date);
  }

  @RequirePermission('accounting', 'read')
  @Get('fiscal-years/:id/opening-balances')
  @ZodResponse(OpeningBalancesSchema)
  getOpening(@UuidParam('id') id: string) {
    return this.fiscal.getOpening(id);
  }

  @RequirePermission('accounting', 'write')
  @Put('fiscal-years/:id/opening-balances')
  @ZodResponse(OpeningBalancesSchema, { description: '기초잔액 전체 교체' })
  setOpening(
    @UuidParam('id') id: string,
    @ZodBody(OpeningBalancesInputSchema) body: OpeningBalancesInput,
  ) {
    return this.fiscal.setOpening(id, body);
  }

  @RequirePermission('accounting', 'write')
  @Post('fiscal-years/:id/carry-forward')
  @HttpCode(200)
  @ZodResponse(
    z.object({ nextFiscalYearId: z.uuid(), lines: z.number().int(), netIncome: z.number().int() }),
    { description: '다음 연도 기초잔액으로 전기이월' },
  )
  carryForward(@UuidParam('id') id: string) {
    return this.fiscal.carryForward(id);
  }

  @RequirePermission('accounting', 'write')
  @Post('accounting-periods/:id/lock')
  @HttpCode(200)
  @ZodResponse(z.object({ locked: z.number().int() }), {
    description: '이 기간까지 마감(이전 열린 기간 포함)',
  })
  lock(@UuidParam('id') id: string) {
    return this.fiscal.lock(id);
  }

  @RequirePermission('accounting', 'write')
  @Post('accounting-periods/:id/unlock')
  @HttpCode(200)
  @ZodResponse(z.object({ unlocked: z.number().int() }), {
    description: '이 기간부터 마감 해제(대표·관리자)',
  })
  unlock(@UuidParam('id') id: string) {
    return this.fiscal.unlock(id);
  }
}
