import { HttpStatus, Injectable } from '@nestjs/common';
import { STATEMENT_GROUPS } from '@wellbuddy/accounting-core';
import { accounts, departments, journalEntries, journalLines, projects } from '@wellbuddy/db';
import { LEDGER_STATUSES } from '@wellbuddy/shared';
import { and, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import { AppException } from '../common/errors.js';
import { DbService } from '../db/db.service.js';
import { FiscalYearsService } from './fiscal-years.service.js';

export type Dimension = 'department' | 'project';
type Category = 'revenue' | 'expense';

/**
 * 부서·프로젝트별 손익: 기간 안 손익 계정 금액을 전표 줄의 부서(또는 프로젝트)별로 나눈다.
 * 부서·프로젝트를 붙이지 않은 줄은 "미지정" 열로 모아, 열 합계가 손익계산서와 같게 한다.
 */
@Injectable()
export class DimensionReportService {
  constructor(
    private readonly db: DbService,
    private readonly fiscal: FiscalYearsService,
  ) {}

  async report(from: string, to: string, dimension: Dimension) {
    return this.db.tenant(async (tx) => {
      if (from > to) throw new AppException('RANGE_INVALID', '시작일이 종료일보다 늦습니다.');
      const year = await this.fiscal.rangeFor(tx, to);
      if (from < year.startDate) {
        throw new AppException(
          'RANGE_SPANS_FISCAL_YEARS',
          `조회 기간은 한 회계연도(${year.startDate} ~ ${year.endDate}) 안이어야 합니다.`,
          HttpStatus.BAD_REQUEST,
        );
      }
      const column =
        dimension === 'department' ? journalLines.departmentId : journalLines.projectId;
      const table = dimension === 'department' ? departments : projects;
      const rows = await tx
        .select({
          accountId: accounts.id,
          code: accounts.code,
          name: accounts.name,
          group: accounts.group,
          dimensionId: column,
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
            gte(journalEntries.entryDate, from),
            lte(journalEntries.entryDate, to),
          ),
        )
        .groupBy(accounts.id, column);

      const pl = rows.flatMap((r) => {
        const category = STATEMENT_GROUPS[r.group].category;
        if (category !== 'revenue' && category !== 'expense') return [];
        const amount = category === 'revenue' ? r.credit - r.debit : r.debit - r.credit;
        return amount === 0 ? [] : [{ ...r, category: category as Category, amount }];
      });

      const ids = [...new Set(pl.flatMap((r) => (r.dimensionId ? [r.dimensionId] : [])))];
      const found =
        ids.length === 0
          ? []
          : await tx
              .select({ id: table.id, code: table.code, name: table.name })
              .from(table)
              .where(inArray(table.id, ids))
              .orderBy(table.code);
      const columns: { id: string | null; code: string | null; name: string }[] = [
        ...found,
        ...(pl.some((r) => !r.dimensionId) ? [{ id: null, code: null, name: '미지정' }] : []),
      ];
      const indexOf = new Map(columns.map((c, i) => [c.id, i]));

      const byAccount = new Map<
        string,
        { accountId: string; code: string; name: string; category: Category; amounts: number[] }
      >();
      for (const r of pl) {
        const line = byAccount.get(r.accountId) ?? {
          accountId: r.accountId,
          code: r.code,
          name: r.name,
          category: r.category,
          amounts: columns.map(() => 0),
        };
        line.amounts[indexOf.get(r.dimensionId)!]! += r.amount;
        byAccount.set(r.accountId, line);
      }
      const lines = [...byAccount.values()]
        .sort((a, b) =>
          a.category === b.category
            ? a.code.localeCompare(b.code)
            : a.category === 'revenue'
              ? -1
              : 1,
        )
        .map((l) => ({ ...l, total: l.amounts.reduce((s, v) => s + v, 0) }));
      const sumBy = (category: Category) =>
        columns.map((_, i) =>
          lines.filter((l) => l.category === category).reduce((s, l) => s + l.amounts[i]!, 0),
        );
      const revenue = sumBy('revenue');
      const expense = sumBy('expense');
      const profit = columns.map((_, i) => revenue[i]! - expense[i]!);
      const total = (values: number[]) => values.reduce((s, v) => s + v, 0);
      return {
        from,
        to,
        dimension,
        columns,
        lines,
        revenue,
        expense,
        profit,
        totals: { revenue: total(revenue), expense: total(expense), profit: total(profit) },
      };
    });
  }
}
