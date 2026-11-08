import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module.js';
import { InventoryService } from './inventory.service.js';
import { ItemsImport } from './items.import.js';
import { ItemsService } from './items.service.js';
import { PartnerPricesService } from './partner-prices.service.js';
import { SalesMasterController } from './sales-master.controller.js';
import { TradeDocsController } from './trade-docs.controller.js';
import { TradeDocsService } from './trade-docs.service.js';
import { TradePostingService } from './trade-posting.service.js';
import { WarehousesService } from './warehouses.service.js';

/** 영업·구매·재고(P3) */
@Module({
  imports: [AccountingModule],
  controllers: [SalesMasterController, TradeDocsController],
  providers: [
    ItemsService,
    WarehousesService,
    PartnerPricesService,
    ItemsImport,
    InventoryService,
    TradePostingService,
    TradeDocsService,
  ],
  exports: [ItemsService, WarehousesService, InventoryService, TradeDocsService],
})
export class SalesModule {}
