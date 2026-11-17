import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type StockCountInput,
  StockCountInputSchema,
  type TradeDocCancelInput,
  TradeDocCancelSchema,
  type TradeDocInput,
  TradeDocInputSchema,
  type TradeTaxInvoiceIssueInput,
  TradeTaxInvoiceIssueSchema,
} from '@wellbuddy/shared';
import { z } from 'zod';
import { RequirePermission } from '../auth/decorators.js';
import { UuidParam, ZodBody, ZodQuery, ZodResponse } from '../common/zod.js';
import { TaxInvoiceIssueSchema } from '../evidence/evidence.schemas.js';
import { InventoryService } from './inventory.service.js';
import {
  InventoryReconcileQuerySchema,
  InventoryReconcileSchema,
  InventorySummaryQuerySchema,
  InventorySummarySchema,
  LedgerQuerySchema,
  LedgerSchema,
  StockQuerySchema,
  StockRowSchema,
  TradeDocListQuerySchema,
  TradeDocListSchema,
  TradeDocSchema,
} from './sales.schemas.js';
import { TradeDocsService } from './trade-docs.service.js';
import { TradeTaxInvoiceService } from './trade-tax-invoice.service.js';

/** 거래 문서(견적·주문·발주·입고·구매·반품)와 재고 조회 */
@ApiTags('trade-docs')
@Controller()
export class TradeDocsController {
  constructor(
    private readonly docs: TradeDocsService,
    private readonly inventory: InventoryService,
    private readonly taxInvoices: TradeTaxInvoiceService,
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

  @RequirePermission('sales', 'write')
  @Post('trade-docs/:id/tax-invoice')
  @ZodResponse(TaxInvoiceIssueSchema, {
    status: 201,
    description:
      '판매에서 전자세금계산서 발행(P3-08): 품목 줄·금액·거래처로 발행하고 증빙을 판매 전표에 잇는다',
  })
  issueTaxInvoice(
    @UuidParam('id') id: string,
    @ZodBody(TradeTaxInvoiceIssueSchema) body: TradeTaxInvoiceIssueInput,
  ) {
    return this.taxInvoices.issue(id, body);
  }

  @RequirePermission('sales', 'write')
  @Post('inventory/counts')
  @ZodResponse(TradeDocSchema, {
    status: 201,
    description: '재고 실사: 장부와 다른 수량을 재고 조정 문서로 남기고 감모·과잉 전표를 만든다',
  })
  stockCount(@ZodBody(StockCountInputSchema) body: StockCountInput) {
    return this.docs.stockCount(body);
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

  @RequirePermission('sales', 'read')
  @Get('inventory/summary')
  @ZodResponse(InventorySummarySchema, {
    description: '재고수불현황(기간): 품목별 기초·입고·출고·기말 수량과 금액',
  })
  summary(
    @ZodQuery(InventorySummaryQuerySchema) query: z.infer<typeof InventorySummaryQuerySchema>,
  ) {
    return this.inventory.summary(query);
  }

  @RequirePermission('sales', 'read')
  @Get('inventory/reconcile')
  @ZodResponse(InventoryReconcileSchema, {
    description: '재고–장부 대사: 재고 계정별 재고금액과 장부 잔액, 차이의 원인 후보 전표',
  })
  reconcile(
    @ZodQuery(InventoryReconcileQuerySchema) query: z.infer<typeof InventoryReconcileQuerySchema>,
  ) {
    return this.inventory.reconcile(query.date);
  }
}
