import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import {
  accounts,
  autoJournalRules,
  departments,
  partners,
  projects,
  type Transaction,
} from '@wellbuddy/db';
import type { AutoJournalRuleInput } from '@wellbuddy/shared';
import { alias } from 'drizzle-orm/pg-core';
import { asc, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/errors.js';
import { requireCompanyContext } from '../common/request-context.js';
import { DbService } from '../db/db.service.js';

const conditionPartner = alias(partners, 'condition_partner');
const assignPartner = alias(partners, 'assign_partner');

/** 회사 분개 규칙 관리(P2-20) */
@Injectable()
export class AutoJournalRulesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private async rows(tx: Transaction, id?: string) {
    const rows = await tx
      .select({
        r: autoJournalRules,
        accountCode: accounts.code,
        accountName: accounts.name,
        partnerName: conditionPartner.name,
        assignPartnerName: assignPartner.name,
      })
      .from(autoJournalRules)
      .innerJoin(accounts, eq(accounts.id, autoJournalRules.accountId))
      .leftJoin(conditionPartner, eq(conditionPartner.id, autoJournalRules.partnerId))
      .leftJoin(assignPartner, eq(assignPartner.id, autoJournalRules.assignPartnerId))
      .where(id ? eq(autoJournalRules.id, id) : undefined)
      .orderBy(asc(autoJournalRules.priority), asc(autoJournalRules.createdAt));
    return rows.map(({ r, ...names }) => ({
      id: r.id,
      name: r.name,
      priority: r.priority,
      isActive: r.isActive,
      kinds: r.kinds,
      keywords: r.keywords,
      partnerId: r.partnerId,
      partnerName: names.partnerName,
      minAmount: r.minAmount,
      maxAmount: r.maxAmount,
      accountId: r.accountId,
      account: `${names.accountCode} ${names.accountName}`,
      assignPartnerId: r.assignPartnerId,
      assignPartnerName: names.assignPartnerName,
      deductible: r.deductible,
      departmentId: r.departmentId,
      projectId: r.projectId,
      memo: r.memo,
      hitCount: r.hitCount,
      lastHitAt: r.lastHitAt?.toISOString() ?? null,
    }));
  }

  list() {
    return this.db.tenant((tx) => this.rows(tx));
  }

  /** 가리키는 계정·거래처·부서·프로젝트가 우리 회사에 있는지(RLS 로 다른 회사 것은 안 보인다) */
  private async assertRefs(tx: Transaction, input: AutoJournalRuleInput) {
    const [account] = await tx
      .select({ isActive: accounts.isActive })
      .from(accounts)
      .where(eq(accounts.id, input.accountId));
    if (!account) throw new AppException('NOT_FOUND', '없는 계정과목입니다.');
    if (!account.isActive) throw new AppException('ACCOUNT_INACTIVE', '사용중지된 계정입니다.');
    const checks = [
      { label: '거래처', table: partners, ids: [input.partnerId, input.assignPartnerId] },
      { label: '부서', table: departments, ids: [input.departmentId] },
      { label: '프로젝트', table: projects, ids: [input.projectId] },
    ] as const;
    for (const c of checks) {
      const ids = [...new Set(c.ids.filter((v): v is string => !!v))];
      if (ids.length === 0) continue;
      const found = await tx
        .select({ id: c.table.id })
        .from(c.table)
        .where(inArray(c.table.id, ids));
      if (found.length !== ids.length)
        throw new AppException('NOT_FOUND', `없는 ${c.label}입니다.`);
    }
  }

  private values(input: AutoJournalRuleInput) {
    return {
      name: input.name,
      priority: input.priority,
      isActive: input.isActive,
      kinds: input.kinds,
      keywords: input.keywords ?? null,
      partnerId: input.partnerId ?? null,
      minAmount: input.minAmount ?? null,
      maxAmount: input.maxAmount ?? null,
      accountId: input.accountId,
      assignPartnerId: input.assignPartnerId ?? null,
      deductible: input.deductible ?? null,
      departmentId: input.departmentId ?? null,
      projectId: input.projectId ?? null,
      memo: input.memo ?? null,
    };
  }

  async create(input: AutoJournalRuleInput) {
    const { companyId, userId } = requireCompanyContext();
    return this.db.tenant(async (tx) => {
      await this.assertRefs(tx, input);
      const [row] = await tx
        .insert(autoJournalRules)
        .values({ companyId, createdBy: userId, ...this.values(input) })
        .returning({ id: autoJournalRules.id });
      await this.audit.record(
        {
          action: 'auto_journal_rule.create',
          entity: 'auto_journal_rule',
          entityId: row!.id,
          after: input,
        },
        tx,
      );
      return (await this.rows(tx, row!.id))[0]!;
    });
  }

  async update(id: string, input: AutoJournalRuleInput) {
    return this.db.tenant(async (tx) => {
      await this.assertRefs(tx, input);
      const [row] = await tx
        .update(autoJournalRules)
        .set({ ...this.values(input), updatedAt: new Date() })
        .where(eq(autoJournalRules.id, id))
        .returning({ id: autoJournalRules.id });
      if (!row) throw new NotFoundException();
      await this.audit.record(
        {
          action: 'auto_journal_rule.update',
          entity: 'auto_journal_rule',
          entityId: id,
          after: input,
        },
        tx,
      );
      return (await this.rows(tx, id))[0]!;
    });
  }

  async toggle(id: string, input: { isActive?: boolean; priority?: number }) {
    if (input.isActive === undefined && input.priority === undefined) {
      throw new AppException('VALIDATION_ERROR', '바꿀 값을 보내 주세요.', HttpStatus.BAD_REQUEST);
    }
    return this.db.tenant(async (tx) => {
      const [row] = await tx
        .update(autoJournalRules)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(autoJournalRules.id, id))
        .returning({ id: autoJournalRules.id });
      if (!row) throw new NotFoundException();
      await this.audit.record(
        {
          action: 'auto_journal_rule.update',
          entity: 'auto_journal_rule',
          entityId: id,
          after: input,
        },
        tx,
      );
      return (await this.rows(tx, id))[0]!;
    });
  }

  async remove(id: string) {
    await this.db.tenant(async (tx) => {
      const [row] = await tx
        .delete(autoJournalRules)
        .where(eq(autoJournalRules.id, id))
        .returning({ id: autoJournalRules.id });
      if (!row) throw new NotFoundException();
      await this.audit.record(
        { action: 'auto_journal_rule.delete', entity: 'auto_journal_rule', entityId: id },
        tx,
      );
    });
  }
}
