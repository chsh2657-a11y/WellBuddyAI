import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import {
  type AccountTotals,
  AGING_LABELS,
  agingBuckets,
  balanceSheet,
  incomeStatement,
  monthlyPeriods,
  STATEMENT_GROUPS,
  SYSTEM_ACCOUNTS,
  trialBalance,
} from '@wellbuddy/accounting-core';
import { accounts, journalEntries, journalLines, partners, type Transaction } from '@wellbuddy/db';
import { formatJournalNo, LEDGER_STATUSES } from '@wellbuddy/shared';
import { and, asc, count, eq, gte, inArray, lt, lte, ne, or, type SQL, sql } from 'drizzle-orm';
import { todayKst } from '../common/dates.js';
import { AppException } from '../common/errors.js';
import { DbService } from '../db/db.service.js';
import { FiscalYearsService } from './fiscal-years.service.js';

/** 장부에 반영되는 전표(전기·역분개됨) */
const inLedger = inArray(journalEntries.status, [...LEDGER_STATUSES]);
const notOpening = ne(journalEntries.type, 'opening');
const won = (column: SQL | typeof journalLines.debit | typeof journalLines.credit) =>
  sql<number>`coalesce(sum(${column}), 0)`.mapWith(Number);

/** 채권·채무 계정(연령분석 기본값) */
const RECEIVABLE_CODES = [SYSTEM_ACCOUNTS.accountsReceivable, '110', '120'];
const PAYABLE_CODES = [SYSTEM_ACCOUNTS.accountsPayable, '252', SYSTEM_ACCOUNTS.otherPayable];
const CASH_CODES = [SYSTEM_ACCOUNTS.cash];
const DEPOSIT_CODES = ['102', SYSTEM_ACCOUNTS.bankDeposit];

type Range = { startDate: string; endDate: string; label: string };

