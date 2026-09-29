import { Controller, Delete, Get, HttpCode, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ApproveSuggestionsSchema,
  AUTO_JOURNAL_KINDS,
  type AutoJournalKind,
  type AutoJournalRuleInput,
  AutoJournalRuleInputSchema,
  AutoJournalRuleToggleSchema,
  type AutoJournalSettings,
  AutoJournalSettingsSchema,
  type SuggestionUpdateInput,
  SuggestionUpdateSchema,
  UPLOAD_KINDS,
  type UploadKind,
} from '@wellbuddy/shared';
import { z } from 'zod';
import { RequirePermission } from '../auth/decorators.js';
import { UuidParam, ZodBody, ZodParam, ZodQuery, ZodResponse } from '../common/zod.js';
import {
  ApproveResultSchema,
  ReviewItemSchema,
  RuleSchema,
  RunSummarySchema,
} from './auto-journal.schemas.js';
import { AutoJournalService } from './auto-journal.service.js';
import { AutoJournalRulesService } from './rules.service.js';

const ReviewQuerySchema = z.object({ kind: z.enum(AUTO_JOURNAL_KINDS).optional() });

/** 자동분개: 실행, 검토함, 승인, 분개 규칙, 자동 전기 설정 */
@ApiTags('auto-journal')
@Controller('auto-journal')
export class AutoJournalController {
  constructor(
    private readonly autoJournal: AutoJournalService,
    private readonly rules: AutoJournalRulesService,
  ) {}

  @RequirePermission('evidence', 'read')
  @Get('settings')
  @ZodResponse(AutoJournalSettingsSchema)
  settings() {
    return this.autoJournal.getSettings();
  }

  @RequirePermission('evidence', 'write')
  @Put('settings')
  @ZodResponse(AutoJournalSettingsSchema)
  updateSettings(@ZodBody(AutoJournalSettingsSchema) body: AutoJournalSettings) {
    return this.autoJournal.updateSettings(body);
  }

  @RequirePermission('evidence', 'write')
  @Post('run')
  @HttpCode(200)
  @ZodResponse(RunSummarySchema, {
    description: '분개 전 증빙을 매칭·분류하고, 신뢰도가 기준 이상이면 자동 전기한다',
  })
  run() {
    return this.autoJournal.run();
  }

  @RequirePermission('evidence', 'read')
  @Get('review')
  @ZodResponse(z.array(ReviewItemSchema), { description: '자동분개 검토함' })
  review(@ZodQuery(ReviewQuerySchema) q: { kind?: AutoJournalKind }) {
    return this.autoJournal.review(q.kind);
  }

  @RequirePermission('evidence', 'write')
  @Put('review/:evidenceKind/:evidenceId')
  @HttpCode(204)
  updateSuggestion(
    @ZodParam('evidenceKind', z.enum(UPLOAD_KINDS)) evidenceKind: UploadKind,
    @UuidParam('evidenceId') evidenceId: string,
    @ZodBody(SuggestionUpdateSchema) body: SuggestionUpdateInput,
  ) {
    return this.autoJournal.updateSuggestion({ evidenceKind, evidenceId }, body);
  }

  @RequirePermission('evidence', 'write')
  @Post('approve')
  @HttpCode(200)
  @ZodResponse(ApproveResultSchema, { description: '고른 추천을 전표로 만든다(하나씩 처리)' })
  approve(@ZodBody(ApproveSuggestionsSchema) body: z.infer<typeof ApproveSuggestionsSchema>) {
    return this.autoJournal.approve(body.items);
  }

  @RequirePermission('evidence', 'read')
  @Get('rules')
  @ZodResponse(z.array(RuleSchema))
  listRules() {
    return this.rules.list();
  }

  @RequirePermission('evidence', 'write')
  @Post('rules')
  @ZodResponse(RuleSchema)
  createRule(@ZodBody(AutoJournalRuleInputSchema) body: AutoJournalRuleInput) {
    return this.rules.create(body);
  }

  @RequirePermission('evidence', 'write')
  @Put('rules/:id')
  @ZodResponse(RuleSchema)
  updateRule(
    @UuidParam('id') id: string,
    @ZodBody(AutoJournalRuleInputSchema) body: AutoJournalRuleInput,
  ) {
    return this.rules.update(id, body);
  }

  @RequirePermission('evidence', 'write')
  @Patch('rules/:id')
  @ZodResponse(RuleSchema)
  toggleRule(
    @UuidParam('id') id: string,
    @ZodBody(AutoJournalRuleToggleSchema) body: z.infer<typeof AutoJournalRuleToggleSchema>,
  ) {
    return this.rules.toggle(id, body);
  }

  @RequirePermission('evidence', 'write')
  @Delete('rules/:id')
  @HttpCode(204)
  removeRule(@UuidParam('id') id: string) {
    return this.rules.remove(id);
  }
}
