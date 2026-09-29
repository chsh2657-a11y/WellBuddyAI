import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import {
  addDays,
  carryForwardLines,
  fiscalYearOf,
  monthlyPeriods,
  STATEMENT_GROUPS,
  SYSTEM_ACCOUNTS,
  validateJournal,
} from '@wellbuddy/accounting-core';
import {
  accountingPeriods,
  accounts,
  companies,
  ensureStandardAccounts,
  fiscalYears,
  journalEntries,
  journalLines,
  partners,
  type Transaction,
  users,
} from '@wellbuddy/db';
import { LEDGER_STATUSES, type OpeningBalancesInput } from '@wellbuddy/shared';
import { and, asc, count, eq, gte, inArray, lte, sql, sum } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/errors.js';
import { requireCompanyContext } from '../common/request-context.js';
import { todayKst } from '../common/dates.js';
import { DbService } from '../db/db.service.js';

export type FiscalYearRow = typeof fiscalYears.$inferSelect;

interface OpeningLine {
  accountId: string;
  partnerId: string | null;
  debit: number;
  credit: number;
}

/** 회계연도·월별 기간·마감, 기초잔액과 전기이월 */
@Injectable()
export class FiscalYearsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  // ── 회계연도 ─────────────────────────────────────────

  /** 날짜가 속한 회계연도를 돌려준다. 없으면 회사의 시작월 기준으로 만들고 월별 기간 12개를 붙인다. */
  async ensureFor(tx: Transaction, date: string): Promise<FiscalYearRow> {
    const { companyId } = requireCompanyContext();
    const found = await this.findFor(tx, date);
    if (found) return found;

    const [company] = await tx
      .select({ startMonth: companies.fiscalYearStartMonth })
      .from(companies)
      .where(eq(companies.id, companyId));
    const range = fiscalYearOf(date, company!.startMonth);
    const [overlap] = await tx
      .select({ id: fiscalYears.id })
      .from(fiscalYears)
      .where(
        and(lte(fiscalYears.startDate, range.endDate), gte(fiscalYears.endDate, range.startDate)),
      );
    if (overlap) {
      throw new AppException(
        'FISCAL_YEAR_OVERLAP',
        '기존 회계연도와 기간이 겹칩니다. 회계연도 시작 월을 확인해 주세요.',
        HttpStatus.CONFLICT,
      );
    }
    // 동시에 같은 연도를 만들면 한쪽은 아무것도 넣지 않고, 다른 쪽이 만든 행을 다시 읽는다
    const [created] = await tx
      .insert(fiscalYears)
      .values({ companyId, ...range })
      .onConflictDoNothing()
      .returning();
    if (!created) return (await this.findFor(tx, date))!;
    await tx
      .insert(accountingPeriods)
      .values(
        monthlyPeriods(range.startDate).map((p) => ({ ...p, companyId, fiscalYearId: created.id })),
      );
    return created;
  }

  private async findFor(tx: Transaction, date: string) {
    const [row] = await tx
      .select()
      .from(fiscalYears)
      .where(and(lte(fiscalYears.startDate, date), gte(fiscalYears.endDate, date)));
    return row;
  }

  private async getYear(tx: Transaction, id: string): Promise<FiscalYearRow> {
    const [row] = await tx.select().from(fiscalYears).where(eq(fiscalYears.id, id));
    if (!row) throw new NotFoundException();
    return row;
  }

  /** 마감된 기간이면 오류(서비스에서 먼저 알려 주고, DB 트리거가 한 번 더 막는다) */
  async assertOpen(tx: Transaction, date: string): Promise<void> {
    const [locked] = await tx
      .select({ id: accountingPeriods.id })
      .from(accountingPeriods)
      .where(
        and(
          eq(accountingPeriods.isLocked, true),
          lte(accountingPeriods.startDate, date),
          gte(accountingPeriods.endDate, date),
        ),
      );
    if (locked) {
      throw new AppException(
        'PERIOD_LOCKED',
        `${date} 은(는) 마감된 기간입니다. 마감을 해제한 뒤 처리해 주세요.`,
        HttpStatus.CONFLICT,
      );
    }
  }

  /** 회계연도 목록(최근 연도부터). 하나도 없으면 오늘이 속한 연도를 만든다. */
  async list() {
    return this.db.tenant(async (tx) => {
      const [any] = await tx.select({ id: fiscalYears.id }).from(fiscalYears).limit(1);
      if (!any) await this.ensureFor(tx, todayKst());

      const years = await tx
        .select()
        .from(fiscalYears)
        .orderBy(sql`${fiscalYears.startDate} desc`);
      const periods = await tx
        .select({
          id: accountingPeriods.id,
          fiscalYearId: accountingPeriods.fiscalYearId,
          periodNo: accountingPeriods.periodNo,
          startDate: accountingPeriods.startDate,
          endDate: accountingPeriods.endDate,
          isLocked: accountingPeriods.isLocked,
          lockedAt: accountingPeriods.lockedAt,
          lockedByName: users.name,
        })
        .from(accountingPeriods)
        .leftJoin(users, eq(users.id, accountingPeriods.lockedBy))
        .orderBy(asc(accountingPeriods.startDate));
      // 기간별 상태별 전표 수(기간은 달 단위이므로 월로 묶는다)
      const month = sql<string>`to_char(${journalEntries.entryDate}, 'YYYY-MM')`;
      const counts = await tx
        .select({ month, status: journalEntries.status, n: count() })
        .from(journalEntries)
        .where(sql`${journalEntries.type} <> 'opening'`)
        .groupBy(month, journalEntries.status);
      const openings = await tx
        .select({
          fiscalYearId: journalEntries.fiscalYearId,
          id: journalEntries.id,
          totalAmount: journalEntries.totalAmount,
        })
        .from(journalEntries)
        .where(eq(journalEntries.type, 'opening'));

      return years.map((y) => {
        const opening = openings.find((o) => o.fiscalYearId === y.id);
        return {
          id: y.id,
          label: y.label,
          startDate: y.startDate,
          endDate: y.endDate,
          carriedForwardAt: y.carriedForwardAt?.toISOString() ?? null,
          opening: opening ? { entryId: opening.id, totalAmount: opening.totalAmount } : null,
          periods: periods
            .filter((p) => p.fiscalYearId === y.id)
            .map(({ fiscalYearId: _, lockedAt, ...p }) => {
              const monthKey = p.startDate.slice(0, 7);
              const of = (status: string) =>
                counts.find((c) => c.month === monthKey && c.status === status)?.n ?? 0;
              return {
                ...p,
                lockedAt: lockedAt?.toISOString() ?? null,
                counts: {
                  draft: of('draft'),
                  pending: of('pending'),
                  posted: of('posted') + of('reversed'),
                },
              };
            }),
        };
      });
    });
  }

  /** 날짜가 속한 회계연도를 만든다(이미 있으면 그대로). */
  async create(date: string) {
    const year = await this.db.tenant(async (tx) => {
      const existing = await this.findFor(tx, date);
      const row = existing ?? (await this.ensureFor(tx, date));
      if (!existing) {
        await this.audit.record(
          { action: 'fiscal_year.create', entity: 'fiscal_year', entityId: row.id, after: row },
          tx,
        );
      }
      return row;
    });
    return { id: year.id, label: year.label, startDate: year.startDate, endDate: year.endDate };
  }

  // ── 마감 ─────────────────────────────────────────────

  /**
   * 이 기간까지(이전의 열린 기간 포함) 마감한다. 마감은 앞에서부터 차례로 이어지도록 한다.
   * 작성중·승인요청 전표가 남아 있으면 먼저 처리하도록 거부한다.
   */
  async lock(periodId: string) {
    const { userId } = requireCompanyContext();
    return this.db.tenant(async (tx) => {
      const target = await this.getPeriod(tx, periodId);
      const toLock = await tx
        .select({ id: accountingPeriods.id, startDate: accountingPeriods.startDate })
        .from(accountingPeriods)
        .where(
          and(
            eq(accountingPeriods.isLocked, false),
            lte(accountingPeriods.endDate, target.endDate),
          ),
        )
        .orderBy(asc(accountingPeriods.startDate));
      if (toLock.length === 0) return { locked: 0 };

      const [open] = await tx
        .select({ n: count() })
        .from(journalEntries)
        .where(
          and(
            inArray(journalEntries.status, ['draft', 'pending']),
            gte(journalEntries.entryDate, toLock[0]!.startDate),
            lte(journalEntries.entryDate, target.endDate),
          ),
        );
      if (open!.n > 0) {
        throw new AppException(
          'DRAFTS_IN_PERIOD',
          `마감할 기간에 작성중·승인요청 전표가 ${open!.n}건 있습니다. 전기하거나 삭제한 뒤 마감해 주세요.`,
          HttpStatus.CONFLICT,
          { count: open!.n },
        );
      }
      await tx
        .update(accountingPeriods)
        .set({ isLocked: true, lockedAt: new Date(), lockedBy: userId })
        .where(
          inArray(
            accountingPeriods.id,
            toLock.map((p) => p.id),
          ),
        );
      await this.audit.record(
        {
          action: 'period.lock',
          entity: 'accounting_period',
          entityId: periodId,
          after: { from: toLock[0]!.startDate, through: target.endDate, periods: toLock.length },
        },
        tx,
      );
      return { locked: toLock.length };
    });
  }

  /** 이 기간부터(이후의 마감된 기간 포함) 마감을 해제한다. 대표·관리자만 할 수 있다. */
  async unlock(periodId: string) {
    const { role } = requireCompanyContext();
    if (role !== 'owner' && role !== 'admin') {
      throw new AppException(
        'UNLOCK_FORBIDDEN',
        '마감 해제는 대표·관리자만 할 수 있습니다.',
        HttpStatus.FORBIDDEN,
      );
    }
    return this.db.tenant(async (tx) => {
      const target = await this.getPeriod(tx, periodId);
      const unlocked = await tx
        .update(accountingPeriods)
        .set({ isLocked: false, lockedAt: null, lockedBy: null })
        .where(
          and(
            eq(accountingPeriods.isLocked, true),
            gte(accountingPeriods.startDate, target.startDate),
          ),
        )
        .returning({ id: accountingPeriods.id });
      if (unlocked.length > 0) {
        await this.audit.record(
          {
            action: 'period.unlock',
            entity: 'accounting_period',
            entityId: periodId,
            after: { from: target.startDate, periods: unlocked.length },
          },
          tx,
        );
      }
      return { unlocked: unlocked.length };
    });
  }

  private async getPeriod(tx: Transaction, id: string) {
    const [row] = await tx.select().from(accountingPeriods).where(eq(accountingPeriods.id, id));
    if (!row) throw new NotFoundException();
    return row;
  }

  // ── 기초잔액·전기이월 ─────────────────────────────────

  async getOpening(fiscalYearId: string) {
    return this.db.tenant(async (tx) => {
      const year = await this.getYear(tx, fiscalYearId);
      const [entry] = await tx
        .select({ id: journalEntries.id, source: journalEntries.source })
        .from(journalEntries)
        .where(and(eq(journalEntries.fiscalYearId, year.id), eq(journalEntries.type, 'opening')));
      const lines = entry
        ? await tx
            .select({
              accountId: journalLines.accountId,
              accountCode: accounts.code,
              accountName: accounts.name,
              partnerId: journalLines.partnerId,
              partnerName: partners.name,
              debit: journalLines.debit,
              credit: journalLines.credit,
            })
            .from(journalLines)
            .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
            .leftJoin(partners, eq(partners.id, journalLines.partnerId))
            .where(eq(journalLines.entryId, entry.id))
            .orderBy(asc(journalLines.lineNo))
        : [];
      const [firstPeriod] = await tx
        .select({ isLocked: accountingPeriods.isLocked })
        .from(accountingPeriods)
        .where(and(eq(accountingPeriods.fiscalYearId, year.id), eq(accountingPeriods.periodNo, 1)));
      return {
        fiscalYearId: year.id,
        entryId: entry?.id ?? null,
        source: entry?.source ?? null,
        locked: firstPeriod?.isLocked ?? false,
        lines,
      };
    });
  }

  /** 기초잔액을 통째로 바꾼다(재무상태표 계정만, 차변 합계 = 대변 합계). 빈 목록이면 지운다. */
  async setOpening(fiscalYearId: string, input: OpeningBalancesInput) {
    await this.db.tenant(async (tx) => {
      const year = await this.getYear(tx, fiscalYearId);
      const lines = input.lines.map((l) => ({ ...l, partnerId: l.partnerId ?? null }));
      if (lines.length > 0) {
        const issues = validateJournal(lines);
        if (issues.length > 0) {
          throw new AppException('JOURNAL_INVALID', issues[0]!.message, HttpStatus.BAD_REQUEST, {
            issues,
          });
        }
        await this.assertBalanceSheetAccounts(tx, lines);
      }
      await this.replaceOpening(tx, year, lines, 'manual');
      await this.audit.record(
        {
          action: 'opening.update',
          entity: 'fiscal_year',
          entityId: year.id,
          after: { lines: lines.length, total: lines.reduce((s, l) => s + l.debit, 0) },
        },
        tx,
      );
    });
    return this.getOpening(fiscalYearId);
  }

  private async assertBalanceSheetAccounts(tx: Transaction, lines: OpeningLine[]) {
    const accountIds = [...new Set(lines.map((l) => l.accountId))];
    const rows = await tx
      .select({ id: accounts.id, name: accounts.name, group: accounts.group })
      .from(accounts)
      .where(inArray(accounts.id, accountIds));
    if (rows.length !== accountIds.length) {
      throw new AppException('ACCOUNT_NOT_FOUND', '없는 계정과목이 있습니다.');
    }
    const incomeAccount = rows.find((a) => STATEMENT_GROUPS[a.group].statement !== 'BS');
    if (incomeAccount) {
      throw new AppException(
        'OPENING_BS_ONLY',
        `기초잔액은 재무상태표 계정만 입력합니다('${incomeAccount.name}'은(는) 손익 계정).`,
      );
    }
    const partnerIds = [...new Set(lines.flatMap((l) => (l.partnerId ? [l.partnerId] : [])))];
    if (partnerIds.length > 0) {
      const found = await tx
        .select({ id: partners.id })
        .from(partners)
        .where(inArray(partners.id, partnerIds));
      if (found.length !== partnerIds.length) {
        throw new AppException('PARTNER_NOT_FOUND', '없는 거래처가 있습니다.');
      }
    }
  }

  private async replaceOpening(
    tx: Transaction,
    year: FiscalYearRow,
    lines: OpeningLine[],
    source: 'manual' | 'carry_forward',
  ) {
    const { companyId, userId } = requireCompanyContext();
    await this.assertOpen(tx, year.startDate);
    const [existing] = await tx
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(and(eq(journalEntries.fiscalYearId, year.id), eq(journalEntries.type, 'opening')));
    if (lines.length === 0) {
      if (existing) await tx.delete(journalEntries).where(eq(journalEntries.id, existing.id));
      return;
    }
    const totalAmount = lines.reduce((s, l) => s + l.debit, 0);
    let entryId: string;
    if (existing) {
      entryId = existing.id;
      await tx.delete(journalLines).where(eq(journalLines.entryId, entryId));
      await tx
        .update(journalEntries)
        .set({ totalAmount, source, updatedAt: new Date(), updatedBy: userId })
        .where(eq(journalEntries.id, entryId));
    } else {
      const now = new Date();
      const [row] = await tx
        .insert(journalEntries)
        .values({
          companyId,
          fiscalYearId: year.id,
          entryDate: year.startDate,
          entryNo: 0,
          type: 'opening',
          status: 'posted',
          description: '기초잔액',
          source,
          totalAmount,
          createdBy: userId,
          updatedBy: userId,
          postedAt: now,
          postedBy: userId,
        })
        .returning({ id: journalEntries.id });
      entryId = row!.id;
    }
    await tx.insert(journalLines).values(
      lines.map((l, i) => ({
        companyId,
        entryId,
        lineNo: i + 1,
        accountId: l.accountId,
        partnerId: l.partnerId,
        debit: l.debit,
        credit: l.credit,
      })),
    );
  }

  /**
   * 회계연도 말 잔액을 다음 연도 기초잔액으로 옮긴다(다시 실행하면 새 잔액으로 덮어쓴다).
   * 손익 계정은 당기순이익으로 합쳐 이월이익잉여금에 더한다.
   */
  async carryForward(fiscalYearId: string) {
    const { companyId } = requireCompanyContext();
    return this.db.tenant(async (tx) => {
      const year = await this.getYear(tx, fiscalYearId);
      const next = await this.ensureFor(tx, addDays(year.endDate, 1));

      const rows = await tx
        .select({
          accountId: journalLines.accountId,
          partnerId: journalLines.partnerId,
          group: accounts.group,
          debit: sum(journalLines.debit).mapWith(Number),
          credit: sum(journalLines.credit).mapWith(Number),
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
        .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
        .where(
          and(
            eq(journalEntries.fiscalYearId, year.id),
            inArray(journalEntries.status, [...LEDGER_STATUSES]),
          ),
        )
        .groupBy(journalLines.accountId, journalLines.partnerId, accounts.group);

      let [retained] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.code, SYSTEM_ACCOUNTS.retainedEarnings));
      if (!retained) {
        await ensureStandardAccounts(tx, companyId);
        [retained] = await tx
          .select({ id: accounts.id })
          .from(accounts)
          .where(eq(accounts.code, SYSTEM_ACCOUNTS.retainedEarnings));
      }
      const { lines, netIncome } = carryForwardLines(rows, retained!.id);
      await this.replaceOpening(tx, next, lines, 'carry_forward');
      await tx
        .update(fiscalYears)
        .set({ carriedForwardAt: new Date() })
        .where(eq(fiscalYears.id, year.id));
      await this.audit.record(
        {
          action: 'fiscal_year.carry_forward',
          entity: 'fiscal_year',
          entityId: year.id,
          after: { nextFiscalYearId: next.id, lines: lines.length, netIncome },
        },
        tx,
      );
      return { nextFiscalYearId: next.id, lines: lines.length, netIncome };
    });
  }
}
