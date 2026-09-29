import { Module } from '@nestjs/common';
import { AccountsService } from './accounts.service.js';
import { DimensionsService } from './dimensions.service.js';
import { FiscalYearsController } from './fiscal-years.controller.js';
import { FiscalYearsService } from './fiscal-years.service.js';
import { FixedAssetsController } from './fixed-assets.controller.js';
import { FixedAssetsService } from './fixed-assets.service.js';
import { FxController } from './fx.controller.js';
import { ExchangeRatesImport } from './fx.import.js';
import { FxService } from './fx.service.js';
import { JournalsController } from './journals.controller.js';
import { JournalsService } from './journals.service.js';
import { MasterController } from './master.controller.js';
import { PartnersImport } from './partners.import.js';
import { PartnersService } from './partners.service.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

@Module({
  controllers: [
    MasterController,
    FiscalYearsController,
    JournalsController,
    ReportsController,
    FixedAssetsController,
    FxController,
  ],
  providers: [
    AccountsService,
    PartnersService,
    DimensionsService,
    PartnersImport,
    FiscalYearsService,
    JournalsService,
    ReportsService,
    FixedAssetsService,
    FxService,
    ExchangeRatesImport,
  ],
  exports: [
    AccountsService,
    PartnersService,
    DimensionsService,
    FiscalYearsService,
    JournalsService,
    ReportsService,
  ],
})
export class AccountingModule {}
