import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { AutoJournalController } from './auto-journal.controller.js';
import { AutoJournalService } from './auto-journal.service.js';
import { RuleSuggestionsService } from './rule-suggestions.service.js';
import { AutoJournalRulesService } from './rules.service.js';

/** 자동분개 엔진·검토함·분개 규칙(P2-19~24) */
@Module({
  imports: [AccountingModule, IntegrationsModule],
  controllers: [AutoJournalController],
  providers: [AutoJournalService, AutoJournalRulesService, RuleSuggestionsService],
  exports: [AutoJournalService],
})
export class AutoJournalModule {}
