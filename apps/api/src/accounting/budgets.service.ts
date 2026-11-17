import { Injectable, NotFoundException } from '@nestjs/common';
import {
  addDays,
  monthlyPeriods,
  STATEMENT_GROUPS,
  type StatementGroup,
} from '@wellbuddy/accounting-core';
import {
  accounts,
  budgets,
  departments,
  fiscalYears,
  journalEntries,
  journalLines,
  type Transaction,
} from '@wellbuddy/db';
import { type BudgetReportQuery, type BudgetSaveInput, LEDGER_STATUSES } from '@wellbuddy/shared';
import { and, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/errors.js';
import { requireCompanyContext } from '../common/request-context.js';
import { DbService } from '../db/db.service.js';

type Category = 'revenue' | 'expense';

const categoryOf = (group: StatementGroup): Category | null => {
  const c = STATEMENT_GROUPS[group].category;
  return c === 'revenue' || c === 'expense' ? c : null;
};

/** 1~12번째 기간(월) 금액 배열 */
const emptyMonths = () => Array.from({ length: 12 }, () => 0);

/**
 * 예산 편성과 예산 대비 실적.
 * - 예산은 회계연도·손익 계정·부서(없으면 부서 미지정)·월별로 둔다.
 * - 실적은 전기·역분개된 전표(기초잔액 제외)의 손익 계정 금액이다. 수익은 대변 − 차변, 비용은 차변 − 대변.
 */
@Injectable()
export class BudgetsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private async year(tx: Transaction, id: string) {
    const [row] = await tx.select().from(fiscalYears).where(eq(fiscalYears.id, id));
    if (!row) throw new NotFoundException();
    return row;
  }

  private periods(startDate: string) {
    return monthlyPeriods(startDate).map((p) => ({
      periodNo: p.periodNo,
      month: p.startDate.slice(0, 7),
    }));
  }

  /** 기간 안 손익 계정의 (계정, 월)별 실적 */
  private async actuals(
    tx: Transaction,
    startDate: string,
    endDate: string,
    departmentId: string | null | undefined,
  ) {
    const month = sql<string>`to_char(${journalEntries.entryDate}, 'YYYY-MM')`;
    const rows = await tx
      .select({
        accountId: accounts.id,
        code: accounts.code,
        name: accounts.name,
        group: accounts.group,
        month,
        debit: sql<number>`coalesce(sum(${journalLines.debit}), 0)`.mapWith(Number),
        credit: sql<number>`coalesce(sum(${journalLines.credit}), 0)`.mapWith(Number),
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(
        and(
          inArray(journalEntries.status, [...LEDGER_STATUSES]),
          ne(journalEntries.type, 'opening'),
          gte(journalEntries.entryDate, startDate),
          lte(journalEntries.entryDate, endDate),
          departmentId ? eq(journalLines.departmentId, departmentId) : undefined,
        ),
      )
      .groupBy(accounts.id, month);
    return rows.flatMap((r) => {
      const category = categoryOf(r.group);
      if (!category) return [];
      const amount = category === 'revenue' ? r.credit - r.debit : r.debit - r.credit;
      return [{ ...r, category, amount }];
    });
  }

  // ── 편성 ─────────────────────────────────────────────

  async get(fiscalYearId: string, departmentId: string | null) {
    return this.db.tenant(async (tx) => {
      const year = await this.year(tx, fiscalYearId);
      const rows = await tx
        .select({
          accountId: accounts.id,
          code: accounts.code,
          name: accounts.name,
          group: accounts.group,
          periodNo: budgets.periodNo,
          amount: budgets.amount,
        })
        .from(budgets)
        .innerJoin(accounts, eq(accounts.id, budgets.accountId))
        .where(
          and(
            eq(budgets.fiscalYearId, fiscalYearId),
            departmentId ? eq(budgets.departmentId, departmentId) : isNull(budgets.departmentId),
          ),
        )
        .orderBy(accounts.code, budgets.periodNo);
      const lines = new Map<
        string,
        { accountId: string; code: string; name: string; group: StatementGroup; months: number[] }
      >();
      for (const r of rows) {
        const line = lines.get(r.accountId) ?? {
          accountId: r.accountId,
          code: r.code,
          name: r.name,
          group: r.group,
          months: emptyMonths(),
        };
        line.months[r.periodNo - 1] = r.amount;
        lines.set(r.accountId, line);
      }
      return {
        fiscalYearId,
        fiscalYear: year.label,
        departmentId,
        periods: this.periods(year.startDate),
        lines: [...lines.values()].map((l) => ({
          ...l,
          total: l.months.reduce((s, v) => s + v, 0),
        })),
      };
    });
  }

  async save(input: BudgetSaveInput) {
    const { companyId } = requireCompanyContext();
    const departmentId = input.departmentId ?? null;
    await this.db.tenant(async (tx) => {
      await this.year(tx, input.fiscalYearId);
      const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
      if (accountIds.length !== input.lines.length) {
        throw new AppException('BUDGET_DUPLICATE_ACCOUNT', '같은 계정이 두 번 들어 있습니다.');
      }
      if (accountIds.length > 0) {
        const found = await tx
          .select({ id: accounts.id, name: accounts.name, group: accounts.group })
          .from(accounts)
          .where(inArray(accounts.id, accountIds));
        if (found.length !== accountIds.length) {
          throw new AppException('ACCOUNT_NOT_FOUND', '없는 계정과목이 있습니다.');
        }
        const notPl = found.find((a) => !categoryOf(a.group));
        if (notPl) {
          throw new AppException(
            'BUDGET_ACCOUNT_INVALID',
            `예산은 수익·비용 계정에만 편성합니다('${notPl.name}'은(는) 재무상태표 계정).`,
          );
        }
      }
      if (departmentId) {
        const [dept] = await tx
          .select({ id: departments.id })
          .from(departments)
          .where(eq(departments.id, departmentId));
        if (!dept) throw new AppException('NOT_FOUND', '없는 부서입니다.');
      }
      await tx
        .delete(budgets)
        .where(
          and(
            eq(budgets.fiscalYearId, input.fiscalYearId),
            departmentId ? eq(budgets.departmentId, departmentId) : isNull(budgets.departmentId),
          ),
        );
      const values = input.lines.flatMap((l) =>
        l.months.flatMap((amount, i) =>
          amount > 0
            ? [
                {
                  companyId,
                  fiscalYearId: input.fiscalYearId,
                  accountId: l.accountId,
                  departmentId,
                  periodNo: i + 1,
                  amount,
                },
              ]
            : [],
        ),
      );
      if (values.length > 0) await tx.insert(budgets).values(values);
      await this.audit.record(
        {
          action: 'budget.save',
          entity: 'budget',
          after: {
            fiscalYearId: input.fiscalYearId,
            departmentId,
            accounts: input.lines.length,
            total: values.reduce((s, v) => s + v.amount, 0),
          },
        },
        tx,
      );
    });
    return this.get(input.fiscalYearId, departmentId);
  }

  /** 전년도 같은 달 실적(예산 편성 참고용). 음수는 0 으로 */
  async suggest(fiscalYearId: string, departmentId: string | null) {
    return this.db.tenant(async (tx) => {
      const year = await this.year(tx, fiscalYearId);
      const prevEnd = addDays(year.startDate, -1);
      const [prev] = await tx
        .select()
        .from(fiscalYears)
        .where(and(lte(fiscalYears.startDate, prevEnd), gte(fiscalYears.endDate, prevEnd)));
      if (!prev) return { fiscalYear: null, lines: [] };
      const months = this.periods(prev.startDate).map((p) => p.month);
      const rows = await this.actuals(tx, prev.startDate, prev.endDate, departmentId);
      const lines = new Map<
        string,
        { accountId: string; code: string; name: string; group: StatementGroup; months: number[] }
      >();
      for (const r of rows) {
        const i = months.indexOf(r.month);
        if (i < 0) continue;
        const line = lines.get(r.accountId) ?? {
          accountId: r.accountId,
          code: r.code,
          name: r.name,
          group: r.group,
          months: emptyMonths(),
        };
        line.months[i] = Math.max(r.amount, 0);
        lines.set(r.accountId, line);
      }
      return {
        fiscalYear: prev.label,
        lines: [...lines.values()]
          .filter((l) => l.months.some((v) => v > 0))
          .sort((a, b) => a.code.localeCompare(b.code))
          .map((l) => ({ ...l, total: l.months.reduce((s, v) => s + v, 0) })),
      };
    });
  }

  // ── 예산 대비 실적 ───────────────────────────────────

  async report(q: BudgetReportQuery) {
    return this.db.tenant(async (tx) => {
      const year = await this.year(tx, q.fiscalYearId);
      const periods = this.periods(year.startDate);
      const through = q.throughPeriod ?? 12;
      const monthsToDate = new Set(periods.slice(0, through).map((p) => p.month));

      const budgetRows = await tx
        .select({
          accountId: accounts.id,
          code: accounts.code,
          name: accounts.name,
          group: accounts.group,
          periodNo: budgets.periodNo,
          amount: sql<number>`sum(${budgets.amount})`.mapWith(Number),
        })
        .from(budgets)
        .innerJoin(accounts, eq(accounts.id, budgets.accountId))
        .where(
          and(
            eq(budgets.fiscalYearId, q.fiscalYearId),
            q.departmentId ? eq(budgets.departmentId, q.departmentId) : undefined,
          ),
        )
        .groupBy(accounts.id, budgets.periodNo);
      const actualRows = await this.actuals(tx, year.startDate, year.endDate, q.departmentId);

      interface Row {
        accountId: string;
        code: string;
        name: string;
        group: StatementGroup;
        category: Category;
        budget: number;
        budgetToDate: number;
        actualToDate: number;
      }
      const rows = new Map<string, Row>();
      const rowOf = (r: {
        accountId: string;
        code: string;
        name: string;
        group: StatementGroup;
      }) => {
        const existing = rows.get(r.accountId);
        if (existing) return existing;
        const created: Row = {
          accountId: r.accountId,
          code: r.code,
          name: r.name,
          group: r.group,
          category: categoryOf(r.group)!,
          budget: 0,
          budgetToDate: 0,
          actualToDate: 0,
        };
        rows.set(r.accountId, created);
        return created;
      };
      for (const b of budgetRows) {
        if (!categoryOf(b.group)) continue;
        const row = rowOf(b);
        row.budget += b.amount;
        if (b.periodNo <= through) row.budgetToDate += b.amount;
      }
      for (const a of actualRows) {
        if (!monthsToDate.has(a.month)) continue;
        rowOf(a).actualToDate += a.amount;
      }

      const lines = [...rows.values()]
        .filter((r) => r.budget !== 0 || r.actualToDate !== 0)
        .sort((a, b) =>
          a.category === b.category
            ? a.code.localeCompare(b.code)
            : a.category === 'revenue'
              ? -1
              : 1,
        )
        .map((r) => ({
          ...r,
          /** 누계 예산 − 누계 실적(비용은 음수면 초과, 수익은 양수면 미달) */
          variance: r.budgetToDate - r.actualToDate,
          /** 집행률·달성률(%) */
          rate:
            r.budgetToDate > 0 ? Math.round((r.actualToDate / r.budgetToDate) * 1000) / 10 : null,
          exceeded: r.category === 'expense' && r.actualToDate > r.budgetToDate,
        }));
      const sum = (category: Category, key: 'budget' | 'budgetToDate' | 'actualToDate') =>
        lines.filter((l) => l.category === category).reduce((s, l) => s + l[key], 0);
      const totals = (category: Category) => ({
        budget: sum(category, 'budget'),
        budgetToDate: sum(category, 'budgetToDate'),
        actualToDate: sum(category, 'actualToDate'),
      });
      const revenue = totals('revenue');
      const expense = totals('expense');
      return {
        fiscalYear: year.label,
        departmentId: q.departmentId ?? null,
        throughPeriod: through,
        throughMonth: periods[through - 1]!.month,
        lines,
        revenue,
        expense,
        profit: {
          budget: revenue.budget - expense.budget,
          budgetToDate: revenue.budgetToDate - expense.budgetToDate,
          actualToDate: revenue.actualToDate - expense.actualToDate,
        },
      };
    });
  }
}
