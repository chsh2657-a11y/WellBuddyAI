import { Module } from '@nestjs/common';
import { AccountsService } from './accounts.service.js';
import { DimensionsService } from './dimensions.service.js';
import { MasterController } from './master.controller.js';
import { PartnersImport } from './partners.import.js';
import { PartnersService } from './partners.service.js';

@Module({
  controllers: [MasterController],
  providers: [AccountsService, PartnersService, DimensionsService, PartnersImport],
  exports: [AccountsService, PartnersService, DimensionsService],
})
export class AccountingModule {}
