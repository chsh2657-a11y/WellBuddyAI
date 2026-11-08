import { Module } from '@nestjs/common';
import { ItemsImport } from './items.import.js';
import { ItemsService } from './items.service.js';
import { PartnerPricesService } from './partner-prices.service.js';
import { SalesMasterController } from './sales-master.controller.js';
import { WarehousesService } from './warehouses.service.js';

/** 영업·구매·재고(P3) */
@Module({
  controllers: [SalesMasterController],
  providers: [ItemsService, WarehousesService, PartnerPricesService, ItemsImport],
  exports: [ItemsService, WarehousesService],
})
export class SalesModule {}
