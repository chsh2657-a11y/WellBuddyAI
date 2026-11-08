import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { defaultNormalBalance } from '@wellbuddy/accounting-core';
import { accountMemos, accounts, ensureStandardAccounts } from '@wellbuddy/db';
import type { AccountInput, AccountUpdateInput } from '@wellbuddy/shared';
import { and, asc, eq, ilike, or } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { isForeignKeyViolation, isUniqueViolation } from '../common/db-errors.js';
import { AppException } from '../common/errors.js';
import { requireCompanyContext } from '../common/request-context.js';
import { DbService } from '../db/db.service.js';

const columns = {
  id: accounts.id,
  code: accounts.code,
  name: accounts.name,
  group: accounts.group,
  normalBalance: accounts.normalBalance,
  requiresPartner: accounts.requiresPartner,
  requiresDepartment: accounts.requiresDepartment,
  isActive: accounts.isActive,
  isSystem: accounts.isSystem,
  description: accounts.description,
};

@Injectable()
export class AccountsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** 계정과목 목록(코드순). 계정이 하나도 없으면 표준 계정과목을 먼저 넣는다. */
  async list(options: { q?: string; includeInactive?: boolean } = {}) {
    const { companyId } = requireCompanyContext();
    return this.db.tenant(async (tx) => {
      const [any] = await tx.select({ id: accounts.id }).from(accounts).limit(1);
      if (!any) await ensureStandardAccounts(tx, companyId);
      const q = options.q ? `%${options.q}%` : undefined;
      return tx
        .select(columns)
        .from(accounts)
        .where(
          and(
            options.includeInactive ? undefined : eq(accounts.isActive, true),
            q ? or(ilike(accounts.code, q), ilike(accounts.name, q)) : undefined,
          ),
        )
        .orderBy(asc(accounts.code));
    });
  }

  async create(input: AccountInput) {
    const { companyId } = requireCompanyContext();
    try {
      return await this.db.tenant(async (tx) => {
        const [row] = await tx
          .insert(accounts)
          .values({
            ...input,
            companyId,
            normalBalance: input.normalBalance ?? defaultNormalBalance(input.group),
            isSystem: false,
          })
          .returning(columns);
        await this.audit.record(
          { action: 'account.create', entity: 'account', entityId: row!.id, after: row },
          tx,
        );
        return row!;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw this.duplicateCode(input.code);
      throw e;
    }
  }

  async update(id: string, input: AccountUpdateInput) {
    try {
      return await this.db.tenant(async (tx) => {
        const [before] = await tx.select(columns).from(accounts).where(eq(accounts.id, id));
        if (!before) throw new NotFoundException();
        if (
          before.isSystem &&
          ((input.code !== undefined && input.code !== before.code) ||
            (input.group !== undefined && input.group !== before.group) ||
            (input.normalBalance !== undefined && input.normalBalance !== before.normalBalance))
        ) {
          throw new AppException(
            'SYSTEM_ACCOUNT_LOCKED',
            '표준 계정과목은 코드·재무제표 구분·정상잔액을 바꿀 수 없습니다. 이름과 옵션만 바꿀 수 있습니다.',
          );
        }
        const [after] = await tx
          .update(accounts)
          .set(input)
          .where(eq(accounts.id, id))
          .returning(columns);
        await this.audit.record(
          { action: 'account.update', entity: 'account', entityId: id, before, after },
          tx,
        );
        return after!;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw this.duplicateCode(input.code ?? '');
      throw e;
    }
  }

  /** 직접 추가한 계정만 삭제할 수 있다(전표에 쓰였으면 사용중지). */
  async remove(id: string) {
    try {
      await this.db.tenant(async (tx) => {
        const [row] = await tx.select(columns).from(accounts).where(eq(accounts.id, id));
        if (!row) throw new NotFoundException();
        if (row.isSystem) {
          throw new AppException(
            'SYSTEM_ACCOUNT_LOCKED',
            '표준 계정과목은 삭제할 수 없습니다. 사용중지해 주세요.',
          );
        }
        await tx.delete(accounts).where(eq(accounts.id, id));
        await this.audit.record(
          { action: 'account.delete', entity: 'account', entityId: id, before: row },
          tx,
        );
      });
    } catch (e) {
      if (isForeignKeyViolation(e)) {
        throw new AppException(
          'ACCOUNT_IN_USE',
          '전표에 사용된 계정은 삭제할 수 없습니다. 사용중지해 주세요.',
          HttpStatus.CONFLICT,
        );
      }
      throw e;
    }
  }

  /** 빠졌거나 지운 표준 계정과목을 다시 넣는다. */
  async restoreStandard() {
    const { companyId } = requireCompanyContext();
    const added = await this.db.tenant((tx) => ensureStandardAccounts(tx, companyId));
    await this.audit.record({
      action: 'account.restore_standard',
      entity: 'account',
      after: { added },
    });
    return { added };
  }

  listMemos(accountId: string) {
    return this.db.tenant((tx) =>
      tx
        .select({ id: accountMemos.id, text: accountMemos.text })
        .from(accountMemos)
        .where(eq(accountMemos.accountId, accountId))
        .orderBy(asc(accountMemos.sortOrder), asc(accountMemos.createdAt)),
    );
  }

  async addMemo(accountId: string, text: string) {
    const { companyId } = requireCompanyContext();
    return this.db.tenant(async (tx) => {
      const [account] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.id, accountId));
      if (!account) throw new NotFoundException();
      const [memo] = await tx
        .insert(accountMemos)
        .values({ companyId, accountId, text })
        .returning({ id: accountMemos.id, text: accountMemos.text });
      return memo!;
    });
  }

  async removeMemo(accountId: string, memoId: string) {
    const deleted = await this.db.tenant((tx) =>
      tx
        .delete(accountMemos)
        .where(and(eq(accountMemos.id, memoId), eq(accountMemos.accountId, accountId)))
        .returning({ id: accountMemos.id }),
    );
    if (deleted.length === 0) throw new NotFoundException();
  }

  private duplicateCode(code: string) {
    return new AppException(
      'DUPLICATE_CODE',
      `계정코드 ${code} 가 이미 있습니다.`,
      HttpStatus.CONFLICT,
    );
  }
}
