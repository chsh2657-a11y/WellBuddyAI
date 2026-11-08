import { HttpStatus, Injectable } from '@nestjs/common';
import { accounts, autoJournalMemory, autoJournalRules, partners } from '@wellbuddy/db';
import { AUTO_JOURNAL_KIND_LABELS, type RuleSuggestionRef } from '@wellbuddy/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/errors.js';
import { DbService } from '../db/db.service.js';
import { type RuleSuggestion, suggestRules } from './engine/rule-suggestions.js';
import { AutoJournalRulesService } from './rules.service.js';

/** 사용자 수정 학습 → 분개 규칙 제안(P2-25) */
@Injectable()
export class RuleSuggestionsService {
  constructor(
    private readonly db: DbService,
    private readonly rules: AutoJournalRulesService,
    private readonly audit: AuditService,
  ) {}

  private async compute() {
    return this.db.tenant(async (tx) => {
      const memory = await tx.select().from(autoJournalMemory);
      const rules = await tx
        .select()
        .from(autoJournalRules)
        .where(eq(autoJournalRules.isActive, true));
      const partnerRows = await tx
        .select({ id: partners.id, name: partners.name, bizRegNo: partners.bizRegNo })
        .from(partners)
        .where(eq(partners.isActive, true));
      const accountRows = await tx
        .select({ id: accounts.id, code: accounts.code, name: accounts.name })
        .from(accounts);
      const accountById = new Map(accountRows.map((a) => [a.id, a]));
      const partnerName = new Map(partnerRows.map((p) => [p.id, p.name]));
      return suggestRules(memory, rules, partnerRows).map((s) => {
        const account = accountById.get(s.accountId);
        const accountLabel = account ? `${account.code} ${account.name}` : '';
        return {
          ...s,
          kindLabel: AUTO_JOURNAL_KIND_LABELS[s.kind],
          partnerName: s.partnerId ? (partnerName.get(s.partnerId) ?? null) : null,
          account: accountLabel,
          /** 만들 규칙 이름 */
          name: `${s.label} → ${account?.name ?? ''}`.slice(0, 50),
        };
      });
    });
  }

  list() {
    return this.compute();
  }

  private async find(ref: RuleSuggestionRef) {
    const found = (await this.compute()).find(
      (s) => s.kind === ref.kind && ref.keys.some((k) => s.keys.includes(k)),
    );
    if (!found) {
      throw new AppException(
        'SUGGESTION_NOT_FOUND',
        '이미 처리했거나 없는 규칙 제안입니다.',
        HttpStatus.NOT_FOUND,
      );
    }
    return found;
  }

  /** 제안의 이력 열쇠를 다시 제안하지 않게 표시한다 */
  private async dismissKeys(s: Pick<RuleSuggestion, 'kind' | 'keys'>, action: string) {
    await this.db.tenant(async (tx) => {
      await tx
        .update(autoJournalMemory)
        .set({ suggestionDismissed: true })
        .where(and(eq(autoJournalMemory.kind, s.kind), inArray(autoJournalMemory.key, s.keys)));
      await this.audit.record(
        { action, entity: 'auto_journal', after: { kind: s.kind, keys: s.keys } },
        tx,
      );
    });
  }

  /** 제안대로 규칙을 만든다 */
  async accept(ref: RuleSuggestionRef) {
    const s = await this.find(ref);
    const rule = await this.rules.create({
      name: s.name,
      priority: 100,
      isActive: true,
      kinds: [s.kind],
      keywords: s.keywords,
      partnerId: s.partnerId,
      minAmount: null,
      maxAmount: null,
      accountId: s.accountId,
      assignPartnerId: null,
      deductible: s.deductible === false ? false : null,
      departmentId: null,
      projectId: null,
      memo: null,
    });
    await this.dismissKeys(s, 'auto_journal.rule_suggestion.accept');
    return rule;
  }

  async dismiss(ref: RuleSuggestionRef) {
    const s = await this.find(ref);
    await this.dismissKeys(s, 'auto_journal.rule_suggestion.dismiss');
  }
}