/**
 * 장부·보고서. 모든 금액은 전기·역분개된 전표만 집계한다.
 * 잔액은 회계연도 안에서 누적한다(전년도 잔액은 기초잔액 전표로 들어온다).
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly db: DbService,
    private readonly fiscal: FiscalYearsService,
  ) {}

  // ── 공통 ─────────────────────────────────────────────

  /** 조회 기간은 한 회계연도 안이어야 한다 */
  private async yearOfRange(tx: Transaction, from: string, to: string): Promise<Range> {
    if (from > to) {
      throw new AppException('RANGE_INVALID', '시작일이 종료일보다 늦습니다.');
    }
    const year = await this.fiscal.rangeFor(tx, to);
    if (from < year.startDate) {
      throw new AppException(
        'RANGE_SPANS_FISCAL_YEARS',
        `조회 기간은 한 회계연도(${year.startDate} ~ ${year.endDate}) 안이어야 합니다.`,
        HttpStatus.BAD_REQUEST,
      );
    }
    return year;
  }

  /** 계정별 차변·대변 합계 */
  private totals(
    tx: Transaction,
    from: string,
    to: string,
    includeOpening: boolean,
  ): Promise<AccountTotals[]> {
    return tx
      .select({
        accountId: accounts.id,
        code: accounts.code,
        name: accounts.name,
        group: accounts.group,
        normalBalance: accounts.normalBalance,
        debit: won(journalLines.debit),
        credit: won(journalLines.credit),
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(
        and(
          inLedger,
          gte(journalEntries.entryDate, from),
          lte(journalEntries.entryDate, to),
          includeOpening ? undefined : notOpening,
        ),
      )
      .groupBy(accounts.id);
  }

  private async account(tx: Transaction, id: string) {
    const [row] = await tx
      .select({
        id: accounts.id,
        code: accounts.code,
        name: accounts.name,
        group: accounts.group,
        normalBalance: accounts.normalBalance,
      })
      .from(accounts)
      .where(eq(accounts.id, id));
    if (!row) throw new NotFoundException();
    return row;
  }

  private async accountIdsByCode(tx: Transaction, codes: string[]) {
    const rows = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(inArray(accounts.code, codes));
    return rows.map((r) => r.id);
  }

  // ── 일계표·월계표 ─────────────────────────────────────

  /**
   * 일계표(하루)·월계표(한 달): 계정별 차변·대변을 현금 거래와 대체 거래로 나눈다.
   * 현금 계정이 들어 있는 전표의 다른 줄은 "현금", 나머지는 "대체"다.
   */
  async dailySummary(from: string, to: string) {
    return this.db.tenant(async (tx) => {
      const year = await this.yearOfRange(tx, from, to);
      const [cash] = await this.accountIdsByCode(tx, CASH_CODES);
      const hasCash = cash
        ? sql<boolean>`exists (select 1 from ${journalLines} x where x.entry_id = ${journalEntries.id} and x.account_id = ${cash})`
        : sql<boolean>`false`;
      const rows = await tx
        .select({
          accountId: accounts.id,
          code: accounts.code,
          name: accounts.name,
          group: accounts.group,
          debitCash: won(sql`case when ${hasCash} then ${journalLines.debit} else 0 end`),
          debitTransfer: won(sql`case when ${hasCash} then 0 else ${journalLines.debit} end`),
          creditCash: won(sql`case when ${hasCash} then ${journalLines.credit} else 0 end`),
          creditTransfer: won(sql`case when ${hasCash} then 0 else ${journalLines.credit} end`),
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
        .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
        .where(
          and(
            inLedger,
            notOpening,
            gte(journalEntries.entryDate, from),
            lte(journalEntries.entryDate, to),
            cash ? ne(journalLines.accountId, cash) : undefined,
          ),
        )
        .groupBy(accounts.id)
        .orderBy(asc(accounts.code));

      const sumOf = (key: 'debitCash' | 'debitTransfer' | 'creditCash' | 'creditTransfer') =>
        rows.reduce((s, r) => s + r[key], 0);
      const totals = {
        debitCash: sumOf('debitCash'),
        debitTransfer: sumOf('debitTransfer'),
        creditCash: sumOf('creditCash'),
        creditTransfer: sumOf('creditTransfer'),
      };
      const opening = cash ? await this.balance(tx, [cash], year.startDate, from, false) : 0;
      return {
        from,
        to,
        rows: rows.map((r) => ({ ...r, groupLabel: STATEMENT_GROUPS[r.group].label })),
        totals,
        cash: {
          opening,
          receipts: totals.creditCash,
          payments: totals.debitCash,
          closing: opening + totals.creditCash - totals.debitCash,
        },
      };
    });
  }

  /**
   * 계정들의 (차변 - 대변) 잔액: 회계연도 시작부터 before 전날까지(기초잔액 포함).
   * inclusive 면 before 당일까지.
   */
  private async balance(
    tx: Transaction,
    accountIds: string[],
    yearStart: string,
    before: string,
    inclusive: boolean,
    partnerId?: string,
  ): Promise<number> {
    if (accountIds.length === 0) return 0;
    const [row] = await tx
      .select({ net: won(sql`${journalLines.debit} - ${journalLines.credit}`) })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .where(
        and(
          inLedger,
          inArray(journalLines.accountId, accountIds),
          partnerId ? eq(journalLines.partnerId, partnerId) : undefined,
          gte(journalEntries.entryDate, yearStart),
          or(
            inclusive
              ? lte(journalEntries.entryDate, before)
              : lt(journalEntries.entryDate, before),
            eq(journalEntries.type, 'opening'),
          ),
        ),
      );
    return row?.net ?? 0;
  }

  // ── 원장 ─────────────────────────────────────────────

  /** 계정별원장(거래처를 주면 거래처원장, 현금 계정이면 현금출납장) */
  async accountLedger(q: { accountId: string; from: string; to: string; partnerId?: string }) {
    return this.db.tenant(async (tx) => {
      const year = await this.yearOfRange(tx, q.from, q.to);
      const account = await this.account(tx, q.accountId);
      let partner: { id: string; name: string } | null = null;
      if (q.partnerId) {
        const [p] = await tx
          .select({ id: partners.id, name: partners.name })
          .from(partners)
          .where(eq(partners.id, q.partnerId));
        if (!p) throw new NotFoundException();
        partner = p;
      }
      const sign = account.normalBalance === 'debit' ? 1 : -1;
      const opening =
        sign * (await this.balance(tx, [account.id], year.startDate, q.from, false, q.partnerId));

      const lines = await tx
        .select({
          lineId: journalLines.id,
          entryId: journalEntries.id,
          entryDate: journalEntries.entryDate,
          entryNo: journalEntries.entryNo,
          description: journalEntries.description,
          memo: journalLines.memo,
          partnerName: partners.name,
          debit: journalLines.debit,
          credit: journalLines.credit,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
        .leftJoin(partners, eq(partners.id, journalLines.partnerId))
        .where(
          and(
            inLedger,
            notOpening,
            eq(journalLines.accountId, account.id),
            q.partnerId ? eq(journalLines.partnerId, q.partnerId) : undefined,
            gte(journalEntries.entryDate, q.from),
            lte(journalEntries.entryDate, q.to),
          ),
        )
        .orderBy(
          asc(journalEntries.entryDate),
          asc(journalEntries.entryNo),
          asc(journalLines.lineNo),
        );

      // 상대 계정: 같은 전표의 다른 계정(여러 개면 "첫 계정 외 n")
      const entryIds = [...new Set(lines.map((l) => l.entryId))];
      const others =
        entryIds.length === 0
          ? []
          : await tx
              .select({ entryId: journalLines.entryId, name: accounts.name })
              .from(journalLines)
              .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
              .where(
                and(
                  inArray(journalLines.entryId, entryIds),
                  ne(journalLines.accountId, account.id),
                ),
              )
              .orderBy(asc(journalLines.lineNo));
      const counterOf = new Map<string, string>();
      for (const id of entryIds) {
        const names = [...new Set(others.filter((o) => o.entryId === id).map((o) => o.name))];
        counterOf.set(
          id,
          names.length <= 1 ? (names[0] ?? '') : `${names[0]} 외 ${names.length - 1}`,
        );
      }

      let running = opening;
      const rows = lines.map((l) => {
        running += sign * (l.debit - l.credit);
        return {
          ...l,
          number: formatJournalNo(l.entryDate, l.entryNo),
          counterAccount: counterOf.get(l.entryId) ?? '',
          balance: running,
        };
      });
      return {
        account: { id: account.id, code: account.code, name: account.name },
        normalBalance: account.normalBalance,
        partner,
        from: q.from,
        to: q.to,
        opening,
        rows,
        totals: {
          debit: rows.reduce((s, r) => s + r.debit, 0),
          credit: rows.reduce((s, r) => s + r.credit, 0),
        },
        closing: running,
      };
    });
  }

  /** 총계정원장: 회계연도의 월별 차변·대변·잔액 */
  async generalLedger(accountId: string, date: string) {
    return this.db.tenant(async (tx) => {
      const year = await this.fiscal.rangeFor(tx, date);
      const account = await this.account(tx, accountId);
      const sign = account.normalBalance === 'debit' ? 1 : -1;
      const [opening] = await tx
        .select({ net: won(sql`${journalLines.debit} - ${journalLines.credit}`) })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
        .where(
          and(
            inLedger,
            eq(journalEntries.type, 'opening'),
            eq(journalLines.accountId, account.id),
            eq(journalEntries.entryDate, year.startDate),
          ),
        );
      const month = sql<string>`to_char(${journalEntries.entryDate}, 'YYYY-MM')`;
      const monthly = await tx
        .select({ month, debit: won(journalLines.debit), credit: won(journalLines.credit) })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
        .where(
          and(
            inLedger,
            notOpening,
            eq(journalLines.accountId, account.id),
            gte(journalEntries.entryDate, year.startDate),
            lte(journalEntries.entryDate, year.endDate),
          ),
        )
        .groupBy(month);
      let running = sign * (opening?.net ?? 0);
      const openingBalance = running;
      const months = monthlyPeriods(year.startDate).map((p) => {
        const m = monthly.find((x) => x.month === p.startDate.slice(0, 7));
        const debit = m?.debit ?? 0;
        const credit = m?.credit ?? 0;
        running += sign * (debit - credit);
        return { month: p.startDate.slice(0, 7), debit, credit, balance: running };
      });
      return {
        account: { id: account.id, code: account.code, name: account.name },
        normalBalance: account.normalBalance,
        fiscalYear: year,
        opening: openingBalance,
        months,
        totals: {
          debit: months.reduce((s, m) => s + m.debit, 0),
          credit: months.reduce((s, m) => s + m.credit, 0),
        },
        closing: running,
      };
    });
  }

  /** 거래처별 잔액(계정 하나): 기초·증가·감소·기말 */
  async partnerBalances(accountId: string, from: string, to: string) {
    return this.db.tenant(async (tx) => {
      const year = await this.yearOfRange(tx, from, to);
      const account = await this.account(tx, accountId);
      const sign = account.normalBalance === 'debit' ? 1 : -1;
      const before = or(lt(journalEntries.entryDate, from), eq(journalEntries.type, 'opening'))!;
      const rows = await tx
        .select({
          partnerId: journalLines.partnerId,
          partnerName: partners.name,
          partnerCode: partners.code,
          openingNet: won(
            sql`case when ${before} then ${journalLines.debit} - ${journalLines.credit} else 0 end`,
          ),
          debit: won(sql`case when ${before} then 0 else ${journalLines.debit} end`),
          credit: won(sql`case when ${before} then 0 else ${journalLines.credit} end`),
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
        .leftJoin(partners, eq(partners.id, journalLines.partnerId))
        .where(
          and(
            inLedger,
            eq(journalLines.accountId, account.id),
            gte(journalEntries.entryDate, year.startDate),
            lte(journalEntries.entryDate, to),
          ),
        )
        .groupBy(journalLines.partnerId, partners.name, partners.code)
        .orderBy(asc(partners.name));
      const result = rows
        .map((r) => {
          const opening = sign * r.openingNet;
          return {
            partnerId: r.partnerId,
            partnerCode: r.partnerCode,
            partnerName: r.partnerName ?? '(거래처 없음)',
            opening,
            debit: r.debit,
            credit: r.credit,
            closing: opening + sign * (r.debit - r.credit),
          };
        })
        .filter((r) => r.opening !== 0 || r.debit !== 0 || r.credit !== 0);
      return {
        account: { id: account.id, code: account.code, name: account.name },
        normalBalance: account.normalBalance,
        from,
        to,
        rows: result,
        totals: {
          opening: result.reduce((s, r) => s + r.opening, 0),
          debit: result.reduce((s, r) => s + r.debit, 0),
          credit: result.reduce((s, r) => s + r.credit, 0),
          closing: result.reduce((s, r) => s + r.closing, 0),
        },
      };
    });
  }

  // ── 시산표·재무제표 ───────────────────────────────────

  /** 합계잔액시산표(회계연도 시작 ~ 기준일 누적) */
  async trialBalance(date: string) {
    return this.db.tenant(async (tx) => {
      const year = await this.fiscal.rangeFor(tx, date);
      const tb = trialBalance(await this.totals(tx, year.startDate, date, true));
      return {
        date,
        fiscalYear: year,
        rows: tb.rows.map((r) => ({ ...r, groupLabel: STATEMENT_GROUPS[r.group].label })),
        totals: tb.totals,
        balanced: tb.balanced,
      };
    });
  }

  /** 손익계산서(기간) */
  async incomeStatement(from: string, to: string) {
    return this.db.tenant(async (tx) => {
      const year = await this.yearOfRange(tx, from, to);
      return {
        from,
        to,
        fiscalYear: year,
        ...incomeStatement(await this.totals(tx, from, to, false)),
      };
    });
  }

  /** 재무상태표(기준일). 당기순이익은 이익잉여금에 포함해 자산 = 부채 + 자본 */
  async balanceSheet(date: string) {
    return this.db.tenant(async (tx) => {
      const year = await this.fiscal.rangeFor(tx, date);
      const cumulative = await this.totals(tx, year.startDate, date, true);
      const netIncome = incomeStatement(cumulative).netIncome;
      return { date, fiscalYear: year, ...balanceSheet(cumulative, netIncome) };
    });
  }

  // ── 채권·채무 ────────────────────────────────────────

  /** 거래처별 채권·채무 잔액과 연령분석(기준일) */
  async aging(kind: 'receivable' | 'payable', date: string) {
    return this.db.tenant(async (tx) => {
      const year = await this.fiscal.rangeFor(tx, date);
      const accountRows = await tx
        .select({ id: accounts.id, code: accounts.code, name: accounts.name })
        .from(accounts)
        .where(inArray(accounts.code, kind === 'receivable' ? RECEIVABLE_CODES : PAYABLE_CODES))
        .orderBy(asc(accounts.code));
      const sign = kind === 'receivable' ? 1 : -1;
      const lines =
        accountRows.length === 0
          ? []
          : await tx
              .select({
                partnerId: journalLines.partnerId,
                partnerName: partners.name,
                entryDate: journalEntries.entryDate,
                debit: journalLines.debit,
                credit: journalLines.credit,
              })
              .from(journalLines)
              .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
              .leftJoin(partners, eq(partners.id, journalLines.partnerId))
              .where(
                and(
                  inLedger,
                  inArray(
                    journalLines.accountId,
                    accountRows.map((a) => a.id),
                  ),
                  gte(journalEntries.entryDate, year.startDate),
                  lte(journalEntries.entryDate, date),
                ),
              );

      const byPartner = new Map<
        string,
        {
          partnerId: string | null;
          partnerName: string;
          balance: number;
          items: { date: string; amount: number }[];
        }
      >();
      for (const l of lines) {
        const key = l.partnerId ?? '';
        const p = byPartner.get(key) ?? {
          partnerId: l.partnerId,
          partnerName: l.partnerName ?? '(거래처 없음)',
          balance: 0,
          items: [],
        };
        const increase = kind === 'receivable' ? l.debit : l.credit;
        p.balance += sign * (l.debit - l.credit);
        if (increase > 0) p.items.push({ date: l.entryDate, amount: increase });
        byPartner.set(key, p);
      }
      const rows = [...byPartner.values()]
        .filter((p) => p.balance !== 0)
        .map((p) => ({
          partnerId: p.partnerId,
          partnerName: p.partnerName,
          balance: p.balance,
          buckets: agingBuckets(p.items, p.balance, date),
        }))
        .sort((a, b) => b.balance - a.balance);
      const buckets = AGING_LABELS.map((_, i) => rows.reduce((s, r) => s + r.buckets[i]!, 0));
      return {
        kind,
        date,
        accounts: accountRows,
        bucketLabels: [...AGING_LABELS],
        rows,
        totals: { balance: rows.reduce((s, r) => s + r.balance, 0), buckets },
      };
    });
  }

  // ── 대시보드 ─────────────────────────────────────────

  async dashboard(date: string = todayKst()) {
    return this.db.tenant(async (tx) => {
      const year = await this.fiscal.rangeFor(tx, date);
      const cumulative = await this.totals(tx, year.startDate, date, true);
      const net = (codes: string[]) =>
        cumulative
          .filter((a) => codes.includes(a.code))
          .reduce((s, a) => s + a.debit - a.credit, 0);

      const month = sql<string>`to_char(${journalEntries.entryDate}, 'YYYY-MM')`;
      const monthly = await tx
        .select({
          month,
          group: accounts.group,
          debit: won(journalLines.debit),
          credit: won(journalLines.credit),
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
        .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
        .where(
          and(
            inLedger,
            notOpening,
            gte(journalEntries.entryDate, year.startDate),
            lte(journalEntries.entryDate, year.endDate),
          ),
        )
        .groupBy(month, accounts.group);
      const months = monthlyPeriods(year.startDate).map((p) => {
        const key = p.startDate.slice(0, 7);
        let revenue = 0;
        let expense = 0;
        for (const m of monthly.filter((x) => x.month === key)) {
          const category = STATEMENT_GROUPS[m.group].category;
          if (category === 'revenue') revenue += m.credit - m.debit;
          if (category === 'expense') expense += m.debit - m.credit;
        }
        return { month: key, revenue, expense };
      });

      const statusCounts = await tx
        .select({ status: journalEntries.status, n: count() })
        .from(journalEntries)
        .where(inArray(journalEntries.status, ['draft', 'pending']))
        .groupBy(journalEntries.status);
      const upToToday = months.filter((m) => m.month <= date.slice(0, 7));
      const revenue = upToToday.reduce((s, m) => s + m.revenue, 0);
      const expense = upToToday.reduce((s, m) => s + m.expense, 0);
      return {
        date,
        fiscalYear: year,
        cash: net(CASH_CODES),
        deposits: net(DEPOSIT_CODES),
        receivables: net(RECEIVABLE_CODES),
        payables: -net(PAYABLE_CODES),
        revenue,
        expense,
        netIncome: incomeStatement(cumulative).netIncome,
        months,
        drafts: statusCounts.find((s) => s.status === 'draft')?.n ?? 0,
        pending: statusCounts.find((s) => s.status === 'pending')?.n ?? 0,
      };
    });
  }
}
