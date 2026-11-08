import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type TradeDocCancelInput,
  TradeDocCancelSchema,
  type TradeDocInput,
  TradeDocInputSchema,
} from '@wellbuddy/shared';
import { z } from 'zod';
import { RequirePermission } from '../auth/decorators.js';
import { UuidParam, ZodBody, ZodQuery, ZodResponse } from '../common/zod.js';
import { InventoryService } from './inventory.service.js';
import {
  LedgerQuerySchema,
  LedgerSchema,
  StockQuerySchema,
  StockRowSchema,
  TradeDocListQuerySchema,
  TradeDocListSchema,
  TradeDocSchema,
} from './sales.schemas.js';
import { TradeDocsService } from './trade-docs.service.js';

/** 거래 문서(견적·주문·발주·입고·구매·반품)와 재고 조회 */
@ApiTags('trade-docs')
@Controller()
export class TradeDocsController {
  constructor(
    private readonly docs: TradeDocsService,
    private readonly inventory: InventoryService,
  ) {}

  @RequirePermission('sales', 'read')
  @Get('trade-docs')
  @ZodResponse(TradeDocListSchema, { description: '거래 문서 목록(최근 날짜순)' })
  list(@ZodQuery(TradeDocListQuerySchema) query: z.infer<typeof TradeDocListQuerySchema>) {
    return this.docs.list(query);
  }

  @RequirePermission('sales', 'read')
  @Get('trade-docs/:id')
  @ZodResponse(TradeDocSchema, { description: '문서·줄(남은 수량)·다음 단계 문서·전표' })
  get(@UuidParam('id') id: string) {
    return this.docs.get(id);
  }

  @RequirePermission('sales', 'write')
  @Post('trade-docs')
  @ZodResponse(TradeDocSchema, {
    status: 201,
    description: '문서 작성. 확정 문서는 재고 이동과 전표를 만든다(앞 문서에서 전환 가능)',
  })
  create(@ZodBody(TradeDocInputSchema) body: TradeDocInput) {
    return this.docs.create(body);
  }

  @RequirePermission('sales', 'write')
  @Post('trade-docs/:id/cancel')
  @HttpCode(200)
  @ZodResponse(TradeDocSchema, { description: '취소: 재고 이동을 지우고 전표를 역분개한다' })
  cancel(@UuidParam('id') id: string, @ZodBody(TradeDocCancelSchema) body: TradeDocCancelInput) {
    return this.docs.cancel(id, body.reason);
  }

  @RequirePermission('sales', 'read')
  @Get('inventory/stock')
  @ZodResponse(z.array(StockRowSchema), {
    description: '현재고(품목·창고별 수량, 품목별 재고금액)',
  })
  stock(@ZodQuery(StockQuerySchema) query: z.infer<typeof StockQuerySchema>) {
    return this.inventory.stock(query);
  }

  @RequirePermission('sales', 'read')
  @Get('inventory/ledger')
  @ZodResponse(LedgerSchema, { description: '재고수불부(기간 입출고와 누계)' })
  ledger(@ZodQuery(LedgerQuerySchema) query: z.infer<typeof LedgerQuerySchema>) {
    return this.inventory.ledger(query);
  }
}
