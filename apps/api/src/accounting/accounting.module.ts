import { Module } from '@nestjs/common';
import { AccountsService } from './accounts.service.js';
import { DimensionsService } from './dimensions.service.js';
import { FiscalYearsController } from './fiscal-years.controller.js';
import { FiscalYearsService } from './fiscal-years.service.js';
import { JournalsController } from './journals.controller.js';
import { JournalsService } from './journals.service.js';
import { MasterController } from './master.controller.js';
import { PartnersImport } from './partners.import.js';
import { PartnersService } from './partners.service.js';

@Module({
  controllers: [MasterController, FiscalYearsController, JournalsController],
  providers: [
    AccountsService,
    PartnersService,
    DimensionsService,
    PartnersImport,
    FiscalYearsService,
    JournalsService,
  ],
  exports: [
    AccountsService,
    PartnersService,
    DimensionsService,
    FiscalYearsService,
    JournalsService,
  ],
})
export class AccountingModule {}
