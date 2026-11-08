import { Controller, Delete, Get, HttpCode, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type ItemInput,
  ItemInputSchema,
  type ItemUpdateInput,
  ItemUpdateSchema,
  type PartnerPriceInput,
  PartnerPriceInputSchema,
  type WarehouseInput,
  WarehouseInputSchema,
  type WarehouseUpdateInput,
  WarehouseUpdateSchema,
} from '@wellbuddy/shared';
import { z } from 'zod';
import { RequirePermission } from '../auth/decorators.js';
import { UuidParam, ZodBody, ZodParam, ZodQuery, ZodResponse } from '../common/zod.js';
import { ItemsService } from './items.service.js';
import { PartnerPricesService } from './partner-prices.service.js';
import {
  ItemListQuerySchema,
  ItemPriceQuerySchema,
  ItemPriceSchema,
  ItemSchema,
  PartnerPriceQuerySchema,
  PartnerPriceSchema,
  WarehouseSchema,
} from './sales.schemas.js';
import { WarehousesService } from './warehouses.service.js';

const IncludeInactiveSchema = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

/** 영업·구매·재고 기초정보: 품목·창고·거래처별 단가 */
@ApiTags('sales-master')
@Controller()
export class SalesMasterController {
  constructor(
    private readonly items: ItemsService,
    private readonly warehouses: WarehousesService,
    private readonly prices: PartnerPricesService,
  ) {}

  // ── 품목 ────────────────────────────────────────────

  @RequirePermission('sales', 'read')
  @Get('items')
  @ZodResponse(z.array(ItemSchema), { description: '품목(코드순)' })
  listItems(@ZodQuery(ItemListQuerySchema) query: z.infer<typeof ItemListQuerySchema>) {
    return this.items.list(query);
  }

  @RequirePermission('sales', 'read')
  @Get('items/by-barcode/:barcode')
  @ZodResponse(ItemSchema, { description: '바코드로 품목 찾기(없으면 404)' })
  itemByBarcode(@ZodParam('barcode', z.string().trim().min(1).max(64)) barcode: string) {
    return this.items.byBarcode(barcode);
  }

  @RequirePermission('sales', 'read')
  @Get('items/:id')
  @ZodResponse(ItemSchema)
  getItem(@UuidParam('id') id: string) {
    return this.items.get(id);
  }

  @RequirePermission('sales', 'read')
  @Get('items/:id/price')
  @ZodResponse(ItemPriceSchema, { description: '단가 찾기: 거래처별 단가 → 품목 기본 단가' })
  itemPrice(
    @UuidParam('id') id: string,
    @ZodQuery(ItemPriceQuerySchema) query: z.infer<typeof ItemPriceQuerySchema>,
  ) {
    return this.items.price(id, query.side, query.partnerId);
  }

  @RequirePermission('sales', 'write')
  @Post('items')
  @ZodResponse(ItemSchema, { status: 201, description: '코드를 비우면 자동 부여' })
  createItem(@ZodBody(ItemInputSchema) body: ItemInput) {
    return this.items.create(body);
  }

  @RequirePermission('sales', 'write')
  @Patch('items/:id')
  @ZodResponse(ItemSchema)
  updateItem(@UuidParam('id') id: string, @ZodBody(ItemUpdateSchema) body: ItemUpdateInput) {
    return this.items.update(id, body);
  }

  @RequirePermission('sales', 'write')
  @Delete('items/:id')
  @HttpCode(204)
  async removeItem(@UuidParam('id') id: string): Promise<void> {
    await this.items.remove(id);
  }

  // ── 창고 ────────────────────────────────────────────

  @RequirePermission('sales', 'read')
  @Get('warehouses')
  @ZodResponse(z.array(WarehouseSchema), { description: '창고(코드순). 없으면 기본창고를 만든다' })
  listWarehouses(@ZodQuery(IncludeInactiveSchema) query: z.infer<typeof IncludeInactiveSchema>) {
    return this.warehouses.list(query);
  }

  @RequirePermission('sales', 'write')
  @Post('warehouses')
  @ZodResponse(WarehouseSchema, { status: 201 })
  createWarehouse(@ZodBody(WarehouseInputSchema) body: WarehouseInput) {
    return this.warehouses.create(body);
  }

  @RequirePermission('sales', 'write')
  @Patch('warehouses/:id')
  @ZodResponse(WarehouseSchema)
  updateWarehouse(
    @UuidParam('id') id: string,
    @ZodBody(WarehouseUpdateSchema) body: WarehouseUpdateInput,
  ) {
    return this.warehouses.update(id, body);
  }

  @RequirePermission('sales', 'write')
  @Delete('warehouses/:id')
  @HttpCode(204)
  async removeWarehouse(@UuidParam('id') id: string): Promise<void> {
    await this.warehouses.remove(id);
  }

  // ── 거래처별 단가 ───────────────────────────────────

  @RequirePermission('sales', 'read')
  @Get('partner-prices')
  @ZodResponse(z.array(PartnerPriceSchema), { description: '거래처별 단가(거래처·품목으로 거름)' })
  listPrices(@ZodQuery(PartnerPriceQuerySchema) query: z.infer<typeof PartnerPriceQuerySchema>) {
    return this.prices.list(query);
  }

  @RequirePermission('sales', 'write')
  @Put('partner-prices')
  @ZodResponse(PartnerPriceSchema, { description: '거래처·품목의 단가를 정한다(있으면 고침)' })
  upsertPrice(@ZodBody(PartnerPriceInputSchema) body: PartnerPriceInput) {
    return this.prices.upsert(body);
  }

  @RequirePermission('sales', 'write')
  @Delete('partner-prices/:id')
  @HttpCode(204)
  async removePrice(@UuidParam('id') id: string): Promise<void> {
    await this.prices.remove(id);
  }
}
