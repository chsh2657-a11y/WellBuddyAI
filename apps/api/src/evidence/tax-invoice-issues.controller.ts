import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type TaxInvoiceCancelInput,
  TaxInvoiceCancelSchema,
  type TaxInvoiceIssueInput,
  TaxInvoiceIssueInputSchema,
} from '@wellbuddy/shared';
import { z } from 'zod';
import { RequirePermission } from '../auth/decorators.js';
import { UuidParam, ZodBody, ZodResponse } from '../common/zod.js';
import { TaxInvoiceCancelResultSchema, TaxInvoiceIssueSchema } from './evidence.schemas.js';
import { TaxInvoiceIssuesService } from './tax-invoice-issues.service.js';

/** 전자세금계산서 발행·취소·상태조회(P2-14) */
@ApiTags('evidence')
@Controller('tax-invoice-issues')
export class TaxInvoiceIssuesController {
  constructor(private readonly issues: TaxInvoiceIssuesService) {}

  @RequirePermission('evidence', 'read')
  @Get()
  @ZodResponse(z.array(TaxInvoiceIssueSchema), { description: '발행한 전자세금계산서(최근 500건)' })
  list() {
    return this.issues.list();
  }

  @RequirePermission('evidence', 'write')
  @Post()
  @ZodResponse(TaxInvoiceIssueSchema, {
    status: 201,
    description: '연동관리에서 고른 공급자(모의·팝빌)로 발행하고 매출 세금계산서로 등록',
  })
  issue(@ZodBody(TaxInvoiceIssueInputSchema) body: TaxInvoiceIssueInput) {
    return this.issues.issue(body);
  }

  @RequirePermission('evidence', 'write')
  @Post(':id/cancel')
  @HttpCode(200)
  @ZodResponse(TaxInvoiceCancelResultSchema, { description: '발행 취소' })
  cancel(
    @UuidParam('id') id: string,
    @ZodBody(TaxInvoiceCancelSchema) body: TaxInvoiceCancelInput,
  ) {
    return this.issues.cancel(id, body);
  }

  @RequirePermission('evidence', 'write')
  @Post(':id/refresh')
  @HttpCode(200)
  @ZodResponse(TaxInvoiceIssueSchema, { description: '국세청 전송 상태 다시 조회' })
  refresh(@UuidParam('id') id: string) {
    return this.issues.refresh(id);
  }
}
