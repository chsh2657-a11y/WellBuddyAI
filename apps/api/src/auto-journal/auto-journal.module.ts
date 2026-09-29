import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module.js';
import { AutoJournalController } from './auto-journal.controller.js';
import { AutoJournalService } from './auto-journal.service.js';
import { AutoJournalRulesService } from './rules.service.js';

/** 자동분개 엔진·검토함·분개 규칙(P2-19~24) */
@Module({
  imports: [AccountingModule],
  controllers: [AutoJournalController],
  providers: [AutoJournalService, AutoJournalRulesService],
  exports: [AutoJournalService],
})
export class AutoJournalModule {}
